import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import {
	handleDom,
	handleElements,
	handleImages,
	handleOutline,
	handleText,
} from "../actions/reads";
import type { ContentRpcRequest } from "../rpc";

describe("read actions", () => {
	it("text reads visible content from a scoped host and its open shadow root", () => {
		const host = el("x-card", {
			attrs: { id: "card" },
			shadow: shadow(
				el("h2", { text: "Shadow title" }),
				el("p", { text: "Visible body" }),
				el("p", { text: "Hidden body", style: { display: "none" } }),
			),
		});
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [el("div", { text: "Outside" }), host],
					}),
				],
			}),
		);

		expect(handleText(request("text", { selector: "#card" }), withDocument(page))).toBe(
			"Shadow title Visible body",
		);
	});

	it("images returns only visible images within the requested scope", () => {
		const scoped = el("img", {
			attrs: { src: "https://cdn.test/hero.png", alt: "Hero" },
			rect: { width: 320, height: 200 },
		});
		(scoped as typeof scoped & { naturalWidth?: number; naturalHeight?: number }).naturalWidth =
			640;
		(scoped as typeof scoped & { naturalWidth?: number; naturalHeight?: number }).naturalHeight =
			400;
		const hidden = el("img", {
			attrs: { src: "https://cdn.test/hidden.png", alt: "Hidden" },
			style: { display: "none" },
		});
		const outside = el("img", {
			attrs: { src: "https://cdn.test/outside.png", alt: "Outside" },
			rect: { width: 50, height: 50 },
		});
		const gallery = el("section", {
			attrs: { id: "gallery" },
			children: [scoped, hidden],
			shadow: shadow(
				el("img", {
					attrs: { src: "https://cdn.test/shadow.png", alt: "Shadow" },
					rect: { width: 100, height: 60 },
				}),
			),
		});
		const page = doc(
			el("html", {
				children: [el("body", { children: [gallery, outside] })],
			}),
		);

		expect(handleImages(request("images", { selector: "#gallery" }), withDocument(page))).toEqual([
			{ src: "https://cdn.test/hero.png", alt: "Hero", width: 640, height: 400 },
			{ src: "https://cdn.test/shadow.png", alt: "Shadow", width: 100, height: 60 },
		]);
	});

	it("elements discovers interactive controls and narrows to form fields when requested", () => {
		const email = el("input", { attrs: { id: "email", name: "email", type: "email" } });
		const submit = el("button", { attrs: { id: "submit" }, text: "Submit" });
		const shadowButton = el("button", { attrs: { id: "shadow-action" }, text: "More" });
		const host = el("x-host", { attrs: { id: "host" }, shadow: shadow(shadowButton) });
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [el("form", { children: [email, submit] }), host],
					}),
				],
			}),
		);

		const all = handleElements(request("elements", {}), withDocument(page));
		expect(all).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ selector: "#email", tag: "input" }),
				expect.objectContaining({ selector: "#submit", tag: "button" }),
				expect.objectContaining({
					route: {
						hosts: [{ selector: "#host" }],
						target: "#shadow-action",
					},
					tag: "button",
				}),
			]),
		);

		const formOnly = handleElements(request("elements", { form: true }), withDocument(page));
		expect(formOnly).toEqual([expect.objectContaining({ selector: "#email", tag: "input" })]);
	});

	it("outline returns visible landmarks and heading hierarchy", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("nav", { attrs: { "aria-label": "Primary" } }),
							el("main", {
								children: [
									el("h1", { text: "Dashboard" }),
									el("section", { children: [el("h2", { text: "Recent activity" })] }),
								],
							}),
							el("footer", { style: { display: "none" } }),
						],
					}),
				],
			}),
		);

		expect(handleOutline(withDocument(page))).toEqual({
			landmarks: [
				{ tag: "nav", role: "navigation", label: "Primary" },
				{ tag: "main", role: "main" },
			],
			headings: [
				{ level: 1, text: "Dashboard" },
				{ level: 2, text: "Recent activity" },
			],
		});
	});

	it("dom serializes a bounded simplified subtree without script/style noise", () => {
		const host = el("x-card", {
			attrs: { id: "card" },
			shadow: shadow(
				el("section", {
					attrs: { role: "region", "aria-label": "Profile" },
					children: [
						el("p", { text: "Summary", children: [el("span", { text: "Deeper detail" })] }),
						el("script", { text: "console.log('noise')" }),
						el("style", { text: ".hidden{}" }),
					],
				}),
			),
		});
		const page = doc(
			el("html", {
				children: [el("body", { children: [host] })],
			}),
		);

		const html = handleDom(request("dom", { selector: "#card", depth: 2 }), withDocument(page));
		expect(html).toContain('<x-card id="card">');
		expect(html).toContain("<shadow-root>");
		expect(html).toContain('<section role="region" aria-label="Profile">');
		expect(html).toContain("<p>Summary…</p>");
		expect(html).not.toContain("script");
		expect(html).not.toContain("style");
		expect(html).not.toContain("Deeper detail");
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
