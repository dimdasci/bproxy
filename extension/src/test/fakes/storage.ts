import type { StorageItem } from "../../background/storage-item";

// In-memory implementation of the `StorageItem<T>` slice used by trace and
// dedupe helpers. Lets unit tests run in plain Node without booting WXT's
// fakeBrowser — the helpers never touch the methods on `WxtStorageItem`
// beyond `getValue`/`setValue`, so this small fake is sufficient.
export function createFakeStorageItem<T>(key: string, initial: T): StorageItem<T> {
	let value: T = initial;
	return {
		key,
		async getValue() {
			return value;
		},
		async setValue(next: T) {
			value = next;
		},
	};
}
