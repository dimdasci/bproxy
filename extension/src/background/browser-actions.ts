import type { BproxyError, BproxyForwardedRequest } from "@bproxy/shared";
import type { ExecutedAction } from "./dispatcher";
import type { BrowserAction } from "./forwarded-actions";
import type { MainWorldExecutor } from "./main-world";

export interface BrowserActionHandlerDeps {
	mainWorld: MainWorldExecutor;
	isEvalEnabled?: () => boolean | Promise<boolean>;
}

export interface BrowserActionHandler {
	handleBrowserAction(request: BproxyForwardedRequest<BrowserAction>): Promise<ExecutedAction>;
	handleMainWorldFill(request: BproxyForwardedRequest<"fill">): Promise<ExecutedAction>;
}

export function createBrowserActionHandler(deps: BrowserActionHandlerDeps): BrowserActionHandler {
	return {
		handleBrowserAction: async (request) => {
			switch (request.action) {
				case "eval": {
					if (!(await evalEnabled(deps))) throw evalDisabledError();
					return deps.mainWorld.executeEval(request as BproxyForwardedRequest<"eval">);
				}
				default:
					throw new Error(`No extension handler is registered yet for action ${request.action}`);
			}
		},
		handleMainWorldFill: async (request) => {
			assertRuntimeApiFillRequest(request);
			return deps.mainWorld.executeRuntimeApiFill(request);
		},
	};
}

async function evalEnabled(deps: BrowserActionHandlerDeps): Promise<boolean> {
	return (await deps.isEvalEnabled?.()) ?? false;
}

function assertRuntimeApiFillRequest(request: BproxyForwardedRequest<"fill">): void {
	if (request.params.method !== "runtime-api") {
		throw scriptError(`fill method ${request.params.method} must run in the content script`);
	}
	if (request.params.world !== "main") {
		throw scriptError('fill method runtime-api requires world "main"');
	}
}

function evalDisabledError(): BproxyError {
	return {
		code: "EVAL_DISABLED",
		category: "policy",
		retry: "never",
		message: "eval is disabled until an explicit allow-eval flag is wired through daemon and extension config",
		suggestedAction:
			"Phase 4 must wire an explicit allow-eval control to extension config before eval can run.",
	};
}

function scriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}
