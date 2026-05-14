import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { logDir, type ServiceConfig } from "./config";

export type LifecycleEvent =
	| "received"
	| "pacing_wait"
	| "forwarded"
	| "response"
	| "timeout"
	| "replay"
	| "ws_connect"
	| "ws_disconnect"
	| "pacing_config";

export function buildLogger(config: ServiceConfig): Logger {
	const dir = logDir(config.stateDir);
	mkdirSync(dir, { recursive: true });
	const today = new Date().toISOString().slice(0, 10);
	const target = join(dir, `${today}.log`);
	return pino(
		{ level: config.logLevel },
		pino.destination({ dest: target, sync: false, mkdir: true }),
	);
}

export function buildTestLogger(): Logger {
	return pino({ level: "silent" });
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
