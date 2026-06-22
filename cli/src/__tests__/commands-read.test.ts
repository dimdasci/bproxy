/**
 * Tests for read/navigation action commands.
 *
 * Verifies that each command correctly:
 * - Parses CLI args into ActionParams
 * - Sends the correct action to the client
 * - Handles optional params (omits undefined values)
 * - Validates arg values where applicable
 */
import { describe, expect, it } from "vitest";
import { type SendOptions, sendAction } from "../client.js";
import { PROTOCOL_VERSION } from "../types.js";
import {
	createMockFetch,
	makeGlobals,
	sendWithCapture,
	setupTempHome,
	successResponse,
} from "./command-test-helpers.js";

// ─── Tests ─────────────────────────────────────────────────────────────

describe("navigate command", () => {
	it("sends navigate action with url param", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("navigate", { url: "https://example.com" }, home);

		expect(plan.code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.body).toMatchObject({
			action: "navigate",
			params: { url: "https://example.com" },
		});
	});
});

describe("text command", () => {
	it("sends text action without selector", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("text", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "text",
			params: {},
		});
	});

	it("sends text action with selector", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("text", { selector: "#content" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "text",
			params: { selector: "#content" },
		});
	});
});

describe("links command", () => {
	it("sends links action without optional params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("links", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "links",
			params: {},
		});
	});

	it("sends links action with selector, visibleOnly, and limit", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture(
			"links",
			{ selector: "#search", visibleOnly: true, limit: 10 },
			home,
		);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "links",
			params: { selector: "#search", visibleOnly: true, limit: 10 },
		});
	});

	it("sends links action with href-contains filter", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("links", { hrefContains: "/in/" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "links",
			params: { hrefContains: "/in/" },
		});
	});

	it("sends links action with offset for pagination", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("links", { offset: 50, limit: 25 }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "links",
			params: { offset: 50, limit: 25 },
		});
	});
});

describe("images command", () => {
	it("sends images action without selector", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("images", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "images",
			params: {},
		});
	});

	it("sends images action with selector", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("images", { selector: ".gallery" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "images",
			params: { selector: ".gallery" },
		});
	});
});

describe("elements command", () => {
	it("sends elements action without form flag", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("elements", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "elements",
			params: {},
		});
	});

	it("sends elements action with form flag", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("elements", { form: true }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "elements",
			params: { form: true },
		});
	});
});

describe("outline command", () => {
	it("sends outline action with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("outline", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "outline",
			params: {},
		});
	});
});

describe("dom command", () => {
	it("sends dom action without params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("dom", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "dom",
			params: {},
		});
	});

	it("sends dom action with selector", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("dom", { selector: "main" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "dom",
			params: { selector: "main" },
		});
	});

	it("sends dom action with selector and depth", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("dom", { selector: "main", depth: 3 }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "dom",
			params: { selector: "main", depth: 3 },
		});
	});
});

describe("scroll command", () => {
	it("sends scroll action with no params (defaults)", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("scroll", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params: {},
		});
	});

	it("sends scroll action with by", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("scroll", { by: "page" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params: { by: "page" },
		});
	});

	it("sends scroll action with direction", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("scroll", { direction: "up" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params: { direction: "up" },
		});
	});

	it("sends scroll action with direction", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("scroll", { direction: "down" }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params: { direction: "down" },
		});
	});

	it("sends scroll with all params combined", async () => {
		const home = setupTempHome();
		const params = { by: "500px", direction: "down" };
		const { plan, calls } = await sendWithCapture("scroll", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params: { by: "500px", direction: "down" },
		});
	});

	it("sends scroll with an explicit element target", async () => {
		const home = setupTempHome();
		const params = { target: { selector: "main#workspace" }, by: "viewport", direction: "down" };
		const { plan, calls } = await sendWithCapture("scroll", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "scroll",
			params,
		});
	});
});

describe("screenshot command", () => {
	it("sends screenshot action with no params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("screenshot", {}, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "screenshot",
			params: {},
		});
	});

	it("sends screenshot action with activate flag", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("screenshot", { activate: true }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "screenshot",
			params: { activate: true },
		});
	});

	it("sends screenshot action with debugger flag", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("screenshot", { debugger: true }, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "screenshot",
			params: { debugger: true },
		});
	});

	it("sends screenshot action with both flags", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture(
			"screenshot",
			{ activate: true, debugger: true },
			home,
		);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "screenshot",
			params: { activate: true, debugger: true },
		});
	});
});

describe("wait command", () => {
	it("sends wait action with selector strategy", async () => {
		const home = setupTempHome();
		const params = { strategy: "selector", target: "#loaded" };
		const { plan, calls } = await sendWithCapture("wait", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "wait",
			params: { strategy: "selector", target: "#loaded" },
		});
	});

	it("sends wait action with url strategy", async () => {
		const home = setupTempHome();
		const params = { strategy: "url", target: "https://example.com/done" };
		const { plan, calls } = await sendWithCapture("wait", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "wait",
			params: { strategy: "url", target: "https://example.com/done" },
		});
	});

	it("sends wait action with navigation strategy", async () => {
		const home = setupTempHome();
		const params = { strategy: "navigation", target: "complete" };
		const { plan, calls } = await sendWithCapture("wait", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "wait",
			params: { strategy: "navigation", target: "complete" },
		});
	});

	it("sends wait action with timeout", async () => {
		const home = setupTempHome();
		const params = { strategy: "selector", target: ".item", timeout: 10000 };
		const { plan, calls } = await sendWithCapture("wait", params, home);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "wait",
			params: { strategy: "selector", target: ".item", timeout: 10000 },
		});
	});
});

describe("request envelope structure", () => {
	it("includes protocol_version, id, session, deadline, and destructive flag", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		await sendAction("text", {}, makeGlobals(home), opts);

		const body = calls[0]!.body;
		expect(body["protocol_version"]).toBe(PROTOCOL_VERSION);
		expect(body["id"]).toBe(requestId);
		expect(body["session"]).toBe("m4q7z2");
		expect(body["deadline"]).toBeGreaterThan(Date.now() - 10000);
		expect(body["destructive"]).toBe(false);
	});

	it("marks navigate as destructive", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		await sendAction("navigate", { url: "https://example.com" }, makeGlobals(home), opts);

		expect(calls[0]!.body["destructive"]).toBe(true);
	});

	it("marks scroll as destructive", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		await sendAction("scroll", {}, makeGlobals(home), opts);

		expect(calls[0]!.body["destructive"]).toBe(true);
	});

	it("marks read commands as non-destructive", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";

		const readActions = [
			"text",
			"links",
			"images",
			"elements",
			"outline",
			"dom",
			"screenshot",
			"wait",
		] as const;
		for (const action of readActions) {
			const { fetch, calls } = createMockFetch(successResponse(requestId));
			const opts: SendOptions = { fetch, requestId };

			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: empty params are valid for all read actions
			await sendAction(action, {} as any, makeGlobals(home), opts);

			expect(calls[0]!.body["destructive"]).toBe(false);
		}
	});

	it("uses global session in envelope", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		await sendAction("text", {}, makeGlobals(home, { session: "k7m2q4" }), opts);

		expect(calls[0]!.body["session"]).toBe("k7m2q4");
	});

	it("requires an explicit session for browser actions", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction("text", {}, makeGlobals(home, { session: undefined }), opts);

		expect(plan.code).toBe(2);
		expect(plan.stderr).toContain("Missing required session id");
		expect(calls).toHaveLength(0);
	});
});

describe("command arg validation", () => {
	it("dom accepts valid depth params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("dom", { selector: "body", depth: 5 }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "dom",
			params: { selector: "body", depth: 5 },
		});
	});

	it("optional params are omitted when not provided (not sent as undefined)", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("text", {}, home);
		const params = calls[0]!.body["params"] as Record<string, unknown>;
		expect(params).toEqual({});
		expect("selector" in params).toBe(false);
	});

	it("tab.open is the bootstrap exception and can omit the session", async () => {
		const home = setupTempHome();
		const requestId = "tab-open-bootstrap";
		const { fetch, calls } = createMockFetch(successResponse(requestId));
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction(
			"tab.open",
			{ url: "https://example.com" },
			makeGlobals(home, { session: undefined }),
			opts,
		);

		expect(plan.code).toBe(0);
		expect(calls[0]!.body["session"]).toBe("");
	});
});

describe("response pass-through", () => {
	it("passes daemon response as stdout unchanged on success (exit 0)", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const data = { text: "Page content here" };
		const responseBody = successResponse(requestId, data);
		const { fetch } = createMockFetch(responseBody);
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction("text", {}, makeGlobals(home), opts);

		expect(plan.code).toBe(0);
		expect(plan.stdout).toEqual(responseBody);
	});

	it("passes daemon error response as stdout with exit 1", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const responseBody = {
			protocol_version: PROTOCOL_VERSION,
			id: requestId,
			ok: false,
			error: {
				code: "ELEMENT_NOT_FOUND",
				category: "target",
				retry: "safe",
				message: "Not found",
			},
		};
		const { fetch } = createMockFetch(responseBody);
		const opts: SendOptions = { fetch, requestId };

		const plan = await sendAction("text", { selector: "#missing" }, makeGlobals(home), opts);

		expect(plan.code).toBe(1);
		expect(plan.stdout).toEqual(responseBody);
	});
});
