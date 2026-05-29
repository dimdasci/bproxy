import { describe, expect, it } from "vitest";
import {
	SESSION_ID_PATTERN,
	createSessionRegistry,
	type InternalSession,
} from "../sessions";

describe("session registry", () => {
	it("generates 6-char base32 session ids", () => {
		const reg = createSessionRegistry();
		const session = reg.create("research");
		expect(session.id).toMatch(SESSION_ID_PATTERN);
		expect(session.label).toBe("research");
		expect(session.tab).toBeNull();
		expect(session.pacing).toBe("human");
		expect(session.paused).toBe(false);
	});

	it("rerolls on id collision", () => {
		const issued = ["aaaaaa", "aaaaaa", "bbbbbb"];
		const reg = createSessionRegistry({
			generateId: () => issued.shift() ?? "cccccc",
		});
		const first = reg.create();
		const second = reg.create();
		expect(first.id).toBe("aaaaaa");
		expect(second.id).toBe("bbbbbb");
		expect(reg.list().map((session) => session.id)).toEqual(["aaaaaa", "bbbbbb"]);
	});

	it("registers session-scoped logical tab handles", () => {
		const reg = createSessionRegistry({ generateId: () => "m4q8z2" });
		const session = reg.create();

		reg.bind(session.id, 42, "fast");
		reg.bind(session.id, 99);

		expect(reg.listTabs(session.id)).toEqual([
			{ tab: "t1", url: "", title: "", bound: false },
			{ tab: "t2", url: "", title: "", bound: true },
		]);
		expect(reg.get(session.id)).toMatchObject({ tab: "t2", pacing: "fast" });
		expect(reg.resolveBound(session.id)?.chromeTabId).toBe(99);
	});

	it("can rebind to an existing logical handle without losing pacing", () => {
		const reg = createSessionRegistry({ generateId: () => "m4q8z2" });
		const session = reg.create();

		reg.bind(session.id, 42, "fast");
		reg.bind(session.id, 99);
		reg.bind(session.id, "t1");

		expect(reg.get(session.id)).toMatchObject({ tab: "t1", pacing: "fast" });
		expect(reg.resolveBound(session.id)?.chromeTabId).toBe(42);
	});

	it("pauses, resumes, and unbind clears the tab plus pause flag", () => {
		const reg = createSessionRegistry({ generateId: () => "m4q8z2" });
		const session = reg.create();

		reg.bind(session.id, 42);
		reg.pause(session.id, "captcha");
		expect(reg.get(session.id)).toMatchObject({ paused: true, pauseReason: "captcha" });

		reg.resume(session.id);
		expect(reg.get(session.id)).toMatchObject({ paused: false, pauseReason: undefined });

		reg.pause(session.id, "captcha");
		reg.unbind(session.id);
		expect(reg.get(session.id)).toMatchObject({ tab: null, paused: false, pauseReason: undefined });
	});

	it("closes a session and returns owned Chrome tab ids", () => {
		const reg = createSessionRegistry({ generateId: () => "m4q8z2" });
		const session = reg.create();

		reg.bind(session.id, 42);
		reg.bind(session.id, 99);

		const closed = reg.close(session.id);
		expect(closed?.session.id).toBe(session.id);
		expect(closed?.tabs.map((tab) => tab.chromeTabId)).toEqual([42, 99]);
		expect(reg.get(session.id)).toBeNull();
	});

	it("tracks tab handles per session", () => {
		const issued = ["aaaaaa", "bbbbbb"];
		const reg = createSessionRegistry({ generateId: () => issued.shift() ?? "cccccc" });
		const first = reg.create();
		const second = reg.create();

		reg.bind(first.id, 11);
		reg.bind(second.id, 22);

		expect(reg.resolveTab(first.id, "t1")?.chromeTabId).toBe(11);
		expect(reg.resolveTab(second.id, "t1")?.chromeTabId).toBe(22);
		expect(reg.hasTabAnywhere("t1")).toBe(true);
	});

	it("exposes mutable internal state only for existing sessions", () => {
		const reg = createSessionRegistry({ generateId: () => "m4q8z2" });
		const created = reg.create();
		const internal = reg.internal(created.id) as InternalSession;
		expect(internal).toBe(reg.getOrCreate(created.id));
		expect(internal.lastActionAt).toEqual({});
		expect(() => reg.internal("zzzzzz")).toThrow("Session 'zzzzzz' was not found");
	});

	it("does not create a ghost session when numeric bind targets an unknown id", () => {
		const reg = createSessionRegistry();
		expect(() => reg.bind("zzzzzz", 42)).toThrow("Session 'zzzzzz' was not found");
		expect(reg.get("zzzzzz")).toBeNull();
	});
});
