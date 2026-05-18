// Runtime content script entrypoint.
//
// `registration: "runtime"` ensures WXT does NOT register this script
// declaratively in the manifest — the background SW injects it on first
// command per tab via `chrome.scripting.executeScript` (ADR-001).
//
// Task 2 lands an empty-but-loadable shell. Tasks 8-12 will wire the
// ISOLATED-world RPC host, page-state snapshot, discovery primitives,
// and the read/write action handlers.
export default defineContentScript({
	registration: "runtime",
	matches: ["<all_urls>"],
	runAt: "document_idle",
	world: "ISOLATED",
	main() {
		// Intentionally no-op at this stage.
	},
});
