import { describe, expect, it } from "vitest";
import { allRegisteredActions, isDestructive } from "../command-registry.js";
import type { Action } from "../types.js";

describe("isDestructive", () => {
	it("classifies navigate as destructive", () => {
		expect(isDestructive("navigate")).toBe(true);
	});

	it("classifies scroll as destructive", () => {
		expect(isDestructive("scroll")).toBe(true);
	});

	it("classifies fill as destructive", () => {
		expect(isDestructive("fill")).toBe(true);
	});

	it("classifies fill-form as destructive", () => {
		expect(isDestructive("fill-form")).toBe(true);
	});

	it("classifies tab.open as destructive", () => {
		expect(isDestructive("tab.open")).toBe(true);
	});

	it("classifies tab.close as destructive", () => {
		expect(isDestructive("tab.close")).toBe(true);
	});

	it("classifies session.create as destructive", () => {
		expect(isDestructive("session.create")).toBe(true);
	});

	it("classifies session.bind as destructive", () => {
		expect(isDestructive("session.bind")).toBe(true);
	});

	it("classifies session.close as destructive", () => {
		expect(isDestructive("session.close")).toBe(true);
	});

	it("classifies require-human as destructive", () => {
		expect(isDestructive("require-human")).toBe(true);
	});

	it("classifies text as non-destructive", () => {
		expect(isDestructive("text")).toBe(false);
	});

	it("classifies links as non-destructive", () => {
		expect(isDestructive("links")).toBe(false);
	});

	it("classifies images as non-destructive", () => {
		expect(isDestructive("images")).toBe(false);
	});

	it("classifies elements as non-destructive", () => {
		expect(isDestructive("elements")).toBe(false);
	});

	it("classifies dom as non-destructive", () => {
		expect(isDestructive("dom")).toBe(false);
	});

	it("classifies screenshot as non-destructive", () => {
		expect(isDestructive("screenshot")).toBe(false);
	});

	it("classifies wait as non-destructive", () => {
		expect(isDestructive("wait")).toBe(false);
	});

	it("classifies debug.status as non-destructive", () => {
		expect(isDestructive("debug.status")).toBe(false);
	});

	it("classifies debug.last as non-destructive", () => {
		expect(isDestructive("debug.last")).toBe(false);
	});

	it("classifies session.list as non-destructive", () => {
		expect(isDestructive("session.list")).toBe(false);
	});

	it("classifies tab.list as non-destructive", () => {
		expect(isDestructive("tab.list")).toBe(false);
	});
});

describe("allRegisteredActions", () => {
	it("covers every Action in the shared type", () => {
		// This list must match the shared Action union exactly.
		// If a new action is added to shared, this test should be updated
		// along with the registry.
		const expected: Action[] = [
			"navigate",
			"text",
			"links",
			"images",
			"elements",
			"outline",
			"dom",
			"scroll",
			"screenshot",
			"fill",
			"fill-form",
			"select",
			"wait",
			"require-human",
			"tab.list",
			"tab.pin",
			"tab.unpin",
			"tab.open",
			"tab.close",
			"session.create",
			"session.list",
			"session.bind",
			"session.unbind",
			"session.resume",
			"session.close",
			"debug.log",
			"debug.last",
			"debug.status",
		];

		const registered = allRegisteredActions();
		for (const action of expected) {
			expect(registered.has(action)).toBe(true);
		}
		expect(registered.size).toBe(expected.length);
	});
});
