import type { BproxyResponse } from "@bproxy/shared";
import type { StorageItem } from "./storage-item";

// Entry shape required by the Phase 3 plan: `{ response, ts }`. `ts` is the
// wall-clock at write time (caller-supplied via `now`) and drives TTL
// eviction.
export interface DedupeEntry {
	response: BproxyResponse;
	ts: number;
}

export type DedupeStore = StorageItem<Record<string, DedupeEntry>>;

export interface Dedupe {
	get(id: string): Promise<BproxyResponse | undefined>;
	set(id: string, response: BproxyResponse): Promise<void>;
	purge(): Promise<void>;
}

export interface DedupeOptions {
	store: DedupeStore;
	ttlMs: number;
	maxSize: number;
	now: () => number;
}

export function createDedupe(opts: DedupeOptions): Dedupe {
	const { store, ttlMs, maxSize, now } = opts;

	function isFresh(entry: DedupeEntry, t: number): boolean {
		return t - entry.ts < ttlMs;
	}

	return {
		async get(id) {
			const table = await store.getValue();
			const entry = table[id];
			if (!entry) return undefined;
			if (!isFresh(entry, now())) {
				// Lazy expiry: drop the stale entry as we observe it.
				const { [id]: _drop, ...rest } = table;
				void _drop;
				await store.setValue(rest);
				return undefined;
			}
			return entry.response;
		},

		async set(id, response) {
			const table = await store.getValue();
			const t = now();
			const next: Record<string, DedupeEntry> = { ...table, [id]: { response, ts: t } };
			await store.setValue(evictIfNeeded(next, maxSize));
		},

		async purge() {
			const table = await store.getValue();
			const t = now();
			const next: Record<string, DedupeEntry> = {};
			for (const [id, entry] of Object.entries(table)) {
				if (isFresh(entry, t)) next[id] = entry;
			}
			await store.setValue(next);
		},
	};
}

// Size-bounded eviction: oldest `ts` first. Periodic alarm-driven purges
// can be added later; for Task 3 lazy purge on read plus this size guard
// covers the documented policy.
function evictIfNeeded(
	table: Record<string, DedupeEntry>,
	maxSize: number,
): Record<string, DedupeEntry> {
	const entries = Object.entries(table);
	if (entries.length <= maxSize) return table;
	entries.sort((a, b) => a[1].ts - b[1].ts);
	const keep = entries.slice(entries.length - maxSize);
	return Object.fromEntries(keep);
}
