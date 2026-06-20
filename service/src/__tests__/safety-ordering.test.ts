import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DAEMON_CONFIG } from "../daemon-config";
import type { BuiltServer } from "../server";
import {
	type MakeCmdOptions,
	makeCmd as makeTestCmd,
	postCommand as post,
	setupTestServer,
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
let cmdOpts: MakeCmdOptions;

function cmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return makeTestCmd(cmdOpts, overrides);
}

async function postCommand(request: BproxyRequest): Promise<BproxyResponse> {
	return post(port, daemonToken, request);
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
		cmdOpts = { idPrefix: "safe", defaultSession: () => currentSession };
		const foreignSession = built.sessions.create(OTHER_NICK).id;

		expect((await postCommand(cmd({ action: "session.list", params: {} }))).ok).toBe(true);
		const second = await postCommand(cmd({ action: "text", session: foreignSession }));
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
		cmdOpts = { idPrefix: "safe", defaultSession: () => currentSession };
		const foreignSession = built.sessions.create(OTHER_NICK).id;

		const response = await postCommand(cmd({ action: "text", session: foreignSession }));
		expect(response).toMatchObject({ ok: false, error: { code: "SESSION_SCOPE_MISMATCH" } });
		expect(sleeps).toEqual([500]);
	});
});
