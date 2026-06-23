import {
	type BproxyErrorResponse,
	type BproxyRequest,
	type BproxyResponse,
	PROTOCOL_VERSION,
	type SessionId,
	type TabHandle,
} from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapturedLogger } from "../logger";
import type { BuiltServer } from "../server";
import {
	connectWsClient,
	setupTestServer,
	TEST_NICK,
	type TestServerContext,
	teardownTestServer,
} from "./helpers/integration";

const daemonToken = "test-deadline-token";
const extensionToken = "test-ext-token";

let ctx: TestServerContext;
let built: BuiltServer;
let port: number;
let captured: CapturedLogger;
let currentSession: BproxyRequest["session"];
let commandSequence = 0;
const T1 = "t1" as TabHandle;

function nextCommandId(): string {
	commandSequence += 1;
	return `dl-${commandSequence}`;
}

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: PROTOCOL_VERSION,
		id: overrides.id ?? nextCommandId(),
		action: overrides.action ?? "text",
		nick: overrides.nick ?? TEST_NICK,
		params: overrides.params ?? {},
		session: overrides.session ?? currentSession,
		deadline: overrides.deadline ?? Date.now() + 5000,
		destructive: false,
		...overrides,
	} as BproxyRequest;
}

async function postCommand(cmd: BproxyRequest, token = daemonToken): Promise<BproxyResponse> {
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(cmd),
	});
	return (await res.json()) as BproxyResponse;
}

function assertError(response: BproxyResponse): asserts response is BproxyErrorResponse {
	expect(response.ok).toBe(false);
}

beforeEach(async () => {
	commandSequence = 0;
	ctx = await setupTestServer({ daemonToken, extensionToken });
	({ built, port, captured, currentSession } = ctx);
});

afterEach(async () => {
	await teardownTestServer(ctx);
});

describe("deadline and timeout behaviour", () => {
	it("tab.open with no extension connected returns NO_EXTENSION", async () => {
		const cmd = makeCmd({
			id: "dl-no-ext-1",
			action: "tab.open",
			params: { url: "https://example.com" },
			session: "" as SessionId, // tab.open auto-creates
		});
		const response = await postCommand(cmd);
		assertError(response);
		expect(response.error.code).toBe("NO_EXTENSION");
		expect(response.error.category).toBe("transport");
		expect(response.error.retry).toBe("conditional");
		expect(response.error.message).toEqual(expect.any(String));
	});

	it("tab.open with hanging extension returns TIMEOUT", { timeout: 10000 }, async () => {
		built.sessions.bind(currentSession, 42);
		const ws = await connectWsClient(port, extensionToken);
		// Extension receives but never responds
		ws.on("message", () => {});

		const cmd = makeCmd({
			id: "dl-timeout-tabopen",
			action: "tab.open",
			params: { url: "https://example.com" },
			session: currentSession,
			deadline: Date.now() + 300,
		});
		const response = await postCommand(cmd);
		assertError(response);
		expect(response.error.code).toBe("TIMEOUT");
		expect(response.error.category).toBe("transport");

		ws.close();
	});

	it("dispatched action with no extension returns NO_EXTENSION immediately", async () => {
		built.sessions.bind(currentSession, 42);
		const cmd = makeCmd({ id: "dl-no-ext-dispatch", action: "text" });
		const response = await postCommand(cmd);
		assertError(response);
		expect(response.error.code).toBe("NO_EXTENSION");
	});

	it("malformed extension response causes timeout (not crash)", { timeout: 10000 }, async () => {
		built.sessions.bind(currentSession, 42);
		const ws = await connectWsClient(port, extensionToken);
		ws.on("message", () => {
			// Send garbage back
			ws.send("not valid json {{{");
		});

		const cmd = makeCmd({
			id: "dl-malformed-1",
			action: "text",
			deadline: Date.now() + 400,
		});
		const response = await postCommand(cmd);
		assertError(response);
		expect(response.error.code).toBe("TIMEOUT");

		ws.close();
	});
});

describe("BproxyError envelope completeness", () => {
	const requiredFields = ["code", "category", "retry", "message"] as const;

	function assertCompleteEnvelope(
		response: BproxyResponse,
	): asserts response is BproxyErrorResponse {
		expect(response.ok).toBe(false);
		if (!response.ok) {
			for (const field of requiredFields) {
				expect(response.error[field]).toEqual(expect.any(String));
				expect(response.error[field].length).toBeGreaterThan(0);
			}
		}
	}

	it("SESSION_REQUIRED — missing session on non-exempt action", async () => {
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({ id: "env-sr", action: "text", session: "" as SessionId });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("SESSION_REQUIRED");
		ws.close();
	});

	it("INVALID_SESSION_ID — malformed session format", async () => {
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({ id: "env-inv", action: "text", session: "INVALID!" as SessionId });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("INVALID_SESSION_ID");
		ws.close();
	});

	it("SESSION_NOT_FOUND — non-existent session", async () => {
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({ id: "env-snf", action: "text", session: "zz7zz7" as SessionId });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("SESSION_NOT_FOUND");
		ws.close();
	});

	it("TAB_NOT_FOUND — no bound tab", async () => {
		const ws = await connectWsClient(port, extensionToken);
		ws.on("message", () => {}); // hang to avoid timeout race
		const cmd = makeCmd({ id: "env-tnf", action: "text" });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("TAB_NOT_FOUND");
		ws.close();
	});

	it("TAB_HANDLE_NOT_FOUND — non-existent tab handle in tab.close", async () => {
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({
			id: "env-thnf",
			action: "tab.close",
			params: { tab: "t99" as unknown as TabHandle },
		});
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("TAB_HANDLE_NOT_FOUND");
		ws.close();
	});

	it("TAB_NOT_IN_SESSION — tab from another session", async () => {
		const otherSession = built.sessions.create(TEST_NICK).id;
		built.sessions.registerTab(otherSession, 999);
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({
			id: "env-tnis",
			action: "tab.close",
			params: { tab: T1 },
		});
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("TAB_NOT_IN_SESSION");
		ws.close();
	});

	it("HUMAN_REQUIRED — paused session", async () => {
		built.sessions.bind(currentSession, 42);
		built.sessions.pause(currentSession, "CAPTCHAdetected");
		const ws = await connectWsClient(port, extensionToken);
		const cmd = makeCmd({ id: "env-hr", action: "text" });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("HUMAN_REQUIRED");
		ws.close();
	});

	it("NO_EXTENSION — no WS client connected", async () => {
		built.sessions.bind(currentSession, 42);
		const cmd = makeCmd({ id: "env-noext", action: "text" });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("NO_EXTENSION");
	});

	it("TIMEOUT — deadline exceeded", { timeout: 10000 }, async () => {
		built.sessions.bind(currentSession, 42);
		const ws = await connectWsClient(port, extensionToken);
		ws.on("message", () => {}); // hang
		const cmd = makeCmd({ id: "env-to", action: "text", deadline: Date.now() + 300 });
		const response = await postCommand(cmd);
		assertCompleteEnvelope(response);
		expect(response.error.code).toBe("TIMEOUT");
		ws.close();
	});
});

describe("lifecycle log events for session-local and tab-mediated actions", () => {
	it("session.create emits received + response with id, no forwarded", async () => {
		captured.clear();
		const cmd = makeCmd({ id: "log-sc-1", action: "session.create", params: {} });
		await postCommand(cmd);

		const events = captured.lines.filter((l) => l["id"] === cmd.id);
		const names = events.map((l) => l["event"]);
		expect(names).toContain("received");
		expect(names).toContain("response");
		expect(names).not.toContain("forwarded");

		const response = events.find((l) => l["event"] === "response");
		expect(response).toMatchObject({ id: cmd.id, ok: true });
	});

	it("tab.list emits received + response with id, no forwarded", async () => {
		captured.clear();
		const cmd = makeCmd({ id: "log-tl-1", action: "tab.list", params: {} });
		await postCommand(cmd);

		const events = captured.lines.filter((l) => l["id"] === cmd.id);
		const names = events.map((l) => l["event"]);
		expect(names).toContain("received");
		expect(names).toContain("response");
		expect(names).not.toContain("forwarded");
	});

	it("tab.open emits received + forwarded (tab: null) + response", async () => {
		captured.clear();
		const ws = await connectWsClient(port, extensionToken);
		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as BproxyRequest;
			const resp = {
				protocol_version: PROTOCOL_VERSION,
				id: req.id,
				ok: true,
				data: { tabId: 100, url: "https://example.com" },
				page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
				replay: false,
			};
			ws.send(JSON.stringify(resp));
		});

		const cmd = makeCmd({
			id: "log-to-1",
			action: "tab.open",
			params: { url: "https://example.com" },
		});
		await postCommand(cmd);

		const events = captured.lines.filter((l) => l["id"] === cmd.id);
		const names = events.map((l) => l["event"]);
		expect(names).toContain("received");
		expect(names).toContain("forwarded");
		expect(names).toContain("response");

		const forwarded = events.find((l) => l["event"] === "forwarded");
		expect(forwarded).toMatchObject({ tab: null });

		ws.close();
	});

	it("session.close emits received + response; sub-requests emit forwarded", async () => {
		built.sessions.registerTab(currentSession, 55, { bind: true });
		captured.clear();
		const ws = await connectWsClient(port, extensionToken);
		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as BproxyRequest;
			const resp = {
				protocol_version: PROTOCOL_VERSION,
				id: req.id,
				ok: true,
				data: { tab: "t1", closed: true },
				page: { url: "", title: "", state: "ready", busy: false },
				replay: false,
			};
			ws.send(JSON.stringify(resp));
		});

		const cmd = makeCmd({ id: "log-sclose-1", action: "session.close", params: {} });
		await postCommand(cmd);

		// The main command should have received + response
		const mainEvents = captured.lines.filter((l) => l["id"] === cmd.id);
		const mainNames = mainEvents.map((l) => l["event"]);
		expect(mainNames).toContain("received");
		expect(mainNames).toContain("response");

		// Sub-request tab.close should have forwarded
		const subEvents = captured.lines.filter(
			(l) => typeof l["id"] === "string" && l["id"].startsWith(`${cmd.id}:close:`),
		);
		const subForwarded = subEvents.filter((l) => l["event"] === "forwarded");
		expect(subForwarded.length).toBeGreaterThanOrEqual(1);

		ws.close();
	});
});

describe("debug.last traces ring buffer", () => {
	it("debug.last returns traces from commands executed in this session", async () => {
		// Execute a session.create to produce a trace entry
		const createCmd = makeCmd({ id: "trace-create-1", action: "session.create", params: {} });
		await postCommand(createCmd);

		// Now query debug.last
		const debugCmd = makeCmd({ id: "trace-debug-1", action: "debug.last", params: {} });
		const response = await postCommand(debugCmd);
		expect(response.ok).toBe(true);
		if (!response.ok) return;

		const data = response.data as unknown as { requests: Array<Record<string, unknown>> };
		expect(data.requests.length).toBeGreaterThanOrEqual(1);

		// Find our create trace
		const createTrace = data.requests.find((r) => r["id"] === "trace-create-1");
		expect(createTrace).toMatchObject({
			id: "trace-create-1",
			action: "session.create",
			ok: true,
			elapsedMs: expect.any(Number),
			receivedAt: expect.any(Number),
		});
	});
});

describe("debug.status does not leak raw Chrome tab ids", () => {
	it("response contains no chromeTabId or numeric tabId fields", async () => {
		built.sessions.registerTab(currentSession, 777, { url: "https://x.com", bind: true });

		const cmd = makeCmd({ id: "debug-leak-1", action: "debug.status", params: {} });
		const response = await postCommand(cmd);
		expect(response.ok).toBe(true);
		if (!response.ok) return;

		const json = JSON.stringify(response.data);
		expect(json).not.toContain("chromeTabId");
		expect(json).not.toContain('"tabId"');
		// The raw Chrome id value 777 should not appear as a standalone number
		// in the response (it could appear as part of port/uptime, so check
		// specifically in session/tab context)
		const data = response.data as unknown as {
			sessionTabs: Array<{ tabs: Array<Record<string, unknown>> }>;
		};
		for (const st of data.sessionTabs) {
			for (const tab of st.tabs) {
				expect(tab).not.toHaveProperty("chromeTabId");
				expect(tab).not.toHaveProperty("tabId");
			}
		}
	});
});
