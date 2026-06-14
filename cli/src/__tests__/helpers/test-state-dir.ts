/**
 * Shared test helper: creates a per-test temporary state directory.
 *
 * Per ADR-028, test I/O uses project-local `.tmp/` (not system /tmp).
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

const TEST_TMP_ROOT = join(import.meta.dirname, "../../.tmp");

export function createTestStateDir(prefix = "test-"): string {
	mkdirSync(TEST_TMP_ROOT, { recursive: true });
	return mkdtempSync(join(TEST_TMP_ROOT, prefix));
}
