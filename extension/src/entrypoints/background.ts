import { bootstrapItem } from "../background/storage";
import {
	type BadgeState,
	createWsClient,
	type WebSocketCtor,
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
// Dispatcher / dedupe / handler routing arrive in Task 6; for now the
// `onMessage` seam is left as a no-op stub.

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

function makeDeps(): WsClientDeps {
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
		// Task 6 will inject the dispatcher here.
		onMessage: () => {},
	};
}

export default defineBackground(() => {
	const client = createWsClient(makeDeps());
	client.start().catch(() => {
		// `start()` swallows expected branches (skip/reject) via badge state.
		// An unexpected throw lands here; surface it as the error badge so
		// the user has a visible signal without crashing the SW.
		setBadge("error");
	});
});
