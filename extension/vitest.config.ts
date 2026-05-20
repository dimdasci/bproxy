import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.ts"],
		environment: "node",
		// `setupFiles` installs the in-process `chrome.storage` stub so
		// `storage.defineItem` from `@wxt-dev/storage` can be exercised
		// without booting WXT's vite-based fakeBrowser harness.
		setupFiles: ["src/test/setup-chrome-storage.ts"],
		clearMocks: true,
		restoreMocks: true,
		passWithNoTests: true,
	},
});
