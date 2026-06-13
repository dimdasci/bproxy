import type { BproxyError, BproxyForwardedRequest } from "@bproxy/shared";
import {
	type ContentRpcRequest,
	parseContentRpcResponse,
	toContentRpcRequest,
} from "../content/rpc";
import type { ExecutedAction } from "./dispatcher";
import type { DomAction } from "./forwarded-actions";
import type { ContentInjector } from "./injection";
import { type NavigationPushMessage, sendNavigationEvent } from "./navigation-push";
import { tabNotFoundError, tabRuntimeScriptError, timeoutError, withTimeout } from "./tabs-support";

export interface TabLike {
	id?: number;
	url?: string;
	title?: string;
	status?: string;
	active?: boolean;
	windowId?: number;
	pinned?: boolean;
}

export interface TabsSeam {
	get(tabId: number): Promise<TabLike>;
	sendMessage(tabId: number, message: ContentRpcRequest): Promise<unknown>;
	onRemoved: EventSeam<(tabId: number, removeInfo?: unknown) => void>;
}

export interface WebNavigationSeam {
	onCommitted: EventSeam<(details: NavigationEvent) => void>;
	onCompleted: EventSeam<(details: NavigationEvent) => void>;
	onHistoryStateUpdated: EventSeam<(details: NavigationEvent) => void>;
}

export interface EventSeam<T> {
	addListener(cb: T): void;
	removeListener(cb: T): void;
}

export interface NavigationEvent {
	tabId: number;
	frameId: number;
	url?: string;
}

export interface FrameRecord {
	tabId: number;
	frameId: number;
	url?: string;
	lastCommittedAt?: number;
	lastCompletedAt?: number;
	lastHistoryStateUpdatedAt?: number;
}

export interface WaitForLoadOptions {
	timeoutMs: number;
}

export interface TabRuntimeDeps {
	tabs: TabsSeam;
	webNavigation: WebNavigationSeam;
	injector: ContentInjector;
	now: () => number;
	setTimeout: (cb: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	rpcTimeoutMs: number;
	sendNavigation?: (message: NavigationPushMessage) => boolean;
}

export interface TabRuntime {
	start(): void;
	stop(): void;
	resolveTargetTab(tabId: number): Promise<TabLike & { id: number }>;
	waitForLoad(tabId: number, options: WaitForLoadOptions): Promise<TabLike & { id: number }>;
	handleDomAction<A extends DomAction>(request: BproxyForwardedRequest<A>): Promise<ExecutedAction>;
	getFrames(tabId: number): FrameRecord[];
	getInjectedTabs(): Promise<number[]>;
}

interface LoadWaiter {
	resolve: (tab: TabLike & { id: number }) => void;
	reject: (error: BproxyError) => void;
	timer: unknown;
}

interface RuntimeState {
	started: boolean;
	removedListener: ((tabId: number, removeInfo?: unknown) => void) | null;
	committedListener: ((details: NavigationEvent) => void) | null;
	completedListener: ((details: NavigationEvent) => void) | null;
	historyListener: ((details: NavigationEvent) => void) | null;
	frames: Map<number, Map<number, FrameRecord>>;
	loadWaiters: Map<number, Set<LoadWaiter>>;
}

export function createTabRuntime(deps: TabRuntimeDeps): TabRuntime {
	const state: RuntimeState = {
		started: false,
		removedListener: null,
		committedListener: null,
		completedListener: null,
		historyListener: null,
		frames: new Map(),
		loadWaiters: new Map(),
	};

	return {
		start: () => startRuntime(deps, state),
		stop: () => stopRuntime(deps, state),
		resolveTargetTab: (tabId) => resolveTargetTab(deps, tabId),
		waitForLoad: (tabId, options) => waitForLoad(deps, state, tabId, options),
		handleDomAction: (request) => handleDomAction(deps, request),
		getFrames: (tabId) => getFrames(state, tabId),
		getInjectedTabs: () => deps.injector.getInjectedTabs(),
	};
}

function startRuntime(deps: TabRuntimeDeps, state: RuntimeState): void {
	if (state.started) return;
	state.started = true;
	const removed = (tabId: number) => {
		state.frames.delete(tabId);
		rejectLoadWaiters(deps, state, tabId, tabNotFoundError(tabId));
		void deps.injector.forgetTab(tabId);
	};
	const committed = (details: NavigationEvent) => {
		if (details.frameId === 0) {
			state.frames.set(details.tabId, new Map());
			void deps.injector.forgetTab(details.tabId);
			sendNavigationEvent(deps, details, "committed");
		}
		upsertFrame(state.frames, details, "lastCommittedAt", deps.now());
	};
	const completed = (details: NavigationEvent) => {
		upsertFrame(state.frames, details, "lastCompletedAt", deps.now());
		if (details.frameId === 0) {
			settleLoadWaiters(deps, state, details.tabId);
		}
	};
	const history = (details: NavigationEvent) => {
		if (details.frameId === 0) sendNavigationEvent(deps, details, "history_state");
		upsertFrame(state.frames, details, "lastHistoryStateUpdatedAt", deps.now());
	};
	state.removedListener = removed;
	state.committedListener = committed;
	state.completedListener = completed;
	state.historyListener = history;
	deps.tabs.onRemoved.addListener(removed);
	deps.webNavigation.onCommitted.addListener(committed);
	deps.webNavigation.onCompleted.addListener(completed);
	deps.webNavigation.onHistoryStateUpdated.addListener(history);
}

function stopRuntime(deps: TabRuntimeDeps, state: RuntimeState): void {
	if (!state.started) return;
	state.started = false;
	if (state.removedListener) {
		deps.tabs.onRemoved.removeListener(state.removedListener);
		state.removedListener = null;
	}
	if (state.committedListener) {
		deps.webNavigation.onCommitted.removeListener(state.committedListener);
		state.committedListener = null;
	}
	if (state.completedListener) {
		deps.webNavigation.onCompleted.removeListener(state.completedListener);
		state.completedListener = null;
	}
	if (state.historyListener) {
		deps.webNavigation.onHistoryStateUpdated.removeListener(state.historyListener);
		state.historyListener = null;
	}
	rejectAllLoadWaiters(deps, state, tabRuntimeScriptError("Tab runtime stopped"));
}

async function handleDomAction<A extends DomAction>(
	deps: TabRuntimeDeps,
	request: BproxyForwardedRequest<A>,
): Promise<ExecutedAction> {
	const tab = await resolveTargetTab(deps, requireTargetTabId(request));
	await deps.injector.ensureInjected(tab.id);
	const raw = await withTimeout(
		deps,
		deps.tabs.sendMessage(
			tab.id,
			toContentRpcRequest({
				id: request.id,
				action: request.action,
				params: request.params,
			}),
		),
	);
	const parsed = parseContentRpcResponse(raw, request.id);
	if (parsed.kind === "invalid") {
		throw tabRuntimeScriptError(`Invalid content-script response: ${parsed.error}`);
	}
	if (!parsed.ok) {
		throw parsed.error;
	}
	return {
		data: parsed.data,
		page: parsed.page,
	};
}

function getFrames(state: RuntimeState, tabId: number): FrameRecord[] {
	const frames = state.frames.get(tabId);
	if (!frames) return [];
	return [...frames.values()].sort((left, right) => left.frameId - right.frameId);
}

function requireTargetTabId(request: BproxyForwardedRequest<DomAction>): number {
	if (typeof request.target.tabId === "number") return request.target.tabId;
	throw tabRuntimeScriptError(`${request.action} requires a target tab id`);
}

async function resolveTargetTab(
	deps: TabRuntimeDeps,
	tabId: number,
): Promise<TabLike & { id: number }> {
	try {
		const tab = await deps.tabs.get(tabId);
		if (!tab || typeof tab.id !== "number") {
			throw new Error("tab missing id");
		}
		return { ...tab, id: tab.id };
	} catch {
		throw tabNotFoundError(tabId);
	}
}

async function waitForLoad(
	deps: TabRuntimeDeps,
	state: RuntimeState,
	tabId: number,
	options: WaitForLoadOptions,
): Promise<TabLike & { id: number }> {
	if (options.timeoutMs <= 0) {
		throw timeoutError(options.timeoutMs);
	}
	const current = await resolveTargetTab(deps, tabId);
	if (current.status === "complete") {
		return current;
	}
	return await new Promise((resolve, reject) => {
		const waiter: LoadWaiter = {
			resolve,
			reject,
			timer: null,
		};
		let waiters = state.loadWaiters.get(tabId);
		if (!waiters) {
			waiters = new Set();
			state.loadWaiters.set(tabId, waiters);
		}
		waiters.add(waiter);
		waiter.timer = deps.setTimeout(() => {
			removeLoadWaiter(state, tabId, waiter);
			reject(timeoutError(options.timeoutMs));
		}, options.timeoutMs);
	});
}

function settleLoadWaiters(deps: TabRuntimeDeps, state: RuntimeState, tabId: number): void {
	const waiters = state.loadWaiters.get(tabId);
	if (!waiters || waiters.size === 0) return;
	for (const waiter of Array.from(waiters)) {
		removeLoadWaiter(state, tabId, waiter);
		deps.clearTimeout(waiter.timer);
		void resolveTargetTab(deps, tabId).then(waiter.resolve, (error: BproxyError) =>
			waiter.reject(error),
		);
	}
}

function rejectLoadWaiters(
	deps: TabRuntimeDeps,
	state: RuntimeState,
	tabId: number,
	error: BproxyError,
): void {
	const waiters = state.loadWaiters.get(tabId);
	if (!waiters || waiters.size === 0) return;
	for (const waiter of Array.from(waiters)) {
		removeLoadWaiter(state, tabId, waiter);
		deps.clearTimeout(waiter.timer);
		waiter.reject(error);
	}
}

function rejectAllLoadWaiters(deps: TabRuntimeDeps, state: RuntimeState, error: BproxyError): void {
	for (const tabId of Array.from(state.loadWaiters.keys())) {
		rejectLoadWaiters(deps, state, tabId, error);
	}
}

function removeLoadWaiter(state: RuntimeState, tabId: number, waiter: LoadWaiter): void {
	const waiters = state.loadWaiters.get(tabId);
	if (!waiters) return;
	waiters.delete(waiter);
	if (waiters.size === 0) {
		state.loadWaiters.delete(tabId);
	}
}

function upsertFrame(
	framesByTab: Map<number, Map<number, FrameRecord>>,
	details: NavigationEvent,
	field: "lastCommittedAt" | "lastCompletedAt" | "lastHistoryStateUpdatedAt",
	at: number,
): void {
	let frames = framesByTab.get(details.tabId);
	if (!frames) {
		frames = new Map();
		framesByTab.set(details.tabId, frames);
	}
	const current = frames.get(details.frameId) ?? { tabId: details.tabId, frameId: details.frameId };
	frames.set(details.frameId, {
		...current,
		url: details.url ?? current.url,
		[field]: at,
	});
}
