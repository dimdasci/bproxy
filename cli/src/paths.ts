/**
 * State directory and file path resolution.
 *
 * Resolution order for BPROXY_HOME:
 *   1. `--home` flag (passed explicitly)
 *   2. `BPROXY_HOME` environment variable
 *   3. `~/.bproxy` (default)
 *
 * Mirrors `service/src/config.ts` conventions without importing it.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_STATE_DIR = ".bproxy";

export type StateFileName = "bproxy.pid" | "port" | "token" | "extension-token" | "pairing.json";

/**
 * Resolve the BPROXY_HOME state directory.
 * @param homeFlag  — explicit `--home` CLI flag value (highest priority)
 * @param env       — process.env for reading BPROXY_HOME
 */
export function resolveStateDir(
	homeFlag: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (homeFlag) return resolve(homeFlag);
	if (env["BPROXY_HOME"]) return resolve(env["BPROXY_HOME"]);
	return resolve(homedir(), DEFAULT_STATE_DIR);
}

/**
 * Resolve an individual state file path within the state directory.
 */
export function stateFile(stateDir: string, name: StateFileName): string {
	return resolve(stateDir, name);
}

/**
 * Resolve the logs directory within the state directory.
 */
export function logDir(stateDir: string): string {
	return resolve(stateDir, "logs");
}

/**
 * Convenience: all commonly-needed file paths in one call.
 */
export interface StatePaths {
	stateDir: string;
	token: string;
	port: string;
	pid: string;
	logs: string;
}

export function resolveStatePaths(
	homeFlag: string | undefined,
	env?: NodeJS.ProcessEnv,
): StatePaths {
	const stateDir = resolveStateDir(homeFlag, env);
	return {
		stateDir,
		token: stateFile(stateDir, "token"),
		port: stateFile(stateDir, "port"),
		pid: stateFile(stateDir, "bproxy.pid"),
		logs: logDir(stateDir),
	};
}
