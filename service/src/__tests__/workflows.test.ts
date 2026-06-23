import {
	type BproxyRequest,
	type BproxyResponse,
	PROTOCOL_VERSION,
	type TabHandle,
} from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuiltServer } from "../server";
import {
	connectWsClient,
	setupTestServer,
	TEST_NICK,
	type TestServerContext,
	teardownTestServer,
} from "./helpers/integration";

const daemonToken = "test-daemon-token";
const extensionToken = "test-extension-token";

let ctx: TestServerContext;
let built: BuiltServer;
let port: number;
let currentSession: BproxyRequest["session"];
const T1 = "t1" as TabHandle;

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: PROTOCOL_VERSION,
		id:
			overrides.id ?? `01HZX${crypto.randomUUID().replaceAll("-", "").slice(0, 21).toUpperCase()}`,
		action: overrides.action ?? "text",
		nick: overrides.nick ?? TEST_NICK,
		params: overrides.params ?? {},
		session: overrides.session ?? currentSession,
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

beforeEach(async () => {
	ctx = await setupTestServer({ daemonToken, extensionToken });
	({ built, port, currentSession } = ctx);
});

afterEach(async () => {
	await teardownTestServer(ctx);
});

describe("end-to-end workflows — Phase 5 task 3", () => {
	describe("session validation", () => {
		it("rejects malformed session ids for browser-control actions", async () => {
			const res = await postCommand(
				makeCmd({ action: "text", session: "default" as BproxyRequest["session"] }),
			);
			const body = (await res.json()) as BproxyResponse;
			expect(body).toMatchObject({ ok: false, error: { code: "INVALID_SESSION_ID" } });
		});

		it("rejects unknown but well-formed session ids", async () => {
			const res = await postCommand(
				makeCmd({ action: "text", session: "zzzzzz" as BproxyRequest["session"] }),
			);
			const body = (await res.json()) as BproxyResponse;
			expect(body).toMatchObject({ ok: false, error: { code: "SESSION_NOT_FOUND" } });
		});
	});

	describe("workflow: fresh tab bootstrap", () => {
		it("tab.open succeeds on a fresh paired daemon without a pre-bound tab", async () => {
			const ws = await connectWsClient(port, extensionToken);
			let forwardedTarget: number | null = 123;

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest & {
					target?: { tabId: number | null };
				};
				forwardedTarget = req.target?.tabId ?? null;
				ws.send(
					JSON.stringify({
						protocol_version: PROTOCOL_VERSION,
						id: req.id,
						ok: true,
						data: { tabId: 42, url: "https://google.com" },
						page: {
							url: "https://google.com",
							title: "Google",
							state: "ready",
							busy: false,
						},
						replay: false,
					}),
				);
			});

			const res = await postCommand(
				makeCmd({
					action: "tab.open",
					params: { url: "https://google.com" },
					session: "" as never,
				}),
			);
			const body = (await res.json()) as BproxyResponse<"tab.open">;
			expect(body.ok).toBe(true);
			if (body.ok) {
				expect(body.data.session).toMatch(/^[a-z2-7]{6}$/);
				expect(body.data.tab).toBe("t1");
				expect(body.data.bound).toBe(true);
				expect(body.data.url).toBe("https://google.com");
				expect(built.sessions.get(body.data.session)).toMatchObject({ tab: "t1" });
				expect(built.sessions.listTabs(body.data.session)).toMatchObject([
					{ tab: "t1", url: "https://google.com", title: "Google", bound: true },
				]);
			}
			expect(forwardedTarget).toBeNull();
			ws.close();
		});

		it("tab.open on an existing session registers t2 and binds it", async () => {
			const ws = await connectWsClient(port, extensionToken);
			const openedUrls: string[] = [];
			let nextTabId = 42;

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest & {
					target?: { tabId: number | null };
				};
				expect(req.target?.tabId).toBeNull();
				openedUrls.push((req.params as { url: string }).url);
				ws.send(
					JSON.stringify({
						protocol_version: PROTOCOL_VERSION,
						id: req.id,
						ok: true,
						data: { tabId: nextTabId++, url: (req.params as { url: string }).url },
						page: {
							url: (req.params as { url: string }).url,
							title: `Opened ${openedUrls.length}`,
							state: "ready",
							busy: false,
						},
						replay: false,
					}),
				);
			});

			const first = (await (
				await postCommand(
					makeCmd({
						action: "tab.open",
						params: { url: "https://one.test" },
						session: currentSession,
					}),
				)
			).json()) as BproxyResponse<"tab.open">;
			expect(first.ok).toBe(true);
			if (!first.ok) throw new Error("first tab.open should succeed");
			expect(first.data.tab).toBe("t1");

			const second = (await (
				await postCommand(
					makeCmd({
						action: "tab.open",
						params: { url: "https://two.test" },
						session: currentSession,
					}),
				)
			).json()) as BproxyResponse<"tab.open">;
			expect(second.ok).toBe(true);
			if (!second.ok) throw new Error("second tab.open should succeed");
			expect(second.data.session).toBe(currentSession);
			expect(second.data.tab).toBe("t2");
			expect(second.data.bound).toBe(true);
			expect(built.sessions.get(currentSession)).toMatchObject({ tab: "t2" });
			expect(built.sessions.listTabs(currentSession)).toMatchObject([
				{ tab: "t1", url: "https://one.test", title: "Opened 1", bound: false },
				{ tab: "t2", url: "https://two.test", title: "Opened 2", bound: true },
			]);
			expect(openedUrls).toEqual(["https://one.test", "https://two.test"]);
			ws.close();
		});
	});

	describe("workflow: logical tab binding", () => {
		it("session.bind moves to a session-owned logical tab and forwarded actions succeed", async () => {
			built.sessions.registerTab(currentSession, 42);
			const ws = await connectWsClient(port, extensionToken);

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				const resp: BproxyResponse = {
					protocol_version: PROTOCOL_VERSION,
					id: req.id,
					ok: true,
					data: { text: "Hello from extension" },
					page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
					replay: false,
				};
				ws.send(JSON.stringify(resp));
			});

			const bindRes = await postCommand(
				makeCmd({ action: "session.bind", params: { tab: T1, pacing: "fast" } }),
			);
			const bindBody = (await bindRes.json()) as BproxyResponse<"session.bind">;
			expect(bindBody.ok).toBe(true);
			expect(built.sessions.get(currentSession)).toMatchObject({ tab: "t1", pacing: "fast" });

			const textRes = await postCommand(makeCmd({ action: "text" }));
			const textBody = (await textRes.json()) as BproxyResponse<"text">;
			expect(textBody.ok).toBe(true);
			if (textBody.ok) expect(textBody.data.text).toBe("Hello from extension");

			ws.close();
		});

		it("rejects logical handles owned by another session", async () => {
			const otherSession = built.sessions.create(TEST_NICK).id;
			built.sessions.registerTab(currentSession, 42);
			const res = await postCommand(
				makeCmd({
					action: "session.bind",
					session: otherSession,
					params: { tab: T1 },
				}),
			);
			const body = (await res.json()) as BproxyResponse;
			expect(body).toMatchObject({ ok: false, error: { code: "TAB_NOT_IN_SESSION" } });
		});
	});

	describe("workflow: pause/resume", () => {
		it("pause blocks forwarded commands, resume allows them", async () => {
			built.sessions.bind(currentSession, 42);
			const ws = await connectWsClient(port, extensionToken);

			let commandCount = 0;
			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				commandCount += 1;
				const resp = {
					protocol_version: PROTOCOL_VERSION,
					id: req.id,
					ok: true,
					data: { count: commandCount },
					page: { url: "https://x", title: "X", state: "ready", busy: false },
					replay: false,
				} as unknown as BproxyResponse;
				ws.send(JSON.stringify(resp));
			});

			const res1 = await postCommand(makeCmd({ action: "text" }));
			const body1 = (await res1.json()) as BproxyResponse;
			expect(body1.ok).toBe(true);
			expect(commandCount).toBe(1);

			built.sessions.pause(currentSession, "captcha-check");
			const res2 = await postCommand(makeCmd({ action: "text" }));
			const body2 = (await res2.json()) as BproxyResponse;
			expect(body2).toMatchObject({ ok: false, error: { code: "HUMAN_REQUIRED" } });
			expect(commandCount).toBe(1);

			await postCommand(makeCmd({ action: "session.resume" }));
			const res3 = await postCommand(makeCmd({ action: "text" }));
			const body3 = (await res3.json()) as BproxyResponse;
			expect(body3.ok).toBe(true);
			expect(commandCount).toBe(2);

			ws.close();
		});
	});

	describe("workflow: session close", () => {
		it("session.close closes all session-owned tabs and removes the session", async () => {
			built.sessions.bind(currentSession, 42);
			built.sessions.bind(currentSession, 99);
			const ws = await connectWsClient(port, extensionToken);
			const closedTargets: number[] = [];

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest & { target?: { tabId: number } };
				if (req.action === "tab.close") {
					closedTargets.push(req.target?.tabId ?? -1);
					const resp = {
						protocol_version: PROTOCOL_VERSION,
						id: req.id,
						ok: true,
						data: { tab: T1, closed: true },
						page: { url: "", title: "", state: "ready", busy: false },
						replay: false,
					} as unknown as BproxyResponse;
					ws.send(JSON.stringify(resp));
				}
			});

			const res = await postCommand(makeCmd({ action: "session.close", params: {} }));
			const body = (await res.json()) as BproxyResponse<"session.close">;
			expect(body.ok).toBe(true);
			if (body.ok) expect(body.data.closedTabs).toBe(2);
			expect(closedTargets).toEqual([42, 99]);
			expect(built.sessions.get(currentSession)).toBeNull();

			ws.close();
		});

		it("session.close is best-effort and still releases daemon state when no extension is connected", async () => {
			built.sessions.bind(currentSession, 42);
			built.sessions.bind(currentSession, 99);

			const res = await postCommand(makeCmd({ action: "session.close", params: {} }));
			const body = (await res.json()) as BproxyResponse<"session.close">;
			expect(body.ok).toBe(true);
			if (body.ok) expect(body.data.closedTabs).toBe(2);
			expect(built.sessions.get(currentSession)).toBeNull();
		});

		it("session.close treats TAB_NOT_FOUND during the close loop as best-effort cleanup", async () => {
			built.sessions.bind(currentSession, 42);
			built.sessions.bind(currentSession, 99);
			const ws = await connectWsClient(port, extensionToken);
			const responses: Array<true | "TAB_NOT_FOUND"> = [true, "TAB_NOT_FOUND"];

			ws.on("message", (raw: unknown) => {
				const req = JSON.parse(String(raw)) as BproxyRequest;
				if (req.action !== "tab.close") return;
				const next = responses.shift();
				if (next === true) {
					ws.send(
						JSON.stringify({
							protocol_version: PROTOCOL_VERSION,
							id: req.id,
							ok: true,
							data: { tab: T1, closed: true },
							page: { url: "", title: "", state: "ready", busy: false },
							replay: false,
						} as unknown as BproxyResponse),
					);
					return;
				}
				ws.send(
					JSON.stringify({
						protocol_version: PROTOCOL_VERSION,
						id: req.id,
						ok: false,
						error: {
							code: "TAB_NOT_FOUND",
							category: "target",
							retry: "conditional",
							message: "Target tab 99 was not found",
						},
					} satisfies BproxyResponse),
				);
			});

			const res = await postCommand(makeCmd({ action: "session.close", params: {} }));
			const body = (await res.json()) as BproxyResponse<"session.close">;
			expect(body.ok).toBe(true);
			if (body.ok) expect(body.data.closedTabs).toBe(2);
			expect(built.sessions.get(currentSession)).toBeNull();
			ws.close();
		});

		it("a second session.close returns SESSION_NOT_FOUND", async () => {
			built.sessions.bind(currentSession, 42);
			const res1 = await postCommand(makeCmd({ action: "session.close", params: {} }));
			const body1 = (await res1.json()) as BproxyResponse<"session.close">;
			expect(body1.ok).toBe(true);

			const res2 = await postCommand(makeCmd({ action: "session.close", params: {} }));
			const body2 = (await res2.json()) as BproxyResponse;
			expect(body2).toMatchObject({ ok: false, error: { code: "SESSION_NOT_FOUND" } });
		});
	});
});
