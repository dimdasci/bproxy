import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { executeExitPlan, exitSuccess } from "../exit.js";
import { globalArgs } from "../globals.js";
import { resolveStateDir, stateFile } from "../paths.js";
import { resolveServiceBinary } from "../service-binary.js";
import type { BproxyResponse, BproxySuccessResponse } from "../types.js";
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
	autostart: CheckResult;
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
): Promise<BproxySuccessResponse<"debug.status"> | null> {
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
		if (!resp.ok) return null;
		const body = (await resp.json()) as BproxyResponse<"debug.status">;
		return body.ok ? body : null;
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
	if (!data) {
		return {
			ok: false,
			running: true,
			pid,
			port,
			reachable: false,
			reason: "Process is alive but daemon HTTP status check failed",
		};
	}

	const daemon = data.data.daemon;
	const firstClient = data.data.wsClients[0];
	return {
		ok: true,
		running: true,
		pid,
		port,
		version: daemon.version,
		protocolVersion: daemon.protocolVersion,
		extensionClients: data.data.wsClients.length,
		extensionProtocolVersion: firstClient?.protocolVersion ?? null,
	};
}

function checkProtocol(daemonResult: CheckResult): CheckResult {
	const daemonProtocol = daemonResult["protocolVersion"];
	if (!daemonResult.ok || typeof daemonProtocol !== "number") {
		return { ok: false, cli: CLI_PROTOCOL_VERSION, daemon: null, reason: "Daemon not running" };
	}
	return {
		ok: daemonProtocol === CLI_PROTOCOL_VERSION,
		cli: CLI_PROTOCOL_VERSION,
		daemon: daemonProtocol,
		...(daemonProtocol === CLI_PROTOCOL_VERSION
			? {}
			: { reason: "CLI and daemon protocol versions differ; upgrade both to the same release" }),
	};
}

function checkExtension(daemonResult: CheckResult): CheckResult {
	if (!daemonResult.ok) {
		return { ok: false, connected: false, reason: "Daemon not running — cannot check extension" };
	}
	const connected = Number(daemonResult["extensionClients"] ?? 0) > 0;
	return {
		ok: connected,
		connected,
		protocolVersion: daemonResult["extensionProtocolVersion"] ?? null,
		...(connected
			? {}
			: { reason: "No paired extension WebSocket is connected; load/pair the Chrome extension" }),
	};
}

function checkAutostart(): CheckResult {
	if (process.platform === "darwin") {
		const plist = resolve(homedir(), "Library/LaunchAgents/com.bproxy.daemon.plist");
		return { ok: true, platform: "darwin", installed: existsSync(plist), plist };
	}
	if (process.platform === "linux") {
		const unit = resolve(homedir(), ".config/systemd/user/bproxy.service");
		return { ok: true, platform: "linux", installed: existsSync(unit), unit };
	}
	return {
		ok: false,
		platform: process.platform,
		installed: false,
		reason: "Auto-start install is supported only on macOS and Linux",
	};
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

	return {
		ok: tokenExists && extensionTokenExists,
		home: stateDir,
		token: tokenExists,
		extensionToken: extensionTokenExists,
		...(tokenExists && extensionTokenExists
			? {}
			: { reason: "Expected token and extension-token files; start and pair the daemon" }),
	};
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
		const autostartResult = checkAutostart();

		const report: DoctorReport = {
			node: nodeResult,
			binary: binaryResult,
			daemon: daemonResult,
			protocol: protocolResult,
			extension: extensionResult,
			state: stateResult,
			autostart: autostartResult,
		};

		const allOk = Object.values(report).every((r) => r.ok);
		const plan = exitSuccess(report);
		plan.code = allOk ? 0 : 1;
		executeExitPlan(plan);
	},
});
