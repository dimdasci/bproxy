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
	buildHandle,
	compareByAge,
	groupByScope,
	notFoundError,
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
		this.logMint(session, tab, sourceAction, minted);
		return decorated;
	}

	resolve(session: SessionId, tab: TabHandle, handle: string): ResolveResult {
		const normalized = handle as ElementHandle;
		if (!HANDLE_PATTERN.test(handle)) {
			return this.resolveFailure(session, tab, normalized, "not_found", notFoundError(handle));
		}
		const entry = this.entries.get(this.key(session, tab, normalized));
		if (!entry) {
			const scopeMismatch = this.findSessionHandle(session, normalized);
			if (scopeMismatch) {
				return this.resolveFailure(
					session,
					tab,
					normalized,
					"scope_mismatch",
					scopeMismatchError(handle, session, tab),
				);
			}
			return this.resolveFailure(session, tab, normalized, "not_found", notFoundError(handle));
		}
		if (this.isExpired(entry)) {
			this.entries.delete(this.key(entry.session, entry.tab, entry.handle));
			return this.resolveFailure(session, tab, normalized, "expired", notFoundError(handle));
		}
		const current = this.pageEpochs.get(entry.chromeTabId) ?? null;
		if (!current) {
			return this.resolveFailure(session, tab, normalized, "no_epoch_data", staleError(handle));
		}
		if (current.epoch !== entry.pageEpoch) {
			return this.resolveFailure(session, tab, normalized, "stale_epoch", staleError(handle));
		}
		if (current.url !== entry.pageUrl) {
			return this.resolveFailure(session, tab, normalized, "stale_url", staleError(handle));
		}
		this.logger?.info({ event: "handle_resolve", handle, session, tab, outcome: "ok" });
		return { ok: true, target: entry.target };
	}

	invalidateForTab(chromeTabId: number): void {
		this.deleteWhere((entry) => entry.chromeTabId === chromeTabId, "tab_close");
		this.pageEpochs.delete(chromeTabId);
	}

	invalidateForSession(session: SessionId): void {
		this.deleteWhere((entry) => entry.session === session, "session_close");
	}

	invalidateForScope(
		session: SessionId,
		tab: TabHandle,
		sourceAction: HandleSourceAction,
		logIfEmpty = true,
		cause = "reread",
	): void {
		this.deleteWhere(
			(entry) =>
				entry.session === session && entry.tab === tab && entry.sourceAction === sourceAction,
			cause,
			logIfEmpty,
			{ session, tab },
		);
	}

	handleNavigation(chromeTabId: number, url: string): void {
		const current = this.pageEpochs.get(chromeTabId);
		const epoch = current ? current.epoch + 1 : 0;
		this.pageEpochs.set(chromeTabId, { epoch, url });
		this.logNavigationInvalidation(chromeTabId);
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
			this.entries.set(this.key(session, tab, handle), stored);
			minted.push(stored);
		}
		this.enforceScopeCap(session, tab, sourceAction);
		this.enforceGlobalCap();
		return minted;
	}

	private enforceScopeCap(
		session: SessionId,
		tab: TabHandle,
		sourceAction: HandleSourceAction,
	): void {
		const scoped = this.findEntries(
			(entry) =>
				entry.session === session && entry.tab === tab && entry.sourceAction === sourceAction,
		);
		if (scoped.length <= this.perScopeCap) return;
		const toDelete = scoped.slice(0, scoped.length - this.perScopeCap);
		for (const entry of toDelete) {
			this.entries.delete(this.key(entry.session, entry.tab, entry.handle));
		}
		this.logInvalidate({ session, tab }, "scope_cap", toDelete.length);
	}

	private enforceGlobalCap(): void {
		const all = this.findEntries(() => true);
		if (all.length <= this.globalCap) return;
		const toDelete = all.slice(0, all.length - this.globalCap);
		for (const entry of toDelete) {
			this.entries.delete(this.key(entry.session, entry.tab, entry.handle));
		}
		this.logInvalidate(undefined, "global_cap", toDelete.length);
	}

	private deleteWhere(
		predicate: (entry: HandleEntry) => boolean,
		cause: string,
		logIfEmpty = true,
		scope?: { session: SessionId; tab?: TabHandle },
	): void {
		const matched = this.findEntries(predicate);
		for (const entry of matched) {
			this.entries.delete(this.key(entry.session, entry.tab, entry.handle));
		}
		if (matched.length > 0 || logIfEmpty) {
			this.logInvalidate(scope, cause, matched.length);
		}
	}

	private logNavigationInvalidation(chromeTabId: number): void {
		const matched = this.findEntries((entry) => entry.chromeTabId === chromeTabId);
		if (matched.length === 0) return;
		for (const group of groupByScope(matched)) {
			this.logInvalidate(group.scope, "navigation", group.count);
		}
	}

	private logMint(
		session: SessionId,
		tab: TabHandle,
		sourceAction: HandleSourceAction,
		minted: HandleEntry[],
	): void {
		if (minted.length === 0) return;
		this.logger?.info({
			event: "handle_mint",
			session,
			tab,
			sourceAction,
			count: minted.length,
			firstHandle: minted[0]?.handle,
			lastHandle: minted.at(-1)?.handle,
		});
	}

	private logInvalidate(
		scope: { session: SessionId; tab?: TabHandle } | undefined,
		cause: string,
		count: number,
	): void {
		this.logger?.info({
			event: "handle_invalidate",
			session: scope?.session,
			tab: scope?.tab,
			cause,
			count,
		});
	}

	private resolveFailure(
		session: SessionId,
		tab: TabHandle,
		handle: ElementHandle,
		outcome: string,
		error: HandleError,
	): ResolveResult {
		this.logger?.info({ event: "handle_resolve", handle, session, tab, outcome });
		return { ok: false, error };
	}

	private key(session: SessionId, tab: TabHandle, handle: ElementHandle): string {
		return `${session}:${tab}:${handle}`;
	}

	private isExpired(entry: HandleEntry): boolean {
		return this.now() - entry.createdAt > this.ttlMs;
	}

	private findEntries(predicate: (entry: HandleEntry) => boolean): HandleEntry[] {
		return [...this.entries.values()].filter(predicate).sort(compareByAge);
	}

	private findSessionHandle(session: SessionId, handle: ElementHandle): HandleEntry | null {
		for (const entry of this.entries.values()) {
			if (entry.session === session && entry.handle === handle) return entry;
		}
		return null;
	}
}
