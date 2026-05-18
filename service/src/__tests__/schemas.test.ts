import { describe, expect, it } from "vitest";
import { ACTION_PARAM_SCHEMAS, ACTIONS, parseRequest } from "../schemas";

describe("request schemas", () => {
	it("provides a params validator for every Action", () => {
		for (const a of ACTIONS) {
			expect(ACTION_PARAM_SCHEMAS[a]).toBeDefined();
		}
	});

	it("accepts a valid navigate request", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "navigate",
			params: { url: "https://example.com" },
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(true);
	});

	it("rejects an unknown action", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "made-up",
			params: {},
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(false);
	});

	it("rejects navigate without url", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "navigate",
			params: {},
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(false);
	});
});
