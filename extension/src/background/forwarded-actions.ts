import type { Action } from "@bproxy/shared";

export type ForwardedAction = Exclude<
	Action,
	| "tab.list"
	| "session.create"
	| "session.list"
	| "session.bind"
	| "session.unbind"
	| "session.resume"
	| "session.close"
	| "debug.last"
	| "debug.status"
>;

export type BrowserAction = Extract<
	ForwardedAction,
	| "navigate"
	| "screenshot"
	| "require-human"
	| "eval"
	| "tab.pin"
	| "tab.unpin"
	| "tab.open"
	| "tab.close"
>;

export type DomAction = Exclude<ForwardedAction, BrowserAction | "debug.log">;

const FORWARDED_ACTIONS = [
	"navigate",
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"scroll",
	"screenshot",
	"fill",
	"fill-form",
	"select",
	"wait",
	"require-human",
	"eval",
	"tab.pin",
	"tab.unpin",
	"tab.open",
	"tab.close",
	"debug.log",
] as const satisfies readonly ForwardedAction[];

const BROWSER_ACTIONS = [
	"navigate",
	"screenshot",
	"require-human",
	"eval",
	"tab.pin",
	"tab.unpin",
	"tab.open",
	"tab.close",
] as const satisfies readonly BrowserAction[];

const DOM_ACTIONS = [
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"scroll",
	"fill",
	"fill-form",
	"select",
	"wait",
] as const satisfies readonly DomAction[];

const forwardedActionSet = new Set<string>(FORWARDED_ACTIONS);
const browserActionSet = new Set<string>(BROWSER_ACTIONS);
const domActionSet = new Set<string>(DOM_ACTIONS);

export function isForwardedAction(action: string): action is ForwardedAction {
	return forwardedActionSet.has(action);
}

export function isBrowserAction(action: ForwardedAction): action is BrowserAction {
	return browserActionSet.has(action);
}

export function isDomAction(action: ForwardedAction): action is DomAction {
	return domActionSet.has(action);
}
