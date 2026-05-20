import type { BproxyForwardedRequest, BproxyResponse } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createPending } from "../pending";

const BASE = 1_000_000;

function req(id: string, deadline = BASE + 5000): BproxyForwardedRequest {
	return {
		protocol_version: 1,
		id,
		action: "text",
		params: {},
		session: "default",
		deadline,
		destructive: false,
		target: { tabId: 42 },
	};
}

function okResponse(id: string): BproxyResponse {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { text: "x" },
		page: { url: "https://x", title: "", state: "ready", busy: false },
		replay: false,
	};
}

describe("pending map", () => {
	it("registers and resolves a request by id", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send = vi.fn();
		const p = pending.register(req("a"), send);
		expect(send).toHaveBeenCalledOnce();
		pending.resolveById("a", okResponse("a"));
		await expect(p).resolves.toMatchObject({ ok: true });
	});

	it("dedupes by id: same id returns the existing promise without re-sending", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send = vi.fn();
		const p1 = pending.register(req("a"), send);
		const p2 = pending.register(req("a"), send);
		expect(send).toHaveBeenCalledOnce();
		expect(p1).toBe(p2);
		pending.resolveById("a", okResponse("a"));
		await expect(p1).resolves.toMatchObject({ ok: true });
	});

	it("times out at deadline with an error envelope", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
		const pending = createPending({ maxSize: 10, now: () => Date.now() });
		const p = pending.register(req("a", BASE + 100), vi.fn());
		vi.advanceTimersByTime(150);
		await expect(p).resolves.toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
		vi.useRealTimers();
	});

	it("emits onTimeout with elapsed ms when deadline expires", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
		const onTimeout = vi.fn();
		const pending = createPending({ maxSize: 10, now: () => Date.now(), onTimeout });
		const p = pending.register(req("a", BASE + 100), vi.fn());
		vi.advanceTimersByTime(150);
		await p;
		expect(onTimeout).toHaveBeenCalledOnce();
		expect(onTimeout).toHaveBeenCalledWith({ id: "a", elapsedMs: 100 });
		vi.useRealTimers();
	});

	it("resolves immediately with TIMEOUT when the deadline is already in the past", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
		const pending = createPending({ maxSize: 10, now: () => Date.now() });
		const p = pending.register(req("a", BASE - 1), vi.fn());
		vi.advanceTimersByTime(0); // flush the 0-ms timer
		await expect(p).resolves.toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
		vi.useRealTimers();
	});

	it("rejects with OVERLOADED when bounded size is reached", async () => {
		const sendFull = vi.fn();
		const pending = createPending({ maxSize: 2, now: () => BASE });
		void pending.register(req("a"), sendFull);
		void pending.register(req("b"), sendFull);
		const overflowSend = vi.fn();
		const overflow = await pending.register(req("c"), overflowSend);
		expect(overflow).toMatchObject({ ok: false, error: { code: "OVERLOADED" } });
		expect(overflowSend).not.toHaveBeenCalled();
	});

	it("replays in-flight requests: original promise resolves when replayed send is responded", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send1 = vi.fn();
		const original = pending.register(req("a"), send1);
		expect(send1).toHaveBeenCalledOnce();

		// First client drops; new client connects.
		const send2 = vi.fn();
		pending.replayForClient(send2);
		expect(send2).toHaveBeenCalledOnce();
		const replayed = send2.mock.calls[0]![0]! as BproxyForwardedRequest;
		expect(replayed.id).toBe("a");

		// The new client responds — the ORIGINAL promise must resolve.
		pending.resolveById("a", okResponse("a"));
		await expect(original).resolves.toMatchObject({ ok: true, id: "a" });
	});

	it("replayForClient with id filter only replays matching ids", () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		void pending.register(req("a"), vi.fn());
		void pending.register(req("b"), vi.fn());
		const send = vi.fn();
		pending.replayForClient(send, ["a"]);
		expect(send).toHaveBeenCalledOnce();
		expect((send.mock.calls[0]![0]! as BproxyForwardedRequest).id).toBe("a");
	});

	it("emits onReplay with request id and ws client", () => {
		const onReplay = vi.fn();
		const pending = createPending({ maxSize: 10, now: () => BASE, onReplay });
		void pending.register(req("a"), vi.fn());
		const send = vi.fn();
		pending.replayForClient(send, undefined, "client-1");
		expect(onReplay).toHaveBeenCalledWith({ id: "a", wsClient: "client-1" });
	});

	it("snapshot lists pending ids", () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		void pending.register(req("a"), vi.fn());
		void pending.register(req("b"), vi.fn());
		expect(pending.size()).toBe(2);
	});
});
