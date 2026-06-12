import type { Action, ActionParams, ActionResult, BproxyError, PageState } from "@bproxy/shared";

export type ContentAction = Extract<
	Action,
	| "text"
	| "links"
	| "images"
	| "elements"
	| "outline"
	| "dom"
	| "inspect"
	| "snapshot"
	| "scroll"
	| "fill"
	| "fill-form"
	| "select"
	| "wait"
>;

export type ContentRpcRequest<A extends ContentAction = ContentAction> = {
	kind: "bproxy.content.request";
	id: string;
	action: A;
	params: ActionParams[A];
};

export type ContentRpcResponse<A extends ContentAction = ContentAction> =
	| {
			kind: "bproxy.content.response";
			id: string;
			ok: true;
			data: ActionResult[A];
			page: PageState;
	  }
	| {
			kind: "bproxy.content.response";
			id: string;
			ok: false;
			error: BproxyError;
	  };

export type ContentRpcHandlers = Partial<{
	[A in ContentAction]: (
		request: ContentRpcRequest<A>,
	) => ActionResult[A] | Promise<ActionResult[A]>;
}>;

export interface ContentRpcHostDeps {
	handlers: ContentRpcHandlers;
	getPageState: () => PageState;
}

export interface RuntimeOnMessageSeam {
	addListener(listener: RuntimeMessageListener): void;
}

export type RuntimeMessageListener = (
	message: unknown,
	sender: unknown,
	sendResponse: (response?: unknown) => void,
) => boolean | void;

export interface ContentRpcHost {
	handleMessage(raw: unknown): Promise<ContentRpcResponse | undefined>;
	createRuntimeMessageListener(): RuntimeMessageListener;
}

const CONTENT_ACTIONS = [
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"inspect",
	"snapshot",
	"scroll",
	"fill",
	"fill-form",
	"select",
	"wait",
] as const satisfies readonly ContentAction[];

const contentActionSet = new Set<string>(CONTENT_ACTIONS);

export function createContentRpcHost(deps: ContentRpcHostDeps): ContentRpcHost {
	return {
		handleMessage: (raw) => handleMessage(deps, raw),
		createRuntimeMessageListener: () => createRuntimeMessageListener(deps),
	};
}

export function registerContentRpcListener(
	deps: ContentRpcHostDeps & { runtimeOnMessage: RuntimeOnMessageSeam },
): void {
	deps.runtimeOnMessage.addListener(createContentRpcHost(deps).createRuntimeMessageListener());
}

export function toContentRpcRequest<A extends ContentAction>(input: {
	id: string;
	action: A;
	params: ActionParams[A];
}): ContentRpcRequest<A> {
	return {
		kind: "bproxy.content.request",
		id: input.id,
		action: input.action,
		params: input.params,
	};
}

export function parseContentRpcResponse(
	raw: unknown,
	expectedId: string,
): ContentRpcResponse | { kind: "invalid"; error: string } {
	if (!isRecord(raw)) return { kind: "invalid", error: "content response must be an object" };
	if (raw["kind"] !== "bproxy.content.response") {
		return { kind: "invalid", error: "content response kind is invalid" };
	}
	if (raw["id"] !== expectedId) {
		return { kind: "invalid", error: "content response id did not match request" };
	}
	if (typeof raw["ok"] !== "boolean") {
		return { kind: "invalid", error: "content response ok must be boolean" };
	}
	if (raw["ok"] === true) {
		if (!isPageState(raw["page"])) {
			return { kind: "invalid", error: "content success response must include page" };
		}
		return raw as ContentRpcResponse;
	}
	if (!isBproxyError(raw["error"])) {
		return { kind: "invalid", error: "content error response is invalid" };
	}
	return raw as ContentRpcResponse;
}

function createRuntimeMessageListener(deps: ContentRpcHostDeps): RuntimeMessageListener {
	return (message, _sender, sendResponse) => {
		if (!matchesContentRequest(message)) return;
		void handleMessage(deps, message).then((response) => {
			if (response) sendResponse(response);
		});
		return true;
	};
}

async function handleMessage(
	deps: ContentRpcHostDeps,
	raw: unknown,
): Promise<ContentRpcResponse | undefined> {
	const parsed = parseContentRpcRequest(raw);
	if (!parsed.success) {
		if (!matchesContentRequest(raw) || !parsed.id) return undefined;
		return errorResponse(parsed.id, protocolError(`Malformed content request: ${parsed.error}`));
	}
	const request = parsed.data;
	const handler = deps.handlers[request.action] as
		| ((
				request: ContentRpcRequest,
		  ) => ActionResult[ContentAction] | Promise<ActionResult[ContentAction]>)
		| undefined;
	if (!handler) {
		return errorResponse(
			request.id,
			protocolError(`Content action is not implemented yet: ${request.action}`),
		);
	}
	try {
		const data = await handler(request);
		return {
			kind: "bproxy.content.response",
			id: request.id,
			ok: true,
			data,
			page: deps.getPageState(),
		};
	} catch (error_) {
		return errorResponse(request.id, normalizeThrown(error_, request.action));
	}
}

type ParseContentRequestResult =
	| { success: true; data: ContentRpcRequest }
	| { success: false; error: string; id?: string };

function parseContentRpcRequest(raw: unknown): ParseContentRequestResult {
	if (!isRecord(raw)) return { success: false, error: "content request must be an object" };
	const id = typeof raw["id"] === "string" && raw["id"].length > 0 ? raw["id"] : undefined;
	if (raw["kind"] !== "bproxy.content.request") {
		return { success: false, error: "content request kind is invalid", id };
	}
	if (!id) return { success: false, error: "content request id is invalid" };
	if (typeof raw["action"] !== "string" || !isContentAction(raw["action"])) {
		return { success: false, error: "content request action is invalid", id };
	}
	if (!("params" in raw)) {
		return { success: false, error: "content request params are missing", id };
	}
	return {
		success: true,
		data: {
			kind: "bproxy.content.request",
			id,
			action: raw["action"],
			params: raw["params"] as ActionParams[ContentAction],
		},
	};
}

function isContentAction(action: string): action is ContentAction {
	return contentActionSet.has(action);
}

function matchesContentRequest(value: unknown): boolean {
	return isRecord(value) && value["kind"] === "bproxy.content.request";
}

function errorResponse(id: string, error: BproxyError): ContentRpcResponse {
	return {
		kind: "bproxy.content.response",
		id,
		ok: false,
		error,
	};
}

function protocolError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}

function normalizeThrown(thrown: unknown, action: ContentAction): BproxyError {
	if (isBproxyError(thrown)) return thrown;
	if (thrown instanceof Error) {
		return {
			code: "SCRIPT_ERROR",
			category: "execution",
			retry: "conditional",
			message: thrown.message || `Content action failed: ${action}`,
			details: { action, name: thrown.name },
		};
	}
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: `Content action failed: ${String(thrown)}`,
		details: { action },
	};
}

function isPageState(value: unknown): value is PageState {
	return (
		isRecord(value) &&
		typeof value["url"] === "string" &&
		typeof value["title"] === "string" &&
		(value["state"] === "loading" || value["state"] === "ready" || value["state"] === "error") &&
		typeof value["busy"] === "boolean"
	);
}

function isBproxyError(value: unknown): value is BproxyError {
	return (
		isRecord(value) &&
		typeof value["code"] === "string" &&
		typeof value["category"] === "string" &&
		typeof value["retry"] === "string" &&
		typeof value["message"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
