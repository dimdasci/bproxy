/**
 * Exit-code mapping and testable exit plan.
 *
 * Exit codes:
 *   0 — valid protocol response with ok: true
 *   1 — valid protocol response with ok: false
 *   2 — CLI usage/config/control-plane failure
 *
 * Commands return an ExitPlan rather than calling process.exit directly.
 * The outermost boundary (bproxy.ts entrypoint) is the only place that
 * calls process.exit.
 */

import type { BproxyResponse } from "./types.js";

/** Exit plan returned by commands for testability. */
export interface ExitPlan {
	code: 0 | 1 | 2;
	/** JSON object to write to stdout (only for code 0 or 1). */
	stdout?: unknown;
	/** Diagnostic message to write to stderr (only for code 2). */
	stderr?: string;
}

/**
 * Map a valid protocol response to an exit plan.
 */
export function exitFromResponse(response: BproxyResponse): ExitPlan {
	return {
		code: response.ok ? 0 : 1,
		stdout: response,
	};
}

/**
 * Create a success exit plan (exit code 0) with JSON stdout.
 */
export function exitSuccess(data: unknown): ExitPlan {
	return { code: 0, stdout: data };
}

/**
 * Create a protocol-error exit plan (exit code 1) with JSON stdout.
 */
export function exitProtocolError(data: unknown): ExitPlan {
	return { code: 1, stdout: data };
}

/**
 * Create a control-plane/usage error exit plan (exit code 2).
 */
export function exitUsageError(message: string): ExitPlan {
	return { code: 2, stderr: message };
}

/**
 * Execute an exit plan: write output and call process.exit.
 * This should only be called at the outermost CLI boundary.
 */
export function executeExitPlan(
	plan: ExitPlan,
	deps: {
		stdout?: NodeJS.WritableStream;
		stderr?: NodeJS.WritableStream;
		exit?: (code: number) => void;
	} = {},
): void {
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;
	const exit = deps.exit ?? ((code: number) => process.exit(code));

	if (plan.stdout !== undefined) {
		stdout.write(`${JSON.stringify(plan.stdout)}\n`);
	}
	if (plan.stderr !== undefined) {
		stderr.write(`${plan.stderr}\n`);
	}

	exit(plan.code);
}
