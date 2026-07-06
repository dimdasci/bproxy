import {
	type BproxyForwardedRequest,
	type BproxyResponse,
	type PageState,
	PROTOCOL_VERSION,
} from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import { createDedupe } from "../dedupe";
import { createDispatcher } from "../dispatcher";
import { parseForwardedRequest } from "../forwarded-request";
import { createTrace } from "../trace";

const PAGE: PageState = {
	url: "https://example.test/",
	title: "Example",
	state: "ready",
	busy: false,
};

function makeRequest(overrides: Partial<BproxyForwardedRequest> = {}): BproxyForwardedRequest {
	return {
		protocol_version: PROTOCOL_VERSION,
		id: overrides.id ?? "req-1",
		action: overrides.action ?? "text",
		params: overrides.params ?? {},
		session: overrides.session ?? ("m4q8z2" as BproxyForwardedRequest["session"]),
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? false,
		target: overrides.target ?? { tabId: 42 },
	};
}

function makeHarness() {
	const now = { value: 1000 };
	const responses: BproxyResponse[] = [];
	const sendResponse = vi.fn((response: BproxyResponse) => {
		responses.push(response);
	});
	const dedupe = createDedupe({
		store: createFakeStorageItem("session:dedupe", {}),
		ttlMs: 60_000,
		maxSize: 100,
		now: () => now.value,
	});
	const trace = createTrace({
		store: createFakeStorageItem("session:trace", []),
		maxSize: 100,
		extensionVersion: () => "0.1.0",
	});
	const handleBrowserAction = vi.fn(async () => ({
		data: { url: "https://example.test/", title: "Example", loadTime: 12 },
		page: PAGE,
	}));
	const handleDomAction = vi.fn(async () => ({ data: { text: "hello" }, page: PAGE }));
	const handleMainWorldFill = vi.fn(async () => ({
		data: { filled: true, verifiedValue: "from-main" },
		page: PAGE,
	}));
	const dispatcher = createDispatcher({
		dedupe,
		trace,
		now: () => now.value,
		sendResponse,
		handleBrowserAction,
		handleDomAction,
		handleMainWorldFill,
	});
	return {
		now,
		responses,
		sendResponse,
		dedupe,
		trace,
		handleBrowserAction,
		handleDomAction,
		handleMainWorldFill,
		dispatcher,
	};
}

describe("parseForwardedRequest", () => {
	it("accepts a valid forwarded request envelope", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify(
				makeRequest({
					action: "fill",
					params: { target: { selector: "#q" }, value: "x", method: "paste", world: "isolated" },
				}),
			),
		);
		expect(parsed.success).toBe(true);
	});

	it("accepts links params for forwarded DOM reads", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify(
				makeRequest({
					action: "links",
					params: {
						selector: "#search",
						visibleOnly: true,
						limit: 10,
						hrefContains: "/in/",
						offset: 5,
					},
				}),
			),
		);
		expect(parsed.success).toBe(true);
	});

	it("rejects negative links offset at the forwarded request boundary", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify(
				makeRequest({
					action: "links",
					params: { limit: 10, offset: -1 },
				}),
			),
		);
		expect(parsed).toMatchObject({
			success: false,
			id: "req-1",
			error: "params are invalid for action links",
		});
	});

	it("accepts click and hover params for forwarded DOM interactions", () => {
		expect(
			parseForwardedRequest(
				JSON.stringify(makeRequest({ action: "click", params: { target: { selector: "#x" } } })),
			).success,
		).toBe(true);
		expect(
			parseForwardedRequest(
				JSON.stringify(
					makeRequest({
						action: "hover",
						params: { target: { route: { hosts: [{ selector: "x-menu" }], target: "button" } } },
					}),
				),
			).success,
		).toBe(true);
	});

	it("rejects daemon-local actions", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify(makeRequest({ action: "debug.status", params: {} })),
		);
		expect(parsed).toMatchObject({ success: false, id: "req-1" });
	});

	it("rejects tab.list so the extension cannot enumerate browser tabs", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify({
				protocol_version: PROTOCOL_VERSION,
				id: "req-1",
				action: "tab.list",
				params: {},
				session: "default",
				deadline: 10_000,
				destructive: false,
				target: { tabId: null },
			}),
		);
		expect(parsed).toMatchObject({ success: false, id: "req-1" });
	});

	it("rejects forwarded requests that still include nick", () => {
		const parsed = parseForwardedRequest(
			JSON.stringify({
				...makeRequest({ action: "text", params: { selector: "main" } }),
				nick: "halbot",
			}),
		);
		expect(parsed).toMatchObject({
			success: false,
			id: "req-1",
			error: "unexpected top-level keys",
		});
	});
});

describe("dispatcher", () => {
	it("rejects malformed messages with a normalized error when an id is present", async () => {
		const h = makeHarness();
		await h.dispatcher.handleMessage(
			JSON.stringify({
				protocol_version: PROTOCOL_VERSION,
				id: "bad-1",
				action: "text",
				params: { selector: 123 },
				session: "default",
				deadline: 10_000,
				destructive: false,
				target: { tabId: 42 },
			}),
		);
		expect(h.responses).toHaveLength(1);
		expect(h.responses[0]).toMatchObject({
			ok: false,
			id: "bad-1",
			error: { code: "SCRIPT_ERROR" },
		});
		expect(h.handleDomAction).not.toHaveBeenCalled();
		expect(h.handleBrowserAction).not.toHaveBeenCalled();
	});

	it("routes browser actions through the browser handler and dedupes replays", async () => {
		const h = makeHarness();
		const request = makeRequest({ action: "navigate", params: { url: "https://example.test/" } });

		await h.dispatcher.handleMessage(JSON.stringify(request));
		h.now.value += 5;
		await h.dispatcher.handleMessage(JSON.stringify(request));

		expect(h.handleBrowserAction).toHaveBeenCalledTimes(1);
		expect(h.handleDomAction).not.toHaveBeenCalled();
		expect(h.responses).toHaveLength(2);
		expect(h.responses[0]).toMatchObject({ ok: true, replay: false, id: request.id });
		expect(h.responses[1]).toMatchObject({ ok: true, replay: true, id: request.id });
		const entries = await h.trace.query({ id: request.id });
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			action: "navigate",
			session: request.session,
			replay: false,
			result: "ok",
		});
		expect(entries[1]).toMatchObject({
			action: "navigate",
			session: request.session,
			replay: true,
			result: "ok",
		});
	});

	it("routes DOM actions through the content handler and dedupes non-destructive reads", async () => {
		const h = makeHarness();
		const request = makeRequest({
			action: "text",
			params: { selector: "main" },
			destructive: false,
		});

		await h.dispatcher.handleMessage(JSON.stringify(request));
		h.now.value += 2;
		await h.dispatcher.handleMessage(JSON.stringify(request));

		expect(h.handleDomAction).toHaveBeenCalledTimes(1);
		expect(h.handleBrowserAction).not.toHaveBeenCalled();
		expect(h.handleMainWorldFill).not.toHaveBeenCalled();
		expect(h.responses).toHaveLength(2);
		expect(h.responses[0]).toMatchObject({ ok: true, replay: false, id: request.id });
		expect(h.responses[1]).toMatchObject({ ok: true, replay: true, id: request.id });
	});

	it("routes runtime-api fill through the MAIN-world handler instead of the content script", async () => {
		const h = makeHarness();
		const request = makeRequest({
			action: "fill",
			params: {
				target: { selector: "#editor" },
				value: "hello",
				method: "runtime-api",
				world: "main",
			},
			destructive: true,
		});

		await h.dispatcher.handleMessage(JSON.stringify(request));

		expect(h.handleMainWorldFill).toHaveBeenCalledTimes(1);
		expect(h.handleDomAction).not.toHaveBeenCalled();
		expect(h.handleBrowserAction).not.toHaveBeenCalled();
		expect(h.responses[0]).toMatchObject({
			ok: true,
			id: request.id,
			data: { filled: true, verifiedValue: "from-main" },
		});
	});

	it("normalizes thrown handler errors and caches the error response", async () => {
		const h = makeHarness();
		h.handleDomAction.mockImplementationOnce(async () => {
			throw new Error("boom");
		});
		const request = makeRequest({ action: "text", params: { selector: "#oops" } });

		await h.dispatcher.handleMessage(JSON.stringify(request));
		h.now.value += 1;
		await h.dispatcher.handleMessage(JSON.stringify(request));

		expect(h.handleDomAction).toHaveBeenCalledTimes(1);
		expect(h.responses).toHaveLength(2);
		expect(h.responses[0]).toMatchObject({
			ok: false,
			id: request.id,
			error: { code: "SCRIPT_ERROR", message: "boom" },
		});
		expect(h.responses[1]).toEqual(h.responses[0]);
		const cached = await h.dedupe.get(request.id);
		expect(cached).toEqual(h.responses[0]);
		const entries = await h.trace.query({ id: request.id });
		expect(entries[0]).toMatchObject({ result: "error", replay: false, errorCode: "SCRIPT_ERROR" });
		expect(entries[1]).toMatchObject({ result: "error", replay: true, errorCode: "SCRIPT_ERROR" });
	});

	it("serves debug.log from the trace ring buffer without touching action handlers", async () => {
		const h = makeHarness();
		await h.trace.append({
			id: "alpha",
			action: "text",
			tab: 42,
			timestamp: 100,
			elapsed: 10,
			result: "ok",
			replay: false,
		});
		await h.trace.append({
			id: "beta",
			action: "navigate",
			tab: 42,
			timestamp: 200,
			elapsed: 20,
			result: "ok",
			replay: false,
		});
		await h.trace.append({
			id: "alpha",
			action: "fill",
			tab: 42,
			timestamp: 300,
			elapsed: 30,
			result: "error",
			errorCode: "ELEMENT_NOT_FOUND",
			replay: false,
		});

		const request = makeRequest({ action: "debug.log", params: { id: "alpha", limit: 1 } });
		await h.dispatcher.handleMessage(JSON.stringify(request));

		expect(h.handleDomAction).not.toHaveBeenCalled();
		expect(h.handleBrowserAction).not.toHaveBeenCalled();
		expect(h.responses).toHaveLength(1);
		expect(h.responses[0]).toMatchObject({
			ok: true,
			id: request.id,
			data: {
				entries: [
					{
						id: "alpha",
						action: "fill",
						errorCode: "ELEMENT_NOT_FOUND",
						extensionVersion: "0.1.0",
					},
				],
			},
		});
		const traced = await h.trace.query({ id: request.id });
		expect(traced).toHaveLength(1);
		expect(traced[0]).toMatchObject({ action: "debug.log", result: "ok", replay: false });
	});
});
