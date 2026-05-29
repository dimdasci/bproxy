import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../logger";
import { type BuiltServer, buildServer } from "../server";

const daemonToken = "test-daemon-token";
const extensionToken = "test-extension-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;
let currentSession: BproxyRequest["session"];

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id:
			overrides.id ??
			`01HZX${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(21, "0")}`,
		action: "text",
		params: {},
		session: currentSession,
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

function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (fn()) return resolve();
			if (Date.now() - start > timeoutMs) return reject(new Error("waitUntil timeout"));
			setTimeout(tick, 10);
		};
		tick();
	});
}

beforeEach(async () => {
	captured = buildCapturedLogger();
	built = await buildServer({ port: 0, daemonToken, extensionToken, logger: captured.logger });
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
	currentSession = built.sessions.create().id;
});

afterEach(async () => {
	await built.app.close();
});

describe("round-trip — design-asserted invariants", () => {
	it("auth runs before any route handler", async () => {
		const handlerSpy = vi.spyOn(built.pending, "register");
		const cmd = makeCmd({ id: "auth-test", action: "debug.status" });

		const noAuth = await fetch(`http://127.0.0.1:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(cmd),
		});
		expect(noAuth.status).toBe(401);
		expect(handlerSpy).not.toHaveBeenCalled();

		const badAuth = await postCommand(cmd, "wrong-token");
		expect(badAuth.status).toBe(401);
		expect(handlerSpy).not.toHaveBeenCalled();

		const okRes = await postCommand(cmd);
		expect(okRes.status).toBe(200);
	});
});

describe("round-trip — happy path", () => {
	it("forwards a command to a connected WS client and resolves with the response", async () => {
		built.sessions.bind(currentSession, 42);
		const ws = await connectClient();

		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as BproxyRequest;
			const resp: BproxyResponse = {
				protocol_version: 1,
				id: req.id,
				ok: true,
				data: { text: "hello" },
				page: { url: "https://x", title: "X", state: "ready", busy: false },
				replay: false,
			};
			ws.send(JSON.stringify(resp));
		});

		const cmd = makeCmd({ id: "01HZX0000000000000000000ZZ" });
		const res = await postCommand(cmd);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		expect(body).toMatchObject({ ok: true, id: cmd.id });
		ws.close();
	});

	it("debug.status is handled daemon-locally even without a WS client", async () => {
		const cmd = makeCmd({ id: "01HZX0000000000000000000DD", action: "debug.status" });
		const res = await postCommand(cmd);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse<"debug.status">;
		if (!body.ok) throw new Error("debug.status should succeed");
		expect(body.data.daemon.pid).toBe(process.pid);
		expect(body.data.sessionTabs).toContainEqual({ session: currentSession, tabs: [] });
	});

	it("pairing flow: claim issues an extension token", async () => {
		const issue = built.pairing.issue();
		const res = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "chrome-extension://abc" },
			body: JSON.stringify({ code: issue.code }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; data: { extensionToken: string } };
		expect(body.ok).toBe(true);
		expect(body.data.extensionToken.length).toBeGreaterThan(0);
	});

	it("responds to app-level heartbeat ping with pong", async () => {
		const ws = await connectClient();
		const pongPromise = new Promise<unknown>((resolve) => {
			ws.once("message", (raw: unknown) => resolve(JSON.parse(String(raw))));
		});
		ws.send(JSON.stringify({ type: "ping", ts: 12345 }));
		await expect(pongPromise).resolves.toEqual({ type: "pong", ts: 12345 });
		ws.close();
	});
});

describe("round-trip — reconnect and replay", () => {
	it(
		"replays an in-flight request to a reconnecting client and resolves the original POST",
		{ timeout: 15_000 },
		async () => {
			built.sessions.bind(currentSession, 42);
			let ws = await connectClient();

			const seenByClient1 = new Promise<BproxyRequest>((resolve) => {
				ws.once("message", (raw: unknown) => resolve(JSON.parse(String(raw)) as BproxyRequest));
			});

			const cmd = makeCmd({ id: "01HZX0000000000000000000RP", deadline: Date.now() + 10_000 });
			const postPromise = postCommand(cmd);
			await seenByClient1;
			ws.close();
			await waitUntil(() => built.clients.size() === 0);

			const replayPromise = new Promise<BproxyRequest>((resolve) => {
				const auth = Buffer.from(extensionToken).toString("base64url");
				const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
					headers: { Origin: "chrome-extension://test" },
				});
				ws2.once("message", (raw: unknown) => resolve(JSON.parse(String(raw)) as BproxyRequest));
				ws2.once("open", () => {
					ws = ws2;
				});
				ws2.once("error", () => {
					/* ignore */
				});
			});

			const replayed = await replayPromise;
			expect(replayed.id).toBe(cmd.id);

			ws.send(
				JSON.stringify({
					protocol_version: 1,
					id: replayed.id,
					ok: true,
					data: { text: "from-client-2" },
					page: { url: "https://x", title: "", state: "ready", busy: false },
					replay: false,
				} satisfies BproxyResponse),
			);

			const res = await postPromise;
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body).toMatchObject({ ok: true, id: cmd.id });
			if (body.ok && body.data && "text" in body.data) {
				expect(body.data.text).toBe("from-client-2");
			}
			ws.close();
		},
	);
});

describe("round-trip — observability (ADR-009)", () => {
	it("emits received → pacing_wait? → response with the request id on every command", async () => {
		const cmd = makeCmd({ id: "01HZX000000000000000000OBS", action: "debug.status" });
		await postCommand(cmd);

		const eventsForId = captured.lines.filter((line) => line["id"] === cmd.id);
		const events = eventsForId.map((line) => line["event"]);
		expect(events).toContain("received");
		expect(events).toContain("response");

		const received = eventsForId.find((line) => line["event"] === "received");
		expect(received).toMatchObject({
			id: cmd.id,
			action: "debug.status",
			session: currentSession,
			destructive: false,
		});

		const response = eventsForId.find((line) => line["event"] === "response");
		expect(response).toMatchObject({ id: cmd.id, ok: true });
	});

	it("emits ws_connect and ws_disconnect when a client connects and drops", async () => {
		captured.clear();
		const ws = await connectClient();
		await waitUntil(() => captured.lines.some((line) => line["event"] === "ws_connect"));
		ws.close();
		await waitUntil(() => captured.lines.some((line) => line["event"] === "ws_disconnect"));

		const connect = captured.lines.find((line) => line["event"] === "ws_connect");
		expect(connect).toHaveProperty("ws_client");
	});
});
