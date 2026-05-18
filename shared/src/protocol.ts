import type { Action, ActionParams, ActionResult } from "./actions";
import type { BproxyError } from "./errors";

export interface BproxyRequest<A extends Action = Action> {
	protocol_version: 1;
	id: string;
	action: A;
	params: ActionParams[A];
	session: string;
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
 * Only browser/tab/`debug.log` actions are forwarded. `session.*`,
 * `debug.last`, and `debug.status` are handled daemon-locally and never
 * carry a `target`.
 */
export type BproxyForwardedRequest<A extends Action = Action> = BproxyRequest<A> & {
	target: { tabId: number };
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
