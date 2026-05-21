import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ServiceConfig {
	port: number;
	host: string;
	stateDir: string;
	logLevel: "trace" | "debug" | "info" | "warn" | "error";
}

const DEFAULT_PORT = 9615;
const DEFAULT_HOST = "127.0.0.1";
const VALID_LEVELS = new Set(["trace", "debug", "info", "warn", "error"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
	const port = Number.parseInt(env["BPROXY_PORT"] ?? "", 10);
	const level = env["BPROXY_LOG_LEVEL"] ?? "info";
	return {
		port: Number.isFinite(port) && port >= 0 ? port : DEFAULT_PORT,
		host: DEFAULT_HOST,
		stateDir: env["BPROXY_HOME"] ?? resolve(homedir(), ".bproxy"),
		logLevel: VALID_LEVELS.has(level) ? (level as ServiceConfig["logLevel"]) : "info",
	};
}

export function stateFile(
	stateDir: string,
	name: "bproxy.pid" | "port" | "token" | "extension-token" | "pairing.json",
): string {
	return resolve(stateDir, name);
}

export function logDir(stateDir: string): string {
	return resolve(stateDir, "logs");
}
