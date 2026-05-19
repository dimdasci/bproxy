import { describe, expect, it, vi } from "vitest";
import { doc, el } from "../../test/fixtures/fake-dom";
import { handleScroll, handleWait, type ScrollWaitDocument } from "../actions/scroll-wait";
import type { ContentRpcRequest } from "../rpc";

describe("scroll and wait actions", () => {
	it("bails out of scroll when the tab is hidden", async () => {
		const page = withPageState(doc(el("html", { children: [el("body")] })), "hidden", "complete");
		const win = createWindow(1000, 100);

		await expect(
			handleScroll(request("scroll", { by: "viewport", direction: "down" }), {
				document: page as unknown as ScrollWaitDocument,
				window: win,
			}),
		).rejects.toMatchObject({ code: "TAB_NOT_VISIBLE" });
		expect(win.scrollBy).not.toHaveBeenCalled();
	});

	it("waits for a selector via polling", async () => {
		const page = withPageState(doc(el("html", { children: [el("body")] })), "visible", "complete");
		const clock = createVirtualClock([0, 0]);
		clock.onSleep(({ count }) => {
			if (count === 2) page.body?.append(el("div", { attrs: { id: "ready" } }));
		});

		const result = await handleWait(
			request("wait", { strategy: "selector", target: "#ready", timeout: 500 }),
			{
				document: page as unknown as ScrollWaitDocument,
				location: { href: "https://example.test/" },
				...clock,
			},
		);

		expect(result).toEqual({ matched: true, elapsed: 360 });
	});

	it("waits for a URL via polling", async () => {
		const clock = createVirtualClock([0]);
		const location = { href: "https://example.test/old" };
		clock.onSleep(() => {
			location.href = "https://example.test/new";
		});

		const result = await handleWait(
			request("wait", { strategy: "url", target: "https://example.test/new", timeout: 500 }),
			{
				location,
				...clock,
			},
		);

		expect(result).toEqual({ matched: true, elapsed: 180 });
	});

	it("waits for navigation by URL, ready-state, and stable subtree signature", async () => {
		const page = withPageState(
			doc(el("html", { children: [el("body", { children: [el("main", { text: "Loading" })] })] })),
			"visible",
			"loading",
		);
		const clock = createVirtualClock([0, 0, 0]);
		const location = { href: "https://example.test/old" };
		clock.onSleep(({ count }) => {
			if (count === 1) location.href = "https://example.test/new";
			if (count === 2) page.readyState = "complete";
		});

		const result = await handleWait(
			request("wait", {
				strategy: "navigation",
				target: "https://example.test/new",
				timeout: 1000,
			}),
			{
				document: page as unknown as ScrollWaitDocument,
				location,
				...clock,
			},
		);

		expect(result).toEqual({ matched: true, elapsed: 540 });
	});

	it("returns before/after scroll math and viewport default distance", async () => {
		const page = withPageState(doc(el("html", { children: [el("body")] })), "visible", "complete");
		const win = createWindow(1000, 100);

		const result = await handleScroll(
			request("scroll", { by: "viewport", direction: "down", untilStable: false }),
			{
				document: page as unknown as ScrollWaitDocument,
				window: win,
			},
		);

		expect(result).toEqual({ before: 100, after: 950, scrolledPx: 850, stable: false });
	});
});

function request<A extends ContentRpcRequest["action"]>(
	action: A,
	params: ContentRpcRequest<A>["params"],
): ContentRpcRequest<A> {
	return {
		kind: "bproxy.content.request",
		id: `req:${action}`,
		action,
		params,
	};
}

function withPageState(
	page: ReturnType<typeof doc>,
	visibilityState: DocumentVisibilityState,
	readyState: DocumentReadyState,
): ReturnType<typeof doc> & {
	visibilityState?: DocumentVisibilityState;
	readyState: DocumentReadyState;
} {
	const typed = page as ReturnType<typeof doc> & {
		visibilityState?: DocumentVisibilityState;
		readyState: DocumentReadyState;
	};
	typed.visibilityState = visibilityState;
	typed.readyState = readyState;
	return typed;
}

function createWindow(innerHeight: number, initialScrollY: number) {
	const win = {
		innerHeight,
		scrollY: initialScrollY,
		scrollBy: vi.fn((options: ScrollToOptions) => {
			win.scrollY += options.top ?? 0;
		}),
	};
	return win;
}

function createVirtualClock(randomValues: number[]) {
	let now = 0;
	let index = 0;
	let count = 0;
	let callback: ((event: { count: number; ms: number; now: number }) => void) | undefined;

	return {
		now: () => now,
		random: () => randomValues[Math.min(index++, randomValues.length - 1)] ?? 0,
		sleep: async (ms: number) => {
			now += ms;
			count += 1;
			callback?.({ count, ms, now });
		},
		onSleep: (fn: (event: { count: number; ms: number; now: number }) => void) => {
			callback = fn;
		},
	};
}
