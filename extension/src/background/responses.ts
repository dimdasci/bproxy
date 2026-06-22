import {
	type Action,
	type ActionResult,
	type BproxyError,
	type BproxyErrorResponse,
	type BproxyForwardedRequest,
	type BproxySuccessResponse,
	type PageState,
	PROTOCOL_VERSION,
} from "@bproxy/shared";

export interface SuccessInput<A extends Action> {
	request: BproxyForwardedRequest<A>;
	data: ActionResult[A];
	page: PageState;
	replay?: boolean;
}

// `A` defaults to `Action` because error envelopes carry no `data`; call
// sites that don't know the action narrowing can use `ErrorInput` directly.
export interface ErrorInput<A extends Action = Action> {
	request: BproxyForwardedRequest<A>;
	error: BproxyError;
}

// Pure envelope builder. The caller owns capturing `page` (the content
// script returns it on every reply) so the builder stays I/O-free and
// trivially unit-testable.
export function successResponse<A extends Action>(
	input: SuccessInput<A>,
): BproxySuccessResponse<A> {
	return {
		protocol_version: PROTOCOL_VERSION,
		id: input.request.id,
		ok: true,
		data: input.data,
		page: input.page,
		replay: input.replay ?? false,
	};
}

export function errorResponse<A extends Action>(input: ErrorInput<A>): BproxyErrorResponse {
	return {
		protocol_version: PROTOCOL_VERSION,
		id: input.request.id,
		ok: false,
		error: input.error,
	};
}
