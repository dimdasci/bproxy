import type { ElementInfo, LinkInfo, SessionId, TabHandle } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { ElementHandleCache } from "../element-handles";

const SESSION = "m4q7z2" as SessionId;
const TAB_1 = "t1" as TabHandle;
const TAB_2 = "t2" as TabHandle;
const CHROME_TAB = 42;

function element(selector: string, label?: string): ElementInfo {
	return { selector, tag: "button", label };
}

function link(selector: string, href: string, text: string): LinkInfo {
	return { text, href, target: { selector } };
}

describe("ElementHandleCache", () => {
	it("mints element and link handles with action-specific prefixes", () => {
		const cache = new ElementHandleCache();
		const elements = cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.a"), element("button.b")],
			"https://example.test/",
			0,
		);
		const links = cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"links",
			[link("a.docs", "https://example.test/docs", "Docs")],
			"https://example.test/",
			0,
		);

		expect(elements.map((entry) => entry.handle)).toEqual(["el1", "el2"]);
		expect(links.map((entry) => entry.handle)).toEqual(["ln1"]);
	});

	it("resolves a minted handle back to its explicit ElementTarget", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		const pageEpoch = cache.getPageEpoch(CHROME_TAB)?.epoch ?? 0;
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			pageEpoch,
		);

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toEqual({ ok: true, target: { selector: "button.submit" } });
	});

	it("expires handles by TTL", () => {
		let now = 1_000;
		const cache = new ElementHandleCache({ ttlMs: 100, now: () => now });
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			0,
		);

		now = 1_200;
		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_NOT_FOUND" } });
	});

	it("fails closed when epoch data is unavailable", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		const pageEpoch = cache.getPageEpoch(CHROME_TAB)?.epoch ?? 0;
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			pageEpoch,
		);
		cache.clearPageEpochs();

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_STALE" } });
	});

	it("returns stale when the page epoch has changed", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		const pageEpoch = cache.getPageEpoch(CHROME_TAB)?.epoch ?? 0;
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			pageEpoch,
		);
		cache.handleNavigation(CHROME_TAB, "https://example.test/next");

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_STALE" } });
	});

	it("returns stale when the URL no longer matches the minted page", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/current");
		const pageEpoch = cache.getPageEpoch(CHROME_TAB)?.epoch ?? 0;
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/original",
			pageEpoch,
		);

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_STALE" } });
	});

	it("reports scope mismatch when the same session is bound to another tab", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			0,
		);

		const resolved = cache.resolve(SESSION, TAB_2, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_SCOPE_MISMATCH" } });
	});

	it("replaces handles on re-read of the same session-tab-action scope", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.old")],
			"https://example.test/",
			0,
		);
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.new")],
			"https://example.test/",
			0,
		);

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toEqual({ ok: true, target: { selector: "button.new" } });
	});

	it("invalidates all session handles on session close", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			0,
		);
		cache.invalidateForSession(SESSION);

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_NOT_FOUND" } });
	});

	it("invalidates all tab handles on tab close", () => {
		const cache = new ElementHandleCache();
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.submit")],
			"https://example.test/",
			0,
		);
		cache.invalidateForTab(CHROME_TAB);

		const resolved = cache.resolve(SESSION, TAB_1, "el1");
		expect(resolved).toMatchObject({ ok: false, error: { code: "ELEMENT_HANDLE_NOT_FOUND" } });
	});

	it("evicts oldest entries when caps are exceeded", () => {
		const cache = new ElementHandleCache({ perScopeCap: 2, globalCap: 3 });
		cache.handleNavigation(CHROME_TAB, "https://example.test/");
		cache.mint(
			SESSION,
			TAB_1,
			CHROME_TAB,
			"elements",
			[element("button.one"), element("button.two"), element("button.three")],
			"https://example.test/",
			0,
		);

		expect(cache.size()).toBe(2);
		expect(cache.resolve(SESSION, TAB_1, "el1")).toMatchObject({
			ok: false,
			error: { code: "ELEMENT_HANDLE_NOT_FOUND" },
		});
		expect(cache.resolve(SESSION, TAB_1, "el2")).toEqual({
			ok: true,
			target: { selector: "button.two" },
		});
		expect(cache.resolve(SESSION, TAB_1, "el3")).toEqual({
			ok: true,
			target: { selector: "button.three" },
		});
	});
});
