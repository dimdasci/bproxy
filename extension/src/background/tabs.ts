import type { ActionParams, BproxyError, BproxyForwardedRequest } from "@bproxy/shared";
import {
	type ContentAction,
	type ContentRpcRequest,
	parseContentRpcResponse,
	toContentRpcRequest,
} from "../content/rpc";
import type { ExecutedAction } from "./dispatcher";
import type { DomAction } from "./forwarded-actions";
import type { ContentInjector } from "./injection";

export interface TabLike {
	id?: number;
	url?: string;
	title?: string;
	status?: string;
	active?: boolean;
	windowId?: number;
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

export interface TabRuntimeDeps {
	tabs: TabsSeam;
	webNavigation: WebNavigationSeam;
	injector: ContentInjector;
	now: () => number;
	setTimeout: (cb: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	rpcTimeoutMs: number;
}

export interface TabRuntime {
	start(): void;
	stop(): void;
	resolveTargetTab(tabId: number): Promise<TabLike & { id: number }>;
	handleDomAction<A extends DomAction>(request: BproxyForwardedRequest<A>): Promise<ExecutedAction>;
	getFrames(tabId: number): FrameRecord[];
}

interface RuntimeState {
	started: boolean;
	removedListener: ((tabId: number, removeInfo?: unknown) => void) | null;
	committedListener: ((details: NavigationEvent) => void) | null;
	completedListener: ((details: NavigationEvent) => void) | null;
	historyListener: ((details: NavigationEvent) => void) | null;
	frames: Map<number, Map<number, FrameRecord>>;
}

export function createTabRuntime(deps: TabRuntimeDeps): TabRuntime {
	const state: RuntimeState = {
		started: false,
		removedListener: null,
		committedListener: null,
		completedListener: null,
		historyListener: null,
		frames: new Map(),
	};

	return {
		start: () => startRuntime(deps, state),
		stop: () => stopRuntime(deps, state),
		resolveTargetTab: (tabId) => resolveTargetTab(deps, tabId),
		handleDomAction: (request) => handleDomAction(deps, request),
		getFrames: (tabId) => getFrames(state, tabId),
	};
}

function startRuntime(deps: TabRuntimeDeps, state: RuntimeState): void {
	if (state.started) return;
	state.started = true;
	const removed = (tabId: number) => {
		state.frames.delete(tabId);
		void deps.injector.forgetTab(tabId);
	};
	const committed = (details: NavigationEvent) => {
		if (details.frameId === 0) {
			state.frames.set(details.tabId, new Map());
			void deps.injector.forgetTab(details.tabId);
		}
		upsertFrame(state.frames, details, "lastCommittedAt", deps.now());
	};
	const completed = (details: NavigationEvent) => {
		upsertFrame(state.frames, details, "lastCompletedAt", deps.now());
	};
	const history = (details: NavigationEvent) => {
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
}

async function handleDomAction<A extends DomAction>(
	deps: TabRuntimeDeps,
	request: BproxyForwardedRequest<A>,
): Promise<ExecutedAction> {
	const tab = await resolveTargetTab(deps, request.target.tabId);
	await deps.injector.ensureInjected(tab.id);
	const raw = await withTimeout(
		deps,
		deps.tabs.sendMessage(
			tab.id,
			toContentRpcRequest({
				id: request.id,
				action: request.action as ContentAction,
				params: request.params as ActionParams[ContentAction],
			}),
		),
	);
	const parsed = parseContentRpcResponse(raw, request.id);
	if (parsed.kind === "invalid") {
		throw scriptError(`Invalid content-script response: ${parsed.error}`);
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
		throw tabNotFound(tabId);
	}
}

async function withTimeout(deps: TabRuntimeDeps, promise: Promise<unknown>): Promise<unknown> {
	let timer: unknown = null;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = deps.setTimeout(() => reject(timeoutError(deps.rpcTimeoutMs)), deps.rpcTimeoutMs);
			}),
		]);
	} finally {
		if (timer !== null) deps.clearTimeout(timer);
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

function tabNotFound(tabId: number): BproxyError {
	return {
		code: "TAB_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message: `Target tab ${tabId} was not found`,
		details: { tabId },
	};
}

function timeoutError(timeoutMs: number): BproxyError {
	return {
		code: "TIMEOUT",
		category: "transport",
		retry: "conditional",
		message: `Timed out waiting for content-script response after ${timeoutMs}ms`,
		details: { timeoutMs },
	};
}

function scriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}
