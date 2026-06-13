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

	it("rejects invalid handle format", () => {
		const result = parseTarget(undefined, undefined, "e17");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("must match");
		}
	});

	it("rejects invalid JSON in --route-json", () => {
		const result = parseTarget(undefined, "not json", undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("not valid JSON");
		}
	});

	it("rejects route-json missing target field", () => {
		const result = parseTarget(undefined, '{"hosts":[]}', undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("must be");
		}
	});

	it("rejects route-json with empty target", () => {
		const result = parseTarget(undefined, '{"hosts":[],"target":""}', undefined);
		expect(result.ok).toBe(false);
	});

	it("rejects route-json with non-array hosts", () => {
		const result = parseTarget(undefined, '{"hosts":"not-array","target":"x"}', undefined);
		expect(result.ok).toBe(false);
	});

	it("rejects route-json with invalid host entry (missing selector)", () => {
		const result = parseTarget(undefined, '{"hosts":[{"index":0}],"target":"x"}', undefined);
		expect(result.ok).toBe(false);
	});

	it("rejects route-json with invalid host entry (non-string selector)", () => {
		const result = parseTarget(undefined, '{"hosts":[{"selector":123}],"target":"x"}', undefined);
		expect(result.ok).toBe(false);
	});

	it("rejects route-json with invalid host entry (non-number index)", () => {
		const result = parseTarget(
			undefined,
			'{"hosts":[{"selector":"x","index":"a"}],"target":"x"}',
			undefined,
		);
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
