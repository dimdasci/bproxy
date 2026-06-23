import { PROTOCOL_VERSION, type TraceEntry } from "@bproxy/shared";
import { storage } from "wxt/utils/storage";
import type { DedupeEntry } from "./dedupe";

// Storage schema for the extension background.
//
// `local:` keys survive SW restarts and uninstalls (per Chrome MV3 storage
// semantics). They hold long-lived pairing material.
//
// `session:` keys live only while the browser session is running and reset
// on full Chrome restart. They hold per-session caches and tab bookkeeping
// that must not leak between Chrome sessions.

/**
 * Pairing bootstrap payload written atomically by the popup after a
 * successful `/pair/claim`. Stored as one record (not six discrete keys)
 * because the daemon issues these fields together and the background SW
 * always needs them as a set before opening the WebSocket.
 */
export interface PairingBootstrap {
	extensionToken: string;
	wsUrl: string;
	protocolVersion: typeof PROTOCOL_VERSION;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export const bootstrapItem = storage.defineItem<PairingBootstrap | null>("local:bootstrap", {
	fallback: null,
});

// Optional feature flags persisted across SW restarts. Specific keys (e.g.
// `debuggerScreenshot`) are added in their feature task.
export type ConfigFlags = Record<string, boolean>;
export const configFlagsItem = storage.defineItem<ConfigFlags>("local:configFlags", {
	fallback: {},
});

// Session-scoped state.

// One-command tab pin: action target tab id keyed by session id. Cleared
// when the daemon sends `session.unbind` or when the browser session ends.
export const sessionPinsItem = storage.defineItem<Record<string, number>>("session:pins", {
	fallback: {},
});

// Dedupe table: request id -> cached response with timestamp. Eviction is
// owned by `createDedupe`; this item is just the persistent store.
export const dedupeItem = storage.defineItem<Record<string, DedupeEntry>>("session:dedupe", {
	fallback: {},
});

// Tabs the background SW has already programmatically injected the content
// script into. Used to avoid double-injection on second command per tab.
export const injectedTabsItem = storage.defineItem<number[]>("session:injectedTabs", {
	fallback: [],
});

// Trace ring buffer for `debug.log`. Bounded by `createTrace`.
export const traceItem = storage.defineItem<TraceEntry[]>("session:trace", {
	fallback: [],
});
