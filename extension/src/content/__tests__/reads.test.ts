import type { ElementTarget } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import { handleLinks } from "../actions/links";
import {
	handleDom,
	handleElements,
	handleImages,
	handleOutline,
	handleText,
} from "../actions/reads";
import type { ContentRpcRequest } from "../rpc";
import { resolveElementTarget } from "../targeting";

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

	it("links extracts structured visible URLs from Google-like markup and open shadow roots", () => {
		const first = el("a", {
			attrs: { href: "/result-1", rel: "noopener", target: "_blank", title: "First result" },
			text: "Result One",
		});
		const second = el("a", {
			attrs: { href: "https://example.test/result-2" },
			children: [el("span", { text: "Result Two" })],
		});
		const hidden = el("a", {
			attrs: { href: "/hidden" },
			text: "Hidden result",
			style: { display: "none" },
		});
		const offscreen = el("a", {
			attrs: { href: "/offscreen" },
			text: "Offscreen result",
			rect: { top: 2000, left: 0, width: 100, height: 20 },
		});
		const duplicate = el("a", { attrs: { href: "/result-1" }, text: "Result One copy" });
		const shadowLink = el("a", { attrs: { href: "/shadow" }, text: "Shadow result" });
		const host = el("search-shadow", { attrs: { id: "shadow-host" }, shadow: shadow(shadowLink) });
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("div", {
								attrs: { id: "search" },
								children: [
									el("div", {
										attrs: { class: "g" },
										children: [el("div", { attrs: { class: "yuRUbf" }, children: [first] })],
									}),
									el("div", { children: [el("div", { children: [second] })] }),
									hidden,
									offscreen,
									duplicate,
									host,
								],
							}),
						],
					}),
				],
			}),
		);
		Object.assign(page, { baseURI: "https://example.test/search?q=bproxy" });
		Object.assign(page.defaultView, { innerWidth: 1280, innerHeight: 800 });

		const result = handleLinks(
			request("links", { selector: "#search", visibleOnly: true, limit: 4 }),
			withDocument(page),
		);

		expect(result.links).toHaveLength(4);
		expect(result.links.map((link) => link.href)).toEqual([
			"https://example.test/result-1",
			"https://example.test/result-2",
			"https://example.test/result-1",
			"https://example.test/shadow",
		]);
		expect(result.total).toBeGreaterThanOrEqual(4);
		const firstLink = result.links[0];
		expect(firstLink).toMatchObject({
			text: "Result One",
			title: "First result",
			rel: "noopener",
			targetAttr: "_blank",
			visible: true,
		});
		expect(result.links[3]).toMatchObject({
			target: { route: { hosts: [{ selector: "#shadow-host" }] } },
			text: "Shadow result",
			visible: true,
		});
		expect(
			resolveElementTarget(result.links[3]!.target as ElementTarget, {
				document: page as unknown as Document,
			}),
		).toBe(shadowLink);
		const allResult = handleLinks(
			request("links", { selector: "#search", limit: 10 }),
			withDocument(page),
		);
		expect(allResult.links.map((link) => link.href)).toContain("https://example.test/hidden");
		expect(allResult.links.map((link) => link.href)).toContain("https://example.test/offscreen");
	});

	it("links --href-contains filters by substring match on absolute href", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("a", { attrs: { href: "https://linkedin.com/in/alice" }, text: "Alice" }),
							el("a", { attrs: { href: "https://linkedin.com/in/bob" }, text: "Bob" }),
							el("a", { attrs: { href: "https://linkedin.com/jobs/123" }, text: "Job" }),
							el("a", { attrs: { href: "https://example.com/other" }, text: "Other" }),
						],
					}),
				],
			}),
		);
		Object.assign(page, { baseURI: "https://linkedin.com/" });

		// Matches substring
		const profileLinks = handleLinks(
			request("links", { hrefContains: "/in/" }),
			withDocument(page),
		);
		expect(profileLinks.links).toHaveLength(2);
		expect(profileLinks.links.map((l) => l.text)).toEqual(["Alice", "Bob"]);
		expect(profileLinks.total).toBe(2);

		// No match returns empty
		const noMatch = handleLinks(
			request("links", { hrefContains: "/nonexistent/" }),
			withDocument(page),
		);
		expect(noMatch.links).toHaveLength(0);
		expect(noMatch.total).toBe(0);

		// Empty string matches everything
		const allLinks = handleLinks(request("links", { hrefContains: "" }), withDocument(page));
		expect(allLinks.links).toHaveLength(4);
		expect(allLinks.total).toBe(4);

		// undefined (omitted) means no filter
		const noFilter = handleLinks(request("links", {}), withDocument(page));
		expect(noFilter.links).toHaveLength(4);
		expect(noFilter.total).toBe(4);

		// Combined with limit: filters first, then caps
		const limited = handleLinks(
			request("links", { hrefContains: "linkedin.com", limit: 2 }),
			withDocument(page),
		);
		expect(limited.links).toHaveLength(2);
		expect(limited.links.map((l) => l.text)).toEqual(["Alice", "Bob"]);
		expect(limited.total).toBe(3); // 3 match linkedin.com, but only 2 returned due to limit
	});

	it("links --offset paginates through matching links", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: Array.from({ length: 10 }, (_, i) =>
							el("a", {
								attrs: { href: `https://example.com/page/${i}` },
								text: `Link ${i}`,
							}),
						),
					}),
				],
			}),
		);
		Object.assign(page, { baseURI: "https://example.com/" });

		// First page: offset 0, limit 3
		const page1 = handleLinks(request("links", { offset: 0, limit: 3 }), withDocument(page));
		expect(page1.links).toHaveLength(3);
		expect(page1.total).toBe(10);
		expect(page1.links.map((l) => l.text)).toEqual(["Link 0", "Link 1", "Link 2"]);

		// Second page: offset 3, limit 3
		const page2 = handleLinks(request("links", { offset: 3, limit: 3 }), withDocument(page));
		expect(page2.links).toHaveLength(3);
		expect(page2.total).toBe(10);
		expect(page2.links.map((l) => l.text)).toEqual(["Link 3", "Link 4", "Link 5"]);

		// Last partial page: offset 9, limit 3
		const lastPage = handleLinks(request("links", { offset: 9, limit: 3 }), withDocument(page));
		expect(lastPage.links).toHaveLength(1);
		expect(lastPage.total).toBe(10);
		expect(lastPage.links.map((l) => l.text)).toEqual(["Link 9"]);

		// Offset beyond total: empty result
		const beyondEnd = handleLinks(request("links", { offset: 20, limit: 5 }), withDocument(page));
		expect(beyondEnd.links).toHaveLength(0);
		expect(beyondEnd.total).toBe(10);

		// Offset with hrefContains
		const filtered = handleLinks(
			request("links", { hrefContains: "/page/", offset: 5, limit: 3 }),
			withDocument(page),
		);
		expect(filtered.links).toHaveLength(3);
		expect(filtered.total).toBe(10);
		expect(filtered.links.map((l) => l.text)).toEqual(["Link 5", "Link 6", "Link 7"]);
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

	it("elements keeps succeeding when a discovered label contains hostile selector characters", () => {
		const account = el("a", {
			attrs: {
				href: "https://accounts.google.com/AccountChooser",
				"aria-label": 'Google Account: Foo\n"Bar" \\ [1]',
			},
		});
		const search = el("button", { attrs: { id: "search" }, text: "Search" });
		const page = doc(
			el("html", {
				children: [el("body", { children: [account, search] })],
			}),
		);

		const elements = handleElements(request("elements", {}), withDocument(page));
		expect(elements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ selector: "#search", tag: "button" }),
				expect.objectContaining({ tag: "a", selector: expect.any(String) }),
			]),
		);

		const accountInfo = elements.find((element) => element.tag === "a");
		expect(accountInfo).toBeDefined();
		expect(accountInfo?.selector).not.toContain("\n");
		expect(
			resolveElementTarget(accountInfo as ElementTarget, { document: page as unknown as Document }),
		).toBe(account);
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
