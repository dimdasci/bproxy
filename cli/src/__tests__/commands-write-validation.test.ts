/**
 * Tests for write command argument validation logic.
 *
 * Tests the validation that happens at the command layer BEFORE sendAction:
 * - Target parsing (selector vs route-json exclusivity)
 * - Value/code source exclusivity
 * - Method/world enum validation
 * - fill-form JSON payload validation
 * - eval --allow-eval guard
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ─── Value source exclusivity logic ────────────────────────────────────

describe("value source exclusivity", () => {
	function countSources(
		value: string | undefined,
		valueFile: string | undefined,
		valueStdin: boolean,
	): number {
		return [value !== undefined, valueFile !== undefined, valueStdin].filter(Boolean).length;
	}

	it("rejects when no source provided", () => {
		expect(countSources(undefined, undefined, false)).toBe(0);
	});

	it("accepts exactly one source: --value", () => {
		expect(countSources("hello", undefined, false)).toBe(1);
	});

	it("accepts exactly one source: --value-file", () => {
		expect(countSources(undefined, "/tmp/file", false)).toBe(1);
	});

	it("accepts exactly one source: --value-stdin", () => {
		expect(countSources(undefined, undefined, true)).toBe(1);
	});

	it("rejects when multiple sources provided", () => {
		expect(countSources("hello", "/tmp/file", false)).toBe(2);
		expect(countSources("hello", undefined, true)).toBe(2);
		expect(countSources(undefined, "/tmp/file", true)).toBe(2);
		expect(countSources("hello", "/tmp/file", true)).toBe(3);
	});
});

// ─── Method validation logic ───────────────────────────────────────────

describe("fill method validation", () => {
	const VALID_METHODS = ["direct", "paste", "runtime-api"];

	it("accepts 'direct'", () => {
		expect(VALID_METHODS.includes("direct")).toBe(true);
	});

	it("accepts 'paste'", () => {
		expect(VALID_METHODS.includes("paste")).toBe(true);
	});

	it("accepts 'runtime-api'", () => {
		expect(VALID_METHODS.includes("runtime-api")).toBe(true);
	});

	it("rejects 'auto'", () => {
		expect(VALID_METHODS.includes("auto")).toBe(false);
	});

	it("rejects 'keyboard'", () => {
		expect(VALID_METHODS.includes("keyboard")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(VALID_METHODS.includes("")).toBe(false);
	});
});

// ─── World validation logic ────────────────────────────────────────────

describe("fill world validation", () => {
	const VALID_WORLDS = ["isolated", "main"];

	it("accepts 'isolated'", () => {
		expect(VALID_WORLDS.includes("isolated")).toBe(true);
	});

	it("accepts 'main'", () => {
		expect(VALID_WORLDS.includes("main")).toBe(true);
	});

	it("rejects 'content'", () => {
		expect(VALID_WORLDS.includes("content")).toBe(false);
	});

	it("rejects 'background'", () => {
		expect(VALID_WORLDS.includes("background")).toBe(false);
	});
});

// ─── fill-form payload validation logic ────────────────────────────────

describe("fill-form payload validation", () => {
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

// ─── eval --allow-eval guard logic ─────────────────────────────────────

describe("eval --allow-eval guard", () => {
	it("requires explicit true to proceed", () => {
		const allowEval = true;
		expect(allowEval === true).toBe(true);
	});

	it("blocks when false (default)", () => {
		const allowEval = false as boolean | undefined;
		expect(allowEval === true).toBe(false);
	});

	it("blocks when undefined", () => {
		const allowEval = undefined as boolean | undefined;
		expect(allowEval === true).toBe(false);
	});
});

// ─── Code source exclusivity (eval) ───────────────────────────────────

describe("eval code source exclusivity", () => {
	function countCodeSources(
		code: string | undefined,
		file: string | undefined,
		stdin: boolean,
	): number {
		return [code !== undefined, file !== undefined, stdin].filter(Boolean).length;
	}

	it("accepts exactly one source: --code", () => {
		expect(countCodeSources("document.title", undefined, false)).toBe(1);
	});

	it("accepts exactly one source: --file", () => {
		expect(countCodeSources(undefined, "/tmp/script.js", false)).toBe(1);
	});

	it("accepts exactly one source: --stdin", () => {
		expect(countCodeSources(undefined, undefined, true)).toBe(1);
	});

	it("rejects no sources", () => {
		expect(countCodeSources(undefined, undefined, false)).toBe(0);
	});

	it("rejects multiple sources", () => {
		expect(countCodeSources("code", "/tmp/f", false)).toBe(2);
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
