import type { Action, BproxyRequest, BproxyResponse, TabHandle } from "@bproxy/shared";
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

const PARAMS_BY_ACTION: Partial<Record<Action, BproxyRequest["params"]>> = {
	navigate: { url: "https://example.com" },
	links: {},
	click: { target: { selector: "button.dismiss" } },
	hover: { target: { selector: "button.menu" } },
	fill: {
		target: { selector: "#email" },
		value: "x@example.com",
		method: "paste",
		world: "isolated",
	},
	"fill-form": {
		fields: [
			{
				target: { selector: "#email" },
				value: "x@example.com",
				method: "paste",
				world: "isolated",
			},
		],
	},
	select: { trigger: { selector: "#country" }, optionText: "USA" },
	wait: { strategy: "selector", target: "#ready" },
	"require-human": { reason: "captcha" },
	"tab.open": { url: "https://example.com" },
};

function paramsFor(action: Action): BproxyRequest["params"] {
	return PARAMS_BY_ACTION[action] ?? {};
}

function makeCmd(action: Action, overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id:
			overrides.id ?? `01HZX${crypto.randomUUID().replaceAll("-", "").slice(0, 21).toUpperCase()}`,
		action,
		nick: overrides.nick ?? TEST_NICK,
		params: paramsFor(action),
		session: overrides.session ?? currentSession,
		deadline: Date.now() + 5000,
		destructive: false,
		...overrides,
	};
}

async function postCommand(cmd: BproxyRequest): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${daemonToken}` },
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

describe("action contract coverage — GAP A", () => {
	describe("daemon-local actions", () => {
		it("debug.last succeeds without WS client", async () => {
			const res = await postCommand(makeCmd("debug.last"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
		});

		it("debug.status succeeds without WS client", async () => {
			const res = await postCommand(makeCmd("debug.status"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
		});

		it("session.create returns a generated session id", async () => {
			const res = await postCommand(
				makeCmd("session.create", {
					params: { label: "research" },
					session: currentSession,
				}),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse<"session.create">;
			if (!body.ok) throw new Error("session.create should succeed");
			expect(body.data.session).toMatch(/^[a-z2-7]{6}$/);
			expect(body.data.label).toBe("research");
		});

		it("session.create succeeds without a label", async () => {
			const res = await postCommand(
				makeCmd("session.create", { params: {}, session: currentSession }),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse<"session.create">;
			if (!body.ok) throw new Error("session.create should succeed");
			expect(body.data.session).toMatch(/^[a-z2-7]{6}$/);
			expect(body.data.label).toBeUndefined();
		});

		it("session.list succeeds without WS client", async () => {
			const res = await postCommand(makeCmd("session.list"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse<"session.list">;
			expect(body.ok).toBe(true);
			if (body.ok) expect(Array.isArray(body.data.sessions)).toBe(true);
		});

		it("session.bind binds an existing logical tab and updates pacing", async () => {
			built.sessions.registerTab(currentSession, 42);
			const res = await postCommand(
				makeCmd("session.bind", { params: { tab: T1, pacing: "fast" } }),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse<"session.bind">;
			expect(body.ok).toBe(true);
			expect(built.sessions.get(currentSession)).toMatchObject({ tab: "t1", pacing: "fast" });
		});

		it("session.unbind clears the logical binding (idempotent)", async () => {
			built.sessions.bind(currentSession, 99);
			await postCommand(makeCmd("session.unbind"));
			expect(built.sessions.get(currentSession)?.tab).toBeNull();
			await postCommand(makeCmd("session.unbind"));
			expect(built.sessions.get(currentSession)?.tab).toBeNull();
		});

		it("session.resume clears paused state", async () => {
			built.sessions.pause(currentSession, "captcha");
			await postCommand(makeCmd("session.resume"));
			expect(built.sessions.get(currentSession)?.paused).toBe(false);
		});
	});

	describe("forwarded actions preconditions", () => {
		const forwardedActions: Action[] = [
			"navigate",
			"text",
			"links",
			"images",
			"elements",
			"outline",
			"dom",
			"scroll",
			"click",
			"hover",
			"screenshot",
			"fill",
			"fill-form",
			"select",
			"wait",
			"require-human",
			"debug.log",
		];

		for (const action of forwardedActions) {
			it(`${action}: returns NO_EXTENSION when no WS client is connected`, async () => {
				const res = await postCommand(makeCmd(action));
				expect(res.status).toBe(200);
				const body = (await res.json()) as BproxyResponse;
				expect(body.ok).toBe(false);
				if (!body.ok) expect(body.error.code).toBe("NO_EXTENSION");
			});
		}

		for (const action of forwardedActions) {
			it(`${action}: returns TAB_NOT_FOUND when WS exists but session is unbound`, async () => {
				const ws = await connectWsClient(port, extensionToken);
				const res = await postCommand(makeCmd(action));
				expect(res.status).toBe(200);
				const body = (await res.json()) as BproxyResponse;
				expect(body.ok).toBe(false);
				if (!body.ok) expect(body.error.code).toBe("TAB_NOT_FOUND");
				ws.close();
			});
		}

		it("tab.list succeeds without a WS client and stays session-scoped", async () => {
			built.sessions.registerTab(currentSession, 42, { url: "https://owned.test/", bind: true });
			const res = await postCommand(makeCmd("tab.list"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse<"tab.list">;
			expect(body.ok).toBe(true);
			if (body.ok) {
				expect(body.data.session).toBe(currentSession);
				expect(body.data.tabs).toMatchObject([
					{ tab: "t1", url: "https://owned.test/", bound: true },
				]);
			}
		});

		it("tab.open returns NO_EXTENSION without a WS client but does not leak an auto-created session", async () => {
			const before = built.sessions.list().length;
			const res = await postCommand(makeCmd("tab.open", { session: "" as never }));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(false);
			if (!body.ok) expect(body.error.code).toBe("NO_EXTENSION");
			expect(built.sessions.list()).toHaveLength(before);
		});

		for (const action of ["tab.pin", "tab.unpin", "tab.close", "tab.activate"] as const) {
			it(`${action}: returns TAB_NOT_FOUND without a selected tab even before WS forwarding`, async () => {
				const res = await postCommand(makeCmd(action));
				expect(res.status).toBe(200);
				const body = (await res.json()) as BproxyResponse;
				expect(body.ok).toBe(false);
				if (!body.ok) expect(body.error.code).toBe("TAB_NOT_FOUND");
			});
		}
	});

	it("debug.log is forwarded to extension (not daemon-local)", async () => {
		built.sessions.bind(currentSession, 42);
		const ws = await connectWsClient(port, extensionToken);

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

		const res = await postCommand(makeCmd("debug.log"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		expect(body.ok).toBe(true);
		expect(receivedAction).toBe("debug.log");
		ws.close();
	});
});
