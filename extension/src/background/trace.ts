import type { TraceEntry } from "@bproxy/shared";
import type { StorageItem } from "./storage-item";

// Input to `append`. The trace module stamps `extensionVersion` itself so
// callers cannot accidentally serve a stale build label from a cached value.
export type TraceInput = Omit<TraceEntry, "extensionVersion">;

export interface TraceQuery {
	id?: string;
	limit?: number;
}

export interface Trace {
	append(input: TraceInput): Promise<void>;
	query(opts?: TraceQuery): Promise<TraceEntry[]>;
}

export interface TraceOptions {
	store: StorageItem<TraceEntry[]>;
	maxSize: number;
	// Provider rather than a literal so the helper stays decoupled from
	// `chrome.runtime.getManifest()`; the entrypoint wires the real source.
	extensionVersion: () => string;
}

export function createTrace(opts: TraceOptions): Trace {
	const { store, maxSize, extensionVersion } = opts;

	return {
		async append(input) {
			const stamped: TraceEntry = { ...input, extensionVersion: extensionVersion() };
			const current = await store.getValue();
			const next = current.concat(stamped);
			// Bound from the head: oldest entries fall off first.
			const trimmed = next.length > maxSize ? next.slice(next.length - maxSize) : next;
			await store.setValue(trimmed);
		},

		async query(query = {}) {
			const all = await store.getValue();
			const filtered = query.id ? all.filter((e) => e.id === query.id) : all;
			if (query.limit === undefined) return filtered;
			const start = Math.max(0, filtered.length - query.limit);
			return filtered.slice(start);
		},
	};
}
