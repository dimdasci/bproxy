import { defineConfig } from "wxt";

// WXT configuration for the @bproxy/extension MV3 build.
//
// Locked outcomes (see docs/plans/phases/03-extension.md):
//  - No declarative `content_scripts` — content script is registered at
//    runtime and injected programmatically by the background SW (ADR-001).
//  - No `web_accessible_resources` — default deny (ADR-016).
//  - `debugger` permission is intentionally absent — it is opt-in only
//    behind a future flag (Task 14).
//  - `srcDir: "src"` keeps entrypoints visible to dependency-cruiser and
//    knip, which scan `extension/src/**`.
export default defineConfig({
	srcDir: "src",
	manifest: {
		name: "bproxy",
		description: "Browser proxy companion extension for bproxy daemon.",
		permissions: ["tabs", "scripting", "webNavigation", "alarms", "storage"],
		host_permissions: ["<all_urls>"],
		action: {
			default_title: "bproxy",
			default_popup: "popup.html",
		},
	},
	// WXT emits an empty `content_scripts: []` entry whenever a runtime
	// content script is bundled, because the array stub is its signal that
	// the bundle exists but is not declaratively registered. The Phase 3
	// plan and ADR-016 require the key to be absent entirely so manifest
	// hygiene tests (Task 16) cannot regress to a non-empty array. Strip
	// it here as the last manifest transform.
	hooks: {
		"build:manifestGenerated": (_wxt, manifest) => {
			if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
				delete manifest.content_scripts;
			}
			if (
				Array.isArray(manifest.web_accessible_resources) &&
				manifest.web_accessible_resources.length === 0
			) {
				delete manifest.web_accessible_resources;
			}
		},
	},
});
