import { spawn } from "node:child_process";
import { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
import type { LoadedServiceConfig, ServiceConfig } from "./config";
import {
	cleanupRuntimeState,
	clearToken,
	ensureStateDir,
	isAlive,
	readExtensionToken,
	readPid,
	readPidState,
	readPort,
	waitForDaemonReady,
	waitForProcessExit,
	writeExtensionToken,
	writePidFile,
	writePort,
	writeToken,
} from "./lifecycle-state";
import { buildLogger } from "./logger";
import { createPairingStore } from "./pairing";
import { readPairingFile, removePairingFile, writePairingFile } from "./pairing-file";
import { buildServer } from "./server";
import { removeOrphanedTmpFiles, wipeTmpDir } from "./session-tmp";
import { createSessionRegistry } from "./sessions";

export type {
	LifecycleStartResult,
	LifecycleStatusResult,
	LifecycleStopResult,
	PairingMetadata,
} from "./pairing-file";

import type {
	LifecycleStartResult,
	LifecycleStatusResult,
	LifecycleStopResult,
} from "./pairing-file";

export {
	clearToken,
	ensureStateDir,
	isAlive,
	readExtensionToken,
	readPid,
	writeExtensionToken,
	writePidFile,
	writePort,
	writeToken,
} from "./lifecycle-state";
export { readPairingFile, removePairingFile, writePairingFile };

const STARTUP_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;

function persistClaimedExtensionToken(config: ServiceConfig, token: string): void {
	writeExtensionToken(config, token);
	removePairingFile(config);
}

export async function startForeground(config: LoadedServiceConfig): Promise<void> {
	ensureStateDir(config);
	wipeTmpDir(config.stateDir);
	removeOrphanedTmpFiles(config.stateDir);
	const logger = buildLogger(config);
	logger.info({ event: "active_config", daemon: config.daemon });
	const daemonToken = writeToken(config);
	const extensionToken = readExtensionToken(config) ?? "";
	const pairing = createPairingStore({ ttlMs: 300_000, now: () => Date.now() });
	const issued = pairing.issue();
	writePairingFile(config, {
		pairingCode: issued.code,
		pairingExpiresAt: issued.expiresAt,
		issuedAt: Date.now(),
	});
	const built = await buildServer({
		port: config.port,
		stateDir: config.stateDir,
		daemonToken,
		extensionToken,
		logger,
		daemonConfig: config.daemon,
		pairing,
		sessions: createSessionRegistry(),
		onExtensionTokenChanged: (token) => persistClaimedExtensionToken(config, token),
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
				wipeTmpDir(config.stateDir);
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
	if (pidState.exists && pidState.pid !== null) {
		if (isAlive(pidState.pid)) {
			const port = readPort(config);
			return {
				running: true,
				pid: pidState.pid,
				...(port === undefined ? {} : { port }),
				version: VERSION,
				protocolVersion: PROTOCOL_VERSION,
			};
		}
	}
	cleanupRuntimeState(config);
	return { running: false, version: VERSION, protocolVersion: PROTOCOL_VERSION };
}
