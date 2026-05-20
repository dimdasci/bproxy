// Minimal structural slice of WXT's `WxtStorageItem` shape.
//
// The helpers in this folder (trace, dedupe) only ever call `getValue`/
// `setValue`. Constraining the helper signatures to that subset keeps unit
// tests independent of WXT's full storage surface and avoids dragging the
// real `@wxt-dev/storage` runtime into Node-only Vitest specs.
export interface StorageItem<T> {
	readonly key: string;
	getValue(): Promise<T>;
	setValue(value: T): Promise<void>;
}
