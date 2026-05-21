/**
 * Re-export shared protocol types used by CLI commands and client.
 * This module exists so command implementations can import from a
 * single CLI-local path without reaching into shared internals.
 */
export type { Action, ActionParams, BproxyRequest, BproxyResponse } from "@bproxy/shared";
