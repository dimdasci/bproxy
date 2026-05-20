import type { PairingBootstrap } from "./storage";
import type { StorageItem } from "./storage-item";

// Background WebSocket client.
//
// Owns the SW↔daemon socket lifecycle: read bootstrap → validate → connect
// with subprotocol auth → keep alive across SW suspensions → reconnect with
// exponential backoff on close → re-read bootstrap on `pair.complete`. The
// dispatcher (Task 6) consumes inbound frames via `onMessage`.
//
// All side-effects (WebSocket, timers, alarms, runtime messages, badge) are
// dependency-injected so the unit tests run in plain Node without booting
// fakeBrowser. The background entrypoint wires real platform objects in.

export type BadgeState = "disconnected" | "connecting" | "connected" | "error";

export type WsClientState = BadgeState;

// Minimal structural slice of the platform WebSocket. We only call `send`,
// `close`, read `readyState`, and assign the four event handlers.
export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	onopen: ((ev?: unknown) => void) | null;
	onclose: ((ev?: unknown) => void) | null;
	onerror: ((ev?: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketCtor = new (url: string, protocols: string[]) => WebSocketLike;

// readyState constants are part of the WebSocket spec but not on the
// minimal `WebSocketLike` slice we accept. Mirror them so callers (and
// tests) share one source of truth.
export const WS_OPEN = 1 as const;

export interface AlarmsSeam {
	create(name: string, info: { periodInMinutes: number }): void;
	clear(name: string): void;
	onAlarm: {
		addListener(cb: (alarm: { name: string }) => void): void;
		removeListener(cb: (alarm: { name: string }) => void): void;
	};
}

export interface RuntimeMessageSeam {
	addListener(cb: (msg: unknown) => void): void;
	removeListener(cb: (msg: unknown) => void): void;
}

export interface WsClientDeps {
	bootstrap: StorageItem<PairingBootstrap | null>;
	WebSocket: WebSocketCtor;
	now: () => number;
	setTimeout: (cb: () => void, ms: number) => unknown;
	clearTimeout: (h: unknown) => void;
	// Returns a number in [0, 1). Used to jitter reconnect delays so a
	// daemon flap does not synchronise reconnects across SW restarts.
	random: () => number;
	setBadge: (state: BadgeState) => void;
	alarms: AlarmsSeam;
	runtimeOnMessage: RuntimeMessageSeam;
	// Optional inbound-frame sink. Defaults to a no-op until Task 6 wires
	// the dispatcher in. Frames are passed through as the raw `data` field
	// from `MessageEvent`.
	onMessage?: (data: unknown) => void;
}

export interface WsClient {
	start(): Promise<void>;
	stop(): Promise<void>;
	reconnect(): Promise<void>;
	send(data: string): boolean;
	getState(): WsClientState;
}

export const KEEPALIVE_ALARM_NAME = "bproxy-ws-keepalive";
export const KEEPALIVE_PERIOD_MIN = 0.5;
// If the socket stays open but no app-level heartbeat comes back within this
// window, treat it as stale and force a reconnect. This covers the real-world
// daemon-restart case where MV3 may not surface `onclose` promptly.
export const STALE_CONNECTION_MS = 45_000;

// Reconnect schedule: 1s, 2s, 4s, ..., 30s cap. Each delay is multiplied by
// a jitter factor in [0.8, 1.2] using the injected `random`.
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;
export const JITTER_LO = 0.8;
export const JITTER_HI = 1.2;

export const PAIR_COMPLETE_MESSAGE = "pair.complete";

interface ClientState {
	badge: BadgeState;
	socket: WebSocketLike | null;
	reconnectTimer: unknown;
	attempt: number;
	alarmListener: ((alarm: { name: string }) => void) | null;
	messageListener: ((msg: unknown) => void) | null;
	started: boolean;
	lastAliveAt: number | null;
}

type ConnectDecision =
	| { kind: "skip" }
	| { kind: "reject" }
	| { kind: "open"; bootstrap: PairingBootstrap };

export function createWsClient(deps: WsClientDeps): WsClient {
	const state: ClientState = {
		badge: "disconnected",
		socket: null,
		reconnectTimer: null,
		attempt: 0,
		alarmListener: null,
		messageListener: null,
		started: false,
		lastAliveAt: null,
	};
	const ctx: Ctx = { deps, state, connect: () => connectOnce(ctx) };
	return {
		start: () => start(ctx),
		stop: () => stop(ctx),
		reconnect: () => forceReconnect(ctx),
		send: (data) => send(ctx, data),
		getState: () => state.badge,
	};
}

interface Ctx {
	deps: WsClientDeps;
	state: ClientState;
	// Self-reference for handlers that need to (re)connect without seeing
	// `connectOnce`'s closure directly — keeps each helper standalone.
	connect: () => Promise<void>;
}

function setBadge(ctx: Ctx, next: BadgeState): void {
	ctx.state.badge = next;
	ctx.deps.setBadge(next);
}

function clearReconnect(ctx: Ctx): void {
	if (ctx.state.reconnectTimer !== null) {
		ctx.deps.clearTimeout(ctx.state.reconnectTimer);
		ctx.state.reconnectTimer = null;
	}
}

function tearDownSocket(ctx: Ctx): void {
	const sock = ctx.state.socket;
	if (!sock) return;
	sock.onopen = null;
	sock.onclose = null;
	sock.onerror = null;
	sock.onmessage = null;
	try {
		sock.close();
	} catch {
		// Already-closed sockets throw on some platforms; ignore.
	}
	ctx.state.socket = null;
	ctx.state.lastAliveAt = null;
}

function scheduleReconnect(ctx: Ctx): void {
	clearReconnect(ctx);
	const delay = nextDelay(ctx.state.attempt, ctx.deps.random);
	ctx.state.attempt += 1;
	ctx.state.reconnectTimer = ctx.deps.setTimeout(() => {
		ctx.state.reconnectTimer = null;
		void ctx.connect();
	}, delay);
}

async function connectOnce(ctx: Ctx): Promise<void> {
	tearDownSocket(ctx);
	const boot = await ctx.deps.bootstrap.getValue();
	const decision = decideConnect(boot, ctx.deps.now());
	if (decision.kind === "skip") {
		setBadge(ctx, "disconnected");
		return;
	}
	if (decision.kind === "reject") {
		setBadge(ctx, "error");
		return;
	}
	setBadge(ctx, "connecting");
	openSocket(ctx, decision.bootstrap);
}

function openSocket(ctx: Ctx, boot: PairingBootstrap): void {
	const protocols = buildSubprotocols(boot.extensionToken);
	const socket = new ctx.deps.WebSocket(boot.wsUrl, protocols);
	ctx.state.socket = socket;
	socket.onopen = () => {
		ctx.state.attempt = 0;
		ctx.state.lastAliveAt = ctx.deps.now();
		clearReconnect(ctx);
		setBadge(ctx, "connected");
	};
	socket.onclose = () => {
		ctx.state.socket = null;
		if (!ctx.state.started) return;
		setBadge(ctx, "connecting");
		scheduleReconnect(ctx);
	};
	// `onclose` always follows `onerror` for a failed handshake; scheduling
	// from here would double-book a reconnect.
	socket.onerror = () => {};
	socket.onmessage = (ev) => {
		if (isPongMessage(ev.data)) {
			ctx.state.lastAliveAt = ctx.deps.now();
			return;
		}
		ctx.state.lastAliveAt = ctx.deps.now();
		ctx.deps.onMessage?.(ev.data);
	};
}

function onAlarm(ctx: Ctx, alarm: { name: string }): void {
	if (alarm.name !== KEEPALIVE_ALARM_NAME) return;
	const socket = ctx.state.socket;
	if (!socket || socket.readyState !== WS_OPEN) return;
	const now = ctx.deps.now();
	if (ctx.state.lastAliveAt !== null && now - ctx.state.lastAliveAt >= STALE_CONNECTION_MS) {
		void forceReconnect(ctx);
		return;
	}
	try {
		socket.send(JSON.stringify({ type: "ping", ts: now }));
	} catch {
		void forceReconnect(ctx);
	}
}

async function start(ctx: Ctx): Promise<void> {
	if (ctx.state.started) return;
	ctx.state.started = true;
	ctx.deps.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
	const alarmL = (alarm: { name: string }) => onAlarm(ctx, alarm);
	ctx.state.alarmListener = alarmL;
	ctx.deps.alarms.onAlarm.addListener(alarmL);
	const msgL = (msg: unknown) => {
		if (isPairCompleteMessage(msg)) void forceReconnect(ctx);
	};
	ctx.state.messageListener = msgL;
	ctx.deps.runtimeOnMessage.addListener(msgL);
	await ctx.connect();
}

async function stop(ctx: Ctx): Promise<void> {
	ctx.state.started = false;
	clearReconnect(ctx);
	tearDownSocket(ctx);
	ctx.deps.alarms.clear(KEEPALIVE_ALARM_NAME);
	if (ctx.state.alarmListener) {
		ctx.deps.alarms.onAlarm.removeListener(ctx.state.alarmListener);
		ctx.state.alarmListener = null;
	}
	if (ctx.state.messageListener) {
		ctx.deps.runtimeOnMessage.removeListener(ctx.state.messageListener);
		ctx.state.messageListener = null;
	}
	setBadge(ctx, "disconnected");
}

async function forceReconnect(ctx: Ctx): Promise<void> {
	if (!ctx.state.started) return;
	clearReconnect(ctx);
	ctx.state.attempt = 0;
	await ctx.connect();
}

function send(ctx: Ctx, data: string): boolean {
	const socket = ctx.state.socket;
	if (!socket || socket.readyState !== WS_OPEN) return false;
	try {
		socket.send(data);
		return true;
	} catch {
		return false;
	}
}

// ---------- pure helpers ----------

// Pre-flight: a missing/empty-token bootstrap is "skip" (badge stays
// disconnected, no error noise — re-pairing will arrive via popup).
// The popup validates `expiresAt` on first claim, but reconnect lifetime is
// governed by the daemon's persisted active extension token, not by the
// bootstrap envelope freshness. A structurally-present but semantically-bad
// `wsUrl` is "reject" (badge error) because we want it visible to the user
// that pairing produced a payload the SW refuses to honour.
export function decideConnect(boot: PairingBootstrap | null, _now: number): ConnectDecision {
	if (!boot) return { kind: "skip" };
	if (!boot.extensionToken) return { kind: "skip" };
	if (!isLoopbackWsUrl(boot.wsUrl)) return { kind: "reject" };
	return { kind: "open", bootstrap: boot };
}

export function buildSubprotocols(extensionToken: string): string[] {
	return ["bproxy.v1", `auth.${base64UrlEncode(extensionToken)}`];
}

// base64url over UTF-8 bytes; symmetrical with Node's
// `Buffer.from(x, "base64url").toString("utf8")` which the daemon uses to
// decode `Sec-WebSocket-Protocol`.
export function base64UrlEncode(input: string): string {
	const utf8 = utf8ToBinaryString(input);
	const b64 = btoa(utf8);
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8ToBinaryString(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let out = "";
	for (const b of bytes) out += String.fromCharCode(b);
	return out;
}

function isLoopbackWsUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	if (parsed.protocol !== "ws:") return false;
	return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

export function nextDelay(attempt: number, random: () => number): number {
	const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
	const jitter = JITTER_LO + (JITTER_HI - JITTER_LO) * random();
	return Math.round(base * jitter);
}

function isPairCompleteMessage(msg: unknown): boolean {
	if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return false;
	const rec = msg as Record<string, unknown>;
	return rec["type"] === PAIR_COMPLETE_MESSAGE;
}

function isPongMessage(data: unknown): boolean {
	const parsed = parseJsonRecord(data);
	return parsed?.["type"] === "pong";
}

function parseJsonRecord(data: unknown): Record<string, unknown> | null {
	if (typeof data === "string") {
		try {
			const parsed = JSON.parse(data) as unknown;
			return isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return isRecord(data) ? data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
