import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../logger";
import { type BuiltServer, buildServer } from "../server";

const daemonToken = "test-obs-token";
const extensionToken = "test-ext-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `obs-${Math.random().toString(36).slice(2, 8)}`,
		action: overrides.action ?? "text",
		params: overrides.params ?? {},
		session: overrides.session ?? "default",
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
});

afterEach(async () => {
	await built.app.close();
});

describe("observability contract — GAP D", () => {
	describe("happy path event sequence", () => {
		it("emits received → forwarded → response for dispatched actions", async () => {
			captured.clear();
			built.sessions.bind("default", 42);
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

			const cmd = makeCmd({ id: "obs-seq-test-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((l) => l["id"] === cmd.id);
			const eventNames = events.map((l) => l["event"]);

			expect(eventNames).toContain("received");
			expect(eventNames).toContain("forwarded");
			expect(eventNames).toContain("response");

			const receivedIndex = eventNames.indexOf("received");
			const forwardedIndex = eventNames.indexOf("forwarded");
			const responseIndex = eventNames.indexOf("response");
			expect(receivedIndex).toBeLessThan(forwardedIndex);
			expect(forwardedIndex).toBeLessThan(responseIndex);

			const forwarded = events.find((l) => l["event"] === "forwarded");
			expect(forwarded).toMatchObject({
				id: cmd.id,
				ws_client: expect.any(String),
				tab: 42,
			});

			const response = events.find((l) => l["event"] === "response");
			expect(response).toMatchObject({
				id: cmd.id,
				ok: true,
				elapsed_ms: expect.any(Number),
			});

			ws.close();
		});

		it("emits pacing_wait when pacing delay occurs", async () => {
			captured.clear();
			built.sessions.bind("default", 42, "human");
			const ws = await connectClient();

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

			const events = captured.lines.filter((l) => l["id"] === cmd2.id);
			const pacing = events.find((l) => l["event"] === "pacing_wait");
			expect(pacing).toMatchObject({ id: cmd2.id, delay_ms: expect.any(Number) });

			ws.close();
		});
	});

	describe("error scenarios", () => {
		it("emits response with error_code when forward fails", async () => {
			captured.clear();
			const ws = await connectClient();
			const cmd = makeCmd({ id: "obs-err-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((l) => l["id"] === cmd.id);
			const response = events.find((l) => l["event"] === "response");
			expect(response).toMatchObject({
				ok: false,
				error_code: "TAB_NOT_FOUND",
				elapsed_ms: expect.any(Number),
			});
			ws.close();
		});

		it("emits timeout event when request exceeds deadline", { timeout: 10000 }, async () => {
			captured.clear();
			built.sessions.bind("default", 42);
			const ws = await connectClient();

			// Client receives but doesn't respond (simulating hang)
			ws.on("message", () => {
				// Don't respond - let it timeout
			});

			const cmd = makeCmd({ id: "obs-timeout-1", action: "text", deadline: Date.now() + 500 });
			await postCommand(cmd);

			// Wait for timeout
			await waitUntil(() => {
				const events = captured.lines.filter((l) => l["id"] === cmd.id);
				return events.some((l) => l["event"] === "timeout");
			}, 3000);

			const events = captured.lines.filter((l) => l["id"] === cmd.id);
			const timeout = events.find((l) => l["event"] === "timeout");

			expect(timeout).toMatchObject({
				id: cmd.id,
				elapsed_ms: expect.any(Number),
			});

			ws.close();
		});
	});

	describe("replay events", () => {
		it("emits replay event when in-flight request is replayed", { timeout: 10000 }, async () => {
			captured.clear();
			built.sessions.bind("default", 42);
			let ws = await connectClient();

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
			await waitUntil(() => captured.lines.some((l) => l["id"] === cmd.id && l["event"] === "replay"));

			const replay = captured.lines.find((l) => l["id"] === cmd.id && l["event"] === "replay");
			expect(replay).toMatchObject({ id: cmd.id, ws_client: expect.any(String) });

			ws2.close();
		});
	});

	describe("configuration events", () => {
		it("emits pacing_config when pacing mode changes", async () => {
			captured.clear();

			const cmd = makeCmd({
				id: "obs-config-1",
				action: "session.bind",
				params: { tabId: 42, pacing: "fast" },
			});
			await postCommand(cmd);

			const configEvent = captured.lines.find((l) => l["event"] === "pacing_config");
			expect(configEvent).toMatchObject({
				session: "default",
				mode: "fast",
			});
		});
	});

	describe("WS connection events", () => {
		it("emits ws_connect with ws_client on new connection", async () => {
			captured.clear();
			const ws = await connectClient();

			await waitUntil(() => captured.lines.some((l) => l["event"] === "ws_connect"));

			const connect = captured.lines.find((l) => l["event"] === "ws_connect");
			expect(connect).toMatchObject({
				event: "ws_connect",
			});
			expect(connect).toHaveProperty("ws_client");

			ws.close();
		});

		it("emits ws_disconnect with ws_client on close", async () => {
			const ws = await connectClient();
			await waitUntil(() => captured.lines.some((l) => l["event"] === "ws_connect"));

			captured.clear();
			ws.close();

			await waitUntil(() => captured.lines.some((l) => l["event"] === "ws_disconnect"));

			const disconnect = captured.lines.find((l) => l["event"] === "ws_disconnect");
			expect(disconnect).toMatchObject({
				event: "ws_disconnect",
			});
			expect(disconnect).toHaveProperty("ws_client");
		});
	});

	describe("error_code field presence", () => {
		it("includes error_code in response event on failure", async () => {
			captured.clear();

			// This will fail because no session is bound
			const cmd = makeCmd({ id: "obs-errcode-1", action: "text" });
			await postCommand(cmd);

			const events = captured.lines.filter((l) => l["id"] === cmd.id);
			const response = events.find((l) => l["event"] === "response");
			expect(response).toMatchObject({
				ok: false,
				error_code: expect.any(String),
			});
		});

		it("omits error_code when response is successful", async () => {
			captured.clear();

			// debug.status should succeed
			const cmd = makeCmd({ id: "obs-success-1", action: "debug.status" });
			await postCommand(cmd);

			const events = captured.lines.filter((l) => l["id"] === cmd.id);
			const response = events.find((l) => l["event"] === "response");
			expect(response).toMatchObject({
				ok: true,
			});
			// error_code should not be present on success
			expect(response).not.toHaveProperty("error_code");
		});
	});
});
