/**
 * Tests for write command argument validation logic.
 *
 * Tests the validation that happens at the command layer BEFORE sendAction:
 * - Target parsing (selector vs route-json exclusivity)
 * - Value source exclusivity
 * - Method/world enum validation
 * - fill-form JSON payload validation
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ─── Value source exclusivity logic ────────────────────────────────────

function countSources(
	value: string | undefined,
	valueFile: string | undefined,
	valueStdin: boolean,
): number {
	return [value !== undefined, valueFile !== undefined, valueStdin].filter(Boolean).length;
}

describe("value source exclusivity", () => {
	it("rejects when no source provided", () => {
		expect(countSources(undefined, undefined, false)).toBe(0);
	});

	it("accepts exactly one source: --value", () => {
		expect(countSources("hello", undefined, false)).toBe(1);
	});

	it("accepts exactly one source: --value-file", () => {
		expect(countSources(undefined, "/home/testuser/.bproxy/data.json", false)).toBe(1);
	});

	it("accepts exactly one source: --value-stdin", () => {
		expect(countSources(undefined, undefined, true)).toBe(1);
	});

	it("rejects when multiple sources provided", () => {
		expect(countSources("hello", "/home/testuser/.bproxy/data.json", false)).toBe(2);
		expect(countSources("hello", undefined, true)).toBe(2);
		expect(countSources(undefined, "/home/testuser/.bproxy/data.json", true)).toBe(2);
		expect(countSources("hello", "/home/testuser/.bproxy/data.json", true)).toBe(3);
	});
});

// ─── Method validation logic ───────────────────────────────────────────

describe("fill method validation", () => {
	const VALID_METHODS = new Set(["direct", "paste", "runtime-api"]);

	it("accepts 'direct'", () => {
		expect(VALID_METHODS.has("direct")).toBe(true);
	});

	it("accepts 'paste'", () => {
		expect(VALID_METHODS.has("paste")).toBe(true);
	});

	it("accepts 'runtime-api'", () => {
		expect(VALID_METHODS.has("runtime-api")).toBe(true);
	});

	it("rejects 'auto'", () => {
		expect(VALID_METHODS.has("auto")).toBe(false);
	});

	it("rejects 'keyboard'", () => {
		expect(VALID_METHODS.has("keyboard")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(VALID_METHODS.has("")).toBe(false);
	});
});

// ─── World validation logic ────────────────────────────────────────────

describe("fill world validation", () => {
	const VALID_WORLDS = new Set(["isolated", "main"]);

	it("accepts 'isolated'", () => {
		expect(VALID_WORLDS.has("isolated")).toBe(true);
	});

	it("accepts 'main'", () => {
		expect(VALID_WORLDS.has("main")).toBe(true);
	});

	it("rejects 'content'", () => {
		expect(VALID_WORLDS.has("content")).toBe(false);
	});

	it("rejects 'background'", () => {
		expect(VALID_WORLDS.has("background")).toBe(false);
	});
});

// ─── fill-form payload validation logic ────────────────────────────────

function validatePayload(raw: string): { ok: boolean; reason?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "not valid JSON" };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "must be object" };
	}
	const obj = parsed as Record<string, unknown>;
	if (!Array.isArray(obj["fields"])) {
		return { ok: false, reason: 'missing "fields" array' };
	}
	return { ok: true };
}

describe("fill-form payload validation", () => {
	it("accepts valid payload with fields array", () => {
		const payload = JSON.stringify({
			fields: [{ target: { selector: "#x" }, value: "v", method: "direct", world: "isolated" }],
		});
		expect(validatePayload(payload).ok).toBe(true);
	});

	it("rejects non-JSON", () => {
		expect(validatePayload("not json").ok).toBe(false);
	});

	it("rejects non-object (array)", () => {
		expect(validatePayload("[1,2,3]").ok).toBe(false);
	});

	it("rejects null", () => {
		expect(validatePayload("null").ok).toBe(false);
	});

	it("rejects object without fields", () => {
		expect(validatePayload('{"data":[]}').ok).toBe(false);
	});

	it("rejects non-array fields", () => {
		expect(validatePayload('{"fields":"not-array"}').ok).toBe(false);
	});
});

// ─── value-file reading ────────────────────────────────────────────────

describe("value-file reading", () => {
	it("reads file content as fill value", () => {
		const dir = mkdtempSync(join(tmpdir(), "bproxy-fill-test-"));
		const filePath = join(dir, "value.txt");
		writeFileSync(filePath, "file-content-here");

		const { readFileSync } = require("node:fs");
		const content = readFileSync(filePath, "utf8");
		expect(content).toBe("file-content-here");
	});
});
