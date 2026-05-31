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
	debugName?: string;
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
			const executed = await executeSingleResult(deps.scripting, {
				target: { tabId: requireTargetTabId(request) },
				world: "MAIN",
				func: injectedRuntimeApiFill,
				args: [request.params.target, request.params.value, RUNTIME_API_PLANS] as const,
				debugName: "runtime-api fill",
			});
			const result = requireMainWorldEnvelope(
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
		async executeEval(request) {
			const tabId = requireTargetTabId(request);
			const executed = await executeSingleResult(deps.scripting, {
				target: { tabId },
				world: "MAIN",
				func: injectedEval,
				args: [request.params.code] as const,
				debugName: "eval",
			});
			const parsed = parseMainWorldEnvelope(executed.value);
			if (!parsed.ok) {
				throw await diagnoseMalformedEvalResult(deps.scripting, tabId, executed.executions);
			}
			const result = parsed.value;
			if (!result.ok) throw toBproxyError(result.error);
			return {
				data: { result: result.result },
				page: toPageState(result.page),
			};
		},
	};
}

function requireTargetTabId(request: BproxyForwardedRequest<"fill" | "eval">): number {
	if (typeof request.target.tabId === "number") return request.target.tabId;
	throw scriptError(`${request.action} requires a target tab id`);
}

async function executeSingleResult<Args extends readonly unknown[], Result>(
	scripting: MainWorldScriptingSeam,
	details: MainWorldExecuteDetails<Args, Result>,
): Promise<{ value: Result; executions: Array<{ result?: unknown }> }> {
	const { debugName: _debugName, ...scriptDetails } = details;
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

async function diagnoseMalformedEvalResult(
	scripting: MainWorldScriptingSeam,
	tabId: number,
	executions: Array<{ result?: unknown }>,
): Promise<BproxyError> {
	const baseDetails = malformedExecuteScriptResultDetails(executions);
	try {
		const probeExecuted = await executeSingleResult(scripting, {
			target: { tabId },
			world: "MAIN",
			func: injectedMainWorldProbe,
			args: [] as const,
			debugName: "eval probe",
		});
		const probeParsed = parseMainWorldEnvelope<{ ok: true; result: unknown; page: PageSnapshot }>(
			probeExecuted.value,
		);
		if (probeParsed.ok && probeParsed.value.ok === true) {
			return scriptError(
				'MAIN-world eval returned null while a non-eval MAIN-world probe succeeded. This page may block string evaluation for extension-injected MAIN-world code (for example via CSP).',
				{
					...baseDetails,
					probe: {
						ok: true,
						executions: probeExecuted.executions,
						result: probeParsed.value.result,
						page: probeParsed.value.page,
					},
				},
			);
		}
		return scriptError('MAIN-world eval returned an unexpected executeScript result', {
			...baseDetails,
			probe: {
				ok: false,
				executions: probeExecuted.executions,
				value: probeExecuted.value,
				valueType: describeValueType(probeExecuted.value),
			},
		});
	} catch (error) {
		return scriptError('MAIN-world eval returned an unexpected executeScript result', {
			...baseDetails,
			probeError: normalizeErrorDetails(error),
		});
	}
}

function malformedExecuteScriptResult(
	debugName: string | undefined,
	executions: Array<{ result?: unknown }>,
): BproxyError {
	const label = debugName ? `MAIN-world ${debugName}` : "MAIN-world execution";
	return scriptError(`${label} returned an unexpected executeScript result`,
		malformedExecuteScriptResultDetails(executions),
	);
}

function malformedExecuteScriptResultDetails(
	executions: Array<{ result?: unknown }>,
): Record<string, unknown> {
	const first = executions[0];
	const firstResult = first && "result" in first ? first.result : undefined;
	const firstResultObjectKeys =
		firstResult && typeof firstResult === "object" && !Array.isArray(firstResult)
			? Object.keys(firstResult as Record<string, unknown>)
			: undefined;
	const firstResultPreview =
		firstResult === null || firstResult === undefined || typeof firstResult !== "object"
			? firstResult
			: Array.isArray(firstResult)
				? { kind: "array", length: firstResult.length }
				: firstResult;
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

function describeValueType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function normalizeErrorDetails(error: unknown): Record<string, unknown> {
	if (isBproxyError(error)) {
		return {
			code: error.code,
			message: error.message,
			details: error.details,
		};
	}
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	return { message: String(error) };
}

function isBproxyError(error: unknown): error is BproxyError {
	return !!error && typeof error === "object" && "code" in error && "message" in error;
}

function injectedMainWorldProbe(): { ok: true; result: { probe: true; value: number }; page: PageSnapshot } {
	return {
		ok: true,
		result: { probe: true, value: 2 },
		page: {
			url: globalThis.location.href,
			title: document.title,
			readyState:
				document.readyState === "interactive" || document.readyState === "complete"
					? document.readyState
					: "loading",
			busyHint: hasBusyHint(),
		},
	};

	function hasBusyHint(): boolean {
		try {
			return (
				document.querySelector(
					'[aria-busy="true"], [role="progressbar"], progress:not([value])',
				) !== null
			);
		} catch {
			return false;
		}
	}
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
