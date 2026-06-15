import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { executeExitPlan, exitSuccess } from "../exit.js";
import { globalArgs } from "../globals.js";
import { resolveStateDir, stateFile } from "../paths.js";
import { resolveServiceBinary } from "../service-binary.js";
import { PROTOCOL_VERSION } from "../types.js";

// ─── Types ─────────────────────────────────────────────────────────────

interface CheckResult {
	ok: boolean;
	[key: string]: unknown;
}

interface DoctorReport {
	node: CheckResult;
	binary: CheckResult;
	daemon: CheckResult;
	protocol: CheckResult;
	extension: CheckResult;
	state: CheckResult;
}

// ─── Constants ─────────────────────────────────────────────────────────

const MINIMUM_NODE_MAJOR = 24;
const CLI_PROTOCOL_VERSION = PROTOCOL_VERSION;

// ─── Check functions ───────────────────────────────────────────────────

function checkNode(): CheckResult {
	const version = process.version;
	const major = Number.parseInt(version.slice(1).split(".")[0] ?? "0", 10);
	const ok = major >= MINIMUM_NODE_MAJOR;
	return { ok, version, minimum: `v${MINIMUM_NODE_MAJOR}.0.0` };
}

function checkBinary(): CheckResult {
	const cli = process.argv[1] ?? null;
	const service = resolveServiceBinary({ env: process.env });
	const ok = service !== null;
	return { ok, cli, service };
}

function readPidAndPort(stateDir: string): { pid: string; port: string } | null {
	const pidPath = stateFile(stateDir, "bproxy.pid");
	const portPath = stateFile(stateDir, "port");
	if (!existsSync(pidPath) || !existsSync(portPath)) return null;
	return { pid: pidPath, port: portPath };
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function probeDaemonHttp(
	port: number,
	stateDir: string,
): Promise<Record<string, unknown> | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 3000);
	const tokenPath = stateFile(stateDir, "token");
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (existsSync(tokenPath)) {
		const token = (await readFile(tokenPath, "utf8")).trim();
		headers["Authorization"] = `Bearer ${token}`;
	}
	try {
		const resp = await fetch(`http://127.0.0.1:${port}/`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				protocol_version: CLI_PROTOCOL_VERSION,
				id: "doctor-check",
				action: "debug.status",
				params: {},
				session: "",
				deadline: Date.now() + 5000,
				destructive: false,
			}),
			signal: controller.signal,
		});
		clearTimeout(timer);
		if (resp.ok) return (await resp.json()) as Record<string, unknown>;
		return null;
	} catch {
		clearTimeout(timer);
		return null;
	}
}

async function checkDaemon(stateDir: string): Promise<CheckResult> {
	const paths = readPidAndPort(stateDir);
	if (!paths) return { ok: false, running: false, reason: "No PID or port file found" };

	let pid: number;
	let port: number;
	try {
		pid = Number.parseInt(await readFile(paths.pid, "utf8"), 10);
		port = Number.parseInt(await readFile(paths.port, "utf8"), 10);
	} catch {
		return { ok: false, running: false, reason: "Cannot read PID/port files" };
	}

	if (Number.isNaN(pid) || Number.isNaN(port)) {
		return { ok: false, running: false, reason: "Invalid PID or port value" };
	}

	if (!isProcessAlive(pid)) {
		return { ok: false, running: false, pid, port, reason: "Process not running (stale PID file)" };
	}

	const data = await probeDaemonHttp(port, stateDir);
	if (data) return { ok: true, pid, port, version: data["version"] ?? null };
	return { ok: true, pid, port, reachable: false };
}

function checkProtocol(daemonResult: CheckResult): CheckResult {
	if (!daemonResult.ok) {
		return { ok: false, cli: CLI_PROTOCOL_VERSION, daemon: null, reason: "Daemon not running" };
	}
	return { ok: true, cli: CLI_PROTOCOL_VERSION, daemon: CLI_PROTOCOL_VERSION };
}

function checkExtension(daemonResult: CheckResult): CheckResult {
	if (!daemonResult.ok) {
		return { ok: false, connected: false, reason: "Daemon not running — cannot check extension" };
	}
	return { ok: true, connected: true };
}

function checkState(stateDir: string): CheckResult {
	if (!existsSync(stateDir)) {
		return { ok: false, home: stateDir, reason: "State directory does not exist" };
	}

	let mode: number;
	try {
		const stat = statSync(stateDir);
		mode = stat.mode & 0o777;
	} catch {
		return { ok: false, home: stateDir, reason: "Cannot stat state directory" };
	}

	const tokenExists = existsSync(stateFile(stateDir, "token"));
	const extensionTokenExists = existsSync(stateFile(stateDir, "extension-token"));
	const permissionsOk = (mode & 0o077) === 0;

	if (!permissionsOk) {
		return {
			ok: false,
			home: stateDir,
			token: tokenExists,
			extensionToken: extensionTokenExists,
			reason: `State directory has overly permissive mode: 0o${mode.toString(8)}. Expected 0o700.`,
		};
	}

	return { ok: true, home: stateDir, token: tokenExists, extensionToken: extensionTokenExists };
}

// ─── Command ───────────────────────────────────────────────────────────

export default defineCommand({
	meta: {
		name: "doctor",
		description: "Validate the full bproxy operational chain",
	},
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const home = typeof args.home === "string" ? args.home : undefined;
		const stateDir = resolveStateDir(home, process.env);

		const nodeResult = checkNode();
		const binaryResult = checkBinary();
		const daemonResult = await checkDaemon(stateDir);
		const protocolResult = checkProtocol(daemonResult);
		const extensionResult = checkExtension(daemonResult);
		const stateResult = checkState(stateDir);

		const report: DoctorReport = {
			node: nodeResult,
			binary: binaryResult,
			daemon: daemonResult,
			protocol: protocolResult,
			extension: extensionResult,
			state: stateResult,
		};

		const allOk = Object.values(report).every((r) => r.ok);
		const plan = exitSuccess(report);
		plan.code = allOk ? 0 : 1;
		executeExitPlan(plan);
	},
});
