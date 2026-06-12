import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import { handleInspect } from "../actions/inspect";
import type { ContentRpcRequest } from "../rpc";

describe("inspect action", () => {
	it("returns rect, computed styles, child count for basic elements", () => {
		const div = el("div", {
			attrs: { id: "target", class: "card primary" },
			rect: { width: 300, height: 200, top: 10, left: 20 },
			text: "Direct text",
			children: [el("p", { text: "Hello" }), el("span", { text: "World" })],
		});
		const page = doc(el("html", { children: [el("body", { children: [div] })] }));

		const result = handleInspect(request({ selector: "#target" }), withDoc(page));

		expect(result.total).toBe(1);
		expect(result.elements).toHaveLength(1);
		const elem = result.elements[0]!;
		expect(elem.tag).toBe("div");
		expect(elem.id).toBe("target");
		expect(elem.classes).toBe("card primary");
		expect(elem.rect).toEqual({ x: 20, y: 10, width: 300, height: 200 });
		expect(elem.children).toBe(2);
		expect(elem.textLength).toBe("Direct text".length);
		expect(elem.computed).toHaveProperty("display");
	});

	it("respects limit parameter", () => {
		const items = Array.from({ length: 5 }, (_, i) =>
			el("li", { attrs: { class: "item" }, text: `Item ${i}` }),
		);
		const page = doc(
			el("html", { children: [el("body", { children: [el("ul", { children: items })] })] }),
		);

		const result = handleInspect(request({ selector: ".item", limit: 2 }), withDoc(page));

		expect(result.total).toBe(5);
		expect(result.elements).toHaveLength(2);
		expect(result.elements[0]!.index).toBe(0);
		expect(result.elements[1]!.index).toBe(1);
	});

	it("returns custom computed properties when specified", () => {
		const div = el("div", {
			attrs: { id: "styled" },
			style: { display: "none" },
		});
		const page = doc(el("html", { children: [el("body", { children: [div] })] }));

		const result = handleInspect(
			request({ selector: "#styled", properties: ["display"] }),
			withDoc(page),
		);

		expect(result.elements[0]!.computed).toEqual({ display: "none" });
	});

	it("counts descendants through shadow roots", () => {
		const inner = el("p", { text: "Inner" });
		const host = el("x-card", {
			attrs: { id: "host" },
			shadow: shadow(el("div", { children: [inner] })),
		});
		const page = doc(el("html", { children: [el("body", { children: [host] })] }));

		const result = handleInspect(request({ selector: "#host" }), withDoc(page));
		// Shadow root contains div > p = 2 descendants (no light DOM children)
		expect(result.elements[0]!.descendants).toBe(2);
	});

	it("reports total correctly when more matches than limit", () => {
		const items = Array.from({ length: 20 }, (_, i) =>
			el("span", { attrs: { class: "tag" }, text: `Tag ${i}` }),
		);
		const page = doc(el("html", { children: [el("body", { children: items })] }));

		const result = handleInspect(request({ selector: ".tag", limit: 3 }), withDoc(page));

		expect(result.total).toBe(20);
		expect(result.elements).toHaveLength(3);
	});

	it("reports role and aria-label", () => {
		const btn = el("button", {
			attrs: { id: "btn", role: "tab", "aria-label": "Settings" },
		});
		const page = doc(el("html", { children: [el("body", { children: [btn] })] }));

		const result = handleInspect(request({ selector: "#btn" }), withDoc(page));
		expect(result.elements[0]!.role).toBe("tab");
		expect(result.elements[0]!.ariaLabel).toBe("Settings");
	});

	it("generates a valid targeting selector for each element", () => {
		const div = el("div", { attrs: { id: "unique" } });
		const page = doc(el("html", { children: [el("body", { children: [div] })] }));

		const result = handleInspect(request({ selector: "#unique" }), withDoc(page));
		expect(result.elements[0]!.selector).toBe("#unique");
	});
});

function request(params: {
	selector: string;
	properties?: string[];
	limit?: number;
}): ContentRpcRequest<"inspect"> {
	return {
		kind: "bproxy.content.request",
		id: "req:inspect",
		action: "inspect",
		params,
	};
}

function withDoc(page: ReturnType<typeof doc>): { document: Document } {
	return { document: page as unknown as Document };
}
