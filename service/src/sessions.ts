import type { PacingMode, SessionId, SessionInfo, TabHandle, TabInfo } from "@bproxy/shared";
import { randomSessionId, SESSION_ID_PATTERN, TAB_HANDLE_PATTERN } from "./session-identifiers";

export { SESSION_ID_PATTERN, TAB_HANDLE_PATTERN } from "./session-identifiers";

export interface InternalTabInfo extends TabInfo {
	chromeTabId: number;
}

export interface InternalSession extends SessionInfo {
	lastActionAt: Record<string, number>;
	tabs: Map<TabHandle, InternalTabInfo>;
	nextTabOrdinal: number;
}

export interface SessionRegistry {
	create(label?: string): SessionInfo;
	get(id: string): SessionInfo | null;
	has(id: string): boolean;
	getOrCreate(id: string): InternalSession;
	bind(id: string, tab: number | string, pacing?: PacingMode): void;
	registerTab(
		id: string,
		chromeTabId: number,
		options?: { url?: string; title?: string; bind?: boolean },
	): TabInfo;
	removeTab(id: string, tab: string): InternalTabInfo | null;
	resolveTab(id: string, tab: string): InternalTabInfo | null;
	resolveBound(id: string): InternalTabInfo | null;
	hasTabAnywhere(tab: string): boolean;
	listTabs(id: string): TabInfo[];
	unbind(id: string): void;
	pause(id: string, reason?: string): void;
	resume(id: string): void;
	list(): SessionInfo[];
	close(id: string): { session: SessionInfo; tabs: Array<InternalTabInfo> } | null;
	internal(id: string): InternalSession;
	isValidSessionId(id: string): boolean;
	isValidTabHandle(tab: string): boolean;
}

export interface SessionRegistryOptions {
	random?: () => number;
	generateId?: () => string;
}

interface RegistryState {
	sessions: Map<string, InternalSession>;
	generateId: () => string;
}

export function createSessionRegistry(options: SessionRegistryOptions = {}): SessionRegistry {
	const random = options.random ?? Math.random;
	const state: RegistryState = {
		sessions: new Map(),
		generateId: options.generateId ?? (() => randomSessionId(random)),
	};

	return {
		create: (label) => createGeneratedSession(state, label),
		get: (id) => getSessionInfo(state, id),
		has: (id) => state.sessions.has(id),
		getOrCreate: (id) => getOrCreateSession(state, id),
		bind: (id, tab, pacing) => bindSession(state, id, tab, pacing),
		registerTab: (id, chromeTabId, config) => registerTabForSession(state, id, chromeTabId, config),
		removeTab: (id, tab) => removeTabFromSession(state, id, tab),
		resolveTab: (id, tab) => resolveTabInSession(state, id, tab),
		resolveBound: (id) => resolveBoundTab(state, id),
		hasTabAnywhere: (tab) => hasTabAnywhere(state, tab),
		listTabs: (id) => listTabsForSession(state, id),
		unbind: (id) => unbindSession(state, id),
		pause: (id, reason) => pauseSession(state, id, reason),
		resume: (id) => resumeSession(state, id),
		list: () => [...state.sessions.values()].map(toSessionInfo),
		close: (id) => closeSession(state, id),
		internal: (id) => requireSession(state, id),
		isValidSessionId: (id) => SESSION_ID_PATTERN.test(id),
		isValidTabHandle: (tab) => TAB_HANDLE_PATTERN.test(tab),
	};
}

function createGeneratedSession(state: RegistryState, label?: string): SessionInfo {
	let id = state.generateId();
	while (state.sessions.has(id)) {
		id = state.generateId();
	}
	const session = createInternalSession(id, label);
	state.sessions.set(id, session);
	return toSessionInfo(session);
}

function getSessionInfo(state: RegistryState, id: string): SessionInfo | null {
	const session = state.sessions.get(id);
	return session ? toSessionInfo(session) : null;
}

function requireSession(state: RegistryState, id: string): InternalSession {
	const session = state.sessions.get(id);
	if (!session) {
		throw new Error(`Session '${id}' was not found`);
	}
	return session;
}

function getOrCreateSession(state: RegistryState, id: string): InternalSession {
	const existing = state.sessions.get(id);
	if (existing) return existing;
	const created = createInternalSession(id);
	state.sessions.set(id, created);
	return created;
}

function bindSession(
	state: RegistryState,
	id: string,
	tab: number | string,
	pacing?: PacingMode,
): void {
	if (typeof tab === "number") {
		const session = requireSession(state, id);
		registerChromeTab(session, tab, { bind: true });
		setPacing(session, pacing);
		syncBoundFlags(session);
		return;
	}

	const session = requireSession(state, id);
	const handle = tab as TabHandle;
	if (!session.tabs.has(handle)) {
		throw new Error(`Tab '${tab}' was not found in session '${id}'`);
	}
	session.tab = handle;
	setPacing(session, pacing);
	syncBoundFlags(session);
}

function registerTabForSession(
	state: RegistryState,
	id: string,
	chromeTabId: number,
	config?: { url?: string; title?: string; bind?: boolean },
): TabInfo {
	const session = requireSession(state, id);
	const tab = registerChromeTab(session, chromeTabId, config);
	return toTabInfo(tab);
}

function removeTabFromSession(
	state: RegistryState,
	id: string,
	tab: string,
): InternalTabInfo | null {
	const session = state.sessions.get(id);
	if (!session) return null;
	const handle = tab as TabHandle;
	const existing = session.tabs.get(handle);
	if (!existing) return null;
	session.tabs.delete(handle);
	if (session.tab === handle) {
		session.tab = null;
	}
	syncBoundFlags(session);
	return toInternalTabInfo(existing);
}

function resolveTabInSession(
	state: RegistryState,
	id: string,
	tab: string,
): InternalTabInfo | null {
	const session = state.sessions.get(id);
	if (!session) return null;
	const resolved = session.tabs.get(tab as TabHandle);
	return resolved ? toInternalTabInfo(resolved) : null;
}

function resolveBoundTab(state: RegistryState, id: string): InternalTabInfo | null {
	const session = state.sessions.get(id);
	if (!session || session.tab === null) return null;
	const resolved = session.tabs.get(session.tab);
	return resolved ? toInternalTabInfo(resolved) : null;
}

function hasTabAnywhere(state: RegistryState, tab: string): boolean {
	const handle = tab as TabHandle;
	for (const session of state.sessions.values()) {
		if (session.tabs.has(handle)) return true;
	}
	return false;
}

function listTabsForSession(state: RegistryState, id: string): TabInfo[] {
	const session = state.sessions.get(id);
	if (!session) return [];
	return [...session.tabs.values()].map(toTabInfo);
}

function unbindSession(state: RegistryState, id: string): void {
	const session = state.sessions.get(id);
	if (!session) return;
	session.tab = null;
	session.paused = false;
	delete session.pauseReason;
	syncBoundFlags(session);
}

function pauseSession(state: RegistryState, id: string, reason?: string): void {
	const session = requireSession(state, id);
	session.paused = true;
	session.pauseReason = reason;
}

function resumeSession(state: RegistryState, id: string): void {
	const session = state.sessions.get(id);
	if (!session) return;
	session.paused = false;
	delete session.pauseReason;
}

function closeSession(
	state: RegistryState,
	id: string,
): { session: SessionInfo; tabs: Array<InternalTabInfo> } | null {
	const session = state.sessions.get(id);
	if (!session) return null;
	state.sessions.delete(id);
	return {
		session: toSessionInfo(session),
		tabs: [...session.tabs.values()].map(toInternalTabInfo),
	};
}

function createInternalSession(id: string, label?: string): InternalSession {
	return {
		id: id as SessionId,
		label,
		tab: null,
		pacing: "human",
		paused: false,
		lastActionAt: {},
		tabs: new Map(),
		nextTabOrdinal: 1,
	};
}

function registerChromeTab(
	session: InternalSession,
	chromeTabId: number,
	config?: { url?: string; title?: string; bind?: boolean },
): InternalTabInfo {
	const existing = findTabByChromeId(session, chromeTabId);
	if (existing) return updateExistingTab(session, existing, config);
	return createChromeTab(session, chromeTabId, config);
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

function setPacing(session: InternalSession, pacing?: PacingMode): void {
	if (pacing) session.pacing = pacing;
}

function findTabByChromeId(session: InternalSession, chromeTabId: number): InternalTabInfo | null {
	for (const tab of session.tabs.values()) {
		if (tab.chromeTabId === chromeTabId) return tab;
	}
	return null;
}

function syncBoundFlags(session: InternalSession): void {
	for (const [handle, tab] of session.tabs) {
		tab.bound = session.tab === handle;
	}
}

function toSessionInfo(session: InternalSession): SessionInfo {
	return {
		id: session.id,
		label: session.label,
		tab: session.tab,
		pacing: session.pacing,
		paused: session.paused,
		pauseReason: session.pauseReason,
	};
}

function toTabInfo(tab: InternalTabInfo): TabInfo {
	return {
		tab: tab.tab,
		url: tab.url,
		title: tab.title,
		bound: tab.bound,
	};
}

function toInternalTabInfo(tab: InternalTabInfo): InternalTabInfo {
	return {
		tab: tab.tab,
		url: tab.url,
		title: tab.title,
		bound: tab.bound,
		chromeTabId: tab.chromeTabId,
	};
}
