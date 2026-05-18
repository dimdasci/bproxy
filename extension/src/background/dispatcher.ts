import type {
	ActionResult,
	BproxyError,
	BproxyForwardedRequest,
	BproxyResponse,
	PageState,
} from "@bproxy/shared";
import type { Dedupe } from "./dedupe";
import {
	type BrowserAction,
	type DomAction,
	type ForwardedAction,
	isBrowserAction,
	isDomAction,
} from "./forwarded-actions";
import { parseForwardedRequest } from "./forwarded-request";
import { errorResponse, successResponse } from "./responses";
import type { Trace } from "./trace";

export interface ExecutedAction {
	data: unknown;
	page: PageState;
}

export interface DispatcherDeps {
	dedupe: Dedupe;
	trace: Trace;
	now: () => number;
	sendResponse: (response: BproxyResponse) => void;
	handleBrowserAction: (request: BproxyForwardedRequest<BrowserAction>) => Promise<ExecutedAction>;
	handleDomAction: (request: BproxyForwardedRequest<DomAction>) => Promise<ExecutedAction>;
}

export interface Dispatcher {
	handleMessage(raw: unknown): Promise<void>;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
	return {
		async handleMessage(raw) {
			const parsed = parseForwardedRequest(raw);
			if (!parsed.success) {
				if (parsed.id) {
					safeSend(
						deps,
						errorResponse({
							request: malformedRequest(parsed.id),
							error: protocolError(`Malformed forwarded request: ${parsed.error}`),
						}),
					);
				}
				return;
			}

			const request = parsed.data;
			const startedAt = deps.now();
			const cached = await deps.dedupe.get(request.id);
			if (cached) {
				const replayed = markReplay(cached);
				await appendTrace(deps, request, replayed, startedAt, true);
				safeSend(deps, replayed);
				return;
			}

			const response = await executeRequest(deps, request);
			try {
				await deps.dedupe.set(request.id, response);
			} catch {
				// Best effort. The action has already executed; still reply.
			}
			await appendTrace(deps, request, response, startedAt, false);
			safeSend(deps, response);
		},
	};
}

async function executeRequest(
	deps: DispatcherDeps,
	request: BproxyForwardedRequest<ForwardedAction>,
): Promise<BproxyResponse> {
	try {
		if (request.action === "debug.log") {
			const entries = await deps.trace.query(request.params as { id?: string; limit?: number });
			return successResponse({
				request,
				data: { entries },
				page: emptyPageState(),
			});
		}
		if (isBrowserAction(request.action)) {
			return buildSuccess(
				request,
				await deps.handleBrowserAction(request as BproxyForwardedRequest<BrowserAction>),
			);
		}
		if (isDomAction(request.action)) {
			return buildSuccess(
				request,
				await deps.handleDomAction(request as BproxyForwardedRequest<DomAction>),
			);
		}
		return errorResponse({
			request,
			error: protocolError(`Forwarded action is unsupported in the extension: ${request.action}`),
		});
	} catch (thrown) {
		return errorResponse({ request, error: normalizeThrown(thrown) });
	}
}

function buildSuccess<A extends ForwardedAction>(
	request: BproxyForwardedRequest<A>,
	result: ExecutedAction,
): BproxyResponse {
	return successResponse({
		request,
		data: result.data as ActionResult[A],
		page: result.page,
	});
}

async function appendTrace(
	deps: DispatcherDeps,
	request: BproxyForwardedRequest<ForwardedAction>,
	response: BproxyResponse,
	startedAt: number,
	replay: boolean,
): Promise<void> {
	try {
		const endedAt = deps.now();
		await deps.trace.append({
			id: request.id,
			action: request.action,
			tab: request.target.tabId,
			timestamp: startedAt,
			elapsed: Math.max(0, endedAt - startedAt),
			result: response.ok ? "ok" : "error",
			errorCode: response.ok ? undefined : response.error.code,
			replay,
		});
	} catch {
		// Best effort; tracing must not block protocol replies.
	}
}

function safeSend(deps: DispatcherDeps, response: BproxyResponse): void {
	try {
		deps.sendResponse(response);
	} catch {
		// The SW can only best-effort send at this point. The daemon will replay
		// pending requests after reconnect if the socket vanished mid-send.
	}
}

function emptyPageState(): PageState {
	return { url: "", title: "", state: "ready", busy: false };
}

function malformedRequest(id: string): BproxyForwardedRequest<"debug.log"> {
	return {
		protocol_version: 1,
		id,
		action: "debug.log",
		params: {},
		session: "",
		deadline: 0,
		destructive: false,
		target: { tabId: 0 },
	};
}

function protocolError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "never",
		message,
	};
}

function normalizeThrown(thrown: unknown): BproxyError {
	if (isBproxyError(thrown)) return thrown;
	if (thrown instanceof Error) {
		return {
			code: "SCRIPT_ERROR",
			category: "execution",
			retry: "conditional",
			message: thrown.message || "Browser action failed",
			details: { name: thrown.name },
		};
	}
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: `Browser action failed: ${String(thrown)}`,
	};
}

function isBproxyError(value: unknown): value is BproxyError {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>)["code"] === "string" &&
		typeof (value as Record<string, unknown>)["category"] === "string" &&
		typeof (value as Record<string, unknown>)["retry"] === "string" &&
		typeof (value as Record<string, unknown>)["message"] === "string"
	);
}

function markReplay(response: BproxyResponse): BproxyResponse {
	if (!response.ok) return response;
	return { ...response, replay: true };
}
