import type { BproxyError, PageState } from "@bproxy/shared";
import {
	type ContentRpcRequest,
	type ContentRpcResponse,
	isContentRpcRequest,
} from "../content/rpc";

// Runtime content script entrypoint.
//
// `registration: "runtime"` ensures WXT does NOT register this script
// declaratively in the manifest — the background SW injects it on first
// command per tab via `chrome.scripting.executeScript` (ADR-001).
//
// Task 7 needs a real request/response bridge so a forwarded DOM action can
// target the daemon-owned tab after injection. Keep the handler surface tiny:
// a single listener, page-state snapshot, and just enough `text` support to
// prove the injection/RPC path. Tasks 8-12 expand this into the full DOM host.
export default defineContentScript({
	registration: "runtime",
	matches: ["<all_urls>"],
	runAt: "document_idle",
	world: "ISOLATED",
	main() {
		chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
			if (!isContentRpcRequest(message)) return;
			void Promise.resolve(handleRequest(message)).then(sendResponse);
			return true;
		});
	},
});

function handleRequest(request: ContentRpcRequest): ContentRpcResponse {
	switch (request.action) {
		case "text":
			return handleText(request as ContentRpcRequest<"text">);
		default:
			return errorResponse(
				request.id,
				scriptError(`Content action is not implemented yet: ${request.action}`),
			);
	}
}

function handleText(request: ContentRpcRequest<"text">): ContentRpcResponse {
	const root = request.params.selector
		? document.querySelector(request.params.selector)
		: document.body;
	if (!root) {
		return errorResponse(request.id, {
			code: "ELEMENT_NOT_FOUND",
			category: "target",
			retry: "conditional",
			message: request.params.selector
				? `No element matched selector ${request.params.selector}`
				: "Document body is not available",
		});
	}
	const text = root instanceof HTMLElement ? root.innerText : (root.textContent ?? "");
	return {
		kind: "bproxy.content.response",
		id: request.id,
		ok: true,
		data: { text },
		page: snapshotPageState(),
	};
}

function errorResponse(id: string, error: BproxyError): ContentRpcResponse {
	return {
		kind: "bproxy.content.response",
		id,
		ok: false,
		error,
	};
}

function snapshotPageState(): PageState {
	return {
		url: window.location.href,
		title: document.title,
		state: document.readyState === "loading" ? "loading" : "ready",
		busy: false,
	};
}

function scriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}
