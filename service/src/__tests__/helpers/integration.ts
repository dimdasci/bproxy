/**
 * Shared integration test utilities for service route tests.
 *
 * Extracted to eliminate Sonar-flagged duplication (connectClient, waitUntil,
 * server lifecycle, makeCmd, postCommand) across action-contract, round-trip,
 * observability, nick-scoping, safety-ordering, etc.
 */
import type { BproxyRequest, BproxyResponse, Nick, SessionId } from "@bproxy/shared";
import WebSocket from "ws";
import { buildCapturedLogger, type CapturedLogger } from "../../logger";
import { type BuildServerOptions, type BuiltServer, buildServer } from "../../server";
import { createTestStateDir, removeTestStateDir } from "./test-state-dir";

export function connectWsClient(port: number, extensionToken: string): Promise<WebSocket> {
	const auth = Buffer.from(extensionToken).toString("base64url");
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
		headers: { Origin: "chrome-extension://test" },
	});
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

export function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
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

export const TEST_NICK = "halbot" as Nick;

export interface TestServerContext {
	built: BuiltServer;
	stateDir: string;
	port: number;
	captured: CapturedLogger;
	currentSession: SessionId;
}

export async function setupTestServer(
	opts: { daemonToken: string; extensionToken: string } & Partial<BuildServerOptions>,
): Promise<TestServerContext> {
	const stateDir = createTestStateDir();
	const captured = buildCapturedLogger();
	const { daemonToken, extensionToken, ...serverOpts } = opts;
	let safetyTick = 0;
	let safetyCalls = 0;
	const built = await buildServer({
		port: 0,
		stateDir,
		daemonToken,
		extensionToken,
		logger: captured.logger,
		safetyNow: () => {
			safetyCalls += 1;
			safetyTick += 1000 + (safetyCalls % 3) * 137;
			return safetyTick;
		},
		safetySleep: async () => {},
		safetyRandom: () => 0,
		...serverOpts,
	});
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	const port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
	const currentSession = built.sessions.create(TEST_NICK).id;
	return { built, stateDir, port, captured, currentSession };
}

export async function teardownTestServer(ctx: TestServerContext): Promise<void> {
	await ctx.built.app.close();
	removeTestStateDir(ctx.stateDir);
}

// ─── Shared request helpers ────────────────────────────────────────────

export interface MakeCmdOptions {
	idPrefix?: string;
	defaultAction?: BproxyRequest["action"];
	defaultSession: () => BproxyRequest["session"];
}

export function makeCmd(
	opts: MakeCmdOptions,
	overrides: Partial<BproxyRequest> = {},
): BproxyRequest {
	const defaults: BproxyRequest = {
		protocol_version: 1,
		id: `${opts.idPrefix ?? "test"}-${crypto.randomUUID().slice(0, 8)}`,
		action: opts.defaultAction ?? "session.list",
		nick: TEST_NICK,
		params: {},
		session: opts.defaultSession(),
		deadline: Date.now() + 5000,
		destructive: false,
	};
	return { ...defaults, ...overrides };
}

export async function postCommand(
	port: number,
	token: string,
	cmd: BproxyRequest,
): Promise<BproxyResponse> {
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(cmd),
	});
	return (await res.json()) as BproxyResponse;
}

export async function postRaw(port: number, token: string, cmd: BproxyRequest): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(cmd),
	});
}
