/**
 * Screenshot file materializer.
 *
 * Decodes a base64 screenshot and writes it to a deterministic,
 * collision-safe filename inside a given directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface WriteScreenshotResult {
	/** Absolute path to the written file. */
	file: string;
	/** File size in bytes. */
	size: number;
	/** Image format. */
	format: "png" | "jpeg";
}

export interface WriteScreenshotOptions {
	/** Override the current time for deterministic filenames in tests. */
	now?: Date;
}

/**
 * Write a base64-encoded screenshot to disk.
 *
 * Creates the output directory (recursively) if it does not exist.
 * Filename is `screenshot-<ISO-timestamp-with-dashes>.<ext>` — deterministic
 * from timestamp, collision-safe at ms precision.
 *
 * @throws Error if the directory cannot be created or the file cannot be written.
 */
export function writeScreenshotFile(
	dir: string,
	base64: string,
	format: "png" | "jpeg",
	opts: WriteScreenshotOptions = {},
): WriteScreenshotResult {
	const timestamp = opts.now ?? new Date();
	const filename = `screenshot-${formatTimestamp(timestamp)}.${format === "jpeg" ? "jpg" : "png"}`;
	const absDir = resolve(dir);
	const absPath = resolve(absDir, filename);

	mkdirSync(absDir, { recursive: true });

	const buffer = Buffer.from(base64, "base64");
	writeFileSync(absPath, buffer);

	return { file: absPath, size: buffer.length, format };
}

/**
 * Format a Date into a filesystem-safe ISO-like timestamp.
 * Example: 2026-06-12T18-45-30.123Z
 */
function formatTimestamp(date: Date): string {
	return date.toISOString().replaceAll(":", "-");
}
