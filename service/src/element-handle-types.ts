import type { ElementHandle, ElementTarget, SessionId, TabHandle } from "@bproxy/shared";
import type { Logger } from "pino";

export type HandleSourceAction = "elements" | "links";

export interface PageEpoch {
	epoch: number;
	url: string;
}

export interface HandleHints {
	tag?: string;
	role?: string;
	textSnippet?: string;
	href?: string;
}

export interface HandleEntry {
	handle: ElementHandle;
	session: SessionId;
	tab: TabHandle;
	chromeTabId: number;
	sourceAction: HandleSourceAction;
	target: ElementTarget;
	pageUrl: string;
	pageEpoch: number;
	createdAt: number;
	hints?: HandleHints;
}

export interface HandleCacheOptions {
	ttlMs?: number;
	perScopeCap?: number;
	globalCap?: number;
	now?: () => number;
	logger?: Pick<Logger, "info" | "debug">;
}

export type ResolveResult = { ok: true; target: ElementTarget } | { ok: false; error: HandleError };

export interface HandleError {
	code: "ELEMENT_HANDLE_NOT_FOUND" | "ELEMENT_HANDLE_STALE" | "ELEMENT_HANDLE_SCOPE_MISMATCH";
	category: "target";
	retry: "conditional" | "never";
	message: string;
	details?: Record<string, unknown>;
}
