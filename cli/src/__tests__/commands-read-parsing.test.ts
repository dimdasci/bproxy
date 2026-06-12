/**
 * Tests for command-layer argument parsing and validation.
 *
 * Tests the globals extraction helper and validates the parsing logic
 * used by the read/navigation commands.
 */
import { describe, expect, it } from "vitest";
import { extractGlobals, parseSessionId, parseTabHandle } from "../globals.js";

// ─── extractGlobals tests ──────────────────────────────────────────────

describe("extractGlobals", () => {
	it("extracts all global args when present", () => {
		const result = extractGlobals({
			session: "m4q7z2",
			timeout: "5000",
			home: "/tmp/home",
			verbose: true,
		});
		expect(result).toEqual({
			session: "m4q7z2",
			timeout: "5000",
			home: "/tmp/home",
			verbose: true,
		});
	});

	it("returns undefined for missing string args", () => {
		const result = extractGlobals({});
		expect(result).toEqual({
			session: undefined,
			timeout: undefined,
			home: undefined,
			verbose: undefined,
		});
	});

	it("ignores non-string values for string args", () => {
		const result = extractGlobals({
			session: 123,
			timeout: true,
			home: null,
			verbose: "yes",
		});
		expect(result).toEqual({
			session: undefined,
			timeout: undefined,
			home: undefined,
			verbose: undefined,
		});
	});
});

describe("Phase 5 id parsing", () => {
	it("accepts valid session ids", () => {
		expect(parseSessionId("m4q7z2")).toBe("m4q7z2");
	});

	it("rejects invalid session ids", () => {
		expect(parseSessionId("default")).toBeNull();
		expect(parseSessionId("abc1234")).toBeNull();
	});

	it("accepts logical tab handles", () => {
		expect(parseTabHandle("t1")).toBe("t1");
		expect(parseTabHandle("t42")).toBe("t42");
	});

	it("rejects raw chrome tab ids and malformed handles", () => {
		expect(parseTabHandle("42")).toBeNull();
		expect(parseTabHandle("t0")).toBeNull();
		expect(parseTabHandle("tab-1")).toBeNull();
	});
});

// ─── Arg-to-params mapping logic tests ─────────────────────────────────

describe("scroll direction validation logic", () => {
	function isValidDirection(d: string): d is "up" | "down" {
		return d === "up" || d === "down";
	}

	it("accepts 'up' direction", () => {
		expect(isValidDirection("up")).toBe(true);
	});

	it("accepts 'down' direction", () => {
		expect(isValidDirection("down")).toBe(true);
	});

	it("rejects invalid direction", () => {
		expect(isValidDirection("left")).toBe(false);
	});
});

describe("wait strategy validation logic", () => {
	function isValidStrategy(s: string): s is "selector" | "url" | "navigation" {
		return s === "selector" || s === "url" || s === "navigation";
	}

	it("accepts 'selector' strategy", () => {
		expect(isValidStrategy("selector")).toBe(true);
	});

	it("accepts 'url' strategy", () => {
		expect(isValidStrategy("url")).toBe(true);
	});

	it("accepts 'navigation' strategy", () => {
		expect(isValidStrategy("navigation")).toBe(true);
	});

	it("rejects invalid strategy", () => {
		expect(isValidStrategy("timeout")).toBe(false);
	});
});

describe("dom depth parsing logic", () => {
	function parseDepth(raw: string): number | null {
		const depth = Number.parseInt(raw, 10);
		if (Number.isNaN(depth) || depth < 0) return null;
		return depth;
	}

	it("parses valid integer depth", () => {
		expect(parseDepth("3")).toBe(3);
	});

	it("parses zero depth", () => {
		expect(parseDepth("0")).toBe(0);
	});

	it("rejects non-numeric depth", () => {
		expect(parseDepth("abc")).toBeNull();
	});

	it("rejects negative depth", () => {
		expect(parseDepth("-1")).toBeNull();
	});
});

describe("wait timeout parsing logic", () => {
	function parseTimeout(raw: string): number | null {
		const ms = Number.parseInt(raw, 10);
		if (Number.isNaN(ms) || ms <= 0) return null;
		return ms;
	}

	it("parses valid timeout", () => {
		expect(parseTimeout("10000")).toBe(10000);
	});

	it("rejects non-numeric timeout", () => {
		expect(parseTimeout("forever")).toBeNull();
	});

	it("rejects zero timeout", () => {
		expect(parseTimeout("0")).toBeNull();
	});

	it("rejects negative timeout", () => {
		expect(parseTimeout("-500")).toBeNull();
	});
});

describe("optional param omission patterns", () => {
	it("text command omits selector when not provided", () => {
		const args: Record<string, unknown> = { verbose: false };
		const params: Record<string, unknown> = {};
		if (typeof args["selector"] === "string") {
			params["selector"] = args["selector"];
		}
		expect(params).toEqual({});
		expect("selector" in params).toBe(false);
	});

	it("text command includes selector when provided", () => {
		const args: Record<string, unknown> = { selector: "#main", verbose: false };
		const params: Record<string, unknown> = {};
		if (typeof args["selector"] === "string") {
			params["selector"] = args["selector"];
		}
		expect(params).toEqual({ selector: "#main" });
	});

	it("scroll command omits all params when none provided", () => {
		const args: Record<string, unknown> = { verbose: false };
		const params: Record<string, unknown> = {};
		if (typeof args["by"] === "string") params["by"] = args["by"];
		if (typeof args["direction"] === "string") params["direction"] = args["direction"];
		expect(params).toEqual({});
	});

	it("screenshot omits flags when false/default", () => {
		const args: Record<string, unknown> = { activate: false, debugger: false };
		const params: Record<string, unknown> = {};
		if (args["activate"] === true) params["activate"] = true;
		if (args["debugger"] === true) params["debugger"] = true;
		expect(params).toEqual({});
	});

	it("screenshot includes flags when true", () => {
		const args: Record<string, unknown> = { activate: true, debugger: true };
		const params: Record<string, unknown> = {};
		if (args["activate"] === true) params["activate"] = true;
		if (args["debugger"] === true) params["debugger"] = true;
		expect(params).toEqual({ activate: true, debugger: true });
	});
});
