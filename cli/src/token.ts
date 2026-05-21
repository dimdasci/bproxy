/**
 * Token preflight validation.
 *
 * Before any network I/O, the CLI verifies the daemon token file:
 *   - Exists
 *   - Is a regular file
 *   - Has mode exactly 0o600
 *   - Is owned by the current user (when process.getuid() is available)
 *
 * On platforms where POSIX APIs are unavailable (Windows), permission/owner
 * checks are skipped. The application still works, but security enforcement
 * relies on OS-level ACLs managed by the user.
 *
 * Token values are never included in error messages.
 */
import { readFileSync, type Stats, statSync } from "node:fs";

export interface TokenPreflightOk {
	ok: true;
	token: string;
}

export interface TokenPreflightError {
	ok: false;
	reason: string;
}

export type TokenPreflightResult = TokenPreflightOk | TokenPreflightError;

/** Subset of fs.Stats needed for preflight, injectable for testing. */
export interface TokenStatInfo {
	isFile(): boolean;
	mode: number;
	uid: number;
}

export interface PreflightDeps {
	stat?: (path: string) => TokenStatInfo;
	read?: (path: string) => string;
	getuid?: () => number | undefined;
}

/**
 * Validate and read the daemon bearer token.
 *
 * @param tokenPath  — absolute path to the token state file
 * @param opts       — injectable dependencies for testing
 */
export function preflightToken(tokenPath: string, opts: PreflightDeps = {}): TokenPreflightResult {
	const statFn = opts.stat ?? defaultStat;
	const readFn = opts.read ?? defaultRead;
	const getuidFn = opts.getuid ?? defaultGetuid;

	const statResult = checkStat(tokenPath, statFn);
	if (!statResult.ok) return statResult.error;

	const permResult = checkPermissions(statResult.info, tokenPath, getuidFn);
	if (permResult) return permResult;

	return readTokenContent(tokenPath, readFn);
}

type StatCheck = { ok: true; info: TokenStatInfo } | { ok: false; error: TokenPreflightError };

function checkStat(tokenPath: string, statFn: (path: string) => TokenStatInfo): StatCheck {
	let info: TokenStatInfo;
	try {
		info = statFn(tokenPath);
	} catch {
		return { ok: false, error: { ok: false, reason: `Token file not found: ${tokenPath}` } };
	}

	if (!info.isFile()) {
		return {
			ok: false,
			error: { ok: false, reason: `Token path is not a regular file: ${tokenPath}` },
		};
	}
	return { ok: true, info };
}

function checkPermissions(
	info: TokenStatInfo,
	tokenPath: string,
	getuidFn: () => number | undefined,
): TokenPreflightError | null {
	const fileMode = info.mode & 0o7777;
	if (fileMode !== 0o600) {
		return {
			ok: false,
			reason: `Token file has insecure permissions: ${formatMode(fileMode)} (expected 0600): ${tokenPath}`,
		};
	}

	const uid = getuidFn();
	if (uid !== undefined && info.uid !== uid) {
		return {
			ok: false,
			reason: `Token file is owned by uid ${info.uid}, expected ${uid}: ${tokenPath}`,
		};
	}
	return null;
}

function readTokenContent(
	tokenPath: string,
	readFn: (path: string) => string,
): TokenPreflightResult {
	let content: string;
	try {
		content = readFn(tokenPath);
	} catch {
		return { ok: false, reason: `Failed to read token file: ${tokenPath}` };
	}

	const token = content.trim();
	if (token.length === 0) {
		return { ok: false, reason: `Token file is empty: ${tokenPath}` };
	}

	return { ok: true, token };
}

// --- Default implementations ---

function defaultStat(path: string): TokenStatInfo {
	const stats: Stats = statSync(path);
	return {
		isFile: () => stats.isFile(),
		mode: stats.mode,
		uid: stats.uid,
	};
}

function defaultRead(path: string): string {
	return readFileSync(path, "utf8");
}

function defaultGetuid(): number | undefined {
	return typeof process.getuid === "function" ? process.getuid() : undefined;
}

// --- Helpers ---

/**
 * Format a numeric mode as a 4-digit octal string.
 */
export function formatMode(mode: number): string {
	return `0${(mode & 0o7777).toString(8).padStart(3, "0")}`;
}
