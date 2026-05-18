import { createDedupe, type Dedupe } from "../background/dedupe";
import { createDispatcher, type Dispatcher, type ExecutedAction } from "../background/dispatcher";
import { bootstrapItem, dedupeItem, traceItem } from "../background/storage";
import { createTrace } from "../background/trace";
import {
	type BadgeState,
	createWsClient,
	type WebSocketCtor,
	type WsClient,
	type WsClientDeps,
} from "../background/ws-client";

// Background service worker entrypoint.
//
// Wires the dependency-injected WS client to real platform objects:
//   - typed `bootstrapItem` (chrome.storage.local survives SW restarts),
//   - global `WebSocket`,
//   - `chrome.alarms` for the keepalive heartbeat,
//   - `chrome.runtime.onMessage` for the popup `pair.complete` signal,
//   - `chrome.action` badge for connection-state visibility.
//
// Task 6 wires dispatcher / dedupe / trace storage into the WS client.
// The concrete browser-API and content-script handlers still land in later
// tasks, so this entrypoint currently installs explicit "not implemented"
// stubs rather than silently dropping requests.

const BADGE_COLOR: Record<BadgeState, string> = {
	disconnected: "#00000000",
	connecting: "#888888",
	connected: "#00000000",
	error: "#cc4444",
};

const BADGE_TEXT: Record<BadgeState, string> = {
	disconnected: "",
	connecting: "…",
	connected: "",
	error: "!",
};

function setBadge(state: BadgeState): void {
	void chrome.action.setBadgeText({ text: BADGE_TEXT[state] });
	void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR[state] });
}

const TRACE_MAX_SIZE = 500;
const DEDUPE_MAX_SIZE = 1000;
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function notImplemented(action: string): Promise<ExecutedAction> {
	return Promise.reject(new Error(`No extension handler is registered yet for action ${action}`));
}

function makeDispatcher(client: WsClient): Dispatcher {
	const trace = createTrace({
		store: traceItem,
		maxSize: TRACE_MAX_SIZE,
		extensionVersion: () => chrome.runtime.getManifest().version,
	});
	const dedupe: Dedupe = createDedupe({
		store: dedupeItem,
		ttlMs: DEDUPE_TTL_MS,
		maxSize: DEDUPE_MAX_SIZE,
		now: () => Date.now(),
	});

	return createDispatcher({
		dedupe,
		trace,
		now: () => Date.now(),
		sendResponse: (response) => {
			client.send(JSON.stringify(response));
		},
		handleBrowserAction: (request) => notImplemented(request.action),
		handleDomAction: (request) => notImplemented(request.action),
	});
}

function makeDeps(onMessage: (data: unknown) => void): WsClientDeps {
	return {
		bootstrap: bootstrapItem,
		// The MV3 service worker exposes a global WebSocket constructor; the
		// cast narrows the platform type to our structural slice.
		WebSocket: globalThis.WebSocket as unknown as WebSocketCtor,
		now: () => Date.now(),
		setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
		clearTimeout: (h) => globalThis.clearTimeout(h as number),
		random: () => Math.random(),
		setBadge,
		alarms: {
			create: (name, info) => chrome.alarms.create(name, info),
			clear: (name) => {
				void chrome.alarms.clear(name);
			},
			onAlarm: chrome.alarms.onAlarm,
		},
		runtimeOnMessage: {
			addListener: (cb) => chrome.runtime.onMessage.addListener(cb),
			removeListener: (cb) => chrome.runtime.onMessage.removeListener(cb),
		},
		onMessage,
	};
}

export default defineBackground(() => {
	let client!: WsClient;
	let dispatcher!: Dispatcher;
	client = createWsClient(
		makeDeps((data) => {
			void dispatcher.handleMessage(data);
		}),
	);
	dispatcher = makeDispatcher(client);
	client.start().catch(() => {
		// `start()` swallows expected branches (skip/reject) via badge state.
		// An unexpected throw lands here; surface it as the error badge so
		// the user has a visible signal without crashing the SW.
		setBadge("error");
	});
});
