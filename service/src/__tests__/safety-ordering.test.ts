import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DAEMON_CONFIG } from "../daemon-config";
import type { BuiltServer } from "../server";
import {
	setupTestServer,
	TEST_NICK,
	type TestServerContext,
	teardownTestServer,
} from "./helpers/integration";

const daemonToken = "test-safety-token";
const extensionToken = "test-safety-ext-token";
const OTHER_NICK = "bobcat" as BproxyRequest["nick"];

let ctx: TestServerContext;
let built: BuiltServer;
let port: number;
let currentSession: BproxyRequest["session"];

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `safe-${crypto.randomUUID().slice(0, 8)}`,
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

afterEach(async () => {
	if (ctx) await teardownTestServer(ctx);
});

describe("safety guard ordering", () => {
	it("applies minimum-interval rejection before session scope validation", async () => {
		const arrivals = [0, 500];
		ctx = await setupTestServer({
			daemonToken,
			extensionToken,
			safetyNow: () => arrivals.shift() ?? 10_000,
			safetySleep: async () => {},
			safetyRandom: () => 0,
		});
		({ built, port, currentSession } = ctx);
		const foreignSession = built.sessions.create(OTHER_NICK).id;

		expect((await postCommand(makeCmd({ action: "session.list", params: {} }))).ok).toBe(true);
		const second = await postCommand(makeCmd({ action: "text", session: foreignSession }));
		expect(second).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
	});

	it("delays session-validation errors before responding", async () => {
		const sleeps: number[] = [];
		const daemonConfig = {
			pacing: DEFAULT_DAEMON_CONFIG.pacing,
			safety: {
				...DEFAULT_DAEMON_CONFIG.safety,
				minInterval: { ms: 100 },
				errorDelay: { minMs: 500, maxMs: 500 },
			},
		};
		ctx = await setupTestServer({
			daemonToken,
			extensionToken,
			daemonConfig,
			safetyNow: () => 10_000,
			safetySleep: async (ms) => {
				sleeps.push(ms);
			},
			safetyRandom: () => 0,
		});
		({ built, port, currentSession } = ctx);
		const foreignSession = built.sessions.create(OTHER_NICK).id;

		const response = await postCommand(makeCmd({ action: "text", session: foreignSession }));
		expect(response).toMatchObject({ ok: false, error: { code: "SESSION_SCOPE_MISMATCH" } });
		expect(sleeps).toEqual([500]);
	});
});
