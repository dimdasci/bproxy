import type { StorageItem } from "./storage-item";

export const RUNTIME_CONTENT_SCRIPT_FILE = "content-scripts/content.js";

export interface ScriptingSeam {
	executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

export interface ContentInjectorDeps {
	store: StorageItem<number[]>;
	scripting: ScriptingSeam;
	file?: string;
}

export interface ContentInjector {
	ensureInjected(tabId: number): Promise<void>;
	forgetTab(tabId: number): Promise<void>;
	isInjected(tabId: number): Promise<boolean>;
	getInjectedTabs(): Promise<number[]>;
}

export function createContentInjector(deps: ContentInjectorDeps): ContentInjector {
	const inFlight = new Map<number, Promise<void>>();
	const file = deps.file ?? RUNTIME_CONTENT_SCRIPT_FILE;

	return {
		async ensureInjected(tabId) {
			if (await hasTab(deps.store, tabId)) return;
			const existing = inFlight.get(tabId);
			if (existing) return existing;
			const pending = injectOnce(deps, tabId, file).finally(() => {
				inFlight.delete(tabId);
			});
			inFlight.set(tabId, pending);
			return pending;
		},
		async forgetTab(tabId) {
			await updateStore(deps.store, (tabs) => tabs.filter((value) => value !== tabId));
		},
		isInjected(tabId) {
			return hasTab(deps.store, tabId);
		},
		getInjectedTabs() {
			return deps.store.getValue();
		},
	};
}

async function injectOnce(deps: ContentInjectorDeps, tabId: number, file: string): Promise<void> {
	if (await hasTab(deps.store, tabId)) return;
	await deps.scripting.executeScript({
		target: { tabId },
		files: [file],
	});
	await updateStore(deps.store, (tabs) => (tabs.includes(tabId) ? tabs : [...tabs, tabId]));
}

async function hasTab(store: StorageItem<number[]>, tabId: number): Promise<boolean> {
	return (await store.getValue()).includes(tabId);
}

async function updateStore(
	store: StorageItem<number[]>,
	update: (tabs: number[]) => number[],
): Promise<void> {
	const current = await store.getValue();
	await store.setValue(normalizeTabs(update(current)));
}

function normalizeTabs(tabs: number[]): number[] {
	return [...new Set(tabs)].sort((left, right) => left - right);
}
