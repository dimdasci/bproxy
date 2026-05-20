import { describe, expect, it, vi } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import { createContentInjector, RUNTIME_CONTENT_SCRIPT_FILE } from "../injection";

describe("createContentInjector", () => {
	it("injects the runtime content script only on first use per tab", async () => {
		const store = createFakeStorageItem("session:injectedTabs", [] as number[]);
		const executeScript = vi.fn(async () => []);
		const injector = createContentInjector({
			store,
			scripting: { executeScript },
		});

		await injector.ensureInjected(42);
		await injector.ensureInjected(42);

		expect(executeScript).toHaveBeenCalledTimes(1);
		expect(executeScript).toHaveBeenCalledWith({
			target: { tabId: 42 },
			files: [RUNTIME_CONTENT_SCRIPT_FILE],
		});
		expect(await store.getValue()).toEqual([42]);
		expect(await injector.isInjected(42)).toBe(true);
	});

	it("forgets a tab when told to clear injection state", async () => {
		const store = createFakeStorageItem("session:injectedTabs", [7, 42]);
		const injector = createContentInjector({
			store,
			scripting: { executeScript: vi.fn(async () => []) },
		});

		await injector.forgetTab(42);

		expect(await store.getValue()).toEqual([7]);
		expect(await injector.isInjected(42)).toBe(false);
	});
});
