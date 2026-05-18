import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { logDir, type ServiceConfig } from "./config";

export function buildLogger(config: ServiceConfig): Logger {
	const dir = logDir(config.stateDir);
	mkdirSync(dir, { recursive: true });
	const today = new Date().toISOString().slice(0, 10);
	const target = join(dir, `${today}.log`);
	// `sync: true` avoids the sonic-boom async-open race: a fast SIGTERM
	// arriving before the worker thread finished opening the file used to
	// crash the daemon (`logger.info()` threw "sonic boom is not ready yet"
	// inside the shutdown handler, killing the process with exit 1).
	// Sync local-file appends are sub-millisecond at the daemon's log rate.
	return pino(
		{ level: config.logLevel },
		pino.destination({ dest: target, sync: true, mkdir: true }),
	);
}

export interface CapturedLogger {
	logger: Logger;
	lines: readonly Record<string, unknown>[];
	clear(): void;
}

export function buildCapturedLogger(): CapturedLogger {
	const lines: Record<string, unknown>[] = [];
	const logger = pino({ level: "trace" }, {
		write(chunk: string) {
			for (const line of chunk.split("\n")) {
				if (!line) continue;
				try {
					lines.push(JSON.parse(line) as Record<string, unknown>);
				} catch {
					/* skip non-JSON */
				}
			}
		},
	} as pino.DestinationStream);
	return {
		logger,
		lines,
		clear() {
			lines.length = 0;
		},
	};
}
