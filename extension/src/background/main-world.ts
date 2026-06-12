import type { ActionResult, BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { snapshotPageState } from "../content/page-state";
import {
	injectedRuntimeApiFill,
	type MainWorldFillResult,
	RUNTIME_API_PLANS,
} from "./main-world-injected-runtime-api";
import type { PageSnapshot } from "./main-world-injected-types";

export interface MainWorldExecuteDetails<
	Args extends readonly unknown[] = readonly unknown[],
	Result = unknown,
> {
	target: { tabId: number };
	world: "MAIN";
	func: (...args: Args) => Result;
	args: Args;
	debugName?: string;
}

export interface MainWorldScriptingSeam {
	executeScript(details: MainWorldExecuteDetails): Promise<Array<{ result?: unknown }>>;
}

export interface MainWorldExecution {
	data: ActionResult["fill"];
	page: PageState;
}

export interface MainWorldExecutor {
	executeRuntimeApiFill(request: BproxyForwardedRequest<"fill">): Promise<MainWorldExecution>;
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
			const executed = await executeSingleResult(deps.scripting, {
				target: { tabId: requireTargetTabId(request) },
				world: "MAIN",
				func: injectedRuntimeApiFill,
				args: [request.params.target, request.params.value, RUNTIME_API_PLANS] as const,
				debugName: "runtime-api fill",
			});
			const result = requireMainWorldEnvelope<MainWorldFillResult>(
				executed.value,
				"runtime-api fill",
				executed.executions,
			);
			if (!result.ok) throw toBproxyError(result.error);
			return {
				data: {
					filled: result.filled,
					verifiedValue: result.verifiedValue,
				},
				page: toPageState(result.page),
			};
		},
	};
}

function requireTargetTabId(request: BproxyForwardedRequest<"fill">): number {
	if (typeof request.target.tabId === "number") return request.target.tabId;
	throw scriptError(`${request.action} requires a target tab id`);
}

async function executeSingleResult<Args extends readonly unknown[], Result>(
	scripting: MainWorldScriptingSeam,
	details: MainWorldExecuteDetails<Args, Result>,
): Promise<{ value: Result; executions: Array<{ result?: unknown }> }> {
	const scriptDetails = {
		target: details.target,
		world: details.world,
		func: details.func,
		args: details.args,
	};
	const executions = await scripting.executeScript(
		scriptDetails as unknown as MainWorldExecuteDetails,
	);
	const first = executions[0];
	if (!first || !("result" in first)) {
		throw malformedExecuteScriptResult(details.debugName, executions);
	}
	return { value: first.result as Result, executions };
}

function parseMainWorldEnvelope<T extends { ok: boolean; page: PageSnapshot }>(
	value: unknown,
): { ok: true; value: T } | { ok: false } {
	if (
		!value ||
		typeof value !== "object" ||
		!("ok" in value) ||
		typeof (value as { ok?: unknown }).ok !== "boolean" ||
		!("page" in value) ||
		!(value as { page?: unknown }).page ||
		typeof (value as { page?: unknown }).page !== "object"
	) {
		return { ok: false };
	}
	return { ok: true, value: value as T };
}

function requireMainWorldEnvelope<T extends { ok: boolean; page: PageSnapshot }>(
	value: unknown,
	debugName: string,
	executions: Array<{ result?: unknown }>,
): T {
	const parsed = parseMainWorldEnvelope<T>(value);
	if (!parsed.ok) throw malformedExecuteScriptResult(debugName, executions);
	return parsed.value;
}

function malformedExecuteScriptResult(
	debugName: string | undefined,
	executions: Array<{ result?: unknown }>,
): BproxyError {
	const label = debugName ? `MAIN-world ${debugName}` : "MAIN-world execution";
	return scriptError(
		`${label} returned an unexpected executeScript result`,
		malformedExecuteScriptResultDetails(executions),
	);
}

function malformedExecuteScriptResultDetails(
	executions: Array<{ result?: unknown }>,
): Record<string, unknown> {
	const first = executions[0];
	const firstResult = first && "result" in first ? first.result : undefined;
	const firstResultObjectKeys = objectKeys(firstResult);
	const firstResultPreview = previewValue(firstResult);
	return {
		executions,
		executionsLength: executions.length,
		hasFirstExecution: first !== undefined,
		firstExecution: first,
		hasResultField: Boolean(first && "result" in first),
		firstResult,
		firstResultType: describeValueType(firstResult),
		firstResultObjectKeys,
		firstResultPreview,
	};
}

function objectKeys(value: unknown): string[] | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return Object.keys(value as Record<string, unknown>);
}

function previewValue(value: unknown): unknown {
	if (value === null || value === undefined || typeof value !== "object") return value;
	if (Array.isArray(value)) return { kind: "array", length: value.length };
	return value;
}

function describeValueType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
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
