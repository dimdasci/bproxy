import type { Action, ActionParams, ActionResult, ForwardedActionParams } from "./actions";
import type { BproxyError } from "./errors";
import type { Nick, SessionId } from "./sessions";

export interface BproxyRequest<A extends Action = Action> {
	protocol_version: 1;
	id: string;
	action: A;
	nick: Nick;
	params: ActionParams[A];
	session: SessionId;
	deadline: number; // unix ms
	destructive: boolean;
}

/**
 * On-wire shape for daemon → extension forwarded requests.
 *
 * The CLI's HTTP input is `BproxyRequest` (no target). The daemon owns the
 * mapping `session → tabId` and wraps the request with `target.tabId` before
 * sending it over the WebSocket. Extensions parse this shape, not bare
 * `BproxyRequest`.
 *
 * `target.tabId` may be `null` for background-handled actions that do not
 * require an existing tab (`tab.open`, `tab.list`, `tab.close`). `session.*`,
 * `debug.last`, and `debug.status` remain daemon-local and never carry a
 * `target`.
 */
export type BproxyForwardedRequest<A extends Action = Action> = Omit<BproxyRequest<A>, "params"> & {
	params: ForwardedActionParams[A];
	target: { tabId: number | null };
};

export interface BproxySuccessResponse<A extends Action = Action> {
	protocol_version: 1;
	id: string;
	ok: true;
	data: ActionResult[A];
	page: PageState;
	replay: boolean;
}

export interface BproxyErrorResponse {
	protocol_version: 1;
	id: string;
	ok: false;
	error: BproxyError;
}

export type BproxyResponse<A extends Action = Action> =
	| BproxySuccessResponse<A>
	| BproxyErrorResponse;

export interface PageState {
	url: string;
	title: string;
	state: "loading" | "ready" | "error";
	busy: boolean;
}
