/**
 * Shared test helper: creates a per-test temporary state directory.
 *
 * Per ADR-028, test I/O uses project-local `.tmp/` (not system /tmp).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_TMP_ROOT = join(__dirname, "../.tmp");

export function createTestStateDir(): string {
	mkdirSync(TEST_TMP_ROOT, { recursive: true });
	return mkdtempSync(join(TEST_TMP_ROOT, "test-"));
}

export function removeTestStateDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
}
