import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { ServiceConfig } from "./config";
import { stateFile } from "./config";
import { buildLogger } from "./logger";
import { createPairingStore } from "./pairing";
import { buildServer } from "./server";
import { createSessionRegistry } from "./sessions";

export function ensureStateDir(config: ServiceConfig): void {
	mkdirSync(config.stateDir, { recursive: true });
}

export function readPid(config: ServiceConfig): number | null {
	const path = stateFile(config.stateDir, "bproxy.pid");
	if (!existsSync(path)) return null;
	const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
	return Number.isFinite(n) ? n : null;
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

export function writeToken(config: ServiceConfig): string {
	ensureStateDir(config);
	const path = stateFile(config.stateDir, "token");
	if (existsSync(path)) {
		const st = statSync(path);
		if ((st.mode & 0o777) !== 0o600) {
			throw new Error(
				`INSECURE_TOKEN_FILE: mode is ${(st.mode & 0o777).toString(8)}, expected 600`,
			);
		}
		const uid = process.getuid?.();
		if (uid !== undefined && st.uid !== uid) {
			throw new Error(`INSECURE_TOKEN_FILE: owned by uid ${st.uid}, expected ${uid}`);
		}
	}
	const token = randomBytes(32).toString("hex");
	writeFileSync(path, token, { mode: 0o600 });
	return token;
}

export function clearToken(config: ServiceConfig): void {
	const path = stateFile(config.stateDir, "token");
	try {
		rmSync(path, { force: true });
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
	const extensionToken = randomBytes(32).toString("base64url");
	const pairing = createPairingStore({ ttlMs: 300_000, now: () => Date.now() });
	const issued = pairing.issue();
	const built = await buildServer({
		port: config.port,
		daemonToken,
		extensionToken,
		logger,
		pairing,
		sessions: createSessionRegistry(),
	});
	const addr = await built.app.listen({ host: config.host, port: config.port });
	const boundPort = Number.parseInt(addr.split(":").pop() ?? String(config.port), 10);
	writePort(config, boundPort);
	writePidFile(config, process.pid);
	process.stdout.write(
		`${JSON.stringify({ pairingCode: issued.code, expiresAt: issued.expiresAt })}\n`,
	);

	const shutdown = (signal: NodeJS.Signals) => {
		void (async () => {
			logger.info({ event: "shutdown", signal });
			await built.app.close();
			clearToken(config);
			try {
				rmSync(stateFile(config.stateDir, "port"), { force: true });
			} catch {
				/* best effort */
			}
			try {
				rmSync(stateFile(config.stateDir, "bproxy.pid"), { force: true });
			} catch {
				/* best effort */
			}
			process.exit(0);
		})();
	};
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}

export function startDetached(config: ServiceConfig): void {
	ensureStateDir(config);
	const bin = process.argv[1];
	if (!bin) throw new Error("cannot determine entry path");
	const child = spawn(process.execPath, [bin, "daemonize"], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	if (child.pid !== undefined) writePidFile(config, child.pid);
}

export function stop(config: ServiceConfig): void {
	const pid = readPid(config);
	if (pid && isAlive(pid)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	for (const name of ["bproxy.pid", "port", "token"] as const) {
		try {
			rmSync(stateFile(config.stateDir, name), { force: true });
		} catch {
			/* best effort */
		}
	}
}

export function status(config: ServiceConfig): { running: boolean; pid?: number; port?: number } {
	const pid = readPid(config);
	if (!pid || !isAlive(pid)) return { running: false };
	const portPath = stateFile(config.stateDir, "port");
	const port = existsSync(portPath)
		? Number.parseInt(readFileSync(portPath, "utf8").trim(), 10)
		: undefined;
	return { running: true, pid, ...(Number.isFinite(port) ? { port } : {}) };
}
