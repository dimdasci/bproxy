import type { BproxyRequest, BproxyResponse, TabHandle } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapturedLogger } from "../logger";
import { computeOwnerHash } from "../owner-hash";
import type { BuiltServer } from "../server";
import {
	connectWsClient,
	setupTestServer,
	TEST_NICK,
	type TestServerContext,
	teardownTestServer,
} from "./helpers/integration";

const daemonToken = "test-nick-token";
const extensionToken = "test-ext-token";
const OTHER_NICK = "bobcat" as BproxyRequest["nick"];
const T1 = "t1" as TabHandle;
const SALT = new Uint8Array(32).fill(7);

let ctx: TestServerContext;
let built: BuiltServer;
let port: number;
let captured: CapturedLogger;
let currentSession: BproxyRequest["session"];

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `nick-${crypto.randomUUID().slice(0, 8)}`,
		action: overrides.action ?? "session.list",
		nick: overrides.nick ?? TEST_NICK,
		params: overrides.params ?? {},
		session: overrides.session ?? currentSession,
		deadline: overrides.deadline ?? Date.now() + 5000,
		destructive: false,
		...overrides,
	};
}

async function postCommand(cmd: BproxyRequest): Promise<BproxyResponse> {
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${daemonToken}` },
		body: JSON.stringify(cmd),
	});
	return (await res.json()) as BproxyResponse;
}

beforeEach(async () => {
	ctx = await setupTestServer({ daemonToken, extensionToken, instanceSalt: SALT });
	({ built, port, captured, currentSession } = ctx);
});

afterEach(async () => {
	await teardownTestServer(ctx);
});

describe("nick scoping", () => {
	it("filters session.list and debug.status by owner nick", async () => {
		const halbotSession2 = built.sessions.create(TEST_NICK).id;
		const bobcatSession = built.sessions.create(OTHER_NICK).id;
		built.sessions.registerTab(currentSession, 42, { bind: true, url: "https://own.test/1" });
		built.sessions.registerTab(halbotSession2, 43, { bind: true, url: "https://own.test/2" });
		built.sessions.registerTab(bobcatSession, 99, { bind: true, url: "https://other.test/" });
		built.sessions.pause(currentSession, "captcha-own");
		built.sessions.pause(bobcatSession, "captcha-other");

		const listed = (await postCommand(
			makeCmd({ action: "session.list", params: {} }),
		)) as BproxyResponse<"session.list">;
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.data.sessions.map((session) => session.id).sort()).toEqual(
			[currentSession, halbotSession2].sort(),
		);

		const status = (await postCommand(
			makeCmd({ action: "debug.status", params: {} }),
		)) as BproxyResponse<"debug.status">;
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.sessions.map((session) => session.id).sort()).toEqual(
			[currentSession, halbotSession2].sort(),
		);
		expect(status.data.sessionTabs.map((entry) => entry.session).sort()).toEqual(
			[currentSession, halbotSession2].sort(),
		);
		expect(status.data.pausedSessions).toEqual([
			{ session: currentSession, reason: "captcha-own" },
		]);
	});

	it("returns SESSION_SCOPE_MISMATCH for a foreign live session", async () => {
		const foreignSession = built.sessions.create(OTHER_NICK).id;
		const response = await postCommand(
			makeCmd({ action: "text", session: foreignSession, nick: TEST_NICK }),
		);
		expect(response).toMatchObject({ ok: false, error: { code: "SESSION_SCOPE_MISMATCH" } });
		if (!response.ok) {
			expect(response.error.retry).toBe("never");
			expect(response.error.suggestedAction).toContain("--nick");
		}
	});

	it("filters debug.last to live sessions owned by the requesting nick", async () => {
		const foreignSession = built.sessions.create(OTHER_NICK).id;
		built.sessions.registerTab(currentSession, 42);
		built.sessions.registerTab(foreignSession, 99);

		const ownBind = await postCommand(
			makeCmd({ id: "trace-own", action: "session.bind", params: { tab: T1 } }),
		);
		expect(ownBind.ok).toBe(true);

		const foreignBind = await postCommand(
			makeCmd({
				id: "trace-foreign",
				action: "session.bind",
				nick: OTHER_NICK,
				session: foreignSession,
				params: { tab: T1 },
			}),
		);
		expect(foreignBind.ok).toBe(true);

		const live = (await postCommand(
			makeCmd({ action: "debug.last", params: { count: 10 } }),
		)) as BproxyResponse<"debug.last">;
		expect(live.ok).toBe(true);
		if (!live.ok) return;
		expect(live.data.requests.map((trace) => trace.id)).toContain("trace-own");
		expect(live.data.requests.map((trace) => trace.id)).not.toContain("trace-foreign");

		built.sessions.close(currentSession);
		const afterClose = (await postCommand(
			makeCmd({ action: "debug.last", params: { count: 10 } }),
		)) as BproxyResponse<"debug.last">;
		expect(afterClose.ok).toBe(true);
		if (!afterClose.ok) return;
		expect(afterClose.data.requests.map((trace) => trace.id)).not.toContain("trace-own");
	});

	it("filters debug.log by live session owner and excludes entries without session metadata", async () => {
		const foreignSession = built.sessions.create(OTHER_NICK).id;
		const closedSession = built.sessions.create(TEST_NICK).id;
		built.sessions.close(closedSession);
		built.sessions.bind(currentSession, 42);
		const ws = await connectWsClient(port, extensionToken);

		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as BproxyRequest;
			if (req.action !== "debug.log") return;
			ws.send(
				JSON.stringify({
					protocol_version: 1,
					id: req.id,
					ok: true,
					data: {
						entries: [
							{
								id: "own",
								action: "text",
								session: currentSession,
								tab: 42,
								timestamp: 1,
								elapsed: 2,
								result: "ok",
								replay: false,
								extensionVersion: "1",
							},
							{
								id: "foreign",
								action: "text",
								session: foreignSession,
								tab: 99,
								timestamp: 1,
								elapsed: 2,
								result: "ok",
								replay: false,
								extensionVersion: "1",
							},
							{
								id: "closed",
								action: "text",
								session: closedSession,
								tab: 77,
								timestamp: 1,
								elapsed: 2,
								result: "ok",
								replay: false,
								extensionVersion: "1",
							},
							{
								id: "legacy",
								action: "text",
								tab: 42,
								timestamp: 1,
								elapsed: 2,
								result: "ok",
								replay: false,
								extensionVersion: "1",
							},
						],
					},
					page: { url: "", title: "", state: "ready", busy: false },
					replay: false,
				}),
			);
		});

		const response = (await postCommand(
			makeCmd({ action: "debug.log", params: {}, destructive: false }),
		)) as BproxyResponse<"debug.log">;
		expect(response.ok).toBe(true);
		if (!response.ok) return;
		expect(response.data.entries.map((entry) => entry.id)).toEqual(["own"]);
		ws.close();
	});

	it("returns ownerHash in bootstrap responses, strips nick from WS messages, and logs ownerHash only", async () => {
		const expectedHash = computeOwnerHash(SALT, TEST_NICK);

		captured.clear();
		const created = (await postCommand(
			makeCmd({ action: "session.create", params: { label: "research" } }),
		)) as BproxyResponse<"session.create">;
		expect(created.ok).toBe(true);
		if (created.ok) {
			expect(created.data.ownerHash).toBe(expectedHash);
		}
		const sessionLogs = captured.lines.filter((line) => line["id"] === created.id);
		for (const line of sessionLogs) {
			expect(line["ownerHash"]).toBe(expectedHash);
			expect(Object.hasOwn(line, "nick")).toBe(false);
		}

		const ws = await connectWsClient(port, extensionToken);
		let forwardedHasNick = true;
		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as Record<string, unknown>;
			forwardedHasNick = Object.hasOwn(req, "nick");
			ws.send(
				JSON.stringify({
					protocol_version: 1,
					id: req["id"],
					ok: true,
					data: { tabId: 42, url: "https://example.com" },
					page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
					replay: false,
				}),
			);
		});

		const opened = (await postCommand(
			makeCmd({ action: "tab.open", params: { url: "https://example.com" }, session: "" as never }),
		)) as BproxyResponse<"tab.open">;
		expect(opened.ok).toBe(true);
		if (opened.ok) {
			expect(opened.data.ownerHash).toBe(expectedHash);
		}
		expect(forwardedHasNick).toBe(false);
		ws.close();
	});
});
