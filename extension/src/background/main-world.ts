import type { ActionResult, BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { snapshotPageState } from "../content/page-state";
import { injectedEval } from "./main-world-injected-eval";
import { injectedRuntimeApiFill, RUNTIME_API_PLANS } from "./main-world-injected-runtime-api";
import type { PageSnapshot } from "./main-world-injected-types";

export interface MainWorldExecuteDetails<
	Args extends readonly unknown[] = readonly unknown[],
	Result = unknown,
> {
	target: { tabId: number };
	world: "MAIN";
	func: (...args: Args) => Result;
	args: Args;
}

export interface MainWorldScriptingSeam {
	executeScript(details: MainWorldExecuteDetails): Promise<Array<{ result?: unknown }>>;
}

export interface MainWorldExecution<A extends "fill" | "eval"> {
	data: ActionResult[A];
	page: PageState;
}

export interface MainWorldExecutor {
	executeRuntimeApiFill(
		request: BproxyForwardedRequest<"fill">,
	): Promise<MainWorldExecution<"fill">>;
	executeEval(request: BproxyForwardedRequest<"eval">): Promise<MainWorldExecution<"eval">>;
}

export interface MainWorldExecutorDeps {
	scripting: MainWorldScriptingSeam;
}

interface MainWorldErrorData {
	code: BproxyError["code"];
	message: string;
	details?: Record<string, unknown>;
}

export function createMainWorldExecutor(deps: MainWorldExecutorDeps): MainWorldExecutor {
	return {
		async executeRuntimeApiFill(request) {
			const result = await executeSingleResult(deps.scripting, {
				target: { tabId: request.target.tabId },
				world: "MAIN",
				func: injectedRuntimeApiFill,
				args: [request.params.target, request.params.value, RUNTIME_API_PLANS] as const,
			});
			if (!result.ok) throw toBproxyError(result.error);
			return {
				data: {
					filled: result.filled,
					verifiedValue: result.verifiedValue,
				},
				page: toPageState(result.page),
			};
		},
		async executeEval(request) {
			const result = await executeSingleResult(deps.scripting, {
				target: { tabId: request.target.tabId },
				world: "MAIN",
				func: injectedEval,
				args: [request.params.code] as const,
			});
			if (!result.ok) throw toBproxyError(result.error);
			return {
				data: { result: result.result },
				page: toPageState(result.page),
			};
		},
	};
}

async function executeSingleResult<Args extends readonly unknown[], Result>(
	scripting: MainWorldScriptingSeam,
	details: MainWorldExecuteDetails<Args, Result>,
): Promise<Result> {
	const executions = await scripting.executeScript(details as unknown as MainWorldExecuteDetails);
	const first = executions[0];
	if (!first || !("result" in first)) {
		throw scriptError("MAIN-world execution returned no result");
	}
	return first.result as Result;
}

function toPageState(snapshot: PageSnapshot): PageState {
	return snapshotPageState(snapshot);
}

function toBproxyError(error: MainWorldErrorData): BproxyError {
	return {
		code: error.code,
		category: isTargetError(error.code) ? "target" : "execution",
		retry: "conditional",
		message: error.message,
		details: error.details,
	};
}

function isTargetError(code: BproxyError["code"]): boolean {
	return code === "ELEMENT_NOT_FOUND" || code === "SELECTOR_AMBIGUOUS";
}

function scriptError(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
		details,
	};
}
