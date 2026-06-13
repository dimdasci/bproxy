import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../logger";
import { type BuiltServer, buildServer } from "../server";

const daemonToken = "test-ordering-token";
const wsToken = "test-ext-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;
const DEFAULT_SESSION = "m4q8z2" as BproxyRequest["session"];

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `auth-test-${Math.random().toString(36).slice(2, 8)}`,
		action: overrides.action ?? "text",
		params: overrides.params ?? {},
		session: overrides.session ?? DEFAULT_SESSION,
		deadline: Date.now() + 5000,
		destructive: false,
		...overrides,
	};
}

async function postCommand(cmd: BproxyRequest, token?: string): Promise<Response> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token !== undefined) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers,
		body: JSON.stringify(cmd),
	});
}

function connectClient(clientToken = wsToken): Promise<WebSocket> {
	const auth = Buffer.from(clientToken).toString("base64url");
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
		headers: { Origin: "chrome-extension://test" },
	});
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

beforeEach(async () => {
	captured = buildCapturedLogger();
	built = await buildServer({
		port: 0,
		daemonToken,
		extensionToken: wsToken,
		logger: captured.logger,
	});
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
});

afterEach(async () => {
	await built.app.close();
});

describe("auth ordering — GAP C", () => {
	describe("negative tests: valid payload + missing/invalid auth", () => {
		it("fails 401 without any Authorization header", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await postCommand(cmd); // No token
			expect(res.status).toBe(401);
		});

		it("fails 401 with empty Authorization header", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "" },
				body: JSON.stringify(cmd),
			});
			expect(res.status).toBe(401);
		});

		it("fails 401 with malformed Authorization header (no Bearer)", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Basic dGVzdA==" },
				body: JSON.stringify(cmd),
			});
			expect(res.status).toBe(401);
		});

		it("fails 401 with wrong bearer token value", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await postCommand(cmd, "wrong-token-value");
			expect(res.status).toBe(401);
		});

		it("fails 401 with Bearer prefix but missing value", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " },
				body: JSON.stringify(cmd),
			});
			expect(res.status).toBe(401);
		});

		it("fails 401 with Bearer prefix and whitespace", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer    " },
				body: JSON.stringify(cmd),
			});
			expect(res.status).toBe(401);
		});

		it("fails 401 when token has trailing characters that look like valid token", async () => {
			// This tests for potential prefix issues
			const cmd = makeCmd({ action: "debug.status" });
			const res = await postCommand(cmd, `${daemonToken}extra`);
			expect(res.status).toBe(401);
		});

		it("fails 401 when token has leading characters", async () => {
			const cmd = makeCmd({ action: "debug.status" });
			const res = await postCommand(cmd, `extra${daemonToken}`);
			expect(res.status).toBe(401);
		});
	});

	describe("positive controls: prove rejection is auth-only", () => {
		it("same body with valid auth succeeds and returns 200", async () => {
			const cmd = makeCmd({ action: "debug.status", id: "auth-compare-test" });
			const res = await postCommand(cmd, daemonToken);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
		});

		it("proves that bad_request comes from auth, not schema parsing", async () => {
			// Uses valid debug.status which would succeed if auth passed
			const cmd = makeCmd({ action: "debug.status" });
			const res = await postCommand(cmd, "wrong");
			expect(res.status).toBe(401);
			// Should not be 400 (schema error) - proves auth is first
		});
	});

	describe("WS auth ordering", () => {
		it("WS connection fails without valid extension token", async () => {
			const badAuth = Buffer.from("wrong-token").toString("base64url");
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${badAuth}`], {
				headers: { Origin: "chrome-extension://test" },
			});

			await new Promise<void>((resolve) => {
				ws.once("error", () => resolve());
				ws.once("close", () => resolve());
				setTimeout(() => resolve(), 500);
			});

			expect(ws.readyState).toBe(WebSocket.CLOSED);
		});

		it("WS connection succeeds with valid extension token", async () => {
			const ws = await connectClient(wsToken);
			expect(ws.readyState).toBe(WebSocket.OPEN);
			ws.close();
		});
	});

	describe("pair/claim endpoint has unique auth (no daemon token)", () => {
		it("pair/claim works without daemon token", async () => {
			const issue = built.pairing.issue();
			const res = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: "chrome-extension://test" },
				body: JSON.stringify({ code: issue.code }),
			});
			// Should succeed (or fail for non-existent code), not fail auth
			expect(res.status).not.toBe(401);
			expect(res.status).toBe(200);
		});

		it("pair/claim still requires Origin header", async () => {
			const issue = built.pairing.issue();
			const res = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
				method: "POST",
				headers: { "Content-Type": "application/json" }, // No Origin
				body: JSON.stringify({ code: issue.code }),
			});
			// Should fail because Origin is missing/invalid
			// This captures a gap - the test will tell us if Origin is enforced
			expect(res.status).toBe(401);
		});
	});

	describe("handler-side effects are prevented when auth fails", () => {
		it("pending.register is not called when auth fails", async () => {
			const handlerSpy = vi.spyOn(built.pending, "register");
			const cmd = makeCmd({ action: "text" });

			const res = await postCommand(cmd, "wrong-token");
			expect(res.status).toBe(401);

			// Handler side effects should not execute
			expect(handlerSpy).not.toHaveBeenCalled();
		});

		it("session state is not modified when auth fails", async () => {
			const sessionId = built.sessions.create().id;
			built.sessions.pause(sessionId, "captcha");
			const sessionBefore = built.sessions.internal(sessionId);
			const beforePaused = sessionBefore.paused;

			const cmd = makeCmd({ action: "session.resume", session: sessionId });
			const res = await postCommand(cmd, "wrong-token");
			expect(res.status).toBe(401);

			const sessionAfter = built.sessions.internal(sessionId);
			// Session state should be unchanged
			expect(sessionAfter.paused).toBe(beforePaused);
			expect(sessionAfter.pauseReason).toBe("captcha");
		});

		it("no trace is recorded when auth fails", async () => {
			// Gap: no trace recording mechanism to assert
			const cmd = makeCmd({ action: "debug.status" });
			await postCommand(cmd, "wrong-token");

			// If we had a trace recording mechanism, it shouldn't record failed auth
			// This captures a potential gap
		});
	});

	describe("auth runs before body parsing/validation", () => {
		it("invalid JSON body with bad auth still returns 401 (not 400)", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
				body: "this is not valid json",
			});
			// If auth runs first, should be 401
			// If parsing runs first, might be 400
			expect(res.status).toBe(401);
		});

		it("valid JSON but invalid schema with bad auth returns 401", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
				body: JSON.stringify({ some: "invalid", request: "data" }),
			});
			expect(res.status).toBe(401);
		});
	});
});
