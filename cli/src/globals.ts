/**
 * Shared global argument definitions and extraction for citty commands.
 *
 * Citty subcommands don't inherit parent args, so each leaf command must
 * define the global flags it needs. This module provides:
 * - `globalArgs`: arg definitions to spread into command `args`
 * - `extractGlobals`: extract ClientGlobalArgs from parsed citty args
 */

import { executeExitPlan, exitUsageError } from "./exit.js";
import { type ClientGlobalArgs, isValidNick, type SessionId, type TabHandle } from "./types.js";

/**
 * Global arg definitions for leaf commands.
 * Spread these into each command's args object.
 */
export const SESSION_ID_PATTERN = /^[a-z2-7]{6}$/;
export const TAB_HANDLE_PATTERN = /^t[1-9]\d*$/;

export function parseSessionId(value: string): SessionId | null {
	return SESSION_ID_PATTERN.test(value) ? (value as SessionId) : null;
}

export function parseTabHandle(value: string): TabHandle | null {
	return TAB_HANDLE_PATTERN.test(value) ? (value as TabHandle) : null;
}

export const globalArgs = {
	nick: {
		type: "string" as const,
		alias: "n",
		description: "Agent nickname for request scoping",
	},
	session: {
		type: "string" as const,
		alias: "s",
		description: "Session ID for the request",
	},
	timeout: {
		type: "string" as const,
		description: "Protocol deadline in milliseconds",
	},
	home: {
		type: "string" as const,
		description: "Override BPROXY_HOME state directory",
	},
	verbose: {
		type: "boolean" as const,
		alias: "v",
		description: "Write structured diagnostics to stderr",
		default: false,
	},
} as const;

/**
 * Extract ClientGlobalArgs from a citty parsed-args object.
 */
export interface ExtractGlobalsDeps {
	onUsageError?: (message: string) => never;
}

export function extractGlobals(
	args: Record<string, unknown>,
	deps: ExtractGlobalsDeps = {},
): ClientGlobalArgs {
	const fail =
		deps.onUsageError ??
		((message: string): never => {
			executeExitPlan(exitUsageError(message));
			throw new Error("unreachable");
		});

	const nick = typeof args["nick"] === "string" ? args["nick"] : undefined;
	if (!nick) {
		return fail("Missing required --nick (-n). Every command requires an agent nickname.");
	}
	if (!isValidNick(nick)) {
		return fail(`Invalid --nick value: ${nick}. Must match /^[a-z][a-z0-9]{5}$/.`);
	}

	return {
		nick,
		session: typeof args["session"] === "string" ? args["session"] : undefined,
		timeout: typeof args["timeout"] === "string" ? args["timeout"] : undefined,
		home: typeof args["home"] === "string" ? args["home"] : undefined,
		verbose: typeof args["verbose"] === "boolean" ? args["verbose"] : undefined,
	};
}
