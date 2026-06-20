/**
 * State-file utilities for daemon lifecycle management.
 *
 * Extracted from lifecycle.ts to keep it under max-lines while satisfying
 * the export-from re-export rule (S7763).
 */

import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import type { ServiceConfig } from "./config";
import { stateFile } from "./config";

// ─── State directory ───────────────────────────────────────────────────

export function ensureStateDir(config: ServiceConfig): void {
	mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
	const st = statSync(config.stateDir);
	if ((st.mode & 0o777) !== 0o700) {
		chmodSync(config.stateDir, 0o700);
	}
}

// ─── PID / port / alive ────────────────────────────────────────────────

interface PidState {
	exists: boolean;
	pid: number | null;
}

export function readPidState(config: ServiceConfig): PidState {
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

export function readPort(config: ServiceConfig): number | undefined {
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

// ─── File permissions ──────────────────────────────────────────────────

export function assertOwnerMode600(
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

// ─── State file CRUD ───────────────────────────────────────────────────

export function removeStateFiles(
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

export function cleanupRuntimeState(config: ServiceConfig): void {
	removeStateFiles(config, ["bproxy.pid", "port", "pairing.json"]);
}

// ─── Token / port / pid writes ─────────────────────────────────────────

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

// ─── Timing helpers ────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!isAlive(pid)) return true;
		await sleep(50);
	}
	return !isAlive(pid);
}

export async function waitForDaemonReady(
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
		await sleep(50);
	}
	throw new Error("startup timeout waiting for daemon readiness");
}
