/**
 * Request ID generation.
 *
 * Each CLI invocation produces a unique request ID using crypto.randomUUID().
 * No ULID or time-sortable format required for Phase 4.
 */
import { randomUUID } from "node:crypto";

/**
 * Generate a unique request ID for a single CLI invocation.
 */
export function generateRequestId(): string {
	return randomUUID();
}
