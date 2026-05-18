import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createClients } from "../clients";
import { createDispatch } from "../dispatch";
import { createPending } from "../pending";
import { createSessionRegistry } from "../sessions";

function req(id: string, session = "default"): BproxyRequest {
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

describe("dispatch", () => {
	it("returns NO_EXTENSION when no clients are connected", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients: createClients(), pending, sessions });
		const r = await dispatch.send(req("a"));
		expect(r).toMatchObject({ ok: false, error: { code: "NO_EXTENSION" } });
	});

	it("returns TAB_NOT_FOUND when the session has no bound tab", async () => {
		const sessions = createSessionRegistry();
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });
		const r = await dispatch.send(req("a"));
		expect(r).toMatchObject({ ok: false, error: { code: "TAB_NOT_FOUND" } });
	});

	it("forwards to the client and resolves on response", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const onForwarded = vi.fn();
		const dispatch = createDispatch({ clients, pending, sessions, onForwarded });

		const p = dispatch.send(req("a"));
		expect(sendMock).toHaveBeenCalledOnce();
		const forwarded = sendMock.mock.calls[0]![0] as BproxyRequest;
		expect(onForwarded).toHaveBeenCalledWith({ id: forwarded.id, wsClient: "c1", tab: 42 });
		pending.resolveById(forwarded.id, ok(forwarded.id));
		await expect(p).resolves.toMatchObject({ ok: true });
	});

	it("serialises commands targeting the same tab in FIFO order", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const p1 = dispatch.send(req("a"));
		const p2 = dispatch.send(req("b"));
		const p3 = dispatch.send(req("c"));
		// Only the first should have been forwarded so far.
		expect(sendMock).toHaveBeenCalledOnce();
		expect((sendMock.mock.calls[0]![0] as BproxyRequest).id).toBe("a");

		pending.resolveById("a", ok("a"));
		await p1;
		// After 'a' resolves, 'b' (not 'c') is forwarded next — order preserved.
		expect(sendMock).toHaveBeenCalledTimes(2);
		expect((sendMock.mock.calls[1]![0] as BproxyRequest).id).toBe("b");

		pending.resolveById("b", ok("b"));
		await p2;
		expect(sendMock).toHaveBeenCalledTimes(3);
		expect((sendMock.mock.calls[2]![0] as BproxyRequest).id).toBe("c");

		pending.resolveById("c", ok("c"));
		await p3;
	});

	it("runs commands targeting different tabs in parallel (per-tab lock only)", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("s-a", 1);
		sessions.bind("s-b", 2);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const pa = dispatch.send(req("a", "s-a"));
		const pb = dispatch.send(req("b", "s-b"));
		// Different tabs → both forwarded immediately, no serialization between them.
		expect(sendMock).toHaveBeenCalledTimes(2);

		pending.resolveById("b", ok("b"));
		await pb;
		pending.resolveById("a", ok("a"));
		await pa;
	});
});
