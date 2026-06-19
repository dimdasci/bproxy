import type { BproxyRequest, BproxyResponse, TabHandle } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { CapturedLogger } from "../logger";
import type { BuiltServer } from "../server";
import {
	connectWsClient,
	setupTestServer,
	TEST_NICK,
	type TestServerContext,
	teardownTestServer,
	waitUntil,
} from "./helpers/integration";

const daemonToken = "test-obs-token";
const extensionToken = "test-ext-token";

let ctx: TestServerContext;
let built: BuiltServer;
let port: number;
let captured: CapturedLogger;
let currentSession: BproxyRequest["session"];
const T1 = "t1" as TabHandle;

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `obs-${crypto.randomUUID().slice(0, 8)}`,
		action: overrides.action ?? "text",
		nick: overrides.nick ?? TEST_NICK,
		params: overrides.params ?? {},
		session: overrides.session ?? currentSession,
		deadline: overrides.deadline ?? Date.now() + 5000,
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

beforeEach(async () => {
	ctx = await setupTestServer({ daemonToken, extensionToken });
	({ built, port, captured, currentSession } = ctx);
});

afterEach(async () => {
	await teardownTestServer(ctx);
});

describe("observability contract — GAP D", () => {
	describe("happy path event sequence", () => {
		it("emits received → forwarded → response for dispatched actions", async () => {
			captured.clear();
			built.sessions.bind(currentSession, 42);
			const ws = await connectWsClient(port, extensionToken);

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

			const cmd = makeCmd({ id: "obs-seq-test-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((line) => line["id"] === cmd.id);
			const eventNames = events.map((line) => line["event"]);

			expect(eventNames).toContain("received");
			expect(eventNames).toContain("forwarded");
			expect(eventNames).toContain("response");
			expect(eventNames.indexOf("received")).toBeLessThan(eventNames.indexOf("forwarded"));
			expect(eventNames.indexOf("forwarded")).toBeLessThan(eventNames.indexOf("response"));

			const forwarded = events.find((line) => line["event"] === "forwarded");
			expect(forwarded).toMatchObject({
				id: cmd.id,
				ws_client: expect.any(String),
				tab: 42,
			});

			const response = events.find((line) => line["event"] === "response");
			expect(response).toMatchObject({
				id: cmd.id,
				ok: true,
				elapsed_ms: expect.any(Number),
			});

			ws.close();
		});

		it("emits pacing_wait when pacing delay occurs", async () => {
			captured.clear();
			built.sessions.bind(currentSession, 42, "human");
			const ws = await connectWsClient(port, extensionToken);

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { url: "https://a.com", title: "A", loadTime: 100 },
					page: { url: "https://a.com", title: "A", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			await postCommand(
				makeCmd({ id: "obs-pacing-1", action: "navigate", params: { url: "https://a.com" } }),
			);
			captured.clear();

			const cmd2 = makeCmd({
				id: "obs-pacing-2",
				action: "navigate",
				params: { url: "https://b.com" },
			});
			await postCommand(cmd2);

			const events = captured.lines.filter((line) => line["id"] === cmd2.id);
			const pacing = events.find((line) => line["event"] === "pacing_wait");
			expect(pacing).toMatchObject({ id: cmd2.id, delay_ms: expect.any(Number) });

			ws.close();
		});
	});

	describe("error scenarios", () => {
		it("emits response with error_code when forward fails", async () => {
			captured.clear();
			const ws = await connectWsClient(port, extensionToken);
			const cmd = makeCmd({ id: "obs-err-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((line) => line["id"] === cmd.id);
			const response = events.find((line) => line["event"] === "response");
			expect(response).toMatchObject({
				ok: false,
				error_code: "TAB_NOT_FOUND",
				elapsed_ms: expect.any(Number),
			});
			ws.close();
		});

		it("emits timeout event when request exceeds deadline", { timeout: 10000 }, async () => {
			captured.clear();
			built.sessions.bind(currentSession, 42);
			const ws = await connectWsClient(port, extensionToken);
			ws.on("message", () => {
				// Intentionally hang.
			});

			const cmd = makeCmd({ id: "obs-timeout-1", action: "text", deadline: Date.now() + 500 });
			await postCommand(cmd);

			await waitUntil(() => {
				const events = captured.lines.filter((line) => line["id"] === cmd.id);
				return events.some((line) => line["event"] === "timeout");
			}, 3000);

			const events = captured.lines.filter((line) => line["id"] === cmd.id);
			const timeout = events.find((line) => line["event"] === "timeout");
			expect(timeout).toMatchObject({ id: cmd.id, elapsed_ms: expect.any(Number) });

			ws.close();
		});
	});

	describe("replay events", () => {
		it("emits replay event when in-flight request is replayed", { timeout: 10000 }, async () => {
			captured.clear();
			built.sessions.bind(currentSession, 42);
			let ws = await connectWsClient(port, extensionToken);

			const seenByClient1 = new Promise<BproxyRequest>((resolve) => {
				ws.once("message", (raw: unknown) => resolve(JSON.parse(String(raw)) as BproxyRequest));
			});

			const cmd = makeCmd({ id: "obs-replay-1", action: "text", deadline: Date.now() + 10000 });
			const postPromise = postCommand(cmd);
			await seenByClient1;
			ws.close();
			await waitUntil(() => built.clients.size() === 0);

			captured.clear();
			const auth = Buffer.from(extensionToken).toString("base64url");
			const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
				headers: { Origin: "chrome-extension://test" },
			});

			ws2.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { text: "ok" },
					page: { url: "https://x", title: "X", state: "ready", busy: false },
					replay: false,
				};
				ws2.send(JSON.stringify(resp));
			});

			await new Promise<void>((resolve, reject) => {
				ws2.once("open", () => resolve());
				ws2.once("error", reject);
			});

			await postPromise;
			await waitUntil(() =>
				captured.lines.some((line) => line["id"] === cmd.id && line["event"] === "replay"),
			);

			const replay = captured.lines.find(
				(line) => line["id"] === cmd.id && line["event"] === "replay",
			);
			expect(replay).toMatchObject({ id: cmd.id, ws_client: expect.any(String) });

			ws = ws2;
			ws.close();
		});
	});

	describe("configuration events", () => {
		it("emits pacing_config when pacing mode changes", async () => {
			captured.clear();
			built.sessions.registerTab(currentSession, 42);

			const cmd = makeCmd({
				id: "obs-config-1",
				action: "session.bind",
				params: { tab: T1, pacing: "fast" },
			});
			await postCommand(cmd);

			const configEvent = captured.lines.find((line) => line["event"] === "pacing_config");
			expect(configEvent).toMatchObject({
				session: currentSession,
				mode: "fast",
			});
		});
	});

	describe("WS connection events", () => {
		it("emits ws_connect with ws_client on new connection", async () => {
			captured.clear();
			const ws = await connectWsClient(port, extensionToken);

			await waitUntil(() => captured.lines.some((line) => line["event"] === "ws_connect"));

			const connect = captured.lines.find((line) => line["event"] === "ws_connect");
			expect(connect).toMatchObject({ event: "ws_connect" });
			expect(connect).toHaveProperty("ws_client");

			ws.close();
		});

		it("emits ws_disconnect with ws_client on close", async () => {
			const ws = await connectWsClient(port, extensionToken);
			await waitUntil(() => captured.lines.some((line) => line["event"] === "ws_connect"));

			captured.clear();
			ws.close();

			await waitUntil(() => captured.lines.some((line) => line["event"] === "ws_disconnect"));

			const disconnect = captured.lines.find((line) => line["event"] === "ws_disconnect");
			expect(disconnect).toMatchObject({ event: "ws_disconnect" });
			expect(disconnect).toHaveProperty("ws_client");
		});
	});

	describe("error_code field presence", () => {
		it("includes error_code in response event on failure", async () => {
			captured.clear();
			const cmd = makeCmd({ id: "obs-errcode-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((line) => line["id"] === cmd.id);
			const response = events.find((line) => line["event"] === "response");
			expect(response).toMatchObject({ ok: false, error_code: expect.any(String) });
		});

		it("omits error_code when response is successful", async () => {
			captured.clear();
			const cmd = makeCmd({ id: "obs-success-1", action: "debug.status" });
			await postCommand(cmd);

			const events = captured.lines.filter((line) => line["id"] === cmd.id);
			const response = events.find((line) => line["event"] === "response");
			expect(response).toMatchObject({ ok: true });
			expect(response).not.toHaveProperty("error_code");
		});
	});
});
