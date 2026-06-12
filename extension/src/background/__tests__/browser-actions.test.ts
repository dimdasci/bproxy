import type { BproxyError, BproxyForwardedRequest, PageState, SessionId } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createBrowserActionHandler } from "../browser-actions";
import type { TabLike } from "../tabs";

const PAGE: PageState = {
	url: "https://example.test/",
	title: "Example",
	state: "ready",
	busy: false,
};
const TEST_SESSION = "m4q7z2" as SessionId;

type TargetTab = TabLike & { id: number };

function tab(overrides: Partial<TargetTab> = {}): TargetTab {
	return {
		id: overrides.id ?? 42,
		url: overrides.url ?? "https://example.test/",
		title: overrides.title ?? "Example",
		status: overrides.status ?? "complete",
		active: overrides.active ?? true,
		windowId: overrides.windowId ?? 7,
		pinned: overrides.pinned ?? false,
	};
}

interface HarnessOverrides {
	resolveTargetTab?: (tabId: number) => Promise<TargetTab>;
	waitForLoad?: (tabId: number, options: { timeoutMs: number }) => Promise<TargetTab>;
	update?: (tabId: number, updateProperties: Record<string, unknown>) => Promise<TabLike>;
	create?: (createProperties: Record<string, unknown>) => Promise<TabLike>;
	remove?: (tabId: number) => Promise<void>;
	captureVisibleTab?: (windowId?: number, options?: { format?: "png" | "jpeg" }) => Promise<string>;
	isDebuggerScreenshotEnabled?: () => boolean | Promise<boolean>;
	captureDebuggerScreenshot?: (
		tab: TargetTab,
	) => Promise<{ base64: string; format: "png" | "jpeg" }>;
}

function createHarness(overrides: HarnessOverrides = {}) {
	const now = { value: 1000 };
	const mainWorld = createMainWorldSeam();
	const tabRuntime = createTabRuntimeSeam(overrides, now);
	const tabs = createTabsSeam(overrides);
	const handler = createBrowserActionHandler({
		mainWorld,
		tabRuntime,
		tabs,
		now: () => now.value,
		isDebuggerScreenshotEnabled: overrides.isDebuggerScreenshotEnabled,
		captureDebuggerScreenshot: overrides.captureDebuggerScreenshot,
	});
	return {
		now,
		mainWorld,
		...tabRuntime,
		...tabs,
		handler,
	};
}

function createMainWorldSeam() {
	return {
		executeRuntimeApiFill: vi.fn(async () => ({
			data: { filled: true, verifiedValue: "x" },
			page: PAGE,
		})),
	};
}

function createTabRuntimeSeam(overrides: HarnessOverrides, now: { value: number }) {
	const resolveTargetTab = vi.fn(
		overrides.resolveTargetTab ?? (async (tabId: number) => tab({ id: tabId })),
	);
	const waitForLoad = vi.fn(
		overrides.waitForLoad ??
			(async (tabId: number) => {
				now.value += 12;
				return tab({ id: tabId, url: "https://example.test/next", title: "Next" });
			}),
	);
	return {
		resolveTargetTab,
		waitForLoad,
	};
}

function createTabsSeam(overrides: HarnessOverrides) {
	const target = tab({ active: false, status: "loading" });
	const update = vi.fn(overrides.update ?? createUpdateResult(target));
	const create = vi.fn(overrides.create ?? createTabCreator());
	const remove = vi.fn(overrides.remove ?? (async () => undefined));
	const captureVisibleTab = vi.fn(
		overrides.captureVisibleTab ?? (async () => "data:image/png;base64,QUJDRA=="),
	);
	return {
		update,
		create,
		remove,
		captureVisibleTab,
	};
}

function createUpdateResult(target: TargetTab) {
	return async (tabId: number, updateProperties: Record<string, unknown>) =>
		tab({
			id: tabId,
			url:
				typeof updateProperties["url"] === "string"
					? (updateProperties["url"] as string)
					: target.url,
			title: target.title,
			active: updateProperties["active"] === true ? true : target.active,
			status: updateProperties["url"] ? "loading" : target.status,
			windowId: target.windowId,
			pinned: updateProperties["pinned"] === true,
		});
}

function createTabCreator() {
	return async (createProperties: Record<string, unknown>) =>
		tab({
			id: 77,
			url: String(createProperties["url"]),
			title: "Created",
			active: false,
		});
}

describe("createBrowserActionHandler", () => {
	it("requires runtime-api fill to use world main", async () => {
		const h = createHarness();

		await expect(
			h.handler.handleMainWorldFill(
				fillRequest({
					params: {
						target: { selector: "#editor" },
						value: "x",
						method: "runtime-api",
						world: "isolated",
					},
				}),
			),
		).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message: 'fill method runtime-api requires world "main"',
		});
		expect(h.mainWorld.executeRuntimeApiFill).not.toHaveBeenCalled();
	});

	it("navigates the daemon-targeted tab and waits for load completion", async () => {
		const h = createHarness();

		const result = await h.handler.handleBrowserAction(
			navigateRequest({ params: { url: "https://example.test/next" } }),
		);

		expect(h.update).toHaveBeenCalledWith(42, { url: "https://example.test/next" });
		expect(h.waitForLoad).toHaveBeenCalledWith(42, { timeoutMs: 9000 });
		expect(result).toEqual({
			data: { url: "https://example.test/next", title: "Next", loadTime: 12 },
			page: {
				url: "https://example.test/next",
				title: "Next",
				state: "ready",
				busy: false,
			},
		});
	});

	it("maps chrome error pages to NAVIGATION_FAILED", async () => {
		const h = createHarness({
			waitForLoad: async (tabId: number) =>
				tab({ id: tabId, url: "chrome-error://chromewebdata/", title: "", status: "complete" }),
		});

		await expect(
			h.handler.handleBrowserAction(navigateRequest({ params: { url: "https://broken.test/" } })),
		).rejects.toMatchObject({
			code: "NAVIGATION_FAILED",
			message: "Navigation failed for https://broken.test/",
		});
	});

	it("maps interstitial pages to HUMAN_REQUIRED", async () => {
		const h = createHarness({
			waitForLoad: async (tabId: number) =>
				tab({
					id: tabId,
					url: "https://www.google.com/sorry/index?continue=https://example.test/",
					title: "Our systems have detected unusual traffic from your computer network",
					status: "complete",
				}),
		});

		await expect(
			h.handler.handleBrowserAction(navigateRequest({ params: { url: "https://example.test/" } })),
		).rejects.toMatchObject({
			code: "HUMAN_REQUIRED",
			message: "CAPTCHA detected",
			details: {
				reason: "captcha",
				url: "https://www.google.com/sorry/index?continue=https://example.test/",
			},
		});
	});

	it("captures a visible screenshot and can activate the tab first", async () => {
		const h = createHarness({
			resolveTargetTab: async () => tab({ id: 42, active: false, windowId: 9 }),
			update: async (tabId: number, updateProperties: Record<string, unknown>) =>
				tab({ id: tabId, active: updateProperties["active"] === true, windowId: 9 }),
		});

		const result = await h.handler.handleBrowserAction(
			screenshotRequest({ params: { activate: true } }),
		);

		expect(h.update).toHaveBeenCalledWith(42, { active: true });
		expect(h.captureVisibleTab).toHaveBeenCalledWith(9, { format: "png" });
		expect(result).toEqual({
			data: { base64: "QUJDRA==", format: "png" },
			page: {
				url: "https://example.test/",
				title: "Example",
				state: "ready",
				busy: false,
			},
		});
	});

	it("returns DEBUGGER_DISABLED for debugger screenshot requests by default", async () => {
		const h = createHarness();

		await expect(
			h.handler.handleBrowserAction(screenshotRequest({ params: { debugger: true } })),
		).rejects.toMatchObject({
			code: "DEBUGGER_DISABLED",
			category: "policy",
		});
		expect(h.captureVisibleTab).not.toHaveBeenCalled();
	});

	it("returns TAB_NOT_VISIBLE when captureVisibleTab would target a background tab", async () => {
		const h = createHarness({
			resolveTargetTab: async () => tab({ id: 42, active: false, windowId: 9 }),
		});

		await expect(h.handler.handleBrowserAction(screenshotRequest())).rejects.toMatchObject({
			code: "TAB_NOT_VISIBLE",
		});
	});

	it("opens, pins, unpins, and closes tabs without mutating daemon session state", async () => {
		const h = createHarness();

		const opened = await h.handler.handleBrowserAction(
			tabOpenRequest({ params: { url: "https://opened.test/" } }),
		);
		expect(opened).toMatchObject({
			data: { tabId: 77, url: "https://opened.test/" },
			page: { url: "https://opened.test/" },
		});

		const pinned = await h.handler.handleBrowserAction(tabPinRequest());
		expect(h.update).toHaveBeenCalledWith(42, { pinned: true });
		expect(pinned).toMatchObject({ data: { tabId: 42 } });

		const unpinned = await h.handler.handleBrowserAction(tabUnpinRequest());
		expect(h.update).toHaveBeenCalledWith(42, { pinned: false });
		expect(unpinned).toMatchObject({ data: {} });

		const closed = await h.handler.handleBrowserAction(tabCloseRequest());
		expect(h.remove).toHaveBeenCalledWith(42);
		expect(closed).toMatchObject({ data: {} });
	});

	it("propagates TAB_NOT_FOUND on tab actions that resolve a missing tab", async () => {
		const missing: BproxyError = {
			code: "TAB_NOT_FOUND",
			category: "target",
			retry: "conditional",
			message: "Target tab 99 was not found",
			details: { tabId: 99 },
		};
		const h = createHarness({
			resolveTargetTab: async (tabId: number) => {
				if (tabId === 99) throw missing;
				return tab({ id: tabId });
			},
		});

		await expect(
			h.handler.handleBrowserAction(tabCloseRequest({ target: { tabId: 99 } })),
		).rejects.toMatchObject({ code: "TAB_NOT_FOUND" });
		expect(h.remove).not.toHaveBeenCalled();
	});

	it("turns require-human into a structured HUMAN_REQUIRED signal", async () => {
		const h = createHarness({
			resolveTargetTab: async () => tab({ id: 42, url: "https://upload.test/", title: "Upload" }),
		});

		await expect(
			h.handler.handleBrowserAction(
				requireHumanRequest({ params: { reason: "Attach resume manually", forAttach: "#resume" } }),
			),
		).rejects.toMatchObject({
			code: "HUMAN_REQUIRED",
			message: "Attach resume manually",
			details: {
				forAttach: "#resume",
				url: "https://upload.test/",
			},
			suggestedAction:
				"Complete the requested browser action manually, then run `bproxy session resume`.",
		});
	});
});

function fillRequest(
	overrides: Partial<BproxyForwardedRequest<"fill">> = {},
): BproxyForwardedRequest<"fill"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-fill",
		action: "fill",
		params: overrides.params ?? {
			target: { selector: "#editor" },
			value: "x",
			method: "runtime-api",
			world: "main",
		},
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function navigateRequest(
	overrides: Partial<BproxyForwardedRequest<"navigate">> = {},
): BproxyForwardedRequest<"navigate"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-nav",
		action: "navigate",
		params: overrides.params ?? { url: "https://example.test/" },
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function screenshotRequest(
	overrides: Partial<BproxyForwardedRequest<"screenshot">> = {},
): BproxyForwardedRequest<"screenshot"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-shot",
		action: "screenshot",
		params: overrides.params ?? {},
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? false,
		target: overrides.target ?? { tabId: 42 },
	};
}

function tabOpenRequest(
	overrides: Partial<BproxyForwardedRequest<"tab.open">> = {},
): BproxyForwardedRequest<"tab.open"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-open",
		action: "tab.open",
		params: overrides.params ?? { url: "https://opened.test/" },
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function tabCloseRequest(
	overrides: Partial<BproxyForwardedRequest<"tab.close">> = {},
): BproxyForwardedRequest<"tab.close"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-close",
		action: "tab.close",
		params: overrides.params ?? {},
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function tabPinRequest(
	overrides: Partial<BproxyForwardedRequest<"tab.pin">> = {},
): BproxyForwardedRequest<"tab.pin"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-pin",
		action: "tab.pin",
		params: overrides.params ?? {},
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function tabUnpinRequest(
	overrides: Partial<BproxyForwardedRequest<"tab.unpin">> = {},
): BproxyForwardedRequest<"tab.unpin"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-unpin",
		action: "tab.unpin",
		params: overrides.params ?? {},
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function requireHumanRequest(
	overrides: Partial<BproxyForwardedRequest<"require-human">> = {},
): BproxyForwardedRequest<"require-human"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-human",
		action: "require-human",
		params: overrides.params ?? { reason: "Need manual step" },
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? false,
		target: overrides.target ?? { tabId: 42 },
	};
}
