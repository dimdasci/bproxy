import { beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";

// Stub `chrome` and `browser` globals with WXT's in-memory fakeBrowser
// before any module loads. `@wxt-dev/storage` reads `globalThis.chrome` /
// `globalThis.browser` at module init, so the stubs must exist by the time
// the first test file imports `storage`.
vi.stubGlobal("chrome", fakeBrowser);
vi.stubGlobal("browser", fakeBrowser);

beforeEach(() => {
	fakeBrowser.reset();
});
