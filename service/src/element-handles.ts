import type { ElementHandle, ElementInfo, LinkInfo, SessionId, TabHandle } from "@bproxy/shared";
import { HANDLE_PATTERN } from "@bproxy/shared";
import {
	type HandleCacheOptions,
	type HandleEntry,
	type HandleError,
	type HandleSourceAction,
	type PageEpoch,
	type ResolveResult,
} from "./element-handle-types";
import {
	addToIndex,
	buildHandle,
	compareByAge,
	groupByScope,
	logInvalidate,
	logMint,
	notFoundError,
	removeFromIndex,
	resolveActionableTarget,
	scopeMismatchError,
	staleError,
} from "./element-handles-support";

export type {
	HandleCacheOptions,
	HandleEntry,
	HandleError,
	HandleHints,
	HandleSourceAction,
	PageEpoch,
	ResolveResult,
} from "./element-handle-types";

export class ElementHandleCache {
	private readonly entries = new Map<string, HandleEntry>();
	private readonly scopeIndex = new Map<string, Set<string>>();
	private readonly tabIndex = new Map<number, Set<string>>();
	private readonly sessionIndex = new Map<string, Set<string>>();
	private readonly pageEpochs = new Map<number, PageEpoch>();
	private readonly ttlMs: number;
	private readonly perScopeCap: number;
	private readonly globalCap: number;
	private readonly now: () => number;
	private readonly logger?: HandleCacheOptions["logger"];

	constructor(options: HandleCacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? 120_000;
		this.perScopeCap = options.perScopeCap ?? 200;
		this.globalCap = options.globalCap ?? 1000;
		this.now = options.now ?? (() => Date.now());
		this.logger = options.logger;
	}

	mint<T extends ElementInfo | LinkInfo>(
		session: SessionId,
		tab: TabHandle,
		chromeTabId: number,
		sourceAction: HandleSourceAction,
		entries: T[],
		pageUrl: string,
		pageEpoch: number,
	): T[] {
		this.invalidateForScope(session, tab, sourceAction, false, "reread");
		const decorated = entries.map((entry) => ({ ...entry })) as T[];
		const minted = this.mintEntries(
			session,
			tab,
			chromeTabId,
			sourceAction,
			decorated,
			pageUrl,
			pageEpoch,
		);
		logMint(this.logger, session, tab, sourceAction, minted);
		return decorated;
	}

	resolve(session: SessionId, tab: TabHandle, handle: string): ResolveResult {
		const normalized = handle as ElementHandle;
		if (!HANDLE_PATTERN.test(handle)) {
			return this.fail(session, tab, normalized, "not_found", notFoundError(handle));
		}
		const entry = this.entries.get(this.primaryKey(session, tab, normalized));
		if (!entry) {
			if (this.findSessionHandle(session, normalized)) {
				return this.fail(
					session,
					tab,
					normalized,
					"scope_mismatch",
					scopeMismatchError(handle, session, tab),
				);
			}
			return this.fail(session, tab, normalized, "not_found", notFoundError(handle));
		}
		if (this.isExpired(entry)) {
			this.removeEntry(this.primaryKey(entry.session, entry.tab, entry.handle), entry);
			return this.fail(session, tab, normalized, "expired", notFoundError(handle));
		}
		const current = this.pageEpochs.get(entry.chromeTabId) ?? null;
		if (!current) return this.fail(session, tab, normalized, "no_epoch_data", staleError(handle));
		if (current.epoch !== entry.pageEpoch)
			return this.fail(session, tab, normalized, "stale_epoch", staleError(handle));
		if (current.url !== entry.pageUrl)
			return this.fail(session, tab, normalized, "stale_url", staleError(handle));
		this.logger?.info({ event: "handle_resolve", handle, session, tab, outcome: "ok" });
		return { ok: true, target: entry.target };
	}

	invalidateForTab(chromeTabId: number): void {
		this.deleteByTabIndex(chromeTabId, "tab_close");
		this.pageEpochs.delete(chromeTabId);
	}

	invalidateForSession(session: SessionId): void {
		const keys = this.sessionIndex.get(session);
		if (!keys || keys.size === 0) return;
		const matched = this.collectEntries(keys);
		for (const entry of matched) {
			this.removeEntry(this.primaryKey(entry.session, entry.tab, entry.handle), entry);
		}
		logInvalidate(this.logger, { session }, "session_close", matched.length);
	}

	invalidateForScope(
		session: SessionId,
		tab: TabHandle,
		sourceAction: HandleSourceAction,
		logIfEmpty = true,
		cause = "reread",
	): void {
		const scopeKey = this.scopeKey(session, tab, sourceAction);
		const keys = this.scopeIndex.get(scopeKey);
		if (!keys || keys.size === 0) {
			if (logIfEmpty) logInvalidate(this.logger, { session, tab }, cause, 0);
			return;
		}
		const count = keys.size;
		const snapshot = Array.from(keys); // snapshot: removeEntry mutates the set
		for (const key of snapshot) {
			const entry = this.entries.get(key);
			if (entry) this.removeEntry(key, entry);
		}
		logInvalidate(this.logger, { session, tab }, cause, count);
	}

	handleNavigation(chromeTabId: number, url: string): void {
		const current = this.pageEpochs.get(chromeTabId);
		const epoch = current ? current.epoch + 1 : 0;
		this.pageEpochs.set(chromeTabId, { epoch, url });
		this.deleteByTabIndex(chromeTabId, "navigation");
	}

	getPageEpoch(chromeTabId: number): PageEpoch | null {
		return this.pageEpochs.get(chromeTabId) ?? null;
	}

	clearPageEpochs(): void {
		this.pageEpochs.clear();
	}

	size(): number {
		return this.entries.size;
	}

	private mintEntries(
		session: SessionId,
		tab: TabHandle,
		chromeTabId: number,
		sourceAction: HandleSourceAction,
		entries: Array<ElementInfo | LinkInfo>,
		pageUrl: string,
		pageEpoch: number,
	): HandleEntry[] {
		const minted: HandleEntry[] = [];
		let ordinal = 0;
		for (const entry of entries) {
			const resolved = resolveActionableTarget(sourceAction, entry);
			if (!resolved) continue;
			ordinal += 1;
			const handle = buildHandle(sourceAction, ordinal);
			entry.handle = handle;
			const createdAt = this.now();
			const stored: HandleEntry = {
				handle,
				session,
				tab,
				chromeTabId,
				sourceAction,
				target: resolved.target,
				pageUrl,
				pageEpoch,
				createdAt,
				hints: resolved.hints,
			};
			this.addEntry(stored);
			minted.push(stored);
		}
		this.enforceScopeCap(session, tab, sourceAction);
		this.enforceGlobalCap();
		return minted;
	}

	private addEntry(entry: HandleEntry): void {
		const key = this.primaryKey(entry.session, entry.tab, entry.handle);
		this.entries.set(key, entry);
		addToIndex(this.scopeIndex, this.scopeKey(entry.session, entry.tab, entry.sourceAction), key);
		addToIndex(this.tabIndex, entry.chromeTabId, key);
		addToIndex(this.sessionIndex, entry.session, key);
	}

	private removeEntry(key: string, entry: HandleEntry): void {
		this.entries.delete(key);
		removeFromIndex(
			this.scopeIndex,
			this.scopeKey(entry.session, entry.tab, entry.sourceAction),
			key,
		);
		removeFromIndex(this.tabIndex, entry.chromeTabId, key);
		removeFromIndex(this.sessionIndex, entry.session, key);
	}

	private enforceScopeCap(
		session: SessionId,
		tab: TabHandle,
		sourceAction: HandleSourceAction,
	): void {
		const scopeKey = this.scopeKey(session, tab, sourceAction);
		const keys = this.scopeIndex.get(scopeKey);
		if (!keys || keys.size <= this.perScopeCap) return;
		const sorted = this.collectEntries(keys);
		const excess = sorted.length - this.perScopeCap;
		for (const entry of sorted.slice(0, excess)) {
			this.removeEntry(this.primaryKey(entry.session, entry.tab, entry.handle), entry);
		}
		logInvalidate(this.logger, { session, tab }, "scope_cap", excess);
	}

	private enforceGlobalCap(): void {
		if (this.entries.size <= this.globalCap) return;
		const sorted = [...this.entries.values()].sort(compareByAge);
		const excess = sorted.length - this.globalCap;
		for (const entry of sorted.slice(0, excess)) {
			this.removeEntry(this.primaryKey(entry.session, entry.tab, entry.handle), entry);
		}
		logInvalidate(this.logger, undefined, "global_cap", excess);
	}

	private deleteByTabIndex(chromeTabId: number, cause: string): void {
		const keys = this.tabIndex.get(chromeTabId);
		if (!keys || keys.size === 0) return;
		const matched = this.collectEntries(keys);
		for (const entry of matched) {
			this.removeEntry(this.primaryKey(entry.session, entry.tab, entry.handle), entry);
		}
		if (matched.length > 0) {
			for (const group of groupByScope(matched)) {
				logInvalidate(this.logger, group.scope, cause, group.count);
			}
		}
	}

	private collectEntries(keys: Set<string>): HandleEntry[] {
		const result: HandleEntry[] = [];
		for (const key of keys) {
			const entry = this.entries.get(key);
			if (entry) result.push(entry);
		}
		return result.sort(compareByAge);
	}

	private fail(
		session: SessionId,
		tab: TabHandle,
		handle: ElementHandle,
		outcome: string,
		error: HandleError,
	): ResolveResult {
		this.logger?.info({ event: "handle_resolve", handle, session, tab, outcome });
		return { ok: false, error };
	}

	private primaryKey(session: SessionId, tab: TabHandle, handle: ElementHandle): string {
		return `${session}:${tab}:${handle}`;
	}

	private scopeKey(session: SessionId, tab: TabHandle, sourceAction: HandleSourceAction): string {
		return `${session}:${tab}:${sourceAction}`;
	}

	private isExpired(entry: HandleEntry): boolean {
		return this.now() - entry.createdAt > this.ttlMs;
	}

	private findSessionHandle(session: SessionId, handle: ElementHandle): HandleEntry | null {
		const keys = this.sessionIndex.get(session);
		if (!keys) return null;
		for (const key of keys) {
			const entry = this.entries.get(key);
			if (entry && entry.handle === handle) return entry;
		}
		return null;
	}
}
