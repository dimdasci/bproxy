import { describe, expect, it } from "vitest";
import { doc, el } from "../../test/fixtures/fake-dom";
import { handleSelect } from "../actions/select";
import type { ContentRpcRequest } from "../rpc";

describe("select action", () => {
	it("falls back to native select value + change event", async () => {
		const trigger = el("select", {
			attrs: { id: "country" },
			children: [
				el("option", { attrs: { value: "us" }, text: "United States" }),
				el("option", { attrs: { value: "ca" }, text: "Canada" }),
			],
		});
		const page = pageDoc(trigger);

		const result = await handleSelect(
			request("select", {
				trigger: { selector: "#country" },
				optionText: "Canada",
			}),
			withDocument(page),
		);

		expect(result).toEqual({ selected: true, optionText: "Canada" });
		expect((trigger as typeof trigger & { value?: string }).value).toBe("ca");
		expect(trigger.emittedEvents.map((event) => event.type)).toEqual(["change"]);
	});

	it("clicks a custom trigger, polls visible options, and verifies selection", async () => {
		const trigger = el("button", { attrs: { id: "role" }, text: "Choose a role" });
		const page = pageDoc(trigger);
		const clock = createVirtualClock([0, 0]);

		trigger.click = () => {
			const option = el("div", { attrs: { role: "option", id: "designer" }, text: "Designer" });
			option.click = () => {
				option.setAttribute("aria-selected", "true");
				trigger.textContent = "Designer";
			};
			page.body?.append(el("div", { attrs: { role: "listbox" }, children: [option] }));
		};

		const result = await handleSelect(
			request("select", {
				trigger: { selector: "#role" },
				optionText: "Designer",
			}),
			{
				...withDocument(page),
				...clock,
			},
		);

		expect(result).toEqual({ selected: true, optionText: "Designer" });
		expect(trigger.textContent).toBe("Designer");
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

function withDocument(page: ReturnType<typeof doc>): { document: Document } {
	return { document: page as unknown as Document };
}

function pageDoc(...children: ReturnType<typeof el>[]) {
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
