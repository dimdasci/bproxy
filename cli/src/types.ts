/**
 * Re-export shared protocol types used by CLI commands and client.
 * This module exists so command implementations can import from a
 * single CLI-local path without reaching into shared internals.
 */
import type { Nick } from "@bproxy/shared";

export interface ClientGlobalArgs {
	nick: Nick;
	session?: string;
	timeout?: string;
	home?: string;
	verbose?: boolean;
}

export type {
	Action,
	ActionParams,
	BproxyRequest,
	BproxyResponse,
	BproxySuccessResponse,
	ClientElementTarget,
	ElementHandle,
	ElementHandleRef,
	ElementRoute,
	ElementTarget,
	ExecutionWorld,
	FillMethod,
	Nick,
	SessionId,
	TabHandle,
} from "@bproxy/shared";
export { isValidNick, PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
