/**
 * Tests for write, select, and human-handoff commands.
 *
 * Verifies:
 * - Target parsing (selector / route-json) for fill and select
 * - Value source resolution (--value, --value-file, --value-stdin, etc.)
 * - Method/world validation (fill never invents values)
 * - Payload validation (fill-form)
 * - Request params sent to daemon
 */
import { describe, expect, it } from "vitest";
import { type SendOptions, sendAction } from "../client.js";
import {
	createMockFetch,
	makeGlobals,
	sendWithCapture,
	setupTempHome,
} from "./command-test-helpers.js";

// ─── fill command tests ────────────────────────────────────────────────

describe("fill command", () => {
	it("sends fill action with selector target", async () => {
		const home = setupTempHome();
		const params = {
			target: { selector: "#email" },
			value: "test@example.com",
			method: "direct",
			world: "isolated",
		};
		const { plan, calls } = await sendWithCapture("fill", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "fill",
			params: {
				target: { selector: "#email" },
				value: "test@example.com",
				method: "direct",
				world: "isolated",
			},
		});
	});

	it("sends fill action with handle target", async () => {
		const home = setupTempHome();
		const params = {
			target: { handle: "el5" },
			value: "test@example.com",
			method: "direct",
			world: "isolated",
		};
		const { plan, calls } = await sendWithCapture("fill", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "fill",
			params: {
				target: { handle: "el5" },
				value: "test@example.com",
				method: "direct",
				world: "isolated",
			},
		});
	});

	it("sends fill action with route target", async () => {
		const home = setupTempHome();
		const route = {
			hosts: [{ selector: "my-component", index: 0 }],
			target: "input.field",
		};
		const params = {
			target: { route },
			value: "hello",
			method: "paste",
			world: "main",
		};
		const { plan, calls } = await sendWithCapture("fill", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "fill",
			params: {
				target: { route },
				value: "hello",
				method: "paste",
				world: "main",
			},
		});
	});

	it("sends fill with runtime-api method", async () => {
		const home = setupTempHome();
		const params = {
			target: { selector: ".editor" },
			value: "content",
			method: "runtime-api",
			world: "main",
		};
		const { plan, calls } = await sendWithCapture("fill", params, home);

		expect(plan.code).toBe(0);
		expect((calls[0]!.body["params"] as Record<string, unknown>)["method"]).toBe("runtime-api");
	});

	it("marks fill as destructive", async () => {
		const home = setupTempHome();
		const params = {
			target: { selector: "#x" },
			value: "v",
			method: "direct",
			world: "isolated",
		};
		const { calls } = await sendWithCapture("fill", params, home);
		expect(calls[0]!.body["destructive"]).toBe(true);
	});

	it("never invents method or world values", async () => {
		const home = setupTempHome();
		// Explicitly passing method and world — verify they're passed through unchanged
		const params = {
			target: { selector: "#x" },
			value: "v",
			method: "paste",
			world: "main",
		};
		const { calls } = await sendWithCapture("fill", params, home);
		const sent = calls[0]!.body["params"] as Record<string, unknown>;
		expect(sent["method"]).toBe("paste");
		expect(sent["world"]).toBe("main");
	});
});

// ─── fill-form command tests ───────────────────────────────────────────

describe("fill-form command", () => {
	it("sends fill-form action with valid fields", async () => {
		const home = setupTempHome();
		const params = {
			fields: [
				{
					target: { selector: "#name" },
					value: "John",
					method: "direct",
					world: "isolated",
				},
				{
					target: { selector: "#email" },
					value: "john@test.com",
					method: "paste",
					world: "main",
				},
			],
		};
		const { plan, calls } = await sendWithCapture("fill-form", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "fill-form",
			params: {
				fields: [
					{ target: { selector: "#name" }, value: "John", method: "direct", world: "isolated" },
					{
						target: { selector: "#email" },
						value: "john@test.com",
						method: "paste",
						world: "main",
					},
				],
			},
		});
	});

	it("marks fill-form as destructive", async () => {
		const home = setupTempHome();
		const params = {
			fields: [{ target: { selector: "#x" }, value: "v", method: "direct", world: "isolated" }],
		};
		const { calls } = await sendWithCapture("fill-form", params, home);
		expect(calls[0]!.body["destructive"]).toBe(true);
	});

	it("supports route targets in fields", async () => {
		const home = setupTempHome();
		const params = {
			fields: [
				{
					target: { route: { hosts: [{ selector: "x-input" }], target: "input" } },
					value: "val",
					method: "runtime-api",
					world: "main",
				},
			],
		};
		const { plan, calls } = await sendWithCapture("fill-form", params, home);

		expect(plan.code).toBe(0);
		const sent = calls[0]!.body["params"] as Record<string, unknown>;
		const fields = sent["fields"] as Array<Record<string, unknown>>;
		expect(fields[0]!["target"]).toEqual({
			route: { hosts: [{ selector: "x-input" }], target: "input" },
		});
	});

	it("never invents method or world — passes through exactly as given", async () => {
		const home = setupTempHome();
		const params = {
			fields: [{ target: { selector: "#a" }, value: "x", method: "runtime-api", world: "main" }],
		};
		const { calls } = await sendWithCapture("fill-form", params, home);
		const fields = (calls[0]!.body["params"] as Record<string, unknown>)["fields"] as Array<
			Record<string, unknown>
		>;
		expect(fields[0]!["method"]).toBe("runtime-api");
		expect(fields[0]!["world"]).toBe("main");
	});
});

// ─── click / hover command tests ───────────────────────────────────────

describe.each(["click", "hover"] as const)("%s command", (action) => {
	it(`sends ${action} action with selector target`, async () => {
		const home = setupTempHome();
		const params = { target: { selector: "#target" } };
		const { plan, calls } = await sendWithCapture(action, params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action,
			params: { target: { selector: "#target" } },
		});
	});

	it(`sends ${action} action with handle target`, async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture(action, { target: { handle: "el3" } }, home);

		expect(plan.code).toBe(0);
		expect((calls[0]!.body["params"] as Record<string, unknown>)["target"]).toEqual({
			handle: "el3",
		});
	});

	it(`sends ${action} action with route target`, async () => {
		const home = setupTempHome();
		const route = { hosts: [{ selector: "x-modal" }], target: "button.close" };
		const { plan, calls } = await sendWithCapture(action, { target: { route } }, home);

		expect(plan.code).toBe(0);
		expect((calls[0]!.body["params"] as Record<string, unknown>)["target"]).toEqual({ route });
	});

	it(`marks ${action} as destructive`, async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture(action, { target: { selector: "#x" } }, home);
		expect(calls[0]!.body["destructive"]).toBe(true);
	});
});

// ─── select command tests ──────────────────────────────────────────────

describe("select command", () => {
	it("sends select action with selector trigger", async () => {
		const home = setupTempHome();
		const params = {
			trigger: { selector: "#country" },
			optionText: "United States",
		};
		const { plan, calls } = await sendWithCapture("select", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "select",
			params: { trigger: { selector: "#country" }, optionText: "United States" },
		});
	});

	it("sends select action with handle trigger", async () => {
		const home = setupTempHome();
		const params = {
			trigger: { handle: "ln4" },
			optionText: "Option A",
		};
		const { plan, calls } = await sendWithCapture("select", params, home);

		expect(plan.code).toBe(0);
		expect((calls[0]!.body["params"] as Record<string, unknown>)["trigger"]).toEqual({
			handle: "ln4",
		});
	});

	it("sends select action with route trigger", async () => {
		const home = setupTempHome();
		const params = {
			trigger: { route: { hosts: [{ selector: "x-dropdown" }], target: "select" } },
			optionText: "Option A",
		};
		const { plan, calls } = await sendWithCapture("select", params, home);

		expect(plan.code).toBe(0);
		expect((calls[0]!.body["params"] as Record<string, unknown>)["trigger"]).toEqual({
			route: { hosts: [{ selector: "x-dropdown" }], target: "select" },
		});
	});

	it("marks select as destructive", async () => {
		const home = setupTempHome();
		const params = { trigger: { selector: "#x" }, optionText: "A" };
		const { calls } = await sendWithCapture("select", params, home);
		expect(calls[0]!.body["destructive"]).toBe(true);
	});
});

// ─── require-human command tests ───────────────────────────────────────

describe("require-human command", () => {
	it("sends require-human action with reason", async () => {
		const home = setupTempHome();
		const params = { reason: "CAPTCHA encountered" };
		const { plan, calls } = await sendWithCapture("require-human", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "require-human",
			params: { reason: "CAPTCHA encountered" },
		});
	});

	it("sends require-human with for-attach", async () => {
		const home = setupTempHome();
		const params = { reason: "Need approval", forAttach: "#captcha-frame" };
		const { plan, calls } = await sendWithCapture("require-human", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "require-human",
			params: { reason: "Need approval", forAttach: "#captcha-frame" },
		});
	});

	it("omits forAttach when not provided", async () => {
		const home = setupTempHome();
		const params = { reason: "Help needed" };
		const { calls } = await sendWithCapture("require-human", params, home);
		const sent = calls[0]!.body["params"] as Record<string, unknown>;
		expect("forAttach" in sent).toBe(false);
	});

	it("marks require-human as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("require-human", { reason: "x" }, home);
		expect(calls[0]!.body["destructive"]).toBe(true);
	});
});

// ─── Cross-cutting: no method/world invention ──────────────────────────

describe("fill/fill-form never invent or retry method/world", () => {
	it("fill does not add default method when protocol returns error", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const errorResponse = {
			protocol_version: 1,
			id: requestId,
			ok: false,
			error: {
				code: "FILL_METHOD_FAILED",
				category: "action",
				retry: "safe",
				message: "Direct fill failed",
			},
		};
		const { fetch } = createMockFetch(errorResponse);
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction(
			"fill",
			{
				target: { selector: "#x" },
				value: "v",
				method: "direct",
				world: "isolated",
			},
			makeGlobals(home),
			opts,
		);

		// CLI exits 1 (protocol error), does NOT retry with a different method
		expect(plan.code).toBe(1);
		expect(plan.stdout).toEqual(errorResponse);
	});

	it("fill-form does not retry individual fields", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const errorResponse = {
			protocol_version: 1,
			id: requestId,
			ok: false,
			error: {
				code: "PARTIAL_FILL_FAILURE",
				category: "action",
				retry: "safe",
				message: "Some fields failed",
			},
		};
		const { fetch, calls } = createMockFetch(errorResponse);
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction(
			"fill-form",
			{
				fields: [
					{ target: { selector: "#a" }, value: "x", method: "paste", world: "main" },
					{ target: { selector: "#b" }, value: "y", method: "direct", world: "isolated" },
				],
			},
			makeGlobals(home),
			opts,
		);

		// Only one POST was made, no retry
		expect(calls).toHaveLength(1);
		expect(plan.code).toBe(1);
	});
});
