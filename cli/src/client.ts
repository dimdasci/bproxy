/**
 * Daemon HTTP client and request builder.
 *
 * Centralizes the "one command = one POST" contract:
 *   - Builds a BproxyRequest envelope from action + params + global args
 *   - POSTs to http://127.0.0.1:{port}/ with Bearer auth
 *   - Aborts fetch shortly after the protocol deadline
 *   - Validates the response shape as a BproxyResponse
 *   - Returns an ExitPlan (never calls process.exit directly)
 *
 * Token values are never logged or included in verbose/diagnostic output.
 */
import { readFileSync } from "node:fs";

import { isDestructive } from "./command-registry.js";
import type { ExitPlan } from "./exit.js";
import { exitFromResponse, exitUsageError } from "./exit.js";
import { parseSessionId } from "./globals.js";
import { generateRequestId } from "./ids.js";
import { type VerboseEntry, writeVerbose } from "./output.js";
import { resolveStatePaths, type StatePaths } from "./paths.js";
import { validateResponse } from "./response-validation.js";
import { preflightToken } from "./token.js";
import type {
	Action,
	ActionParams,
	BproxyRequest,
	BproxyResponse,
	ClientGlobalArgs,
} from "./types.js";

export { validateResponse } from "./response-validation.js";
export type { ClientGlobalArgs } from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────

/** Options for the send function, enabling test injection. */
export interface SendOptions {
	/** Injected fetch for testing; defaults to global fetch. */
	fetch?: typeof globalThis.fetch;
	/** Injected stderr stream for verbose output. */
	stderr?: NodeJS.WritableStream;
	/** Injected env for path resolution. */
	env?: NodeJS.ProcessEnv;
	/** Override request ID generation for deterministic tests. */
	requestId?: string;
	/** Override port file read for testing. */
	readPort?: (portPath: string) => number | null;
}

/** Default deadline when --timeout is not provided (30 seconds). */
const DEFAULT_DEADLINE_MS = 30_000;

/** Buffer added to the protocol deadline for the fetch abort (2 seconds). */
const ABORT_BUFFER_MS = 2_000;

// ─── Internal context passed between pipeline stages ───────────────────

interface RequestContext {
	requestId: string;
	action: string;
	session: string;
	port: number;
	token: string;
	deadlineMs: number;
	verbose: boolean;
	stderr: NodeJS.WritableStream;
	fetchFn: typeof globalThis.fetch;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Build and send a single protocol request to the daemon.
 *
 * This is the only function action commands need to call.
 * It handles: path resolution, token preflight, request building,
 * HTTP POST, response validation, verbose logging, and exit-code mapping.
 */
export async function sendAction<A extends Action>(
	action: A,
	params: ActionParams[A],
	globals: ClientGlobalArgs,
	opts: SendOptions = {},
): Promise<ExitPlan> {
	const env = opts.env ?? process.env;
	const paths = resolveStatePaths(globals.home, env);

	const ctx = resolveContext(action, globals, paths, opts);
	if ("code" in ctx) return ctx; // ExitPlan on preflight failure

	const request = buildRequest(action, params, ctx);
	return executeRequest(request, ctx);
}

// ─── Preflight / context resolution ───────────────────────────────────

function resolveContext(
	action: Action,
	globals: ClientGlobalArgs,
	paths: StatePaths,
	opts: SendOptions,
): RequestContext | ExitPlan {
	const tokenResult = preflightToken(paths.token);
	if (!tokenResult.ok) return exitUsageError(tokenResult.reason);

	const readPortFn = opts.readPort ?? defaultReadPort;
	const port = readPortFn(paths.port);
	if (port === null) {
		return exitUsageError(`Daemon not running: port file not found or unreadable at ${paths.port}`);
	}

	const deadlineMs = parseDeadline(globals.timeout);
	if (deadlineMs === null) return exitUsageError(`Invalid timeout value: ${globals.timeout}`);

	const session = resolveSession(action, globals);
	if (typeof session !== "string") return session;

	return {
		requestId: opts.requestId ?? generateRequestId(),
		action,
		session,
		port,
		token: tokenResult.token,
		deadlineMs,
		verbose: globals.verbose ?? false,
		stderr: opts.stderr ?? process.stderr,
		fetchFn: opts.fetch ?? globalThis.fetch,
	};
}

function parseDeadline(timeout: string | undefined): number | null {
	if (!timeout) return DEFAULT_DEADLINE_MS;
	const ms = Number.parseInt(timeout, 10);
	if (Number.isNaN(ms) || ms <= 0) return null;
	return ms;
}

function isSessionExempt(action: Action): boolean {
	return (
		action === "session.create" ||
		action === "session.list" ||
		action === "debug.last" ||
		action === "debug.status"
	);
}

function resolveSession(action: Action, globals: ClientGlobalArgs): string | ExitPlan {
	if (typeof globals.session === "string") {
		const session = parseSessionId(globals.session);
		if (session) return session;
		return exitUsageError(`Invalid session id: ${globals.session}. Must match /^[a-z2-7]{6}$/.`);
	}

	if (action === "tab.open" || isSessionExempt(action)) return "";

	return exitUsageError(
		`Missing required session id for '${action}'. Use -s <id> or --session <id>. Create one with 'bproxy session create' or bootstrap with 'bproxy tab open --url ...'.`,
	);
}

// ─── Request building ──────────────────────────────────────────────────

function buildRequest<A extends Action>(
	action: A,
	params: ActionParams[A],
	ctx: RequestContext,
): BproxyRequest<A> {
	return {
		protocol_version: 1,
		id: ctx.requestId,
		action,
		params,
		session: ctx.session as BproxyRequest<A>["session"],
		deadline: Date.now() + ctx.deadlineMs,
		destructive: isDestructive(action),
	};
}

// ─── HTTP execution ────────────────────────────────────────────────────

async function executeRequest<A extends Action>(
	request: BproxyRequest<A>,
	ctx: RequestContext,
): Promise<ExitPlan> {
	const url = `http://127.0.0.1:${ctx.port}/`;

	if (ctx.verbose) {
		writeVerbose(
			{ requestId: ctx.requestId, action: ctx.action, session: ctx.session, url },
			ctx.stderr,
		);
	}

	const startTime = Date.now();
	const fetchResult = await doFetch(url, request, ctx);
	const elapsed = Date.now() - startTime;

	if (!fetchResult.ok) {
		emitVerboseOnError(ctx, elapsed, "FETCH_FAILED");
		return exitUsageError(fetchResult.message);
	}

	return processResponse(fetchResult.response, ctx, elapsed);
}

interface FetchOk {
	ok: true;
	response: Response;
}
interface FetchFail {
	ok: false;
	message: string;
}

async function doFetch<A extends Action>(
	url: string,
	request: BproxyRequest<A>,
	ctx: RequestContext,
): Promise<FetchOk | FetchFail> {
	const abortController = new AbortController();
	const abortTimeout = setTimeout(() => abortController.abort(), ctx.deadlineMs + ABORT_BUFFER_MS);

	try {
		const response = await ctx.fetchFn(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${ctx.token}`,
			},
			body: JSON.stringify(request),
			signal: abortController.signal,
		});
		return { ok: true, response };
	} catch (err) {
		let message: string;
		if (err instanceof Error && err.name === "AbortError") {
			message = `Request timed out after ${ctx.deadlineMs + ABORT_BUFFER_MS}ms`;
		} else {
			const detail = err instanceof Error ? err.message : String(err);
			message = `Failed to connect to daemon at 127.0.0.1:${ctx.port}: ${detail}`;
		}
		return { ok: false, message };
	} finally {
		clearTimeout(abortTimeout);
	}
}

// ─── Response processing ───────────────────────────────────────────────

async function processResponse(
	response: Response,
	ctx: RequestContext,
	elapsed: number,
): Promise<ExitPlan> {
	if (response.status === 401 || response.status === 403) {
		emitVerboseOnError(ctx, elapsed, "AUTH_REJECTED", response.status);
		return exitUsageError(
			`Daemon rejected authentication (HTTP ${response.status}). Token may be stale; try restarting the service.`,
		);
	}

	const body = await parseBody(response);
	if (body === null) {
		emitVerboseOnError(ctx, elapsed, "INVALID_JSON", response.status);
		return exitUsageError(
			`Daemon returned non-JSON response (HTTP ${response.status}). The service may be unhealthy.`,
		);
	}

	const validated = validateResponse(body, ctx.requestId);
	if (!validated.ok) {
		emitVerboseOnError(ctx, elapsed, "MALFORMED_RESPONSE", response.status);
		return exitUsageError(validated.reason);
	}

	if (ctx.verbose) {
		const postEntry: VerboseEntry = {
			requestId: ctx.requestId,
			action: ctx.action,
			session: ctx.session,
			elapsed,
			httpStatus: response.status,
		};
		if (!validated.response.ok) {
			postEntry.errorCode = validated.response.error.code;
		}
		writeVerbose(postEntry, ctx.stderr);
	}

	const plan = exitFromResponse(validated.response);
	if (isSessionClosePartialFailure(ctx.action, validated.response)) {
		plan.stderr =
			"Warning: session terminated but some Chrome tabs may not have been closed. Do not retry session close; a retry will return SESSION_NOT_FOUND.";
	}
	return plan;
}

function isSessionClosePartialFailure(action: string, response: BproxyResponse): boolean {
	if (action !== "session.close" || response.ok) return false;
	return !["SESSION_REQUIRED", "INVALID_SESSION_ID", "SESSION_NOT_FOUND"].includes(
		response.error.code,
	);
}

async function parseBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function emitVerboseOnError(
	ctx: RequestContext,
	elapsed: number,
	errorCode: string,
	httpStatus?: number,
): void {
	if (!ctx.verbose) return;
	writeVerbose(
		{
			requestId: ctx.requestId,
			action: ctx.action,
			session: ctx.session,
			elapsed,
			httpStatus,
			errorCode,
		},
		ctx.stderr,
	);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function defaultReadPort(portPath: string): number | null {
	let content: string;
	try {
		content = readFileSync(portPath, "utf8");
	} catch {
		return null;
	}
	const port = Number.parseInt(content.trim(), 10);
	if (Number.isNaN(port) || port <= 0 || port > 65535) {
		return null;
	}
	return port;
}
