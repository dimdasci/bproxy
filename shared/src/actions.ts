import type { ErrorCode } from "./errors";
import type { PacingMode, SessionId, SessionInfo, TabHandle, TabInfo } from "./sessions";

export type Action =
	| "navigate"
	| "text"
	| "links"
	| "images"
	| "elements"
	| "outline"
	| "dom"
	| "inspect"
	| "snapshot"
	| "scroll"
	| "screenshot"
	| "fill"
	| "fill-form"
	| "select"
	| "wait"
	| "require-human"
	| "tab.list"
	| "tab.pin"
	| "tab.unpin"
	| "tab.open"
	| "tab.close"
	| "session.create"
	| "session.list"
	| "session.bind"
	| "session.unbind"
	| "session.resume"
	| "session.close"
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

export interface LinkInfo {
	text: string;
	href: string;
	target: ElementTarget;
	title?: string;
	rel?: string;
	targetAttr?: string;
	visible?: boolean;
}

export interface Landmark {
	tag: string;
	role: string;
	label?: string;
}

export interface Heading {
	level: number;
	text: string;
}

export interface InspectElement {
	index: number;
	tag: string;
	id: string;
	classes: string;
	role: string;
	ariaLabel: string;
	rect: { x: number; y: number; width: number; height: number };
	computed: Record<string, string>;
	children: number;
	descendants: number;
	textLength: number;
	scrollable: boolean;
	scrollInfo?: { scrollTop: number; scrollHeight: number; clientHeight: number };
	selector: string;
}

export interface TraceEntry {
	id: string;
	action: Action;
	tab: number;
	timestamp: number;
	elapsed: number;
	result: "ok" | "error";
	errorCode?: ErrorCode;
	replay: boolean;
	/** Extension build version. Used to detect stale-build entries served
	 *  from a ring buffer after the extension was reloaded. */
	extensionVersion: string;
}

export interface DaemonRequestTrace {
	id: string;
	action: Action;
	session: SessionId;
	receivedAt: number;
	elapsedMs: number;
	ok: boolean;
	errorCode?: ErrorCode;
	replayed?: boolean;
}

// ─── Per-action params ─────────────────────────────────────────────────

export interface ActionParams {
	navigate: { url: string };
	text: { selector?: string };
	links: { selector?: string; visibleOnly?: boolean; limit?: number };
	images: { selector?: string };
	elements: { form?: boolean };
	outline: Record<string, never>;
	dom: { selector?: string; depth?: number };
	inspect: { selector: string; properties?: string[]; limit?: number };
	snapshot: { selector?: string; maxDepth?: number; interactiveOnly?: boolean };
	scroll: { target?: ElementTarget; by?: string; direction?: "up" | "down" };
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
	"tab.list": Record<string, never>;
	"tab.pin": { tab?: TabHandle };
	"tab.unpin": { tab?: TabHandle };
	"tab.open": { url: string };
	"tab.close": { tab?: TabHandle };
	"session.create": { label?: string };
	"session.list": Record<string, never>;
	"session.bind": { tab: TabHandle; pacing?: PacingMode };
	"session.unbind": Record<string, never>;
	"session.resume": Record<string, never>;
	"session.close": Record<string, never>;
	"debug.log": { id?: string; limit?: number };
	"debug.last": { count?: number };
	"debug.status": Record<string, never>;
}

// ─── Per-action results ────────────────────────────────────────────────

export interface ActionResult {
	navigate: { url: string; title: string; loadTime: number };
	text: { text: string };
	links: { links: Array<LinkInfo> };
	images: { images: Array<{ src: string; alt: string; width: number; height: number }> };
	elements: { elements: Array<ElementInfo> };
	outline: { landmarks: Array<Landmark>; headings: Array<Heading> };
	dom: { html: string };
	inspect: { elements: Array<InspectElement>; total: number };
	snapshot: { tree: string; nodeCount: number };
	scroll: {
		target: "viewport" | "element";
		before: number;
		after: number;
		scrolledPx: number;
		moved: boolean;
		stable: boolean;
		scrollHeight?: number;
		clientHeight?: number;
	};
	screenshot: { base64: string; format: "png" | "jpeg" };
	fill: { filled: boolean; verifiedValue: string };
	"fill-form": {
		results: Array<{ target: ElementTarget; filled: boolean; verifiedValue: string }>;
	};
	select: { selected: boolean; optionText: string };
	wait: { matched: boolean; elapsed: number };
	"require-human": { resumed: boolean };
	"tab.list": { session: SessionId; tabs: Array<TabInfo> };
	"tab.pin": { tab: TabHandle; pinned: true };
	"tab.unpin": { tab: TabHandle; pinned: false };
	"tab.open": { session: SessionId; tab: TabHandle; bound: boolean; url: string };
	"tab.close": { tab: TabHandle; closed: true };
	"session.create": { session: SessionId; label?: string };
	"session.list": { sessions: Array<SessionInfo> };
	"session.bind": { session: SessionId; tab: TabHandle };
	"session.unbind": Record<string, never>;
	"session.resume": { session: SessionId };
	"session.close": { session: SessionId; closedTabs: number };
	"debug.log": { entries: Array<TraceEntry> };
	"debug.last": { requests: Array<DaemonRequestTrace> };
	"debug.status": {
		daemon: { pid: number; port: number; uptimeSec: number };
		wsClients: Array<{ id: string; connectedAt: number }>;
		sessions: Array<SessionInfo>;
		sessionTabs: Array<{ session: SessionId; tabs: Array<TabInfo> }>;
		pausedSessions: Array<{ session: SessionId; reason?: string }>;
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
