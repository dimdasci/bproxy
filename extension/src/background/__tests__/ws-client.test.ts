import { describe, expect, it, vi } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import type { PairingBootstrap } from "../storage";
import {
	type BadgeState,
	base64UrlEncode,
	buildSubprotocols,
	createWsClient,
	decideConnect,
	JITTER_HI,
	JITTER_LO,
	KEEPALIVE_ALARM_NAME,
	KEEPALIVE_PERIOD_MIN,
	nextDelay,
	RECONNECT_BASE_MS,
	RECONNECT_MAX_MS,
	type WebSocketLike,
	WS_OPEN,
	type WsClientDeps,
} from "../ws-client";

// ---------- shared fakes ----------

function happyBootstrap(overrides: Partial<PairingBootstrap> = {}): PairingBootstrap {
	return {
		extensionToken: "tok-abc",
		wsUrl: "ws://127.0.0.1:9615/ws",
		protocolVersion: 1,
		issuedAt: 1000,
		expiresAt: 1_000_000,
		nonce: "n-1",
		...overrides,
	};
}

interface FakeSocket extends WebSocketLike {
	url: string;
	protocols: string[];
	sent: string[];
	closed: boolean;
	fireOpen(): void;
	fireClose(): void;
	fireError(): void;
	fireMessage(data: unknown): void;
}

interface SocketFactory {
	ctor: WsClientDeps["WebSocket"];
	created: FakeSocket[];
	last(): FakeSocket;
}

function makeSocketFactory(): SocketFactory {
	const created: FakeSocket[] = [];
	class Sock implements FakeSocket {
		readonly url: string;
		readonly protocols: string[];
		readyState = 0;
		sent: string[] = [];
		closed = false;
		onopen: ((ev?: unknown) => void) | null = null;
		onclose: ((ev?: unknown) => void) | null = null;
		onerror: ((ev?: unknown) => void) | null = null;
		onmessage: ((ev: { data: unknown }) => void) | null = null;
		constructor(url: string, protocols: string[]) {
			this.url = url;
			this.protocols = protocols;
			created.push(this);
		}
		send(data: string): void {
			this.sent.push(data);
		}
		close(): void {
			this.closed = true;
			this.readyState = 3;
		}
		fireOpen(): void {
			this.readyState = WS_OPEN;
			this.onopen?.();
		}
		fireClose(): void {
			this.readyState = 3;
			this.onclose?.();
		}
		fireError(): void {
			this.onerror?.();
		}
		fireMessage(data: unknown): void {
			this.onmessage?.({ data });
		}
	}
	return {
		ctor: Sock as unknown as WsClientDeps["WebSocket"],
		created,
		last() {
			const s = created.at(-1);
			if (!s) throw new Error("no socket created yet");
			return s;
		},
	};
}

interface FakeAlarms {
	seam: WsClientDeps["alarms"];
	creates: Array<{ name: string; info: { periodInMinutes: number } }>;
	cleared: string[];
	fire(name: string): void;
	listeners(): number;
}

function makeFakeAlarms(): FakeAlarms {
	const listeners = new Set<(alarm: { name: string }) => void>();
	const creates: FakeAlarms["creates"] = [];
	const cleared: string[] = [];
	const seam: WsClientDeps["alarms"] = {
		create(name, info) {
			creates.push({ name, info });
		},
		clear(name) {
			cleared.push(name);
		},
		onAlarm: {
			addListener(cb) {
				listeners.add(cb);
			},
			removeListener(cb) {
				listeners.delete(cb);
			},
		},
	};
	return {
		seam,
		creates,
		cleared,
		fire(name) {
			for (const cb of listeners) cb({ name });
		},
		listeners: () => listeners.size,
	};
}

interface FakeRuntimeMsg {
	seam: WsClientDeps["runtimeOnMessage"];
	send(msg: unknown): void;
	listeners(): number;
}

function makeFakeRuntimeMsg(): FakeRuntimeMsg {
	const listeners = new Set<(msg: unknown) => void>();
	const seam: WsClientDeps["runtimeOnMessage"] = {
		addListener(cb) {
			listeners.add(cb);
		},
		removeListener(cb) {
			listeners.delete(cb);
		},
	};
	return {
		seam,
		send(msg) {
			for (const cb of listeners) cb(msg);
		},
		listeners: () => listeners.size,
	};
}

interface FakeTimers {
	setTimeout: WsClientDeps["setTimeout"];
	clearTimeout: WsClientDeps["clearTimeout"];
	pending(): Array<{ id: number; delay: number }>;
	run(id: number): Promise<void>;
}

function makeFakeTimers(): FakeTimers {
	let nextId = 1;
	const tasks = new Map<number, { delay: number; cb: () => void }>();
	return {
		setTimeout(cb, delay) {
			const id = nextId++;
			tasks.set(id, { delay, cb });
			return id;
		},
		clearTimeout(h) {
			tasks.delete(h as number);
		},
		pending() {
			return Array.from(tasks.entries()).map(([id, { delay }]) => ({ id, delay }));
		},
		async run(id) {
			const t = tasks.get(id);
			if (!t) throw new Error(`no pending timer ${id}`);
			tasks.delete(id);
			t.cb();
			// Flush the async `connect()` chain so callers can observe the
			// newly-constructed socket without juggling microtask awaits.
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}

interface Harness {
	deps: WsClientDeps;
	badges: BadgeState[];
	storage: ReturnType<typeof createFakeStorageItem<PairingBootstrap | null>>;
	sockets: SocketFactory;
	alarms: FakeAlarms;
	runtimeMsg: FakeRuntimeMsg;
	timers: FakeTimers;
	nowMs: { value: number };
	random: { value: number };
	onMessage: ReturnType<typeof vi.fn>;
}

function makeHarness(initial: PairingBootstrap | null = happyBootstrap()): Harness {
	const storage = createFakeStorageItem<PairingBootstrap | null>("local:bootstrap", initial);
	const sockets = makeSocketFactory();
	const alarms = makeFakeAlarms();
	const runtimeMsg = makeFakeRuntimeMsg();
	const timers = makeFakeTimers();
	const nowMs = { value: 5000 };
	const random = { value: 0.5 };
	const badges: BadgeState[] = [];
	const onMessage = vi.fn();
	const deps: WsClientDeps = {
		bootstrap: storage,
		WebSocket: sockets.ctor,
		now: () => nowMs.value,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		random: () => random.value,
		setBadge: (s) => badges.push(s),
		alarms: alarms.seam,
		runtimeOnMessage: runtimeMsg.seam,
		onMessage,
	};
	return { deps, badges, storage, sockets, alarms, runtimeMsg, timers, nowMs, random, onMessage };
}

// ---------- pure helpers ----------

describe("decideConnect", () => {
	it("returns skip when bootstrap is null", () => {
		expect(decideConnect(null, 5000)).toEqual({ kind: "skip" });
	});

	it("returns skip when token is empty", () => {
		expect(decideConnect(happyBootstrap({ extensionToken: "" }), 5000)).toEqual({ kind: "skip" });
	});

	it("returns skip when expiresAt is in the past", () => {
		expect(decideConnect(happyBootstrap({ expiresAt: 4000 }), 5000)).toEqual({ kind: "skip" });
	});

	it("returns reject when wsUrl is non-loopback", () => {
		expect(decideConnect(happyBootstrap({ wsUrl: "ws://example.com/" }), 5000).kind).toBe("reject");
	});

	it("returns reject when wsUrl is wss", () => {
		expect(decideConnect(happyBootstrap({ wsUrl: "wss://127.0.0.1/" }), 5000).kind).toBe("reject");
	});

	it("returns reject when wsUrl cannot be parsed", () => {
		expect(decideConnect(happyBootstrap({ wsUrl: "not a url" }), 5000).kind).toBe("reject");
	});

	it("returns open for a valid loopback bootstrap", () => {
		const boot = happyBootstrap();
		expect(decideConnect(boot, 5000)).toEqual({ kind: "open", bootstrap: boot });
	});

	it("accepts localhost as well as 127.0.0.1", () => {
		const boot = happyBootstrap({ wsUrl: "ws://localhost:9615/ws" });
		expect(decideConnect(boot, 5000).kind).toBe("open");
	});
});

describe("buildSubprotocols", () => {
	it("emits bproxy.v1 first then auth.<base64url>", () => {
		const subs = buildSubprotocols("hello-world");
		expect(subs).toEqual(["bproxy.v1", `auth.${base64UrlEncode("hello-world")}`]);
	});

	it("auth.<token> round-trips through base64url back to the original token", () => {
		const token = "tok-abc-123_+/=";
		const subs = buildSubprotocols(token);
		const tail = subs[1] ?? "";
		const encoded = tail.slice("auth.".length);
		// Mirror the daemon's `Buffer.from(x, "base64url").toString("utf8")`.
		const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
		const std = padded.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = atob(std);
		// Convert binary string back to UTF-8.
		const bytes = new Uint8Array(decoded.length);
		for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
		expect(new TextDecoder().decode(bytes)).toBe(token);
	});

	it("emits url-safe characters only (no +, /, =)", () => {
		// A 16-byte input whose standard base64 encoding contains both `+`
		// and `/` so we can assert they are stripped.
		const tail = buildSubprotocols("\xfb\xef\xff\xfe").at(1) ?? "";
		const encoded = tail.slice("auth.".length);
		expect(encoded).not.toMatch(/[+/=]/);
	});
});

describe("nextDelay", () => {
	it("doubles per attempt starting at 1s with mid-jitter (random=0.5 → 1.0×)", () => {
		const r = () => 0.5;
		expect(nextDelay(0, r)).toBe(RECONNECT_BASE_MS);
		expect(nextDelay(1, r)).toBe(2000);
		expect(nextDelay(2, r)).toBe(4000);
		expect(nextDelay(3, r)).toBe(8000);
	});

	it("caps at the max regardless of attempt", () => {
		const r = () => 0.5;
		expect(nextDelay(20, r)).toBe(RECONNECT_MAX_MS);
		expect(nextDelay(50, r)).toBe(RECONNECT_MAX_MS);
	});

	it("applies low jitter at random=0 (×0.8) and high jitter at random≈1 (×1.2)", () => {
		expect(nextDelay(0, () => 0)).toBe(Math.round(RECONNECT_BASE_MS * JITTER_LO));
		expect(nextDelay(0, () => 0.999999)).toBe(
			Math.round(RECONNECT_BASE_MS * (JITTER_LO + (JITTER_HI - JITTER_LO) * 0.999999)),
		);
	});
});

// ---------- integration ----------

describe("createWsClient — start()", () => {
	it("no bootstrap: starts cleanly, no socket, badge stays disconnected", async () => {
		const h = makeHarness(null);
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);
		expect(h.badges).toEqual(["disconnected"]);
		expect(client.getState()).toBe("disconnected");
	});

	it("expired bootstrap: no socket, badge disconnected", async () => {
		const h = makeHarness(happyBootstrap({ expiresAt: 100 }));
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);
		expect(client.getState()).toBe("disconnected");
	});

	it("empty token: no socket, badge disconnected", async () => {
		const h = makeHarness(happyBootstrap({ extensionToken: "" }));
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);
		expect(client.getState()).toBe("disconnected");
	});

	it("non-loopback wsUrl: no socket, badge error", async () => {
		const h = makeHarness(happyBootstrap({ wsUrl: "ws://example.com/" }));
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);
		expect(client.getState()).toBe("error");
	});

	it("wss wsUrl: no socket, badge error", async () => {
		const h = makeHarness(happyBootstrap({ wsUrl: "wss://127.0.0.1/" }));
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);
		expect(client.getState()).toBe("error");
	});

	it("happy path: constructs socket with [url, subprotocols], badge connecting→connected", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(1);
		const sock = h.sockets.last();
		expect(sock.url).toBe("ws://127.0.0.1:9615/ws");
		expect(sock.protocols).toEqual(buildSubprotocols("tok-abc"));
		expect(client.getState()).toBe("connecting");
		sock.fireOpen();
		expect(client.getState()).toBe("connected");
		expect(h.badges).toEqual(["connecting", "connected"]);
	});

	it("registers the keepalive alarm and a runtime-message listener", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.alarms.creates).toEqual([
			{ name: KEEPALIVE_ALARM_NAME, info: { periodInMinutes: KEEPALIVE_PERIOD_MIN } },
		]);
		expect(h.alarms.listeners()).toBe(1);
		expect(h.runtimeMsg.listeners()).toBe(1);
		await client.stop();
	});
});

describe("createWsClient — reconnect schedule", () => {
	it("first three closes schedule at 1s, 2s, 4s (mid-jitter)", async () => {
		const h = makeHarness();
		h.random.value = 0.5; // 1.0× jitter
		const client = createWsClient(h.deps);
		await client.start();
		const close1 = h.sockets.last();
		close1.fireClose();
		expect(h.timers.pending().map((t) => t.delay)).toEqual([1000]);
		await h.timers.run(h.timers.pending()[0]?.id ?? -1);
		const close2 = h.sockets.last();
		expect(close2).not.toBe(close1);
		close2.fireClose();
		expect(h.timers.pending().map((t) => t.delay)).toEqual([2000]);
		await h.timers.run(h.timers.pending()[0]?.id ?? -1);
		const close3 = h.sockets.last();
		close3.fireClose();
		expect(h.timers.pending().map((t) => t.delay)).toEqual([4000]);
	});

	it("jitter bounds: delays stay within [base*0.8, base*1.2]", async () => {
		for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
			const h = makeHarness();
			h.random.value = r;
			const client = createWsClient(h.deps);
			await client.start();
			h.sockets.last().fireClose();
			const delay = h.timers.pending()[0]?.delay ?? -1;
			expect(delay).toBeGreaterThanOrEqual(Math.round(1000 * JITTER_LO));
			expect(delay).toBeLessThanOrEqual(Math.round(1000 * JITTER_HI));
			await client.stop();
		}
	});

	it("a successful open resets the schedule back to 1s", async () => {
		const h = makeHarness();
		h.random.value = 0.5;
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireClose();
		await h.timers.run(h.timers.pending()[0]?.id ?? -1);
		h.sockets.last().fireClose();
		await h.timers.run(h.timers.pending()[0]?.id ?? -1);
		// Third socket succeeds.
		h.sockets.last().fireOpen();
		// Then drops again — should schedule at 1s, not 4s.
		h.sockets.last().fireClose();
		expect(h.timers.pending().map((t) => t.delay)).toEqual([1000]);
	});

	it("plateaus at the 30s cap after many sequential closes", async () => {
		const h = makeHarness();
		h.random.value = 0.5;
		const client = createWsClient(h.deps);
		await client.start();
		for (let i = 0; i < 12; i++) {
			h.sockets.last().fireClose();
			const id = h.timers.pending()[0]?.id ?? -1;
			await h.timers.run(id);
		}
		h.sockets.last().fireClose();
		expect(h.timers.pending()[0]?.delay).toBe(RECONNECT_MAX_MS);
	});
});

describe("createWsClient — pair.complete", () => {
	it("re-reads bootstrap and reconnects immediately on a runtime pair.complete", async () => {
		const h = makeHarness(null);
		const client = createWsClient(h.deps);
		await client.start();
		expect(h.sockets.created.length).toBe(0);

		// Storage gets populated after start (popup just paired).
		await h.storage.setValue(happyBootstrap());

		h.runtimeMsg.send({ type: "pair.complete" });
		// `reconnect` is queued via a microtask in the listener; flush.
		await Promise.resolve();
		await Promise.resolve();
		expect(h.sockets.created.length).toBe(1);
		expect(client.getState()).toBe("connecting");
	});

	it("ignores unrelated runtime messages", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		const before = h.sockets.created.length;
		h.runtimeMsg.send({ type: "other.event" });
		h.runtimeMsg.send("string-message");
		h.runtimeMsg.send(null);
		await Promise.resolve();
		expect(h.sockets.created.length).toBe(before);
	});

	it("forces an immediate reconnect during backoff (cancels pending timer)", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireClose();
		expect(h.timers.pending().length).toBe(1);
		h.runtimeMsg.send({ type: "pair.complete" });
		await Promise.resolve();
		await Promise.resolve();
		expect(h.timers.pending().length).toBe(0);
		// And a new socket is opening.
		expect(client.getState()).toBe("connecting");
	});
});

describe("createWsClient — keepalive", () => {
	it("alarm fires while open → sends a ping frame with current ts", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireOpen();
		h.nowMs.value = 12_345;
		h.alarms.fire(KEEPALIVE_ALARM_NAME);
		expect(h.sockets.last().sent).toEqual([JSON.stringify({ type: "ping", ts: 12_345 })]);
		await client.stop();
	});

	it("alarm fires while not open → does not call send", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		// connecting, not yet open
		h.alarms.fire(KEEPALIVE_ALARM_NAME);
		expect(h.sockets.last().sent).toEqual([]);
	});

	it("alarm with an unrelated name is ignored", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireOpen();
		h.alarms.fire("some-other-alarm");
		expect(h.sockets.last().sent).toEqual([]);
	});
});

describe("createWsClient — message dispatch seam", () => {
	it("forwards inbound message data through onMessage", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireOpen();
		h.sockets.last().fireMessage('{"hello":1}');
		expect(h.onMessage).toHaveBeenCalledWith('{"hello":1}');
		await client.stop();
	});
});

describe("createWsClient — stop()", () => {
	it("clears alarm, removes listeners, cancels pending reconnect, and resets badge", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		h.sockets.last().fireClose();
		expect(h.timers.pending().length).toBe(1);
		await client.stop();
		expect(h.alarms.cleared).toEqual([KEEPALIVE_ALARM_NAME]);
		expect(h.alarms.listeners()).toBe(0);
		expect(h.runtimeMsg.listeners()).toBe(0);
		expect(h.timers.pending().length).toBe(0);
		expect(client.getState()).toBe("disconnected");
	});

	it("after stop, a subsequent close on a torn-down socket does not schedule a reconnect", async () => {
		const h = makeHarness();
		const client = createWsClient(h.deps);
		await client.start();
		const sock = h.sockets.last();
		await client.stop();
		// Even if a stale socket synthesises a close, it should be a no-op
		// because our handler-null + started=false combo ignores it.
		sock.fireClose?.();
		expect(h.timers.pending().length).toBe(0);
	});
});
