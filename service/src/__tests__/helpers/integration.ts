/**
 * Shared integration test utilities for service route tests.
 *
 * Extracted to eliminate Sonar-flagged duplication (connectClient, waitUntil,
 * server lifecycle) across action-contract, round-trip, observability, etc.
 */
import type { SessionId } from "@bproxy/shared";
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
	const built = await buildServer({
		port: 0,
		stateDir,
		daemonToken,
		extensionToken,
		logger: captured.logger,
		...serverOpts,
	});
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	const port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
	const currentSession = built.sessions.create().id;
	return { built, stateDir, port, captured, currentSession };
}

export async function teardownTestServer(ctx: TestServerContext): Promise<void> {
	await ctx.built.app.close();
	removeTestStateDir(ctx.stateDir);
}
