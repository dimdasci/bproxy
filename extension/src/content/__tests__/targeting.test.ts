import type { ElementRoute, ElementTarget } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { doc, el, shadow } from "../../test/fixtures/fake-dom";
import { createElementTarget, resolveElementTarget, resolveSelectorTarget } from "../targeting";

describe("targeting", () => {
	it("round-trips nested open-shadow targets through a route", () => {
		const email = el("input", {
			attrs: { name: "email", type: "email" },
			value: "user@example.test",
		});
		const innerHost = el("editor-host", {
			attrs: { id: "host-2" },
			shadow: shadow(email),
		});
		const outerHost = el("outer-host", {
			attrs: { id: "host-1" },
			shadow: shadow(innerHost),
		});
		const page = doc(el("html", { children: [el("body", { children: [outerHost] })] }));

		const target = createElementTarget(email as unknown as Element);

		expect(target).toEqual({
			route: {
				hosts: [{ selector: "#host-1" }, { selector: "#host-2" }],
				target: 'input[name="email"]',
			},
		});
		expect(resolveElementTarget(target, { document: page as unknown as Document })).toBe(
			email as unknown as Element,
		);
	});

	it("reports missing shadow hosts as ELEMENT_NOT_FOUND", () => {
		const page = doc(el("html", { children: [el("body")] }));
		const route: ElementRoute = {
			hosts: [{ selector: "#missing-host" }],
			target: 'input[name="email"]',
		};

		expectThrown(() => resolveElementTarget({ route }, { document: page as unknown as Document }), {
			code: "ELEMENT_NOT_FOUND",
		});
	});

	it("treats closed shadow roots as out of scope", () => {
		const closedHost = el("x-host", { attrs: { id: "closed-host" } });
		const page = doc(el("html", { children: [el("body", { children: [closedHost] })] }));
		const target: ElementTarget = {
			route: {
				hosts: [{ selector: "#closed-host" }],
				target: "input",
			},
		};

		const error = captureThrown(() =>
			resolveElementTarget(target, { document: page as unknown as Document }),
		);
		expect(error).toEqual(
			expect.objectContaining({
				code: "ELEMENT_NOT_FOUND",
				details: expect.objectContaining({ closedShadow: true }),
			}),
		);
	});

	it("rejects ambiguous light-dom selectors", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [
							el("input", { attrs: { class: "field", name: "first" } }),
							el("input", { attrs: { class: "field", name: "second" } }),
						],
					}),
				],
			}),
		);

		expectThrown(() => resolveSelectorTarget(".field", { document: page as unknown as Document }), {
			code: "SELECTOR_AMBIGUOUS",
		});
	});
});

function expectThrown(run: () => unknown, expected: Record<string, unknown>): void {
	expect(captureThrown(run)).toEqual(expect.objectContaining(expected));
}

function captureThrown(run: () => unknown): unknown {
	try {
		run();
		expect.unreachable("expected function to throw");
	} catch (error) {
		return error;
	}
}
