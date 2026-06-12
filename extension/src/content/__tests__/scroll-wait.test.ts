import { describe, expect, it, vi } from "vitest";
import { doc, el, type FakeElement, shadow } from "../../test/fixtures/fake-dom";
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

	it("reports no movement when viewport scroll does not move", async () => {
		const page = withPageState(doc(el("html", { children: [el("body")] })), "visible", "complete");
		const win = {
			innerHeight: 1000,
			scrollY: 0,
			scrollBy: vi.fn(), // no-op — scrollY stays at 0
		};
		const clock = createVirtualClock([0]);

		const result = await handleScroll(
			request("scroll", { by: "viewport", direction: "down", untilStable: true }),
			{
				document: page as unknown as ScrollWaitDocument,
				window: win,
				...clock,
			},
		);

		expect(result).toEqual({
			target: "viewport",
			before: 0,
			after: 0,
			scrolledPx: 0,
			moved: false,
			stable: false,
		});
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

		expect(result).toEqual({
			target: "viewport",
			before: 100,
			after: 950,
			scrolledPx: 850,
			moved: true,
			stable: false,
		});
	});

	it("does not infer an element scroll target when viewport scroll does not move", async () => {
		const scrollable = makeScrollable(el("main", { attrs: { id: "workspace" } }), 0, 200, 2000);
		const page = withPageState(
			doc(el("html", { children: [el("body", { children: [scrollable] })] })),
			"visible",
			"complete",
		);
		const win = {
			innerHeight: 1000,
			scrollY: 0,
			scrollBy: vi.fn(),
		};

		const result = await handleScroll(
			request("scroll", { by: "viewport", direction: "down", untilStable: false }),
			{
				document: page as unknown as ScrollWaitDocument,
				window: win,
			},
		);

		expect(scrollable.scrollBy).not.toHaveBeenCalled();
		expect(result).toMatchObject({ target: "viewport", moved: false, scrolledPx: 0 });
	});

	it("scrolls an explicit selector target", async () => {
		const scrollable = makeScrollable(el("main", { attrs: { id: "workspace" } }), 100, 400, 2400);
		const page = withPageState(
			doc(el("html", { children: [el("body", { children: [scrollable] })] })),
			"visible",
			"complete",
		);
		const win = createWindow(1000, 0);

		const result = await handleScroll(
			request("scroll", {
				target: { selector: "#workspace" },
				by: "viewport",
				direction: "down",
				untilStable: false,
			}),
			{
				document: page as unknown as ScrollWaitDocument,
				window: win,
			},
		);

		expect(win.scrollBy).not.toHaveBeenCalled();
		expect(result).toEqual({
			target: "element",
			before: 100,
			after: 440,
			scrolledPx: 340,
			moved: true,
			stable: false,
			scrollHeight: 2400,
			clientHeight: 400,
		});
	});

	it("scrolls an explicit shadow-route target", async () => {
		const scrollable = makeScrollable(el("section", { attrs: { id: "pane" } }), 10, 300, 1200);
		const page = withPageState(
			doc(
				el("html", {
					children: [el("body", { children: [el("x-shell", { shadow: shadow(scrollable) })] })],
				}),
			),
			"visible",
			"complete",
		);

		const result = await handleScroll(
			request("scroll", {
				target: { route: { hosts: [{ selector: "x-shell" }], target: "#pane" } },
				by: "100px",
				direction: "down",
				untilStable: false,
			}),
			{
				document: page as unknown as ScrollWaitDocument,
				window: createWindow(1000, 0),
			},
		);

		expect(result).toMatchObject({ target: "element", before: 10, after: 110, moved: true });
	});

	it("returns target errors for explicit missing selector targets", async () => {
		const page = withPageState(doc(el("html", { children: [el("body")] })), "visible", "complete");

		await expect(
			handleScroll(request("scroll", { target: { selector: "#missing" } }), {
				document: page as unknown as ScrollWaitDocument,
				window: createWindow(1000, 0),
			}),
		).rejects.toMatchObject({ code: "ELEMENT_NOT_FOUND" });
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

type ScrollableFakeElement = FakeElement & {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
	scrollBy: ReturnType<typeof vi.fn>;
};

function makeScrollable(
	element: FakeElement,
	initialScrollTop: number,
	clientHeight: number,
	scrollHeight: number,
): ScrollableFakeElement {
	const scrollable = element as ScrollableFakeElement;
	Object.defineProperties(scrollable, {
		scrollTop: { value: initialScrollTop, writable: true, configurable: true },
		clientHeight: { value: clientHeight, configurable: true },
		scrollHeight: { value: scrollHeight, configurable: true },
	});
	scrollable.scrollBy = vi.fn((options: ScrollToOptions) => {
		scrollable.scrollTop += options.top ?? 0;
	});
	return scrollable;
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
