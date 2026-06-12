import type { BproxyForwardedRequest, PageState, SessionId } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import { createContentInjector } from "../injection";
import { createTabRuntime, type EventSeam, type NavigationEvent } from "../tabs";

const PAGE: PageState = {
	url: "https://example.test/",
	title: "Example",
	state: "ready",
	busy: false,
};
const TEST_SESSION = "m4q7z2" as SessionId;

function makeRequest(
	overrides: Partial<BproxyForwardedRequest<"text">> = {},
): BproxyForwardedRequest<"text"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-1",
		action: overrides.action ?? "text",
		params: overrides.params ?? { selector: "main" },
		session: overrides.session ?? TEST_SESSION,
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? false,
		target: overrides.target ?? { tabId: 42 },
	};
}

function createEvent<T extends (...args: never[]) => void>(): EventSeam<T> & {
	emit: (...args: Parameters<T>) => void;
} {
	const listeners = new Set<T>();
	return {
		addListener(cb) {
			listeners.add(cb);
		},
		removeListener(cb) {
			listeners.delete(cb);
		},
		emit(...args) {
			for (const listener of listeners) {
				listener(...args);
			}
		},
	};
}

function createHarness(overrides?: {
	sendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
}) {
	const onRemoved = createEvent<(tabId: number, removeInfo?: unknown) => void>();
	const onCommitted = createEvent<(details: NavigationEvent) => void>();
	const onCompleted = createEvent<(details: NavigationEvent) => void>();
	const onHistoryStateUpdated = createEvent<(details: NavigationEvent) => void>();
	const executeScript = vi.fn(async () => []);
	const sendMessage =
		overrides?.sendMessage ??
		vi.fn(async (_tabId: number, message: unknown) => ({
			kind: "bproxy.content.response",
			id: (message as { id: string }).id,
			ok: true,
			data: { text: "hello" },
			page: PAGE,
		}));
	const injector = createContentInjector({
		store: createFakeStorageItem("session:injectedTabs", [] as number[]),
		scripting: { executeScript },
	});
	const runtime = createTabRuntime({
		tabs: {
			get: vi.fn(async (tabId: number) => ({ id: tabId, url: "https://example.test/" })),
			sendMessage,
			onRemoved,
		},
		webNavigation: {
			onCommitted,
			onCompleted,
			onHistoryStateUpdated,
		},
		injector,
		now: () => 1000,
		setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
		clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
		rpcTimeoutMs: 10,
	});

	return {
		runtime,
		executeScript,
		sendMessage,
		onRemoved,
		onCommitted,
		onCompleted,
		onHistoryStateUpdated,
	};
}

describe("createTabRuntime", () => {
	it("injects on first request and does not reinject on the second", async () => {
		const h = createHarness();
		h.runtime.start();

		await h.runtime.handleDomAction(makeRequest());
		await h.runtime.handleDomAction(makeRequest({ id: "req-2" }));

		expect(h.executeScript).toHaveBeenCalledTimes(1);
		expect(h.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("cleans up injected-tab state when the tab closes", async () => {
		const h = createHarness();
		h.runtime.start();

		await h.runtime.handleDomAction(makeRequest());
		h.onRemoved.emit(42);
		await h.runtime.handleDomAction(makeRequest({ id: "req-2" }));

		expect(h.executeScript).toHaveBeenCalledTimes(2);
	});

	it("clears injection state on main-frame navigation so the next command reinjects", async () => {
		const h = createHarness();
		h.runtime.start();

		await h.runtime.handleDomAction(makeRequest());
		h.onCommitted.emit({ tabId: 42, frameId: 0, url: "https://example.test/next" });
		await h.runtime.handleDomAction(makeRequest({ id: "req-2" }));

		expect(h.executeScript).toHaveBeenCalledTimes(2);
		expect(h.runtime.getFrames(42)).toEqual([
			{
				tabId: 42,
				frameId: 0,
				url: "https://example.test/next",
				lastCommittedAt: 1000,
			},
		]);
	});

	it("waits for the next main-frame load completion", async () => {
		let currentTab = { id: 42, url: "https://example.test/", status: "loading" };
		const onRemoved = createEvent<(tabId: number, removeInfo?: unknown) => void>();
		const onCommitted = createEvent<(details: NavigationEvent) => void>();
		const onCompleted = createEvent<(details: NavigationEvent) => void>();
		const onHistoryStateUpdated = createEvent<(details: NavigationEvent) => void>();
		const runtime = createTabRuntime({
			tabs: {
				get: vi.fn(async () => currentTab),
				sendMessage: vi.fn(async () => ({})),
				onRemoved,
			},
			webNavigation: {
				onCommitted,
				onCompleted,
				onHistoryStateUpdated,
			},
			injector: createContentInjector({
				store: createFakeStorageItem("session:injectedTabs", [] as number[]),
				scripting: { executeScript: vi.fn(async () => []) },
			}),
			now: () => 1000,
			setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
			rpcTimeoutMs: 10,
		});
		runtime.start();

		const pending = runtime.waitForLoad(42, { timeoutMs: 50 });
		await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		currentTab = { id: 42, url: "https://example.test/next", status: "complete" };
		onCompleted.emit({ tabId: 42, frameId: 0, url: "https://example.test/next" });

		await expect(pending).resolves.toMatchObject({
			id: 42,
			url: "https://example.test/next",
			status: "complete",
		});
	});

	it("times out when the content script never responds", async () => {
		const h = createHarness({
			sendMessage: vi.fn(async () => await new Promise(() => undefined)),
		});
		h.runtime.start();

		await expect(h.runtime.handleDomAction(makeRequest())).rejects.toMatchObject({
			code: "TIMEOUT",
		});
	});

	it("returns TAB_NOT_FOUND when Chrome no longer has the daemon-targeted tab", async () => {
		const onRemoved = createEvent<(tabId: number, removeInfo?: unknown) => void>();
		const runtime = createTabRuntime({
			tabs: {
				get: vi.fn(async () => {
					throw new Error("No tab");
				}),
				sendMessage: vi.fn(async () => ({})),
				onRemoved,
			},
			webNavigation: {
				onCommitted: createEvent<(details: NavigationEvent) => void>(),
				onCompleted: createEvent<(details: NavigationEvent) => void>(),
				onHistoryStateUpdated: createEvent<(details: NavigationEvent) => void>(),
			},
			injector: createContentInjector({
				store: createFakeStorageItem("session:injectedTabs", [] as number[]),
				scripting: { executeScript: vi.fn(async () => []) },
			}),
			now: () => 1000,
			setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
			clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
			rpcTimeoutMs: 10,
		});

		await expect(runtime.handleDomAction(makeRequest())).rejects.toMatchObject({
			code: "TAB_NOT_FOUND",
		});
	});
});
