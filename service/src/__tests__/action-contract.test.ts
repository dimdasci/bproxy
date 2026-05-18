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

const PARAMS_BY_ACTION: Partial<Record<Action, BproxyRequest["params"]>> = {
	navigate: { url: "https://example.com" },
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
	eval: { code: "1+1" },
	"tab.open": { url: "https://example.com" },
};

function paramsFor(action: Action): BproxyRequest["params"] {
	return PARAMS_BY_ACTION[action] ?? {};
}

function makeCmd(action: Action, overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id:
			overrides.id ??
			`01HZX${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(21, "0")}`,
		action,
		params: paramsFor(action),
		session: overrides.session ?? "default",
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

		it("session.list succeeds without WS client", async () => {
			const res = await postCommand(makeCmd("session.list"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
			if (body.ok) {
				const data = body.data as { sessions: unknown[] };
				expect(Array.isArray(data.sessions)).toBe(true);
			}
		});

		it("session.bind works from unbound session and updates pacing", async () => {
			const res = await postCommand(
				makeCmd("session.bind", { session: "s1", params: { tabId: 42, pacing: "fast" } }),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as BproxyResponse;
			expect(body.ok).toBe(true);
			expect(built.sessions.getOrCreate("s1").tabId).toBe(42);
			expect(built.sessions.getOrCreate("s1").pacing).toBe("fast");
		});

		it("session.unbind clears tabId (idempotent)", async () => {
			built.sessions.bind("default", 99);
			await postCommand(makeCmd("session.unbind"));
			expect(built.sessions.getOrCreate("default").tabId).toBeNull();
			await postCommand(makeCmd("session.unbind"));
			expect(built.sessions.getOrCreate("default").tabId).toBeNull();
		});

		it("session.resume clears paused state", async () => {
			built.sessions.pause("default", "captcha");
			await postCommand(makeCmd("session.resume"));
			expect(built.sessions.getOrCreate("default").paused).toBe(false);
		});
	});

	describe("forwarded actions preconditions", () => {
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
			"tab.list",
			"tab.pin",
			"tab.unpin",
			"tab.open",
			"tab.close",
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
				const ws = await connectClient();
				const res = await postCommand(makeCmd(action));
				expect(res.status).toBe(200);
				const body = (await res.json()) as BproxyResponse;
				expect(body.ok).toBe(false);
				if (!body.ok) expect(body.error.code).toBe("TAB_NOT_FOUND");
				ws.close();
			});
		}
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

		const res = await postCommand(makeCmd("debug.log"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		expect(body.ok).toBe(true);
		expect(receivedAction).toBe("debug.log");
		ws.close();
	});
});
