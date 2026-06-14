import { describe, expect, it } from "vitest";
import { doc, el, FakeElement, shadow } from "../../test/fixtures/fake-dom";
import { handleFill, handleFillForm } from "../actions/fill";
import type { ContentRpcRequest } from "../rpc";

class NativeInputElement extends FakeElement {
	setCalls = 0;
	private _value = "";

	override get value(): string {
		return this._value;
	}

	override set value(next: string) {
		this.setCalls += 1;
		this._value = next;
	}
}

class RejectingInputElement extends FakeElement {
	private readonly _value = "persisted";

	override get value(): string {
		return this._value;
	}

	// Simulate a hostile controlled field that rejects the write.
	// biome-ignore lint/correctness/noUnusedVariables: intentional no-op setter
	override set value(_next: string) {
		// Intentionally no-op: controlled field rejects agent writes
	}
}

describe("fill actions", () => {
	it("direct writes set value with no emitted events", () => {
		const input = new NativeInputElement("input", { attrs: { id: "email", type: "email" } });
		const page = pageDoc(input);

		const result = handleFill(
			request("fill", {
				target: { selector: "#email" },
				value: "user@example.com",
				method: "direct",
				world: "isolated",
			}),
			withDocument(page),
		);

		expect(result).toEqual({ filled: true, verifiedValue: "user@example.com" });
		expect(input.value).toBe("user@example.com");
		expect(input.setCalls).toBeGreaterThan(0);
		expect(input.emittedEvents).toEqual([]);
	});

	it("paste writes use setter, dispatch paste-shaped events, and never emit key events", () => {
		const input = new NativeInputElement("input", { attrs: { id: "name" } });
		const page = pageDoc(input);

		const result = handleFill(
			request("fill", {
				target: { selector: "#name" },
				value: "Ada Lovelace",
				method: "paste",
				world: "isolated",
			}),
			withDocument(page),
		);

		expect(result).toEqual({ filled: true, verifiedValue: "Ada Lovelace" });
		expect(input.setCalls).toBeGreaterThan(0);
		expect(page.activeElement).toBe(input);
		expect(input.emittedEvents.map((event) => event.type)).toEqual([
			"beforeinput",
			"input",
			"change",
		]);
		expect(input.emittedEvents[0]).toMatchObject({
			inputType: "insertFromPaste",
			data: "Ada Lovelace",
		});
		expect(input.emittedEvents[1]).toMatchObject({
			inputType: "insertFromPaste",
			data: "Ada Lovelace",
		});
		expect(input.emittedEvents.some((event) => event.type.startsWith("key"))).toBe(false);
	});

	it("rejects runtime-api and non-isolated world combinations", () => {
		const page = pageDoc(el("input", { attrs: { id: "email" } }));

		expectThrown(
			() =>
				handleFill(
					request("fill", {
						target: { selector: "#email" },
						value: "x",
						method: "runtime-api",
						world: "main",
					}),
					withDocument(page),
				),
			{ code: "SCRIPT_ERROR" },
		);

		expectThrown(
			() =>
				handleFill(
					request("fill", {
						target: { selector: "#email" },
						value: "x",
						method: "direct",
						world: "main",
					}),
					withDocument(page),
				),
			{ code: "SCRIPT_ERROR" },
		);
	});

	it("fill-form guards hidden fields, verifies read-back, and supports shadow routes", async () => {
		const visible = new NativeInputElement("input", { attrs: { id: "visible" } });
		const hidden = new NativeInputElement("input", {
			attrs: { id: "honeypot", type: "hidden" },
		});
		hidden.value = "trap";
		const rejecting = new RejectingInputElement("input", { attrs: { id: "rejecting" } });
		const shadowField = el("textarea", { attrs: { id: "shadow-field" } });
		const host = el("x-host", { attrs: { id: "host" }, shadow: shadow(shadowField) });
		const page = pageDoc(visible, hidden, rejecting, host);

		const result = await handleFillForm(
			request("fill-form", {
				fields: [
					{
						target: { selector: "#visible" },
						value: "alpha",
						method: "direct",
						world: "isolated",
					},
					{
						target: { selector: "#honeypot" },
						value: "bot",
						method: "paste",
						world: "isolated",
					},
					{
						target: { selector: "#rejecting" },
						value: "beta",
						method: "paste",
						world: "isolated",
					},
					{
						target: {
							route: {
								hosts: [{ selector: "#host" }],
								target: "#shadow-field",
							},
						},
						value: "shadow text",
						method: "direct",
						world: "isolated",
					},
				],
			}),
			{
				...withDocument(page),
				random: () => 0,
				sleep: async () => {},
			},
		);

		expect(result).toEqual({
			results: [
				{ target: { selector: "#visible" }, filled: true, verifiedValue: "alpha" },
				{ target: { selector: "#honeypot" }, filled: false, verifiedValue: "trap" },
				{ target: { selector: "#rejecting" }, filled: false, verifiedValue: "persisted" },
				{
					target: { route: { hosts: [{ selector: "#host" }], target: "#shadow-field" } },
					filled: true,
					verifiedValue: "shadow text",
				},
			],
		});
		expect((shadowField as typeof shadowField & { value?: string }).value).toBe("shadow text");
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

function pageDoc(...children: FakeElement[]) {
	return doc(
		el("html", {
			children: [el("body", { children })],
		}),
	);
}

function expectThrown(run: () => unknown, expected: Record<string, unknown>): void {
	try {
		run();
		expect.unreachable("expected function to throw");
	} catch (error) {
		expect(error).toMatchObject(expected);
	}
}
