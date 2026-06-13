import { describe, expect, it } from "vitest";
import { doc, el, type FakeElement } from "../../test/fixtures/fake-dom";
import { handleClick, handleHover } from "../actions/interactions";
import type { ContentRpcRequest } from "../rpc";

describe("interaction actions", () => {
	it("click succeeds on a visible target", async () => {
		const button = el("button", { attrs: { id: "dismiss" }, text: "Dismiss" });
		const page = pageDoc(button);
		const clock = createVirtualClock([0]);

		const result = await handleClick(request("click", { target: { selector: "#dismiss" } }), {
			document: page as unknown as Document,
			...clock,
		});

		expect(result).toEqual({ clicked: true, disappeared: false, stable: true });
		expect(page.activeElement).toBe(button);
		expect(button.emittedEvents.map((event) => event.type)).toEqual([
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	});

	it("click reports disappeared=true when activation removes the target", async () => {
		const button = el("button", { attrs: { id: "close" }, text: "Close" });
		button.click = () => {
			button.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
			button.remove();
		};
		const page = pageDoc(button);
		const clock = createVirtualClock([0]);

		const result = await handleClick(request("click", { target: { selector: "#close" } }), {
			document: page as unknown as Document,
			...clock,
		});

		expect(result).toEqual({ clicked: true, disappeared: true, stable: true });
	});

	it("click fails with ELEMENT_NOT_ACTIONABLE for a hidden target", async () => {
		const hidden = el("button", {
			attrs: { id: "hidden" },
			style: { display: "none" },
		});
		const page = pageDoc(hidden);

		await expect(
			handleClick(request("click", { target: { selector: "#hidden" } }), {
				document: page as unknown as Document,
			}),
		).rejects.toMatchObject({ code: "ELEMENT_NOT_ACTIONABLE" });
	});

	it("click fails with TAB_NOT_VISIBLE for a hidden document", async () => {
		const button = el("button", { attrs: { id: "dismiss" } });
		const page = pageDoc(button);
		page.visibilityState = "hidden";

		await expect(
			handleClick(request("click", { target: { selector: "#dismiss" } }), {
				document: page as unknown as Document,
			}),
		).rejects.toMatchObject({ code: "TAB_NOT_VISIBLE" });
	});

	it("hover dispatches the expected hover event sequence", async () => {
		const target = el("button", { attrs: { id: "menu" }, text: "Menu" });
		const page = pageDoc(target);
		const clock = createVirtualClock([0]);

		const result = await handleHover(request("hover", { target: { selector: "#menu" } }), {
			document: page as unknown as Document,
			...clock,
		});

		expect(result).toEqual({ hovered: true, stable: true, elapsed: 180 });
		expect(target.emittedEvents.map((event) => event.type)).toEqual([
			"pointerover",
			"pointerenter",
			"mouseover",
			"mouseenter",
			"pointermove",
			"mousemove",
		]);
	});

	it("hover uses bounded polling to report settle elapsed time", async () => {
		const target = el("button", { attrs: { id: "menu" }, text: "Menu" });
		const page = pageDoc(target);
		const sleeps: number[] = [];
		const clock = createVirtualClock([0]);

		const result = await handleHover(request("hover", { target: { selector: "#menu" } }), {
			document: page as unknown as Document,
			now: clock.now,
			random: clock.random,
			sleep: async (ms) => {
				sleeps.push(ms);
				await clock.sleep(ms);
			},
		});

		expect(result).toMatchObject({ hovered: true, stable: true, elapsed: 180 });
		expect(sleeps).toEqual([180]);
	});

	it("click fails with TAB_NOT_VISIBLE if tab becomes hidden during settle", async () => {
		const button = el("button", { attrs: { id: "dismiss" }, text: "Dismiss" });
		const page = pageDoc(button);
		const clock = createVirtualClock([0]);

		await expect(
			handleClick(request("click", { target: { selector: "#dismiss" } }), {
				document: page as unknown as Document,
				now: clock.now,
				random: clock.random,
				sleep: async (ms) => {
					await clock.sleep(ms);
					page.visibilityState = "hidden";
				},
			}),
		).rejects.toMatchObject({ code: "TAB_NOT_VISIBLE" });
	});

	it("click fails with ELEMENT_NOT_ACTIONABLE for a disabled target", async () => {
		const disabled = el("button", {
			attrs: { id: "submit", disabled: true },
			text: "Submit",
		});
		const page = pageDoc(disabled);

		await expect(
			handleClick(request("click", { target: { selector: "#submit" } }), {
				document: page as unknown as Document,
			}),
		).rejects.toMatchObject({ code: "ELEMENT_NOT_ACTIONABLE" });
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

function pageDoc(...children: FakeElement[]) {
	return doc(
		el("html", {
			children: [el("body", { children })],
		}),
	);
}

function createVirtualClock(randomValues: number[]) {
	let now = 0;
	let index = 0;

	return {
		now: () => now,
		random: () => randomValues[Math.min(index++, randomValues.length - 1)] ?? 0,
		sleep: async (ms: number) => {
			now += ms;
		},
	};
}
