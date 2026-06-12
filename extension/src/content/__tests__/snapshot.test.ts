import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import { handleSnapshot } from "../actions/snapshot";
import type { ContentRpcRequest } from "../rpc";

describe("snapshot action", () => {
	it("produces correct tree for basic page with headings and landmarks", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("nav", { attrs: { "aria-label": "Primary" } }),
							el("main", {
								children: [el("h1", { text: "Dashboard" }), el("h2", { text: "Recent activity" })],
							}),
						],
					}),
				],
			}),
		);

		const result = handleSnapshot(request({}), withDoc(page));

		expect(result.tree).toContain('navigation "Primary"');
		expect(result.tree).toContain("main:");
		expect(result.tree).toContain('heading "Dashboard" [level=1]');
		expect(result.tree).toContain('heading "Recent activity" [level=2]');
		expect(result.nodeCount).toBeGreaterThan(0);
	});

	it("traverses open shadow roots transparently", () => {
		const host = el("x-card", {
			attrs: { id: "card" },
			shadow: shadow(el("h2", { text: "Shadow title" }), el("p", { text: "Body text" })),
		});
		const page = doc(el("html", { children: [el("body", { children: [host] })] }));

		const result = handleSnapshot(request({}), withDoc(page));
		expect(result.tree).toContain('heading "Shadow title" [level=2]');
		expect(result.tree).toContain('text "Body text"');
	});

	it("skips noise elements (script, style)", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("h1", { text: "Title" }),
							el("script", { text: "console.log('noise')" }),
							el("style", { text: ".x{}" }),
						],
					}),
				],
			}),
		);

		const result = handleSnapshot(request({}), withDoc(page));
		expect(result.tree).toContain("Title");
		expect(result.tree).not.toContain("noise");
		expect(result.tree).not.toContain(".x{}");
	});

	it("respects maxDepth — truncates deep trees", () => {
		const deep = el("div", {
			children: [
				el("div", {
					children: [el("div", { children: [el("h3", { text: "Deep heading" })] })],
				}),
			],
		});
		const page = doc(el("html", { children: [el("body", { children: [deep] })] }));

		const shallow = handleSnapshot(request({ maxDepth: 2 }), withDoc(page));
		expect(shallow.tree).not.toContain("Deep heading");

		const full = handleSnapshot(request({ maxDepth: 8 }), withDoc(page));
		expect(full.tree).toContain("Deep heading");
	});

	it("interactiveOnly mode shows only buttons, links, inputs", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("h1", { text: "Title" }),
							el("p", { text: "Paragraph" }),
							el("button", { attrs: { id: "btn" }, text: "Click me" }),
							el("a", { attrs: { href: "/home" }, text: "Home" }),
							el("input", { attrs: { type: "text", placeholder: "Search" } }),
						],
					}),
				],
			}),
		);

		const result = handleSnapshot(request({ interactiveOnly: true }), withDoc(page));
		expect(result.tree).toContain('button "Click me"');
		expect(result.tree).toContain('link "Home"');
		expect(result.tree).toContain('textbox "Search"');
		expect(result.tree).not.toContain("heading");
		expect(result.tree).not.toContain("Paragraph");
	});

	it("handles display: contents wrappers (walks through them)", () => {
		const wrapper = el("div", {
			style: { display: "contents" },
			children: [el("h1", { text: "Visible via contents" })],
		});
		const page = doc(el("html", { children: [el("body", { children: [wrapper] })] }));

		const result = handleSnapshot(request({}), withDoc(page));
		expect(result.tree).toContain("Visible via contents");
	});

	it("truncates long text at 80 chars", () => {
		const longText = "A".repeat(200);
		const page = doc(
			el("html", { children: [el("body", { children: [el("h1", { text: longText })] })] }),
		);

		const result = handleSnapshot(request({}), withDoc(page));
		// The name should be truncated with "…"
		expect(result.tree).toContain("…");
		expect(result.tree.length).toBeLessThan(longText.length + 50);
	});

	it("selector param scopes to subtree", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("div", { attrs: { id: "outside" }, children: [el("h1", { text: "Outside" })] }),
							el("div", {
								attrs: { id: "inside" },
								children: [el("h2", { text: "Inside" })],
							}),
						],
					}),
				],
			}),
		);

		const result = handleSnapshot(request({ selector: "#inside" }), withDoc(page));
		expect(result.tree).toContain("Inside");
		expect(result.tree).not.toContain("Outside");
	});

	it("computes accessible name via aria-label", () => {
		const nav = el("nav", { attrs: { "aria-label": "Main menu" } });
		const page = doc(el("html", { children: [el("body", { children: [nav] })] }));

		const result = handleSnapshot(request({}), withDoc(page));
		expect(result.tree).toContain('navigation "Main menu"');
	});

	it("reports state flags for interactive elements", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("button", { attrs: { disabled: true }, text: "Submit" }),
							el("input", { attrs: { type: "checkbox", "aria-checked": "true" } }),
							el("button", { attrs: { "aria-expanded": "false" }, text: "More" }),
						],
					}),
				],
			}),
		);

		const result = handleSnapshot(request({}), withDoc(page));
		expect(result.tree).toContain("disabled");
		expect(result.tree).toContain("checked");
		expect(result.tree).toContain("collapsed");
	});
});

function request(params: {
	selector?: string;
	maxDepth?: number;
	interactiveOnly?: boolean;
}): ContentRpcRequest<"snapshot"> {
	return {
		kind: "bproxy.content.request",
		id: "req:snapshot",
		action: "snapshot",
		params,
	};
}

function withDoc(page: ReturnType<typeof doc>): { document: Document } {
	return { document: page as unknown as Document };
}
