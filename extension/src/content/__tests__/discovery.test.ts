import type { ElementTarget } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import { discoverInteractiveElements } from "../discovery";
import { resolveElementTarget } from "../targeting";

describe("discovery", () => {
	it("finds interactive elements inside nested open shadow roots with reusable targets", () => {
		const email = el("input", {
			attrs: { name: "email", type: "email" },
			value: "user@example.test",
		});
		const editor = el("editor-host", { attrs: { id: "editor" }, shadow: shadow(email) });
		const host = el("outer-host", { attrs: { id: "container" }, shadow: shadow(editor) });
		const page = doc(el("html", { children: [el("body", { children: [host] })] }));

		const elements = discoverInteractiveElements({ document: page as unknown as Document });

		expect(elements).toHaveLength(1);
		expect(elements[0]).toMatchObject({
			route: {
				hosts: [{ selector: "#container" }, { selector: "#editor" }],
				target: 'input[name="email"]',
			},
			tag: "input",
			value: "user@example.test",
		});
		expect(
			resolveElementTarget(elements[0] as ElementTarget, {
				document: page as unknown as Document,
			}),
		).toBe(email as unknown as Element);
	});

	it("extracts labels, placeholders, and select options for form discovery", () => {
		const email = el("input", {
			attrs: { id: "email", name: "email", type: "email", required: true },
			value: "person@example.test",
		});
		const notes = el("textarea", {
			attrs: { placeholder: "Tell us more" },
			text: "Short bio",
		});
		const choice = el("select", {
			value: "two",
			children: [el("option", { text: "One" }), el("option", { text: "Two" })],
		});
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("form", {
								children: [
									el("label", { attrs: { for: "email" }, text: "Email address" }),
									email,
									notes,
									choice,
								],
							}),
						],
					}),
				],
			}),
		);

		const elements = discoverInteractiveElements({
			document: page as unknown as Document,
			formOnly: true,
		});

		expect(elements).toHaveLength(3);
		expect(elements[0]).toMatchObject({
			selector: "#email",
			label: "Email address",
			type: "email",
			value: "person@example.test",
			required: true,
		});
		expect(elements[1]).toMatchObject({
			tag: "textarea",
			placeholder: "Tell us more",
			value: "Short bio",
		});
		expect(elements[2]).toMatchObject({
			tag: "select",
			options: ["One", "Two"],
			value: "two",
		});
	});

	it("prefers the active dialog scope over the full page", () => {
		const outside = el("input", { attrs: { id: "outside", name: "outside" } });
		const inside = el("input", { attrs: { id: "inside", name: "inside" } });
		const dialog = el("div", {
			attrs: { role: "dialog" },
			children: [inside],
		});
		const page = doc(
			el("html", {
				children: [el("body", { children: [outside, dialog] })],
			}),
		);
		page.activeElement = inside;

		const elements = discoverInteractiveElements({ document: page as unknown as Document });

		expect(elements).toHaveLength(1);
		expect(elements[0]).toMatchObject({ selector: "#inside" });
	});

	it("uses hit-test roots and annotates runtime handles without scanning the whole page", () => {
		const globalInput = el("input", { attrs: { id: "global" } });
		const editor = el("div", {
			attrs: { id: "editor", contenteditable: "true" },
			text: "Draft",
		});
		(editor as typeof editor & { __quill?: object }).__quill = {};
		const form = el("form", { children: [editor] });
		const page = doc(
			el("html", {
				children: [el("body", { children: [globalInput, form] })],
			}),
		);
		page.setHitTest([editor]);

		const elements = discoverInteractiveElements({
			document: page as unknown as Document,
			point: { x: 10, y: 10 },
		});

		expect(elements).toHaveLength(1);
		expect(elements[0]).toMatchObject({
			selector: "#editor",
			runtimeHandle: "quill",
			value: "Draft",
		});
	});
});
