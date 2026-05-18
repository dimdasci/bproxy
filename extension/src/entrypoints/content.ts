import type { ActionResult, BproxyError } from "@bproxy/shared";
import { snapshotDomPageState } from "../content/page-state";
import {
	type ContentRpcHandlers,
	type ContentRpcRequest,
	registerContentRpcListener,
} from "../content/rpc";

// Runtime content script entrypoint.
//
// `registration: "runtime"` ensures WXT does NOT register this script
// declaratively in the manifest — the background SW injects it on first
// command per tab via `chrome.scripting.executeScript` (ADR-001).
//
// Task 8 turns the minimal Task 7 bridge into the real ISOLATED-world host:
// one runtime listener, typed content-RPC envelopes, consistent page-state
// snapshots, and normalized error handling. Action coverage stays tiny here;
// later tasks add the rest of the DOM surface area on top of this host.
export default defineContentScript({
	registration: "runtime",
	matches: ["<all_urls>"],
	runAt: "document_idle",
	world: "ISOLATED",
	main() {
		registerContentRpcListener({
			runtimeOnMessage: chrome.runtime.onMessage,
			handlers,
			getPageState: () => snapshotDomPageState(),
		});
	},
});

const handlers: ContentRpcHandlers = {
	text: (request) => ({ text: readText(request) }),
};

function readText(request: ContentRpcRequest<"text">): ActionResult["text"]["text"] {
	const root = request.params.selector
		? document.querySelector(request.params.selector)
		: document.body;
	if (!root) {
		throw elementNotFound(
			request.params.selector
				? `No element matched selector ${request.params.selector}`
				: "Document body is not available",
		);
	}
	return root instanceof HTMLElement ? root.innerText : (root.textContent ?? "");
}

function elementNotFound(message: string): BproxyError {
	return {
		code: "ELEMENT_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message,
	};
}
