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
