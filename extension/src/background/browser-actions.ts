import type { BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { detectInterstitial } from "./browser-action-interstitials";
import {
	debuggerDisabledError,
	emptyPageState,
	errorMessage,
	evalDisabledError,
	humanRequiredError,
	navigationFailed,
	pageStateFromTab,
	parseCapturedImage,
	scriptError,
	tabNotVisible,
} from "./browser-action-support";
import type { ExecutedAction } from "./dispatcher";
import type { BrowserAction } from "./forwarded-actions";
import type { MainWorldExecutor } from "./main-world";
import type { TabLike, TabRuntime } from "./tabs";

export interface BrowserTabsSeam {
	update(tabId: number, updateProperties: Record<string, unknown>): Promise<TabLike>;
	query(queryInfo?: Record<string, unknown>): Promise<TabLike[]>;
	create(createProperties: Record<string, unknown>): Promise<TabLike>;
	remove(tabId: number): Promise<void>;
	captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg" }): Promise<string>;
}

export interface BrowserActionHandlerDeps {
	mainWorld: MainWorldExecutor;
	tabRuntime: Pick<TabRuntime, "resolveTargetTab" | "waitForLoad" | "getInjectedTabs">;
	tabs: BrowserTabsSeam;
	now?: () => number;
	isEvalEnabled?: () => boolean | Promise<boolean>;
	isDebuggerScreenshotEnabled?: () => boolean | Promise<boolean>;
	captureDebuggerScreenshot?: (
		tab: TabLike & { id: number },
	) => Promise<{ base64: string; format: "png" | "jpeg" }>;
}

export interface BrowserActionHandler {
	handleBrowserAction(request: BproxyForwardedRequest<BrowserAction>): Promise<ExecutedAction>;
	handleMainWorldFill(request: BproxyForwardedRequest<"fill">): Promise<ExecutedAction>;
}

type RoutedBrowserAction = Exclude<BrowserAction, "eval" | "require-human">;
type BrowserActionFn<A extends RoutedBrowserAction> = (
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<A>,
) => Promise<ExecutedAction>;

type BrowserActionMap = { [A in RoutedBrowserAction]: BrowserActionFn<A> };

const ROUTED_BROWSER_ACTIONS: BrowserActionMap = {
	navigate: handleNavigate,
	screenshot: handleScreenshot,
	"tab.list": handleTabList,
	"tab.open": handleTabOpen,
	"tab.close": handleTabClose,
	"tab.pin": handleTabPin,
	"tab.unpin": handleTabUnpin,
};

export function createBrowserActionHandler(deps: BrowserActionHandlerDeps): BrowserActionHandler {
	return {
		handleBrowserAction: (request) => handleBrowserAction(deps, request),
		handleMainWorldFill: async (request) => {
			assertRuntimeApiFillRequest(request);
			return deps.mainWorld.executeRuntimeApiFill(request);
		},
	};
}

async function handleBrowserAction(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<BrowserAction>,
): Promise<ExecutedAction> {
	if (request.action === "require-human") {
		throw await buildRequireHumanError(deps, request as BproxyForwardedRequest<"require-human">);
	}
	if (request.action === "eval") {
		if (!(await evalEnabled(deps))) throw evalDisabledError();
		return deps.mainWorld.executeEval(request as BproxyForwardedRequest<"eval">);
	}
	const handler = ROUTED_BROWSER_ACTIONS[request.action];
	return handler(deps, request as never);
}

async function handleNavigate(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"navigate">,
): Promise<ExecutedAction> {
	const target = await deps.tabRuntime.resolveTargetTab(request.target.tabId);
	const startedAt = now(deps);
	try {
		await deps.tabs.update(target.id, { url: request.params.url });
	} catch (error) {
		throw navigationFailed(`Failed to navigate tab ${target.id} to ${request.params.url}`, {
			tabId: target.id,
			url: request.params.url,
			cause: errorMessage(error),
		});
	}

	const loaded = await deps.tabRuntime.waitForLoad(target.id, {
		timeoutMs: Math.max(1, request.deadline - startedAt),
	});
	if (isErrorUrl(loaded.url)) {
		throw navigationFailed(`Navigation failed for ${request.params.url}`, {
			tabId: loaded.id,
			url: loaded.url,
		});
	}
	const interstitial = detectInterstitial(loaded);
	if (interstitial) throw interstitial;
	return {
		data: {
			url: loaded.url ?? request.params.url,
			title: loaded.title ?? "",
			loadTime: Math.max(0, now(deps) - startedAt),
		},
		page: pageStateFromTab(loaded),
	};
}

async function handleScreenshot(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"screenshot">,
): Promise<ExecutedAction> {
	let target = await deps.tabRuntime.resolveTargetTab(request.target.tabId);
	if (request.params.debugger === true) {
		if (!(await debuggerScreenshotEnabled(deps)) || !deps.captureDebuggerScreenshot) {
			throw debuggerDisabledError();
		}
		const captured = await deps.captureDebuggerScreenshot(target);
		return { data: captured, page: pageStateFromTab(target) };
	}
	if (request.params.activate === true && target.active !== true) {
		target = await resolveTabResult(deps, target.id, deps.tabs.update(target.id, { active: true }));
	}
	if (target.active !== true) throw tabNotVisible(target.id);
	if (typeof target.windowId !== "number") {
		throw scriptError(`Target tab ${target.id} has no windowId for captureVisibleTab`);
	}
	const captured = await deps.tabs.captureVisibleTab(target.windowId, { format: "png" });
	return {
		data: parseCapturedImage(captured),
		page: pageStateFromTab(target),
	};
}

async function handleTabList(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.list">,
): Promise<ExecutedAction> {
	const injected = new Set(await deps.tabRuntime.getInjectedTabs());
	const tabs = (await deps.tabs.query({})).flatMap((tab) => toListedTab(tab, request, injected));
	return {
		data: { tabs },
		page: await currentPageStateOrEmpty(deps, request.target.tabId),
	};
}

function toListedTab(
	tab: TabLike,
	request: BproxyForwardedRequest<"tab.list">,
	injected: ReadonlySet<number>,
) {
	if (typeof tab.id !== "number") return [];
	return [
		{
			id: tab.id,
			url: tab.url ?? "",
			title: tab.title ?? "",
			session: tab.id === request.target.tabId ? request.session : null,
			injected: injected.has(tab.id),
		},
	];
}

async function handleTabOpen(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.open">,
): Promise<ExecutedAction> {
	const created = await resolveTabResult(deps, null, deps.tabs.create({ url: request.params.url }));
	return {
		data: { tabId: created.id, url: created.url ?? request.params.url },
		page: pageStateFromTab(created),
	};
}

async function handleTabClose(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.close">,
): Promise<ExecutedAction> {
	const tab = await deps.tabRuntime.resolveTargetTab(request.params.tabId ?? request.target.tabId);
	await deps.tabs.remove(tab.id);
	return { data: {}, page: pageStateFromTab(tab) };
}

async function handleTabPin(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.pin">,
): Promise<ExecutedAction> {
	const tabId = request.params.tabId ?? request.target.tabId;
	const updated = await resolveTabResult(deps, tabId, deps.tabs.update(tabId, { pinned: true }));
	return { data: { tabId: updated.id }, page: pageStateFromTab(updated) };
}

async function handleTabUnpin(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.unpin">,
): Promise<ExecutedAction> {
	const updated = await resolveTabResult(
		deps,
		request.target.tabId,
		deps.tabs.update(request.target.tabId, { pinned: false }),
	);
	return { data: {}, page: pageStateFromTab(updated) };
}

async function buildRequireHumanError(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"require-human">,
): Promise<BproxyError> {
	const tab = await safeResolveTargetTab(deps, request.target.tabId);
	return humanRequiredError(request.params.reason, {
		reason: request.params.reason,
		forAttach: request.params.forAttach,
		tabId: request.target.tabId,
		url: tab?.url,
		state: tab ? pageStateFromTab(tab).state : undefined,
		kind: request.params.forAttach ? "attach" : "manual",
		id: request.id,
	});
}

async function resolveTabResult(
	deps: BrowserActionHandlerDeps,
	tabId: number | null,
	pending: Promise<TabLike>,
): Promise<TabLike & { id: number }> {
	const tab = await pending;
	if (typeof tab.id === "number") return { ...tab, id: tab.id };
	if (tabId !== null) return deps.tabRuntime.resolveTargetTab(tabId);
	throw scriptError("Chrome tabs API returned a tab without an id");
}

async function currentPageStateOrEmpty(
	deps: BrowserActionHandlerDeps,
	tabId: number,
): Promise<PageState> {
	const tab = await safeResolveTargetTab(deps, tabId);
	return tab ? pageStateFromTab(tab) : emptyPageState();
}

async function safeResolveTargetTab(
	deps: BrowserActionHandlerDeps,
	tabId: number,
): Promise<(TabLike & { id: number }) | null> {
	try {
		return await deps.tabRuntime.resolveTargetTab(tabId);
	} catch {
		return null;
	}
}

async function evalEnabled(deps: BrowserActionHandlerDeps): Promise<boolean> {
	return (await deps.isEvalEnabled?.()) ?? false;
}

async function debuggerScreenshotEnabled(deps: BrowserActionHandlerDeps): Promise<boolean> {
	return (await deps.isDebuggerScreenshotEnabled?.()) ?? false;
}

function assertRuntimeApiFillRequest(request: BproxyForwardedRequest<"fill">): void {
	if (request.params.method !== "runtime-api") {
		throw scriptError(`fill method ${request.params.method} must run in the content script`);
	}
	if (request.params.world !== "main") {
		throw scriptError('fill method runtime-api requires world "main"');
	}
}

function isErrorUrl(url: string | undefined): boolean {
	return (
		typeof url === "string" &&
		(url.startsWith("chrome-error://") ||
			url.startsWith("edge-error://") ||
			url.startsWith("about:neterror"))
	);
}

function now(deps: BrowserActionHandlerDeps): number {
	return deps.now?.() ?? Date.now();
}
