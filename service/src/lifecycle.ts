import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { ServiceConfig } from "./config";
import { stateFile } from "./config";
import { buildLogger } from "./logger";
import { createPairingStore } from "./pairing";
import type {
	LifecycleStartResult,
	LifecycleStatusResult,
	LifecycleStopResult,
	PairingMetadata,
} from "./pairing-file";
import { readPairingFile, removePairingFile, writePairingFile } from "./pairing-file";
import { buildServer } from "./server";
import { createSessionRegistry } from "./sessions";

export type { LifecycleStartResult, LifecycleStatusResult, LifecycleStopResult, PairingMetadata };
export { readPairingFile, removePairingFile, writePairingFile };

const STARTUP_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
const POLL_MS = 50;

export function ensureStateDir(config: ServiceConfig): void {
	mkdirSync(config.stateDir, { recursive: true });
}

interface PidState {
	exists: boolean;
	pid: number | null;
}

function readPidState(config: ServiceConfig): PidState {
	const path = stateFile(config.stateDir, "bproxy.pid");
	if (!existsSync(path)) return { exists: false, pid: null };
	const raw = readFileSync(path, "utf8").trim();
	const pid = Number.parseInt(raw, 10);
	return {
		exists: true,
		pid: Number.isFinite(pid) && pid > 0 ? pid : null,
	};
}

export function readPid(config: ServiceConfig): number | null {
	return readPidState(config).pid;
}

function readPort(config: ServiceConfig): number | undefined {
	const path = stateFile(config.stateDir, "port");
	if (!existsSync(path)) return undefined;
	const port = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
	return Number.isFinite(port) && port > 0 && port <= 65_535 ? port : undefined;
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		return false;
	}
}

function assertOwnerMode600(
	path: string,
	errCode: "INSECURE_TOKEN_FILE" | "INSECURE_EXTENSION_TOKEN_FILE",
): void {
	const st = statSync(path);
	if ((st.mode & 0o777) !== 0o600) {
		throw new Error(`${errCode}: mode is ${(st.mode & 0o777).toString(8)}, expected 600`);
	}
	const uid = process.getuid?.();
	if (uid !== undefined && st.uid !== uid) {
		throw new Error(`${errCode}: owned by uid ${st.uid}, expected ${uid}`);
	}
}

function removeStateFiles(
	config: ServiceConfig,
	names: readonly ("bproxy.pid" | "port" | "token" | "pairing.json")[],
): void {
	for (const name of names) {
		try {
			rmSync(stateFile(config.stateDir, name), { force: true });
		} catch {
			/* best effort */
		}
	}
}

function cleanupRuntimeState(config: ServiceConfig): void {
	removeStateFiles(config, ["bproxy.pid", "port", "pairing.json"]);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!isAlive(pid)) return true;
		await sleep(POLL_MS);
	}
	return !isAlive(pid);
}

async function waitForDaemonReady(
	config: ServiceConfig,
	pid: number,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!isAlive(pid)) {
			throw new Error("daemon failed during startup");
		}
		const port = readPort(config);
		if (port !== undefined) return;
		await sleep(POLL_MS);
	}
	throw new Error("startup timeout waiting for daemon readiness");
}

export function writeToken(config: ServiceConfig): string {
	ensureStateDir(config);
	const path = stateFile(config.stateDir, "token");
	if (existsSync(path)) assertOwnerMode600(path, "INSECURE_TOKEN_FILE");
	const token = randomBytes(32).toString("hex");
	writeFileSync(path, token, { mode: 0o600 });
	return token;
}

export function readExtensionToken(config: ServiceConfig): string | null {
	ensureStateDir(config);
	const path = stateFile(config.stateDir, "extension-token");
	if (!existsSync(path)) return null;
	assertOwnerMode600(path, "INSECURE_EXTENSION_TOKEN_FILE");
	const token = readFileSync(path, "utf8").trim();
	return token.length > 0 ? token : null;
}

export function writeExtensionToken(config: ServiceConfig, token: string): void {
	ensureStateDir(config);
	const path = stateFile(config.stateDir, "extension-token");
	if (existsSync(path)) assertOwnerMode600(path, "INSECURE_EXTENSION_TOKEN_FILE");
	writeFileSync(path, token, { mode: 0o600 });
}

export function clearToken(config: ServiceConfig): void {
	try {
		rmSync(stateFile(config.stateDir, "token"), { force: true });
	} catch {
		/* best effort */
	}
}

export function writePort(config: ServiceConfig, port: number): void {
	writeFileSync(stateFile(config.stateDir, "port"), String(port));
}

export function writePidFile(config: ServiceConfig, pid: number): void {
	writeFileSync(stateFile(config.stateDir, "bproxy.pid"), String(pid));
}

export async function startForeground(config: ServiceConfig): Promise<void> {
	ensureStateDir(config);
	const logger = buildLogger(config);
	const daemonToken = writeToken(config);
	const extensionToken = readExtensionToken(config) ?? "";
	const pairing = createPairingStore({ ttlMs: 300_000, now: () => Date.now() });
	const issued = pairing.issue();

	// Write pairing metadata atomically for the detached parent to read
	const pairingMeta: PairingMetadata = {
		pairingCode: issued.code,
		pairingExpiresAt: issued.expiresAt,
		issuedAt: Date.now(),
	};
	writePairingFile(config, pairingMeta);

	const built = await buildServer({
		port: config.port,
		daemonToken,
		extensionToken,
		logger,
		pairing,
		sessions: createSessionRegistry(),
		onExtensionTokenChanged: (token) => {
			writeExtensionToken(config, token);
			// Pairing claim succeeded — remove pairing.json
			removePairingFile(config);
		},
	});
	let resolveShutdown!: () => void;
	const shutdownPromise = new Promise<void>((resolve) => {
		resolveShutdown = resolve;
	});
	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals) => {
		if (shuttingDown) return;
		shuttingDown = true;
		void (async () => {
			logger.info({ event: "shutdown", signal });
			try {
				await built.app.close();
			} catch {
				/* best effort */
			} finally {
				clearToken(config);
				cleanupRuntimeState(config);
				resolveShutdown();
			}
		})();
	};
	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	const addr = await built.app.listen({ host: config.host, port: config.port });
	const boundPort = Number.parseInt(addr.split(":").pop() ?? String(config.port), 10);
	writePort(config, boundPort);
	writePidFile(config, process.pid);
	process.stdout.write(
		`${JSON.stringify({ pairingCode: issued.code, expiresAt: issued.expiresAt })}\n`,
	);

	await shutdownPromise;
}

export async function startDetached(config: ServiceConfig): Promise<LifecycleStartResult> {
	ensureStateDir(config);
	const pidState = readPidState(config);
	if (pidState.pid !== null && isAlive(pidState.pid)) {
		throw new Error(`daemon already running (pid ${pidState.pid})`);
	}
	cleanupRuntimeState(config);

	const bin = process.argv[1];
	if (!bin) throw new Error("cannot determine entry path");
	const child = spawn(process.execPath, [bin, "daemonize"], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, BPROXY_HOME: config.stateDir, BPROXY_PORT: String(config.port) },
	});
	child.unref();
	if (child.pid === undefined) {
		throw new Error("failed to spawn daemon");
	}
	writePidFile(config, child.pid);

	try {
		await waitForDaemonReady(config, child.pid, STARTUP_TIMEOUT_MS);
	} catch (error) {
		try {
			if (isAlive(child.pid)) process.kill(child.pid, "SIGTERM");
		} catch {
			/* best effort */
		}
		await waitForProcessExit(child.pid, 1_000);
		clearToken(config);
		cleanupRuntimeState(config);
		throw error;
	}

	const port = readPort(config);
	if (port === undefined) {
		throw new Error("daemon started but port file is missing");
	}

	// Read pairing metadata written by the foreground daemon
	const pairingMeta = readPairingFile(config);
	if (!pairingMeta) {
		throw new Error("daemon started but pairing metadata is missing");
	}

	return {
		running: true,
		pid: child.pid,
		port,
		pairingCode: pairingMeta.pairingCode,
		pairingExpiresAt: pairingMeta.pairingExpiresAt,
	};
}

export async function stop(config: ServiceConfig): Promise<LifecycleStopResult> {
	const pid = readPid(config);
	if (pid !== null && isAlive(pid)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
		await waitForProcessExit(pid, STOP_TIMEOUT_MS);
	}
	// Remove transient state but preserve extension-token for transparent reconnect
	clearToken(config);
	cleanupRuntimeState(config);
	return { running: false };
}

export function status(config: ServiceConfig): LifecycleStatusResult {
	const pidState = readPidState(config);
	if (!pidState.exists || pidState.pid === null) {
		cleanupRuntimeState(config);
		return { running: false };
	}
	if (!isAlive(pidState.pid)) {
		cleanupRuntimeState(config);
		return { running: false };
	}
	const port = readPort(config);
	return { running: true, pid: pidState.pid, ...(port !== undefined ? { port } : {}) };
}
