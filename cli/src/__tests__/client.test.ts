import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClientGlobalArgs, sendAction, validateResponse } from "../client.js";

// ─── Test helpers ──────────────────────────────────────────────────────

function makeGlobals(overrides: Partial<ClientGlobalArgs> = {}): ClientGlobalArgs {
	return {
		session: "test-session",
		timeout: "5000",
		home: "/tmp/bproxy-test",
		verbose: false,
		...overrides,
	};
}

function successResponse(id: string, data: unknown = { text: "hello" }) {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data,
		page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
		replay: false,
	};
}

function errorResponse(id: string, code = "ELEMENT_NOT_FOUND") {
	return {
		protocol_version: 1,
		id,
		ok: false,
		error: {
			code,
			category: "target",
			retry: "safe",
			message: "Element not found",
		},
	};
}

/**
 * Create a mock fetch that records the request and returns a given response.
 */
function createMockFetch(responseBody: unknown, status = 200) {
	const calls: { url: string; init: RequestInit }[] = [];

	const mockFetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		calls.push({ url: url.toString(), init: init ?? {} });
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	};

	return { fetch: mockFetch as typeof globalThis.fetch, calls };
}

/** Create a writable stream that captures output */
function captureStream(): { stream: NodeJS.WritableStream; output: () => string } {
	let buffer = "";
	const stream = {
		write(chunk: string | Buffer) {
			buffer += typeof chunk === "string" ? chunk : chunk.toString();
			return true;
		},
	} as NodeJS.WritableStream;
	return { stream, output: () => buffer };
}

function setupTempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "bproxy-client-test-"));
	// Write token file with correct permissions
	const tokenPath = join(dir, "token");
	writeFileSync(tokenPath, "test-bearer-token\n", { mode: 0o600 });
	// Write port file
	writeFileSync(join(dir, "port"), "9615\n");
	return dir;
}

// ─── validateResponse tests ────────────────────────────────────────────

function omit<T extends Record<string, unknown>>(obj: T, key: string): Partial<T> {
	const copy = { ...obj };
	delete copy[key];
	return copy;
}

describe("validateResponse", () => {
	const reqId = "test-request-id";

	it("accepts a valid success response", () => {
		const body = successResponse(reqId);
		const result = validateResponse(body, reqId);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.response).toEqual(body);
		}
	});

	it("accepts a valid error response", () => {
		const body = errorResponse(reqId);
		const result = validateResponse(body, reqId);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.response.ok).toBe(false);
		}
	});

	it("rejects null body", () => {
		const result = validateResponse(null, reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("not a JSON object");
		}
	});

	it("rejects non-object body", () => {
		const result = validateResponse("string", reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("not a JSON object");
		}
	});

	it("rejects wrong protocol_version", () => {
		const result = validateResponse({ ...successResponse(reqId), protocol_version: 2 }, reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("protocol_version");
		}
	});

	it("rejects missing id", () => {
		const result = validateResponse(omit(successResponse(reqId), "id"), reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'id' field");
		}
	});

	it("rejects mismatched id", () => {
		const body = successResponse("wrong-id");
		const result = validateResponse(body, reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("mismatch");
		}
	});

	it("rejects missing ok field", () => {
		const result = validateResponse(omit(successResponse(reqId), "ok"), reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'ok' field");
		}
	});

	it("rejects success response without data", () => {
		const result = validateResponse(omit(successResponse(reqId), "data"), reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'data' field");
		}
	});

	it("rejects success response without page", () => {
		const result = validateResponse(omit(successResponse(reqId), "page"), reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'page' field");
		}
	});

	it("rejects error response without error object", () => {
		const result = validateResponse({ protocol_version: 1, id: reqId, ok: false }, reqId);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'error' object");
		}
	});

	it("rejects error response with error missing code", () => {
		const result = validateResponse(
			{ protocol_version: 1, id: reqId, ok: false, error: { category: "target" } },
			reqId,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("'error.code'");
		}
	});
});

// ─── sendAction tests (with mocked dependencies) ──────────────────────

describe("sendAction", () => {
	it("returns exit 2 when token file is missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bproxy-client-test-"));
		// Write port but no token
		writeFileSync(join(dir, "port"), "9615\n");

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch: createMockFetch({}).fetch,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Token file not found");
	});

	it("returns exit 2 when port file is missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bproxy-client-test-"));
		// Write token but no port
		const tokenPath = join(dir, "token");
		writeFileSync(tokenPath, "test-token\n", { mode: 0o600 });

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch: createMockFetch({}).fetch,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Daemon not running");
	});

	it("returns exit 2 for invalid timeout", async () => {
		const dir = setupTempHome();

		const result = await sendAction(
			"text",
			{},
			makeGlobals({ home: dir, timeout: "not-a-number" }),
			{ fetch: createMockFetch({}).fetch },
		);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Invalid timeout");
	});

	it("sends correct request shape and returns exit 0 on success", async () => {
		const dir = setupTempHome();
		const reqId = "fixed-request-id";
		const responseBody = successResponse(reqId);
		const { fetch, calls } = createMockFetch(responseBody);

		const result = await sendAction(
			"text",
			{ selector: ".content" },
			makeGlobals({ home: dir, session: "my-session" }),
			{ fetch, requestId: reqId },
		);

		expect(result.code).toBe(0);
		expect(result.stdout).toEqual(responseBody);

		// Verify request shape
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("http://127.0.0.1:9615/");
		const body = JSON.parse(calls[0]!.init.body as string);
		expect(body.protocol_version).toBe(1);
		expect(body.id).toBe(reqId);
		expect(body.action).toBe("text");
		expect(body.params).toEqual({ selector: ".content" });
		expect(body.session).toBe("my-session");
		expect(body.destructive).toBe(false);
		expect(body.deadline).toBeGreaterThan(Date.now() - 10_000);
	});

	it("includes Authorization header without leaking token in verbose", async () => {
		const dir = setupTempHome();
		const reqId = "fixed-id-auth";
		const responseBody = successResponse(reqId);
		const { fetch, calls } = createMockFetch(responseBody);
		const { stream, output } = captureStream();

		await sendAction("text", {}, makeGlobals({ home: dir, verbose: true }), {
			fetch,
			requestId: reqId,
			stderr: stream,
		});

		// Verify auth header is present
		const headers = calls[0]!.init.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer test-bearer-token");

		// Verify token value does NOT appear in verbose stderr
		const stderrOutput = output();
		expect(stderrOutput).not.toContain("test-bearer-token");
		expect(stderrOutput).toContain(reqId);
	});

	it("sets destructive flag for write actions", async () => {
		const dir = setupTempHome();
		const reqId = "destructive-test";
		const responseBody = successResponse(reqId);
		const { fetch, calls } = createMockFetch(responseBody);

		await sendAction("navigate", { url: "https://example.com" }, makeGlobals({ home: dir }), {
			fetch,
			requestId: reqId,
		});

		const body = JSON.parse(calls[0]!.init.body as string);
		expect(body.destructive).toBe(true);
	});

	it("returns exit 1 on protocol error response", async () => {
		const dir = setupTempHome();
		const reqId = "error-test";
		const responseBody = errorResponse(reqId, "ELEMENT_NOT_FOUND");
		const { fetch } = createMockFetch(responseBody);

		const result = await sendAction(
			"fill",
			{ target: { selector: ".missing" }, value: "x", method: "direct", world: "isolated" },
			makeGlobals({ home: dir }),
			{ fetch, requestId: reqId },
		);

		expect(result.code).toBe(1);
		expect(result.stdout).toEqual(responseBody);
	});

	it("returns exit 2 on HTTP 401", async () => {
		const dir = setupTempHome();
		const reqId = "auth-fail";
		const { fetch } = createMockFetch({ error: "unauthorized" }, 401);

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("rejected authentication");
	});

	it("returns exit 2 on HTTP 403", async () => {
		const dir = setupTempHome();
		const reqId = "forbidden";
		const { fetch } = createMockFetch({ error: "forbidden" }, 403);

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("rejected authentication");
	});

	it("returns exit 2 on non-JSON response", async () => {
		const dir = setupTempHome();
		const reqId = "non-json";

		const mockFetch = (): Promise<Response> =>
			Promise.resolve(new Response("not json at all", { status: 200 }));

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch: mockFetch as typeof globalThis.fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("non-JSON response");
	});

	it("returns exit 2 on malformed protocol response", async () => {
		const dir = setupTempHome();
		const reqId = "malformed";
		// Valid JSON but wrong protocol shape
		const { fetch } = createMockFetch({ some: "random", json: true });

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("protocol_version");
	});

	it("returns exit 2 when fetch throws (connection refused)", async () => {
		const dir = setupTempHome();
		const reqId = "connection-refused";

		const mockFetch = (): Promise<Response> => Promise.reject(new Error("ECONNREFUSED"));

		const result = await sendAction("text", {}, makeGlobals({ home: dir }), {
			fetch: mockFetch as typeof globalThis.fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Failed to connect");
		expect(result.stderr).toContain("ECONNREFUSED");
	});

	it("returns exit 2 on abort timeout", async () => {
		const dir = setupTempHome();
		const reqId = "abort-test";

		const abortError = new Error("The operation was aborted");
		abortError.name = "AbortError";
		const mockFetch = (): Promise<Response> => Promise.reject(abortError);

		const result = await sendAction("text", {}, makeGlobals({ home: dir, timeout: "100" }), {
			fetch: mockFetch as typeof globalThis.fetch,
			requestId: reqId,
		});

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("timed out");
	});

	it("uses default session when not provided", async () => {
		const dir = setupTempHome();
		const reqId = "default-session";
		const responseBody = successResponse(reqId);
		const { fetch, calls } = createMockFetch(responseBody);

		await sendAction("text", {}, makeGlobals({ home: dir, session: undefined }), {
			fetch,
			requestId: reqId,
		});

		const body = JSON.parse(calls[0]!.init.body as string);
		expect(body.session).toBe("default");
	});

	it("uses default deadline when timeout not provided", async () => {
		const dir = setupTempHome();
		const reqId = "default-deadline";
		const responseBody = successResponse(reqId);
		const { fetch, calls } = createMockFetch(responseBody);
		const before = Date.now();

		await sendAction("text", {}, makeGlobals({ home: dir, timeout: undefined }), {
			fetch,
			requestId: reqId,
		});

		const body = JSON.parse(calls[0]!.init.body as string);
		// Default is 30s from now
		expect(body.deadline).toBeGreaterThanOrEqual(before + 29_000);
		expect(body.deadline).toBeLessThanOrEqual(Date.now() + 31_000);
	});

	it("writes verbose stderr entries before and after request", async () => {
		const dir = setupTempHome();
		const reqId = "verbose-test";
		const responseBody = successResponse(reqId);
		const { fetch } = createMockFetch(responseBody);
		const { stream, output } = captureStream();

		await sendAction(
			"navigate",
			{ url: "https://example.com" },
			makeGlobals({ home: dir, verbose: true, session: "s1" }),
			{ fetch, requestId: reqId, stderr: stream },
		);

		const lines = output().trim().split("\n");
		expect(lines.length).toBe(2);

		const pre = JSON.parse(lines[0]!);
		expect(pre.requestId).toBe(reqId);
		expect(pre.action).toBe("navigate");
		expect(pre.session).toBe("s1");
		expect(pre.url).toBe("http://127.0.0.1:9615/");

		const post = JSON.parse(lines[1]!);
		expect(post.requestId).toBe(reqId);
		expect(post.elapsed).toBeGreaterThanOrEqual(0);
		expect(post.httpStatus).toBe(200);
	});

	it("writes error code in verbose stderr for protocol errors", async () => {
		const dir = setupTempHome();
		const reqId = "verbose-error";
		const responseBody = errorResponse(reqId, "TIMEOUT");
		const { fetch } = createMockFetch(responseBody);
		const { stream, output } = captureStream();

		await sendAction("text", {}, makeGlobals({ home: dir, verbose: true }), {
			fetch,
			requestId: reqId,
			stderr: stream,
		});

		const lines = output().trim().split("\n");
		const post = JSON.parse(lines[1]!);
		expect(post.errorCode).toBe("TIMEOUT");
	});
});
