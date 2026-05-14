import type { PacingMode, SessionInfo, TabInfo } from "./sessions";

export type Action =
	| "navigate"
	| "text"
	| "images"
	| "elements"
	| "outline"
	| "dom"
	| "scroll"
	| "screenshot"
	| "fill"
	| "fill-form"
	| "select"
	| "wait"
	| "require-human"
	| "eval"
	| "tab.list"
	| "tab.pin"
	| "tab.unpin"
	| "tab.open"
	| "tab.close"
	| "session.list"
	| "session.bind"
	| "session.unbind"
	| "session.resume"
	| "debug.log"
	| "debug.last"
	| "debug.status";

// ─── Supporting Types ──────────────────────────────────────────────────

export type FillMethod = "direct" | "paste" | "runtime-api";
export type ExecutionWorld = "isolated" | "main";

/** Shadow-DOM route representation (ADR-014) */
export interface ElementRoute {
	hosts: Array<{ selector: string; index?: number }>; // shadow host chain from document
	target: string; // selector within deepest shadow root
}

/** Target must be exactly one strategy: light-DOM selector or shadow route */
export type ElementTarget =
	| { selector: string; route?: never }
	| { selector?: never; route: ElementRoute };

/**
 * Composed from ElementTarget so an ElementInfo can be passed directly
 * anywhere an ElementTarget is expected.
 */
export type ElementInfo = ElementTarget & {
	tag: string;
	type?: string; // input type
	label?: string;
	value?: string;
	placeholder?: string;
	required?: boolean;
	options?: string[]; // for select/dropdown
	role?: string;
	// Framework/runtime markers for method selection
	hasShadowRoot?: boolean;
	runtimeHandle?: "quill" | "lexical" | "prosemirror" | "codemirror" | "monaco" | "slate";
};

export interface Landmark {
	tag: string;
	role: string;
	label?: string;
}

export interface Heading {
	level: number;
	text: string;
}

export interface TraceEntry {
	id: string;
	action: string;
	tab: number;
	timestamp: number;
	elapsed: number;
	result: "ok" | "error";
	errorCode?: string;
	replay: boolean;
}

export interface DaemonRequestTrace {
	id: string;
	action: string;
	session: string;
	receivedAt: number;
	elapsedMs: number;
	ok: boolean;
	errorCode?: string;
	replayed?: boolean;
}

// ─── Per-action params ─────────────────────────────────────────────────

export interface ActionParams {
	navigate: { url: string };
	text: { selector?: string };
	images: { selector?: string };
	elements: { form?: boolean };
	outline: Record<string, never>;
	dom: { selector?: string; depth?: number };
	scroll: { by?: string; direction?: "up" | "down"; untilStable?: boolean };
	screenshot: { activate?: boolean; debugger?: boolean };
	fill: {
		target: ElementTarget;
		value: string;
		method: FillMethod;
		world: ExecutionWorld;
	};
	"fill-form": {
		fields: Array<{
			target: ElementTarget;
			value: string;
			method: FillMethod;
			world: ExecutionWorld;
		}>;
	};
	select: { trigger: ElementTarget; optionText: string };
	wait: { strategy: "selector" | "url" | "navigation"; target: string; timeout?: number };
	"require-human": { reason: string; forAttach?: string };
	eval: { code: string };
	"tab.list": Record<string, never>;
	"tab.pin": { tabId?: number };
	"tab.unpin": Record<string, never>;
	"tab.open": { url: string };
	"tab.close": { tabId?: number };
	"session.list": Record<string, never>;
	"session.bind": { tabId: number; pacing?: PacingMode };
	"session.unbind": Record<string, never>;
	"session.resume": Record<string, never>;
	"debug.log": { id?: string; limit?: number };
	"debug.last": { count?: number };
	"debug.status": Record<string, never>;
}

// ─── Per-action results ────────────────────────────────────────────────

export interface ActionResult {
	navigate: { url: string; title: string; loadTime: number };
	text: { text: string };
	images: { images: Array<{ src: string; alt: string; width: number; height: number }> };
	elements: { elements: Array<ElementInfo> };
	outline: { landmarks: Array<Landmark>; headings: Array<Heading> };
	dom: { html: string };
	scroll: { before: number; after: number; scrolledPx: number; stable: boolean };
	screenshot: { base64: string; format: "png" | "jpeg" };
	fill: { filled: boolean; verifiedValue: string };
	"fill-form": {
		results: Array<{ target: ElementTarget; filled: boolean; verifiedValue: string }>;
	};
	select: { selected: boolean; optionText: string };
	wait: { matched: boolean; elapsed: number };
	"require-human": { resumed: boolean };
	eval: { result: unknown };
	"tab.list": { tabs: Array<TabInfo> };
	"tab.pin": { tabId: number };
	"tab.unpin": Record<string, never>;
	"tab.open": { tabId: number; url: string };
	"tab.close": Record<string, never>;
	"session.list": { sessions: Array<SessionInfo> };
	"session.bind": { session: string; tabId: number };
	"session.unbind": Record<string, never>;
	"session.resume": { session: string };
	"debug.log": { entries: Array<TraceEntry> };
	"debug.last": { requests: Array<DaemonRequestTrace> };
	"debug.status": {
		daemon: { pid: number; port: number; uptimeSec: number };
		wsClients: Array<{ id: string; connectedAt: number }>;
		sessions: Array<SessionInfo>;
		pausedSessions: Array<{ session: string; reason?: string }>;
	};
}

// ─── Compile-time guard ────────────────────────────────────────────────
// Every Action must have ActionParams and ActionResult entries.
// If this line errors, a new Action was added without updating both interfaces.
// Suppress unused-type warnings — these exist only for the compile-time check.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time guard
type _AssertParams = { [A in Action]: ActionParams[A] };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time guard
type _AssertResults = { [A in Action]: ActionResult[A] };
