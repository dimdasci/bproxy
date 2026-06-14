/**
 * Tests for session, tab, debug, and top-level status commands.
 *
 * Verifies:
 * - Correct action names and params in request envelopes
 * - Destructive classification per command registry
 * - Optional param omission
 * - Argument validation (logical tab handles, pacing, count, limit)
 * - HUMAN_REQUIRED responses pass through as exit 1 (protocol JSON)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClientGlobalArgs, type SendOptions, sendAction } from "../client.js";
import {
	createMockFetch,
	makeGlobals,
	setupTempHome,
	successResponse,
} from "./command-test-helpers.js";
import { createTestStateDir } from "./helpers/test-state-dir.js";

// ─── Test infrastructure (local additions) ─────────────────────────────

function errorResponse(id: string, code: string, message = "error") {
	return {
		protocol_version: 1,
		id,
		ok: false,
		error: { code, message },
	};
}

async function sendWithCapture(
	action: string,
	params: Record<string, unknown>,
	home: string,
	globals?: Partial<ClientGlobalArgs>,
) {
	const requestId = "test-id-001";
	const { fetch, calls } = createMockFetch(successResponse(requestId));
	const opts: SendOptions = { fetch, requestId };

	const plan = await sendAction(
		action as Parameters<typeof sendAction>[0],
		params as Parameters<typeof sendAction>[1],
		makeGlobals(home, globals),
		opts,
	);

	return { plan, calls, requestId };
}

// ─── Session commands ──────────────────────────────────────────────────

describe("session.create", () => {
	it("sends session.create with optional label", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.create", { label: "research" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "session.create",
			params: { label: "research" },
			destructive: true,
		});
	});
});

describe("session.list", () => {
	it("sends session.list with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.list", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "session.list", params: {} });
	});

	it("is classified as non-destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("session.list", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: false });
	});
});

describe("session.bind", () => {
	it("sends session.bind with a logical tab handle", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.bind", { tab: "t1" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "session.bind", params: { tab: "t1" } });
	});

	it("sends session.bind with a logical tab handle and pacing", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture(
			"session.bind",
			{ tab: "t7", pacing: "human" },
			home,
		);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: { tab: "t7", pacing: "human" } });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("session.bind", { tab: "t1" }, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("session.unbind", () => {
	it("sends session.unbind with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.unbind", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "session.unbind", params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("session.unbind", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("session.resume", () => {
	it("sends session.resume with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.resume", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "session.resume", params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("session.resume", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("session.close", () => {
	it("sends session.close with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.close", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "session.close", params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("session.close", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

// ─── Tab commands ──────────────────────────────────────────────────────

describe("tab.list", () => {
	it("sends tab.list with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.list", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "tab.list", params: {} });
	});

	it("is classified as non-destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("tab.list", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: false });
	});
});

describe("tab.pin", () => {
	it("sends tab.pin with an optional logical tab handle", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.pin", { tab: "t5" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "tab.pin", params: { tab: "t5" } });
	});

	it("sends tab.pin without a tab handle when not specified", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.pin", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("tab.pin", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("tab.unpin", () => {
	it("sends tab.unpin with an optional logical tab handle", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.unpin", { tab: "t2" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "tab.unpin", params: { tab: "t2" } });
	});

	it("sends tab.unpin with empty params when not specified", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.unpin", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "tab.unpin", params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("tab.unpin", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("tab.open", () => {
	it("sends tab.open with url", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.open", { url: "https://test.com" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({
			action: "tab.open",
			params: { url: "https://test.com" },
		});
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("tab.open", { url: "https://test.com" }, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

describe("tab.close", () => {
	it("sends tab.close with an optional logical tab handle", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.close", { tab: "t3" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "tab.close", params: { tab: "t3" } });
	});

	it("sends tab.close without a tab handle when not specified", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("tab.close", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: {} });
	});

	it("is classified as destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("tab.close", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: true });
	});
});

// ─── Debug commands ────────────────────────────────────────────────────

describe("debug.log", () => {
	it("sends debug.log with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.log", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "debug.log", params: {} });
	});

	it("sends debug.log with id filter", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.log", { id: "req-123" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: { id: "req-123" } });
	});

	it("sends debug.log with limit", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.log", { limit: 50 }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: { limit: 50 } });
	});

	it("is classified as non-destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("debug.log", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: false });
	});
});

describe("debug.last", () => {
	it("sends debug.last with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.last", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "debug.last", params: {} });
	});

	it("sends debug.last with count", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.last", { count: 10 }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: { count: 10 } });
	});

	it("is classified as non-destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("debug.last", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: false });
	});
});

describe("debug.status", () => {
	it("sends debug.status with empty params", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.status", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "debug.status", params: {} });
	});

	it("is classified as non-destructive", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("debug.status", {}, home);
		expect(calls[0]!.body).toMatchObject({ destructive: false });
	});
});

// ─── Top-level status ──────────────────────────────────────────────────

describe("top-level status (debug.status alias)", () => {
	it("sends debug.status action", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("debug.status", {}, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ action: "debug.status" });
	});

	it("requires token preflight (tested via missing token)", async () => {
		const dir = createTestStateDir("bproxy-cmd-test-");
		writeFileSync(join(dir, "port"), "9615", { mode: 0o644 });
		// No token file → should fail with exit 2

		const requestId = "test-id-001";
		const { fetch } = createMockFetch(successResponse(requestId));
		const plan = await sendAction("debug.status", {}, makeGlobals(dir), {
			fetch,
			requestId,
		});
		expect(plan.code).toBe(2);
		expect(plan.stderr).toContain("Token file not found");
	});
});

// ─── HUMAN_REQUIRED pass-through ───────────────────────────────────────

describe("HUMAN_REQUIRED handling", () => {
	it("passes through HUMAN_REQUIRED as exit 1 with protocol JSON", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch } = createMockFetch(errorResponse(requestId, "HUMAN_REQUIRED", "Session paused"));

		const plan = await sendAction("debug.log", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
		expect(plan.stdout).toEqual(
			expect.objectContaining({
				ok: false,
				error: { code: "HUMAN_REQUIRED", message: "Session paused" },
			}),
		);
	});

	it("does not convert HUMAN_REQUIRED to exit 2", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch } = createMockFetch(
			errorResponse(requestId, "HUMAN_REQUIRED", "Human intervention required"),
		);

		const plan = await sendAction("session.resume", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
		expect(plan.stderr).toBeUndefined();
	});

	it("HUMAN_REQUIRED on forwarded action surfaces as protocol error not control-plane", async () => {
		const home = setupTempHome();
		const requestId = "test-id-001";
		const { fetch } = createMockFetch(errorResponse(requestId, "HUMAN_REQUIRED", "paused"));

		const plan = await sendAction("tab.list", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
		// stdout should contain the protocol error JSON
		expect(plan.stdout).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "HUMAN_REQUIRED" }),
			}),
		);
	});
});

// ─── Validation edge cases ─────────────────────────────────────────────

describe("argument validation", () => {
	it("session.bind accepts valid logical tab handles", async () => {
		const home = setupTempHome();
		const { plan, calls } = await sendWithCapture("session.bind", { tab: "t99" }, home);
		expect(plan.code).toBe(0);
		expect(calls[0]!.body).toMatchObject({ params: { tab: "t99" } });
	});

	it("debug.last with count sends correct params", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("debug.last", { count: 5 }, home);
		expect(calls[0]!.body).toMatchObject({ params: { count: 5 } });
	});

	it("debug.log with id and limit sends both", async () => {
		const home = setupTempHome();
		const { calls } = await sendWithCapture("debug.log", { id: "abc", limit: 20 }, home);
		expect(calls[0]!.body).toMatchObject({ params: { id: "abc", limit: 20 } });
	});
});
