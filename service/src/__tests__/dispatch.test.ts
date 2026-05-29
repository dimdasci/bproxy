import type { BproxyForwardedRequest, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createClients } from "../clients";
import { createDispatch } from "../dispatch";
import { createPending } from "../pending";
import { createSessionRegistry } from "../sessions";

const DEFAULT_SESSION = "m4q8z2" as BproxyRequest["session"];
const SESSION_A = "aaaaaa" as BproxyRequest["session"];
const SESSION_B = "bbbbbb" as BproxyRequest["session"];

function req(id: string, session = DEFAULT_SESSION): BproxyRequest {
	return {
		protocol_version: 1,
		id,
		action: "text",
		params: {},
		session,
		deadline: Date.now() + 5000,
		destructive: false,
	};
}

function ok(id: string): BproxyResponse {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { text: "x" },
		page: { url: "", title: "", state: "ready", busy: false },
		replay: false,
	};
}

function createSeededRegistry(...sessionIds: BproxyRequest["session"][]) {
	const sessions = createSessionRegistry();
	for (const sessionId of sessionIds) {
		sessions.getOrCreate(sessionId);
	}
	return sessions;
}

describe("dispatch", () => {
	it("returns NO_EXTENSION when no clients are connected", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.bind(DEFAULT_SESSION, 42);
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients: createClients(), pending, sessions });
		const response = await dispatch.send(req("a"));
		expect(response).toMatchObject({ ok: false, error: { code: "NO_EXTENSION" } });
	});

	it("returns SESSION_NOT_FOUND when dispatch is called for an unknown session", async () => {
		const sessions = createSessionRegistry();
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });
		const response = await dispatch.send(req("a"));
		expect(response).toMatchObject({ ok: false, error: { code: "SESSION_NOT_FOUND" } });
		expect(sessions.get(DEFAULT_SESSION)).toBeNull();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("returns TAB_NOT_FOUND when the session has no bound tab", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });
		const response = await dispatch.send(req("a"));
		expect(response).toMatchObject({ ok: false, error: { code: "TAB_NOT_FOUND" } });
	});

	it("forwards tab.open with target.tabId null so a fresh session does not need a bound tab", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const onForwarded = vi.fn();
		const dispatch = createDispatch({ clients, pending, sessions, onForwarded });

		const promise = dispatch.send({
			...req("open"),
			action: "tab.open",
			params: { url: "https://google.com" },
			destructive: true,
		});
		expect(sendMock).toHaveBeenCalledOnce();
		const forwarded = sendMock.mock.calls[0]![0] as BproxyForwardedRequest;
		expect(onForwarded).toHaveBeenCalledWith({ id: forwarded.id, wsClient: "c1", tab: null });
		expect(forwarded.target).toEqual({ tabId: null });
		pending.resolveById(forwarded.id, {
			protocol_version: 1,
			id: forwarded.id,
			ok: true,
			data: { tabId: 42, url: "https://google.com" },
			page: { url: "https://google.com", title: "Google", state: "ready", busy: false },
			replay: false,
		});
		await expect(promise).resolves.toMatchObject({ ok: true });
	});

	it("forwards to the client and resolves on response", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.bind(DEFAULT_SESSION, 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const onForwarded = vi.fn();
		const dispatch = createDispatch({ clients, pending, sessions, onForwarded });

		const promise = dispatch.send(req("a"));
		expect(sendMock).toHaveBeenCalledOnce();
		const forwarded = sendMock.mock.calls[0]![0] as BproxyForwardedRequest;
		expect(onForwarded).toHaveBeenCalledWith({ id: forwarded.id, wsClient: "c1", tab: 42 });
		expect(forwarded.target).toEqual({ tabId: 42 });
		pending.resolveById(forwarded.id, ok(forwarded.id));
		await expect(promise).resolves.toMatchObject({ ok: true });
	});

	it("rebinding the session changes target.tabId on the very next forwarded request", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.bind(DEFAULT_SESSION, 1);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const p1 = dispatch.send(req("a"));
		const first = sendMock.mock.calls[0]![0] as BproxyForwardedRequest;
		expect(first.target.tabId).toBe(1);
		pending.resolveById(first.id, ok(first.id));
		await p1;

		sessions.bind(DEFAULT_SESSION, 2);
		const p2 = dispatch.send(req("b"));
		const second = sendMock.mock.calls[1]![0] as BproxyForwardedRequest;
		expect(second.target.tabId).toBe(2);
		pending.resolveById(second.id, ok(second.id));
		await p2;
	});

	it("refuses forwarded actions on a paused session with HUMAN_REQUIRED, before any tab check", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.pause(DEFAULT_SESSION, "captcha-check");
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const response = await dispatch.send(req("a"));
		expect(response).toMatchObject({ ok: false, error: { code: "HUMAN_REQUIRED" } });
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("HUMAN_REQUIRED gate carries the pause reason in the error message", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.bind(DEFAULT_SESSION, 42);
		sessions.pause(DEFAULT_SESSION, "manual-attach");
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const response = await dispatch.send(req("a"));
		expect(response.ok).toBe(false);
		if (!response.ok) {
			expect(response.error.code).toBe("HUMAN_REQUIRED");
			expect(response.error.message).toContain("manual-attach");
		}
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("serialises commands targeting the same tab in FIFO order", async () => {
		const sessions = createSeededRegistry(DEFAULT_SESSION);
		sessions.bind(DEFAULT_SESSION, 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const p1 = dispatch.send(req("a"));
		const p2 = dispatch.send(req("b"));
		const p3 = dispatch.send(req("c"));
		expect(sendMock).toHaveBeenCalledOnce();
		expect((sendMock.mock.calls[0]![0] as BproxyForwardedRequest).id).toBe("a");

		pending.resolveById("a", ok("a"));
		await p1;
		expect(sendMock).toHaveBeenCalledTimes(2);
		expect((sendMock.mock.calls[1]![0] as BproxyForwardedRequest).id).toBe("b");

		pending.resolveById("b", ok("b"));
		await p2;
		expect(sendMock).toHaveBeenCalledTimes(3);
		expect((sendMock.mock.calls[2]![0] as BproxyForwardedRequest).id).toBe("c");

		pending.resolveById("c", ok("c"));
		await p3;
	});

	it("runs commands targeting different tabs in parallel (per-tab lock only)", async () => {
		const sessions = createSeededRegistry(SESSION_A, SESSION_B);
		sessions.bind(SESSION_A, 1);
		sessions.bind(SESSION_B, 2);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const pa = dispatch.send(req("a", SESSION_A));
		const pb = dispatch.send(req("b", SESSION_B));
		expect(sendMock).toHaveBeenCalledTimes(2);

		pending.resolveById("b", ok("b"));
		await pb;
		pending.resolveById("a", ok("a"));
		await pa;
	});
});
