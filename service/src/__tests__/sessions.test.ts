import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../sessions";

describe("session registry", () => {
	it("implicitly creates sessions on first lookup", () => {
		const reg = createSessionRegistry();
		const s = reg.getOrCreate("default");
		expect(s.name).toBe("default");
		expect(s.tabId).toBeNull();
		expect(s.pacing).toBe("human");
		expect(s.paused).toBe(false);
	});

	it("returns the same instance for repeated lookups", () => {
		const reg = createSessionRegistry();
		expect(reg.getOrCreate("a")).toBe(reg.getOrCreate("a"));
	});

	it("binds a tab to a session", () => {
		const reg = createSessionRegistry();
		reg.bind("default", 42, "fast");
		const s = reg.getOrCreate("default");
		expect(s.tabId).toBe(42);
		expect(s.pacing).toBe("fast");
	});

	it("pauses and resumes a session", () => {
		const reg = createSessionRegistry();
		reg.pause("default", "captcha");
		expect(reg.getOrCreate("default").paused).toBe(true);
		expect(reg.getOrCreate("default").pauseReason).toBe("captcha");
		reg.resume("default");
		expect(reg.getOrCreate("default").paused).toBe(false);
	});

	it("unbind clears the tab AND drops the pause flag (view: 04-session-state)", () => {
		const reg = createSessionRegistry();
		reg.bind("default", 42);
		reg.pause("default", "captcha");
		reg.unbind("default");
		const s = reg.getOrCreate("default");
		expect(s.tabId).toBeNull();
		expect(s.paused).toBe(false);
		expect(s.pauseReason).toBeUndefined();
	});

	it("lists all sessions", () => {
		const reg = createSessionRegistry();
		reg.getOrCreate("a");
		reg.getOrCreate("b");
		expect(
			reg
				.list()
				.map((s) => s.name)
				.sort(),
		).toEqual(["a", "b"]);
	});
});
