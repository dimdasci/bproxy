/**
 * Session-scoped temporary directory management.
 *
 * Each session receives a pre-created artifact directory at
 * `BPROXY_HOME/tmp/sessions/<session-id>/` for agent-facing file output
 * (screenshots, exports). Cleaned on session close or daemon stop.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve the session temp directory path (does not create it).
 */
export function sessionTmpPath(stateDir: string, sessionId: string): string {
	return resolve(stateDir, "tmp", "sessions", sessionId);
}

/**
 * Create the session temp directory (idempotent).
 * Returns the absolute path.
 */
export function createSessionTmpDir(stateDir: string, sessionId: string): string {
	const dir = sessionTmpPath(stateDir, sessionId);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
}

/**
 * Remove a session's temp directory (best-effort, idempotent).
 */
export function removeSessionTmpDir(stateDir: string, sessionId: string): void {
	try {
		rmSync(sessionTmpPath(stateDir, sessionId), { recursive: true, force: true });
	} catch {
		/* best effort */
	}
}

/**
 * Wipe the entire `BPROXY_HOME/tmp/` tree (daemon startup / shutdown).
 * Per ADR-028, daemon startup and shutdown wipe `BPROXY_HOME/tmp/`.
 */
export function wipeTmpDir(stateDir: string): void {
	try {
		rmSync(resolve(stateDir, "tmp"), { recursive: true, force: true });
	} catch {
		/* best effort */
	}
}

/**
 * Remove orphaned atomic-write staging files (`*.tmp` siblings) in the
 * state directory. Per ADR-028, daemon startup removes stale siblings
 * left by crashed previous runs.
 */
export function removeOrphanedTmpFiles(stateDir: string): void {
	try {
		for (const entry of readdirSync(stateDir)) {
			if (entry.endsWith(".tmp")) {
				try {
					rmSync(resolve(stateDir, entry), { force: true });
				} catch {
					/* best effort */
				}
			}
		}
	} catch {
		/* stateDir may not exist yet */
	}
}
