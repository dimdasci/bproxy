import type { Action, BproxyForwardedRequest } from "@bproxy/shared";

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
	"navigate" | "screenshot" | "require-human" | "tab.pin" | "tab.unpin" | "tab.open" | "tab.close"
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
	"inspect",
	"snapshot",
	"scroll",
	"click",
	"hover",
	"screenshot",
	"fill",
	"fill-form",
	"select",
	"wait",
	"require-human",
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
	"inspect",
	"snapshot",
	"scroll",
	"click",
	"hover",
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

export function isBrowserActionRequest(
	request: BproxyForwardedRequest<ForwardedAction>,
): request is BproxyForwardedRequest<BrowserAction> {
	return browserActionSet.has(request.action);
}

export function isDomActionRequest(
	request: BproxyForwardedRequest<ForwardedAction>,
): request is BproxyForwardedRequest<DomAction> {
	return domActionSet.has(request.action);
}
