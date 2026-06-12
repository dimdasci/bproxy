import type { BproxyRequest } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { ACTION_PARAM_SCHEMAS, ACTIONS, parseRequest } from "../schemas";

const SESSION = "m4q8z2" as BproxyRequest["session"];

function parse(action: string, params: unknown) {
	return parseRequest({
		protocol_version: 1,
		id: `schema-${action}`,
		action,
		params,
		session: SESSION,
		deadline: Date.now() + 1000,
		destructive: false,
	});
}

describe("request schemas", () => {
	it("provides a params validator for every Action", () => {
		for (const action of ACTIONS) {
			expect(ACTION_PARAM_SCHEMAS[action]).toBeDefined();
		}
	});

	it("accepts a valid navigate request", () => {
		expect(parse("navigate", { url: "https://example.com" }).success).toBe(true);
	});

	it("accepts links params with selector, visibility filter, and limit", () => {
		expect(parse("links", { selector: "#search", visibleOnly: true, limit: 10 }).success).toBe(
			true,
		);
	});

	it("accepts scroll params with an explicit element target", () => {
		expect(
			parse("scroll", {
				target: { selector: "main#workspace" },
				by: "viewport",
				direction: "down",
				untilStable: true,
			}).success,
		).toBe(true);
	});

	it("accepts session.create with and without label", () => {
		expect(parse("session.create", {}).success).toBe(true);
		expect(parse("session.create", { label: "research" }).success).toBe(true);
	});

	it("accepts tab.open with an empty session placeholder for fresh bootstrap", () => {
		expect(
			parseRequest({
				protocol_version: 1,
				id: "schema-tab-open-empty-session",
				action: "tab.open",
				params: { url: "https://example.com" },
				session: "",
				deadline: Date.now() + 1000,
				destructive: true,
			}).success,
		).toBe(true);
	});

	it("accepts session.bind with a logical tab handle", () => {
		expect(parse("session.bind", { tab: "t1", pacing: "fast" }).success).toBe(true);
	});

	it("rejects an unknown action", () => {
		expect(parse("made-up", {}).success).toBe(false);
	});

	it("rejects session.bind with a raw Chrome tab id", () => {
		expect(parse("session.bind", { tabId: 42 }).success).toBe(false);
	});

	it("rejects invalid logical tab handles", () => {
		expect(parse("session.bind", { tab: "t0" }).success).toBe(false);
		expect(parse("session.bind", { tab: "tab1" }).success).toBe(false);
	});

	it("rejects session.close with extra fields in strict mode", () => {
		expect(parse("session.close", { force: true }).success).toBe(false);
	});
});
