import { createFillHandlers } from "../content/actions/fill";
import { createReadHandlers } from "../content/actions/reads";
import { createScrollWaitHandlers } from "../content/actions/scroll-wait";
import { createSelectHandlers } from "../content/actions/select";
import { snapshotDomPageState } from "../content/page-state";
import { registerContentRpcListener } from "../content/rpc";

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

const handlers = {
	...createReadHandlers(),
	...createScrollWaitHandlers(),
	...createFillHandlers(),
	...createSelectHandlers(),
};
