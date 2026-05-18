import type { Action, ActionParams, ActionResult, BproxyError, PageState } from "@bproxy/shared";

export type ContentAction = Extract<
	Action,
	| "text"
	| "images"
	| "elements"
	| "outline"
	| "dom"
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

export function isContentRpcRequest(value: unknown): value is ContentRpcRequest {
	if (!isRecord(value)) return false;
	if (value["kind"] !== "bproxy.content.request") return false;
	if (typeof value["id"] !== "string" || value["id"].length === 0) return false;
	if (typeof value["action"] !== "string") return false;
	return "params" in value;
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
		if (!isRecord(raw["page"])) {
			return { kind: "invalid", error: "content success response must include page" };
		}
		return raw as ContentRpcResponse;
	}
	if (!isBproxyError(raw["error"])) {
		return { kind: "invalid", error: "content error response is invalid" };
	}
	return raw as ContentRpcResponse;
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
