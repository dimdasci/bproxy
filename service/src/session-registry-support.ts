import type { PacingMode, SessionId, SessionInfo, TabHandle, TabInfo } from "@bproxy/shared";
import type { InternalSession, InternalTabInfo } from "./session-registry-types";

export function createInternalSession(id: string, owner: string, label?: string): InternalSession {
	return {
		id: id as SessionId,
		owner,
		label,
		tab: null,
		pacing: "human",
		paused: false,
		lastActionAt: {},
		tabs: new Map(),
		nextTabOrdinal: 1,
	};
}

export function registerChromeTab(
	session: InternalSession,
	chromeTabId: number,
	config?: { url?: string; title?: string; bind?: boolean },
): InternalTabInfo {
	const existing = findTabByChromeId(session, chromeTabId);
	if (existing) return updateExistingTab(session, existing, config);
	return createChromeTab(session, chromeTabId, config);
}

export function setPacing(session: InternalSession, pacing?: PacingMode): void {
	if (pacing) session.pacing = pacing;
}

export function syncBoundFlags(session: InternalSession): void {
	for (const [handle, tab] of session.tabs) {
		tab.bound = session.tab === handle;
	}
}

export function toSessionInfo(session: InternalSession): SessionInfo {
	return {
		id: session.id,
		label: session.label,
		tab: session.tab,
		pacing: session.pacing,
		paused: session.paused,
		pauseReason: session.pauseReason,
	};
}

export function toTabInfo(tab: InternalTabInfo): TabInfo {
	return {
		tab: tab.tab,
		url: tab.url,
		title: tab.title,
		bound: tab.bound,
	};
}

export function toInternalTabInfo(tab: InternalTabInfo): InternalTabInfo {
	return {
		tab: tab.tab,
		url: tab.url,
		title: tab.title,
		bound: tab.bound,
		chromeTabId: tab.chromeTabId,
	};
}

function updateExistingTab(
	session: InternalSession,
	tab: InternalTabInfo,
	config?: { url?: string; title?: string; bind?: boolean },
): InternalTabInfo {
	if (config?.url !== undefined) tab.url = config.url;
	if (config?.title !== undefined) tab.title = config.title;
	if (config?.bind) session.tab = tab.tab;
	syncBoundFlags(session);
	return tab;
}

function createChromeTab(
	session: InternalSession,
	chromeTabId: number,
	config?: { url?: string; title?: string; bind?: boolean },
): InternalTabInfo {
	const handle = `t${session.nextTabOrdinal++}` as TabHandle;
	const created: InternalTabInfo = {
		tab: handle,
		url: config?.url ?? "",
		title: config?.title ?? "",
		bound: false,
		chromeTabId,
	};
	session.tabs.set(handle, created);
	if (config?.bind) session.tab = handle;
	syncBoundFlags(session);
	return created;
}

function findTabByChromeId(session: InternalSession, chromeTabId: number): InternalTabInfo | null {
	for (const tab of session.tabs.values()) {
		if (tab.chromeTabId === chromeTabId) return tab;
	}
	return null;
}
