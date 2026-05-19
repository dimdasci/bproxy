import type { BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { snapshotPageState } from "../content/page-state";
import type { ExecutedAction } from "./dispatcher";
import type { BrowserAction } from "./forwarded-actions";
import type { MainWorldExecutor } from "./main-world";
import type { TabLike, TabRuntime } from "./tabs";

export interface BrowserTabsSeam {
	update(tabId: number, updateProperties: Record<string, unknown>): Promise<TabLike>;
	query(queryInfo?: Record<string, unknown>): Promise<TabLike[]>;
	create(createProperties: Record<string, unknown>): Promise<TabLike>;
	remove(tabId: number): Promise<void>;
	captureVisibleTab(
		windowId?: number,
		options?: { format?: "png" | "jpeg" },
	): Promise<string>;
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

export function createBrowserActionHandler(deps: BrowserActionHandlerDeps): BrowserActionHandler {
	return {
		handleBrowserAction: async (request) => {
			switch (request.action) {
				case "navigate":
					return await handleNavigate(deps, request as BproxyForwardedRequest<"navigate">);
				case "screenshot":
					return await handleScreenshot(deps, request as BproxyForwardedRequest<"screenshot">);
				case "tab.list":
					return await handleTabList(deps, request as BproxyForwardedRequest<"tab.list">);
				case "tab.open":
					return await handleTabOpen(deps, request as BproxyForwardedRequest<"tab.open">);
				case "tab.close":
					return await handleTabClose(deps, request as BproxyForwardedRequest<"tab.close">);
				case "tab.pin":
					return await handleTabPin(deps, request as BproxyForwardedRequest<"tab.pin">);
				case "tab.unpin":
					return await handleTabUnpin(deps, request as BproxyForwardedRequest<"tab.unpin">);
				case "require-human":
					throw await buildRequireHumanError(deps, request as BproxyForwardedRequest<"require-human">);
				case "eval": {
					if (!(await evalEnabled(deps))) throw evalDisabledError();
					return deps.mainWorld.executeEval(request as BproxyForwardedRequest<"eval">);
				}
				default:
					throw new Error(`No extension handler is registered yet for action ${request.action}`);
			}
		},
		handleMainWorldFill: async (request) => {
			assertRuntimeApiFillRequest(request);
			return deps.mainWorld.executeRuntimeApiFill(request);
		},
	};
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
		return {
			data: captured,
			page: pageStateFromTab(target),
		};
	}
	if (request.params.activate === true && target.active !== true) {
		target = await resolveTabResult(deps, target.id, deps.tabs.update(target.id, { active: true }));
	}
	if (target.active !== true) {
		throw tabNotVisible(target.id);
	}
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
	const tabs = (await deps.tabs.query({})).flatMap((tab) => {
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
	});
	return {
		data: { tabs },
		page: await currentPageStateOrEmpty(deps, request.target.tabId),
	};
}

async function handleTabOpen(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.open">,
): Promise<ExecutedAction> {
	const created = await resolveTabResult(deps, null, deps.tabs.create({ url: request.params.url }));
	return {
		data: {
			tabId: created.id,
			url: created.url ?? request.params.url,
		},
		page: pageStateFromTab(created),
	};
}

async function handleTabClose(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.close">,
): Promise<ExecutedAction> {
	const tab = await deps.tabRuntime.resolveTargetTab(request.params.tabId ?? request.target.tabId);
	await deps.tabs.remove(tab.id);
	return {
		data: {},
		page: pageStateFromTab(tab),
	};
}

async function handleTabPin(
	deps: BrowserActionHandlerDeps,
	request: BproxyForwardedRequest<"tab.pin">,
): Promise<ExecutedAction> {
	const tabId = request.params.tabId ?? request.target.tabId;
	const updated = await resolveTabResult(deps, tabId, deps.tabs.update(tabId, { pinned: true }));
	return {
		data: { tabId: updated.id },
		page: pageStateFromTab(updated),
	};
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
	return {
		data: {},
		page: pageStateFromTab(updated),
	};
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
	if (tabId !== null) return await deps.tabRuntime.resolveTargetTab(tabId);
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

function pageStateFromTab(tab: TabLike): PageState {
	return snapshotPageState({
		url: tab.url ?? "",
		title: tab.title ?? "",
		readyState: tab.status === "complete" ? "complete" : "loading",
	});
}

function emptyPageState(): PageState {
	return { url: "", title: "", state: "ready", busy: false };
}

function parseCapturedImage(value: string): { base64: string; format: "png" | "jpeg" } {
	const match = /^data:image\/(png|jpeg);base64,(.+)$/u.exec(value);
	if (match) {
		return {
			format: match[1] === "jpeg" ? "jpeg" : "png",
			base64: match[2] ?? "",
		};
	}
	return { format: "png", base64: value };
}

function detectInterstitial(tab: TabLike & { id: number }): BproxyError | null {
	const title = tab.title ?? "";
	const url = tab.url ?? "";
	if (
		/\/sorry\b/i.test(url) ||
		/recaptcha|hcaptcha|turnstile|captcha/i.test(url) ||
		/unusual traffic|verify you are human|captcha/i.test(title)
	) {
		return humanRequiredError("CAPTCHA detected", {
			reason: "captcha",
			tabId: tab.id,
			url,
			title,
			suggestedAction:
				"Resolve the CAPTCHA or verification challenge in the browser, then run `bproxy session resume`.",
		});
	}
	if (
		/challenge|interstitial/i.test(url) ||
		/just a moment|attention required/i.test(title)
	) {
		return humanRequiredError("Challenge page detected", {
			reason: "challenge",
			tabId: tab.id,
			url,
			title,
			suggestedAction:
				"Resolve the interstitial in the browser, then run `bproxy session resume`.",
		});
	}
	if (
		/consent|privacy/i.test(url) ||
		/before you continue|consent/i.test(title)
	) {
		return humanRequiredError("Consent page detected", {
			reason: "consent",
			tabId: tab.id,
			url,
			title,
		});
	}
	if (
		/(?:sign-?in|signin|login|auth)/i.test(url) &&
		/(?:sign in|log in)/i.test(title)
	) {
		return humanRequiredError("Sign-in required", {
			reason: "signin",
			tabId: tab.id,
			url,
			title,
		});
	}
	return null;
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

function evalDisabledError(): BproxyError {
	return {
		code: "EVAL_DISABLED",
		category: "policy",
		retry: "never",
		message: "eval is disabled until an explicit allow-eval flag is wired through daemon and extension config",
		suggestedAction:
			"Phase 4 must wire an explicit allow-eval control to extension config before eval can run.",
	};
}

function debuggerDisabledError(): BproxyError {
	return {
		code: "DEBUGGER_DISABLED",
		category: "policy",
		retry: "never",
		message: "Debugger-backed screenshots are disabled unless the extension is reloaded with an explicit opt-in.",
		suggestedAction: "Retry without --debugger, or enable the debugger screenshot path in the extension build.",
	};
}

function humanRequiredError(
	message: string,
	details: Record<string, unknown> & { suggestedAction?: string },
): BproxyError {
	return {
		code: "HUMAN_REQUIRED",
		category: "policy",
		retry: "conditional",
		message,
		suggestedAction:
			details.suggestedAction ??
			(details["forAttach"]
				? "Complete the requested browser action manually, then run `bproxy session resume`."
				: "Resolve the page state in the browser, then run `bproxy session resume`."),
		details,
	};
}

function navigationFailed(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "NAVIGATION_FAILED",
		category: "execution",
		retry: "conditional",
		message,
		details,
	};
}

function tabNotVisible(tabId: number): BproxyError {
	return {
		code: "TAB_NOT_VISIBLE",
		category: "execution",
		retry: "conditional",
		message: `Target tab ${tabId} is not visible for captureVisibleTab`,
		details: { tabId },
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
