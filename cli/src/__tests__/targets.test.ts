/**
 * Tests for the target parser (--selector / --route-json / --element).
 */
import { describe, expect, it } from "vitest";
import { parseOptionalTarget, parseTarget } from "../targets.js";

describe("parseOptionalTarget", () => {
	it("allows omitted targets", () => {
		const result = parseOptionalTarget(undefined, undefined, undefined);
		expect(result).toEqual({ ok: true });
	});

	it("parses provided selector targets", () => {
		const result = parseOptionalTarget("main", undefined, undefined);
		expect(result).toEqual({ ok: true, target: { selector: "main" } });
	});

	it("parses provided element handles", () => {
		const result = parseOptionalTarget(undefined, undefined, "el5");
		expect(result).toEqual({ ok: true, target: { handle: "el5" } });
	});

	it("rejects competing target strategies", () => {
		const result = parseOptionalTarget("main", '{"hosts":[],"target":"main"}', undefined);
		expect(result.ok).toBe(false);
	});
});

describe("parseTarget", () => {
	it("returns target with selector when --selector provided", () => {
		const result = parseTarget("#email", undefined, undefined);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.target).toEqual({ selector: "#email" });
		}
	});

	it("returns target with handle when valid --element provided", () => {
		const result = parseTarget(undefined, undefined, "ln12");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.target).toEqual({ handle: "ln12" });
		}
	});

	it("returns target with route when valid --route-json provided", () => {
		const route = JSON.stringify({
			hosts: [{ selector: "my-component", index: 0 }],
			target: "input.field",
		});
		const result = parseTarget(undefined, route, undefined);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.target).toEqual({
				route: {
					hosts: [{ selector: "my-component", index: 0 }],
					target: "input.field",
				},
			});
		}
	});

	it("rejects when multiple target strategies are provided", () => {
		const result = parseTarget("#email", '{"hosts":[],"target":"x"}', undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("exactly one");
		}
	});

	it("rejects when no target strategy is provided", () => {
		const result = parseTarget(undefined, undefined, undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("exactly one");
		}
	});

	it.each([
		["invalid handle format", undefined, undefined, "e17", "must match"],
		["invalid JSON in --route-json", undefined, "not json", undefined, "not valid JSON"],
		["route-json missing target field", undefined, '{"hosts":[]}', undefined, "must be"],
	] as const)("rejects %s", (_label, selector, route, element, fragment) => {
		const result = parseTarget(selector, route, element);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain(fragment);
	});

	it.each([
		["route-json with empty target", '{"hosts":[],"target":""}'],
		["route-json with non-array hosts", '{"hosts":"not-array","target":"x"}'],
		[
			"route-json with invalid host entry (missing selector)",
			'{"hosts":[{"index":0}],"target":"x"}',
		],
		[
			"route-json with invalid host entry (non-string selector)",
			'{"hosts":[{"selector":123}],"target":"x"}',
		],
		[
			"route-json with invalid host entry (non-number index)",
			'{"hosts":[{"selector":"x","index":"a"}],"target":"x"}',
		],
	] as const)("rejects %s", (_label, route) => {
		const result = parseTarget(undefined, route, undefined);
		expect(result.ok).toBe(false);
	});

	it("accepts route-json with hosts without index", () => {
		const route = JSON.stringify({ hosts: [{ selector: "host-el" }], target: "input" });
		const result = parseTarget(undefined, route, undefined);
		expect(result.ok).toBe(true);
	});

	it("accepts route-json with multiple hosts", () => {
		const route = JSON.stringify({
			hosts: [{ selector: "outer", index: 0 }, { selector: "inner" }],
			target: ".deep-input",
		});
		const result = parseTarget(undefined, route, undefined);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.target as { route: { hosts: unknown[] } }).route.hosts).toHaveLength(2);
		}
	});
});
