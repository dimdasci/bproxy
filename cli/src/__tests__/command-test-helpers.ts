/**
 * Shared test fixtures for CLI command tests.
 *
 * Extracted to eliminate duplication across commands-write, commands-read,
 * and commands-control test files.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@bproxy/shared";
import type { ClientGlobalArgs, SendOptions } from "../client.js";
import { sendAction } from "../client.js";
import { extractUrl } from "./fetch-helper.js";
import { createTestStateDir } from "./helpers/test-state-dir.js";

export function setupTempHome(prefix = "bproxy-cmd-test-"): string {
	const dir = createTestStateDir(prefix);
	writeFileSync(join(dir, "token"), "test-token\n", { mode: 0o600 });
	writeFileSync(join(dir, "port"), "9615", { mode: 0o644 });
	return dir;
}

export function makeGlobals(
	home: string,
	overrides: Partial<ClientGlobalArgs> = {},
): ClientGlobalArgs {
	return {
		nick: "halbot" as ClientGlobalArgs["nick"],
		session: "m4q7z2",
		timeout: "5000",
		home,
		verbose: false,
		...overrides,
	};
}

export function successResponse(id: string, data: unknown = {}) {
	return {
		protocol_version: PROTOCOL_VERSION,
		id,
		ok: true,
		data,
		page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
		replay: false,
	};
}

export function createMockFetch(responseBody: unknown, status = 200) {
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const mockFetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const bodyStr = typeof init?.body === "string" ? init.body : "{}";
		calls.push({ url: extractUrl(url), body: JSON.parse(bodyStr) as Record<string, unknown> });
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	};
	return { fetch: mockFetch, calls };
}

export async function sendWithCapture(
	action: string,
	params: Record<string, unknown>,
	home: string,
	globals?: Partial<ClientGlobalArgs>,
) {
	const requestId = "test-id-001";
	const { fetch, calls } = createMockFetch(successResponse(requestId));
	const opts: SendOptions = { fetch, requestId };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
	const plan = await sendAction(action as any, params as any, makeGlobals(home, globals), opts);
	return { plan, calls };
}
