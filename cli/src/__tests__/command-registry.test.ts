import { describe, expect, it } from "vitest";
import { allRegisteredActions, isDestructive } from "../command-registry.js";
import type { Action } from "../types.js";

const DESTRUCTIVE: Action[] = [
	"navigate",
	"scroll",
	"click",
	"hover",
	"fill",
	"fill-form",
	"select",
	"tab.pin",
	"tab.unpin",
	"tab.open",
	"tab.close",
	"session.create",
	"session.bind",
	"session.unbind",
	"session.resume",
	"session.close",
	"require-human",
];

const NON_DESTRUCTIVE: Action[] = [
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"inspect",
	"snapshot",
	"screenshot",
	"wait",
	"tab.list",
	"session.list",
	"debug.log",
	"debug.last",
	"debug.status",
];

describe("isDestructive", () => {
	it.each(DESTRUCTIVE)("classifies %s as destructive", (action) => {
		expect(isDestructive(action)).toBe(true);
	});

	it.each(NON_DESTRUCTIVE)("classifies %s as non-destructive", (action) => {
		expect(isDestructive(action)).toBe(false);
	});
});

describe("allRegisteredActions", () => {
	it("covers every Action in the shared type", () => {
		const expected: Action[] = [...DESTRUCTIVE, ...NON_DESTRUCTIVE];
		const registered = allRegisteredActions();
		for (const action of expected) {
			expect(registered.has(action)).toBe(true);
		}
		expect(registered.size).toBe(expected.length);
	});
});
