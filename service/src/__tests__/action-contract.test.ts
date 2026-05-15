import type { Action, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../logger";
import { type BuiltServer, buildServer } from "../server";

const daemonToken = "test-daemon-token";
const extensionToken = "test-extension-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;

function makeCmd(action: Action, overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id:
			overrides.id ??
			`01HZX${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(21, "0")}`,
		action,
		params: {},
		session: overrides.session ?? "default",
		deadline: Date.now() + 5000,
		destructive: false,
		...overrides,
	};
}

async function postCommand(cmd: BproxyRequest, token = daemonToken): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(cmd),
	});
}

function connectClient(): Promise<WebSocket> {
	const auth = Buffer.from(extensionToken).toString("base64url");
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
	built = await buildServer({ port: 0, daemonToken, extensionToken, logger: captured.logger });
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
});

afterEach(async () => {
	await built.app.close();
});

describe("action contract coverage — GAP A", () => {
	describe("daemon-local actions (no WS client needed)", () => {
		it("debug.last succeeds without WS client", async () => {
			const cmd = makeCmd("debug.last");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
		});

		it("debug.status succeeds without WS client", async () => {
			const cmd = makeCmd("debug.status");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
		});
	});

	describe("forwarded actions (need WS client)", () => {
		// These are browser actions that SHOULD require a WS client
		const forwardedActions: Action[] = [
			"navigate",
			"text",
			"images",
			"elements",
			"outline",
			"dom",
			"scroll",
			"screenshot",
			"fill",
			"fill-form",
			"select",
			"wait",
			"require-human",
			"eval",
			"debug.log", // debug.log is forwarded, not daemon-local
		];

		for (const action of forwardedActions) {
			it(`${action} requires WS client and bound tab`, async () => {
				// Session not bound yet
				const cmd = makeCmd(action);
				const res = await postCommand(cmd);
				expect(res.status).toBe(200);
				const body = (await res.json()) as BproxyResponse;
				// Should fail because no session is bound
				expect(body.ok).toBe(false);
				if (!body.ok) {
					expect(body.error.code).toBe("TAB_NOT_FOUND");
				}
			});
		}

		it("forwarded actions succeed with bound session and WS client", async () => {
			built.sessions.bind("default", 42);
			const ws = await connectClient();

			const seenRequests: BproxyRequest[] = [];
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				seenRequests.push(req);
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { result: "ok" },
					page: { url: "https://x", title: "X", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			// Test with text action
			const cmd = makeCmd("text");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			ws.close();
		});

		it("debug.log is forwarded to extension (not daemon-local)", async () => {
			built.sessions.bind("default", 42);
			const ws = await connectClient();

			let receivedAction: string | null = null;
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				receivedAction = req.action;
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { entries: [] },
					page: { url: "", title: "", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			const cmd = makeCmd("debug.log");
			await postCommand(cmd);

			// debug.log should be forwarded to extension
			expect(receivedAction).toBe("debug.log");

			ws.close();
		});
	});

	describe("session lifecycle actions", () => {
		it("session.list works without bound tab and returns session state", async () => {
			const cmd = makeCmd("session.list");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
			if (body.ok) {
				const data = body.data as { sessions: unknown[] };
				expect(data.sessions).toBeDefined();
				expect(Array.isArray(data.sessions)).toBe(true);
			}
		});

		it("session.bind from unbound session works and allows subsequent forwarded actions", async () => {
			// This test captures the chicken-and-egg gap:
			// Without session.bind, no forwarded actions work.
			// session.bind itself needs to work without a pre-bound tab.

			// First bind the session
			const bindCmd = makeCmd("session.bind", { params: { tabId: 42 } });
			const bindRes = await postCommand(bindCmd);
			expect(bindRes.status).toBe(200);
			const bindBody = (await bindRes.json()) as BproxyResponse;
			expect(bindBody.ok).toBe(true);

			// Now session should be bound
			const session = built.sessions.getOrCreate("default");
			expect(session.tabId).toBe(42);
		});

		it("session.unbind removes tab binding", async () => {
			built.sessions.bind("default", 42);
			const cmd = makeCmd("session.unbind");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			const session = built.sessions.getOrCreate("default");
			expect(session.tabId).toBeNull();
		});

		it("session.resume clears paused state", async () => {
			built.sessions.bind("default", 42);
			built.sessions.pause("default", "test");
			expect(built.sessions.getOrCreate("default").paused).toBe(true);

			const cmd = makeCmd("session.resume");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			const session = built.sessions.getOrCreate("default");
			expect(session.paused).toBe(false);
		});
	});

	describe("tab lifecycle actions", () => {
		// These actions should require a bound tab
		it("tab.list requires bound session or returns error", async () => {
			const cmd = makeCmd("tab.list");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			// Without session binding, this should error
			expect(body.ok).toBe(false);
		});

		it("tab.pin requires bound session", async () => {
			const cmd = makeCmd("tab.pin");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
		});

		it("tab.unpin requires bound session", async () => {
			const cmd = makeCmd("tab.unpin");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
		});

		it("tab.open requires bound session", async () => {
			const cmd = makeCmd("tab.open", { params: { url: "https://example.com" } });
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
		});

		it("tab.close requires bound session", async () => {
			const cmd = makeCmd("tab.close");
			const res = await postCommand(cmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
		});
	});
});
