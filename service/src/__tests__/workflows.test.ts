import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../logger";
import { type BuiltServer, buildServer } from "../server";

const daemonToken = "test-daemon-token";
const extensionToken = "test-extension-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id:
			overrides.id ??
			`01HZX${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(21, "0")}`,
		action: overrides.action ?? "text",
		params: overrides.params ?? {},
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future use
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

describe("end-to-end workflows — GAP B", () => {
	describe("workflow: unbound session → session.bind → forwarded action", () => {
		it("full happy path: bind then succeed", async () => {
			const ws = await connectClient();

			// Set up message handler
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { text: "Hello from extension" },
					page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			// Without binding, text action should fail
			const textBefore = makeCmd({ action: "text" });
			const res1 = await postCommand(textBefore);
			const body1 = (await res1.json()) as BproxyResponse;
			expect(body1.ok).toBe(false);
			if (!body1.ok) expect(body1.error.code).toBe("TAB_NOT_FOUND");

			// Bind the session
			const bindCmd = makeCmd({ action: "session.bind", params: { tabId: 42 } });
			const bindRes = await postCommand(bindCmd);
			const bindBody = (await bindRes.json()) as BproxyResponse;
			expect(bindBody.ok).toBe(true);
			if (bindBody.ok) {
				const data = bindBody.data as { session: string };
				expect(data.session).toBe("default");
			}

			// Now text action should succeed
			const textAfter = makeCmd({ action: "text" });
			const res2 = await postCommand(textAfter);
			const body2 = (await res2.json()) as BproxyResponse;
			expect(body2.ok).toBe(true);
			if (body2.ok) {
				const data2 = body2.data as { text: string };
				expect(data2.text).toBe("Hello from extension");
			}

			ws.close();
		});

		it("chicken-and-egg: session.bind must work without pre-bound tab", async () => {
			// The session is created automatically but not bound
			const session = built.sessions.getOrCreate("workflow-test");
			expect(session.tabId).toBeNull();

			// session.bind should succeed
			const bindCmd = makeCmd({
				action: "session.bind",
				session: "workflow-test",
				params: { tabId: 100 },
			});
			const res = await postCommand(bindCmd);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			// Session should now be bound
			const after = built.sessions.getOrCreate("workflow-test");
			expect(after.tabId).toBe(100);
		});
	});

	describe("workflow: pause/resume", () => {
		it("pause blocks forwarded commands, resume allows them", async () => {
			built.sessions.bind("default", 42);
			const ws = await connectClient();

			// Set up handler that tracks calls
			let commandCount = 0;
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				commandCount++;
				const resp = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { count: commandCount },
					page: { url: "https://x", title: "X", state: "ready" as const, busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			// Start with normal operation
			const cmd1 = makeCmd({ action: "text" });
			const res1 = await postCommand(cmd1);
			const body1 = (await res1.json()) as BproxyResponse;
			expect(body1.ok).toBe(true);
			expect(commandCount).toBe(1);

			// Pause the session: the daemon must now refuse forwarded actions
			// without sending anything to the extension.
			built.sessions.pause("default", "captcha-check");

			const cmd2 = makeCmd({ action: "text" });
			const res2 = await postCommand(cmd2);
			const body2 = (await res2.json()) as BproxyResponse;
			expect(body2.ok).toBe(false);
			if (!body2.ok) expect(body2.error.code).toBe("HUMAN_REQUIRED");
			// The extension MUST NOT see the paused-session command.
			expect(commandCount).toBe(1);

			// Resume
			const resumeCmd = makeCmd({ action: "session.resume" });
			await postCommand(resumeCmd);

			// After resume, forwarded commands flow again.
			const cmd3 = makeCmd({ action: "text" });
			const res3 = await postCommand(cmd3);
			const body3 = (await res3.json()) as BproxyResponse;
			expect(body3.ok).toBe(true);
			expect(commandCount).toBe(2);

			ws.close();
		});

		it("forwarded HUMAN_REQUIRED response pauses the session in daemon state", async () => {
			built.sessions.bind("default", 42);
			const ws = await connectClient();

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: false,
					error: {
						code: "HUMAN_REQUIRED",
						category: "policy",
						retry: "never",
						message: "interstitial detected",
					},
				};
				ws.send(JSON.stringify(resp));
			});

			const cmd = makeCmd({ action: "text" });
			const res = await postCommand(cmd);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
			if (!body.ok) expect(body.error.code).toBe("HUMAN_REQUIRED");

			// Daemon must have flipped the session into paused state with the reason.
			const after = built.sessions.getOrCreate("default");
			expect(after.paused).toBe(true);
			expect(after.pauseReason).toBe("interstitial detected");

			ws.close();
		});
	});

	describe("workflow: tab reassignment", () => {
		it("rebinding session updates routing target", async () => {
			built.sessions.bind("default", 1);
			const ws = await connectClient();

			// Track which tab ID commands are sent for
			const receivedTabIds: number[] = [];
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const session = built.sessions.getOrCreate(req.session);
				if (session.tabId !== null) {
					receivedTabIds.push(session.tabId);
				}
				const resp: BproxyResponse = {
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: { tabId: session.tabId ?? -1 },
					page: { url: "https://x", title: "X", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			// First command goes to tab 1
			const cmd1 = makeCmd({ action: "text" });
			await postCommand(cmd1);

			// Rebind to tab 2
			const bindCmd = makeCmd({ action: "session.bind", params: { tabId: 2 } });
			await postCommand(bindCmd);

			// Second command should go to tab 2
			const cmd2 = makeCmd({ action: "text" });
			await postCommand(cmd2);

			// This captures a potential gap - does rebinding actually update the target?
			expect(receivedTabIds).toContain(2);

			ws.close();
		});
	});

	describe("workflow: pairing → connect → command", () => {
		it("full pairing flow: issue code, claim, connect WS, send command", async () => {
			// Step 1: Issue pairing code (would be done by daemon on start)
			const issue = built.pairing.issue();
			expect(issue.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

			// Step 2: Claim the code
			const claimRes = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: "chrome-extension://test" },
				body: JSON.stringify({ code: issue.code }),
			});
			expect(claimRes.status).toBe(200);
			const claimBody = (await claimRes.json()) as {
				ok: boolean;
				data: { extensionToken: string };
			};
			expect(claimBody.ok).toBe(true);

			// Step 3: Connect with the claimed token
			const newToken = claimBody.data.extensionToken;
			const auth = Buffer.from(newToken).toString("base64url");
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
				headers: { Origin: "chrome-extension://test" },
			});

			await new Promise<void>((resolve, reject) => {
				ws.once("open", () => resolve());
				ws.once("error", reject);
			});

			// Step 4: Bind and send command
			built.sessions.bind("default", 42);
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
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

			const cmd = makeCmd({ action: "text" });
			const res = await postCommand(cmd);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			ws.close();
		});
	});

	describe("workflow: boundary conditions", () => {
		it("handles session binding without specifying pacing (defaults to human)", async () => {
			const bindCmd = makeCmd({ action: "session.bind", params: { tabId: 42 } });
			const res = await postCommand(bindCmd);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			const session = built.sessions.getOrCreate("default");
			expect(session.pacing).toBe("human");
		});

		it("handles session binding with explicit pacing", async () => {
			const bindCmd = makeCmd({ action: "session.bind", params: { tabId: 42, pacing: "fast" } });
			const res = await postCommand(bindCmd);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);

			const session = built.sessions.getOrCreate("default");
			expect(session.pacing).toBe("fast");
		});
	});
});
