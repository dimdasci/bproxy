/**
 * Service binary resolution and execution.
 *
 * Resolves the service binary path in this order:
 *   1. BPROXY_SERVICE_BIN environment variable
 *   2. Workspace service/dist/index.mjs (relative to project root)
 *   3. Sibling bproxy-service.mjs in the same directory as this CLI binary
 *   4. `bproxy-service` on PATH
 *
 * The CLI MUST NOT import service source code. It spawns the service binary
 * as a child process and communicates through stdout/stderr/exit codes.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Types ─────────────────────────────────────────────────────────────

export interface ServiceSpawnResult {
	ok: true;
	stdout: string;
}

export interface ServiceSpawnError {
	ok: false;
	exitCode: number;
	stderr: string;
}

export type ServiceExecResult = ServiceSpawnResult | ServiceSpawnError;

export interface ServiceBinaryDeps {
	env?: NodeJS.ProcessEnv;
	existsSync?: (path: string) => boolean;
	which?: (name: string) => string | null;
}

// ─── Binary resolution ─────────────────────────────────────────────────

/**
 * Locate the service binary using the resolution chain.
 * Returns the absolute path to the binary or null if not found.
 *
 * Resolution order:
 *   1. BPROXY_SERVICE_BIN environment variable
 *   2. Workspace service/dist/index.mjs (relative to project root)
 *   3. Sibling in the same directory as the running CLI binary
 *   4. `bproxy-service` on PATH
 */
export function resolveServiceBinary(deps: ServiceBinaryDeps = {}): string | null {
	const env = deps.env ?? process.env;
	const exists = deps.existsSync ?? existsSync;
	const whichFn = deps.which ?? defaultWhich;

	// 1. BPROXY_SERVICE_BIN env override
	const envBin = env["BPROXY_SERVICE_BIN"];
	if (envBin && exists(envBin)) return envBin;

	// 2. Workspace service/dist/index.mjs
	const workspaceBin = resolveWorkspaceBin(exists);
	if (workspaceBin) return workspaceBin;

	// 3. Sibling in the same directory as this CLI binary
	const siblingBin = resolveSiblingBin(exists);
	if (siblingBin) return siblingBin;

	// 4. bproxy-service on PATH
	const pathBin = whichFn("bproxy-service");
	if (pathBin) return pathBin;

	return null;
}

function resolveWorkspaceBin(exists: (path: string) => boolean): string | null {
	// Navigate from cli/src/ or cli/dist/ up to workspace root
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);

	// Try various relative locations depending on whether we're in src or dist
	const candidates = [
		resolve(thisDir, "../../service/dist/index.mjs"), // from cli/src/
		resolve(thisDir, "../service/dist/index.mjs"), // from cli/dist/
		resolve(thisDir, "../../service/dist/index.mjs"), // fallback
	];

	for (const candidate of candidates) {
		if (exists(candidate)) return candidate;
	}
	return null;
}

/**
 * After global npm install, both bproxy.mjs and bproxy-service.mjs live
 * in the same directory (the package's bin directory). Check for a sibling
 * `bproxy-service.mjs` next to the running CLI binary.
 */
function resolveSiblingBin(exists: (path: string) => boolean): string | null {
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);

	const candidate = resolve(thisDir, "bproxy-service.mjs");
	if (exists(candidate)) return candidate;
	return null;
}

function defaultWhich(name: string): string | null {
	try {
		const result = execSync(`which ${name}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
		const path = result.trim();
		return path.length > 0 ? path : null;
	} catch {
		return null;
	}
}

// ─── Service execution ─────────────────────────────────────────────────

/**
 * Spawn the service binary with the given command and environment.
 * Captures stdout/stderr and returns structured result.
 *
 * @param binPath  — resolved service binary path
 * @param command  — lifecycle command: start, stop, status
 * @param env      — environment variables for the child process
 * @param timeoutMs — maximum time to wait for the command (default 15s)
 */
export function execServiceBinary(
	binPath: string,
	command: string,
	env: NodeJS.ProcessEnv,
	timeoutMs = 15_000,
): Promise<ServiceExecResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [binPath, command], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			resolve({ ok: false, exitCode: 2, stderr: `Service command timed out after ${timeoutMs}ms` });
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ ok: false, exitCode: 2, stderr: `Failed to spawn service binary: ${err.message}` });
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			const exitCode = code ?? 1;
			if (exitCode === 0) {
				resolve({ ok: true, stdout: stdout.trim() });
			} else {
				resolve({ ok: false, exitCode, stderr: stderr.trim() || stdout.trim() });
			}
		});
	});
}
