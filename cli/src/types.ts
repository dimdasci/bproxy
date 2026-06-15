/**
 * Re-export shared protocol types used by CLI commands and client.
 * This module exists so command implementations can import from a
 * single CLI-local path without reaching into shared internals.
 */
export interface ClientGlobalArgs {
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
	ClientElementTarget,
	ElementHandle,
	ElementHandleRef,
	ElementRoute,
	ElementTarget,
	ExecutionWorld,
	FillMethod,
	SessionId,
	TabHandle,
} from "@bproxy/shared";
export { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
