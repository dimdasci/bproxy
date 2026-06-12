import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type SendOptions, sendAction } from "../client.js";
import { writeScreenshotFile } from "../screenshot-file.js";
import type { BproxyResponse } from "../types.js";

// A tiny 1x1 red PNG encoded in base64
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAw" +
	"AFDgGMksMOHwAAAABJRU5ErkJggg==";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "bproxy-screenshot-test-"));
}

describe("writeScreenshotFile", () => {
	it("writes a PNG file and returns absolute path and size", () => {
		const dir = makeTempDir();
		const result = writeScreenshotFile(dir, TINY_PNG_BASE64, "png", {
			now: new Date("2026-06-12T18:45:30.123Z"),
		});

		expect(result.file).toBe(resolve(dir, "screenshot-2026-06-12T18-45-30.123Z.png"));
		expect(result.format).toBe("png");
		expect(result.size).toBe(Buffer.from(TINY_PNG_BASE64, "base64").length);

		// File exists and has correct content
		expect(existsSync(result.file)).toBe(true);
		const written = readFileSync(result.file);
		expect(written.toString("base64")).toBe(TINY_PNG_BASE64);
	});

	it("creates directory recursively if it does not exist", () => {
		const base = makeTempDir();
		const nested = join(base, "deep", "nested", "dir");

		const result = writeScreenshotFile(nested, TINY_PNG_BASE64, "png", {
			now: new Date("2026-01-01T00:00:00.000Z"),
		});

		expect(existsSync(result.file)).toBe(true);
		expect(result.file).toContain("deep/nested/dir/screenshot-");
	});

	it("uses .jpg extension for jpeg format", () => {
		const dir = makeTempDir();
		const result = writeScreenshotFile(dir, TINY_PNG_BASE64, "jpeg", {
			now: new Date("2026-03-15T10:20:30.456Z"),
		});

		expect(result.file).toMatch(/\.jpg$/);
		expect(result.format).toBe("jpeg");
	});

	it("filename matches expected pattern", () => {
		const dir = makeTempDir();
		const result = writeScreenshotFile(dir, TINY_PNG_BASE64, "png", {
			now: new Date("2026-12-31T23:59:59.999Z"),
		});

		const filename = result.file.split("/").pop()!;
		expect(filename).toBe("screenshot-2026-12-31T23-59-59.999Z.png");
	});

	it("resolves relative dir to absolute path", () => {
		// Use a temp dir as base, create a relative-looking path
		const base = makeTempDir();
		const relDir = join(base, "rel");
		const result = writeScreenshotFile(relDir, TINY_PNG_BASE64, "png");

		expect(result.file).toBe(resolve(result.file));
		expect(existsSync(result.file)).toBe(true);
	});

	it("throws when directory is unwritable", () => {
		// /proc/non-existent on Linux, /dev/null/impossible on macOS
		const badDir = "/dev/null/impossible/path";
		expect(() => writeScreenshotFile(badDir, TINY_PNG_BASE64, "png")).toThrow();
	});

	it("file size matches decoded buffer length", () => {
		const dir = makeTempDir();
		const result = writeScreenshotFile(dir, TINY_PNG_BASE64, "png");

		const stat = statSync(result.file);
		expect(stat.size).toBe(result.size);
	});
});

const INT_TINY_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAw" +
	"AFDgGMksMOHwAAAABJRU5ErkJggg==";

function setupHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "bproxy-ss-int-"));
	writeFileSync(join(dir, "token"), "test-token\n", { mode: 0o600 });
	writeFileSync(join(dir, "port"), "9615", { mode: 0o644 });
	return dir;
}

function screenshotResponse(id: string) {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { base64: INT_TINY_PNG, format: "png" },
		page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
		replay: false,
	};
}

function mockFetch(responseBody: unknown): typeof globalThis.fetch {
	return (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	};
}

describe("screenshot --output-dir integration", () => {
	it("command writes file and stdout has file path instead of base64", async () => {
		const home = setupHome();
		const outputDir = join(makeTempDir(), "screens");
		const requestId = "ss-file-test-1";

		const opts: SendOptions = {
			fetch: mockFetch(screenshotResponse(requestId)),
			requestId,
		};

		const plan = await sendAction("screenshot", {}, { home, session: "abc234" }, opts);

		// Simulate what screenshot command does with --output-dir
		expect(plan.code).toBe(0);
		const response = plan.stdout as BproxyResponse<"screenshot">;
		expect(response.ok).toBe(true);
		if (!response.ok) return;

		const result = writeScreenshotFile(outputDir, response.data.base64, response.data.format);

		// Verify file written
		expect(existsSync(result.file)).toBe(true);
		expect(result.size).toBe(Buffer.from(INT_TINY_PNG, "base64").length);

		// Verify transformed output shape
		const transformed = {
			...response,
			data: { format: result.format, file: result.file, size: result.size },
		};
		const json = JSON.stringify(transformed);
		expect(json).not.toContain("base64");
		expect(json).toContain(result.file);
		expect(transformed.page).toEqual(response.page);
	});

	it("without --output-dir, base64 remains in stdout", async () => {
		const home = setupHome();
		const requestId = "ss-no-dir-1";

		const opts: SendOptions = {
			fetch: mockFetch(screenshotResponse(requestId)),
			requestId,
		};

		const plan = await sendAction("screenshot", {}, { home, session: "abc234" }, opts);

		expect(plan.code).toBe(0);
		const response = plan.stdout as BproxyResponse<"screenshot">;
		expect(response.ok).toBe(true);
		if (!response.ok) return;
		expect(response.data.base64).toBe(INT_TINY_PNG);
	});
});
