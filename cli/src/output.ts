/**
 * Output formatting helpers.
 *
 * Stdout: machine-readable JSON only (single-line, trailing newline).
 * Stderr: structured diagnostics for --verbose and exit-2 messages.
 *
 * No color, no progress bars, no token values in any output.
 */

/**
 * Write a JSON object to stdout as a single line with trailing newline.
 * This is the only function that should write to stdout in the CLI.
 */
export function writeJson(data: unknown, out: NodeJS.WritableStream = process.stdout): void {
	out.write(`${JSON.stringify(data)}\n`);
}

/**
 * Structured verbose log entry for --verbose stderr output.
 *
 * Invariant: this type never includes raw Chrome tab ids or internal
 * identifiers. Only logical session ids, request ids, and action names
 * appear in CLI-facing diagnostic output.
 */
export interface VerboseEntry {
	requestId?: string;
	action?: string;
	session?: string;
	url?: string;
	elapsed?: number;
	httpStatus?: number;
	errorCode?: string;
}

/**
 * Write a structured verbose diagnostic to stderr.
 * Used when --verbose is enabled. Never includes token values.
 */
export function writeVerbose(
	entry: VerboseEntry,
	err: NodeJS.WritableStream = process.stderr,
): void {
	err.write(`${JSON.stringify(entry)}\n`);
}

/**
 * Write a plain diagnostic message to stderr for exit-2 failures.
 * Human-readable text only. Never includes token values.
 */
export function writeDiagnostic(
	message: string,
	err: NodeJS.WritableStream = process.stderr,
): void {
	err.write(`${message}\n`);
}
