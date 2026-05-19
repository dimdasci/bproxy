import type { ActionResult, BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { snapshotPageState } from "../content/page-state";


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

type RuntimeApiPlan = {
	locate: string[];
	write:
		| {
				kind: "method";
				name: string;
				tail?: unknown[];
		  }
		| {
				kind: 1;
		  };
	read?:
		| {
				kind: "method";
				name: string;
		  }
		| {
				kind: 1;
		  };
	trimTrailingNewline?: boolean;
};

type PageSnapshot = {
	url: string;
	title: string;
	readyState: "loading" | "interactive" | "complete";
	busyHint: boolean;
};

type MainWorldErrorData = {
	code: BproxyError["code"];
	message: string;
	details?: Record<string, unknown>;
};

type MainWorldFillResult =
	| {
			ok: true;
			filled: boolean;
			verifiedValue: string;
			page: PageSnapshot;
	  }
	| {
			ok: false;
			error: MainWorldErrorData;
			page: PageSnapshot;
	  };

type MainWorldEvalResult =
	| {
			ok: true;
			result: unknown;
			page: PageSnapshot;
	  }
	| {
			ok: false;
			error: MainWorldErrorData;
			page: PageSnapshot;
	  };

const RUNTIME_API_PLANS: RuntimeApiPlan[] = [
	{
		locate: ["__quill"],
		write: { kind: "method", name: "setText", tail: ["api"] },
		read: { kind: "method", name: "getText" },
		trimTrailingNewline: true,
	},
	{
		locate: ["__monacoEditor"],
		write: { kind: "method", name: "setValue" },
		read: { kind: "method", name: "getValue" },
	},
	{
		locate: ["cmView"],
		write: { kind: 1 },
		read: { kind: 1 },
	},
];

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
		category: error.code === "ELEMENT_NOT_FOUND" || error.code === "SELECTOR_AMBIGUOUS" ? "target" : "execution",
		retry: "conditional",
		message: error.message,
		details: error.details,
	};
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

function injectedRuntimeApiFill(
	target: unknown,
	value: string,
	plans: RuntimeApiPlan[],
): MainWorldFillResult {
	const page = (): PageSnapshot => ({
		url: globalThis.location.href,
		title: document.title,
		readyState:
			document.readyState === "interactive" || document.readyState === "complete"
				? document.readyState
				: "loading",
		busyHint: hasBusyHint(),
	});
	const fail = (error: MainWorldErrorData): MainWorldFillResult => ({ ok: false, error, page: page() });
	try {
		const resolved = resolveTarget(target);
		if (!resolved.ok) return fail(resolved.error);
		const matched = findRuntimeHandle(resolved.element, plans);
		if (!matched) {
			return fail({
				code: "SCRIPT_ERROR",
				message: "No supported runtime editor handle was found at the target",
			});
		}
		const verifiedValue = applyRuntimeWrite(matched.handle, matched.plan, value);
		return {
			ok: true,
			filled: verifiedValue === value,
			verifiedValue,
			page: page(),
		};
	} catch {
		return fail({
			code: "SCRIPT_ERROR",
			message: "Runtime editor write failed",
		});
	}

	function resolveTarget(input: unknown):
		| { ok: true; element: Element }
		| { ok: false; error: MainWorldErrorData } {
		if (!input || typeof input !== "object") {
			return { ok: false, error: { code: "SCRIPT_ERROR", message: "Target is invalid" } };
		}
		if ("selector" in input && typeof input.selector === "string") {
			return resolveUniqueSelector(document, input.selector, { kind: "selector" });
		}
		if ("route" in input && input.route && typeof input.route === "object") {
			return resolveRoute(input.route as { hosts?: unknown; target?: unknown });
		}
		return { ok: false, error: { code: "SCRIPT_ERROR", message: "Target is invalid" } };
	}

	function resolveRoute(route: { hosts?: unknown; target?: unknown }):
		| { ok: true; element: Element }
		| { ok: false; error: MainWorldErrorData } {
		if (!Array.isArray(route.hosts) || typeof route.target !== "string") {
			return { ok: false, error: { code: "SCRIPT_ERROR", message: "Route target is invalid" } };
		}
		let root: Document | ShadowRoot = document;
		for (let offset = 0; offset < route.hosts.length; offset += 1) {
			const host = route.hosts[offset];
			if (!host || typeof host !== "object") {
				return { ok: false, error: { code: "SCRIPT_ERROR", message: "Route host is invalid" } };
			}
			const selector = "selector" in host && typeof host.selector === "string" ? host.selector : null;
			const index = "index" in host && Number.isInteger(host.index) ? host.index : undefined;
			if (!selector) {
				return { ok: false, error: { code: "SCRIPT_ERROR", message: "Route host selector is invalid" } };
			}
			const resolvedHost = resolveRouteHost(root, selector, index, offset);
			if (!resolvedHost.ok) return resolvedHost;
			const shadowRoot = resolvedHost.element.shadowRoot;
			if (!shadowRoot) {
				return {
					ok: false,
					error: {
						code: "ELEMENT_NOT_FOUND",
						message: `Shadow host ${selector} has no open shadow root`,
						details: { selector, hostOffset: offset, closedShadow: true },
					},
				};
			}
			root = shadowRoot;
		}
		return resolveUniqueSelector(root, route.target, { kind: "route-target" });
	}

	function resolveRouteHost(
		root: Document | ShadowRoot,
		selector: string,
		index: number | undefined,
		hostOffset: number,
	): { ok: true; element: Element } | { ok: false; error: MainWorldErrorData } {
		const matches = queryAll(root, selector);
		if (!matches.ok) {
			return {
				ok: false,
				error: {
					code: "SCRIPT_ERROR",
					message: `Invalid selector ${selector}`,
					details: { selector, hostOffset, cause: matches.message },
				},
			};
		}
		if (matches.elements.length === 0) {
			return {
				ok: false,
				error: {
					code: "ELEMENT_NOT_FOUND",
					message: `No shadow host matched route selector ${selector}`,
					details: { selector, hostOffset },
				},
			};
		}
		if (index !== undefined) {
			const selected = matches.elements[index];
			if (!selected) {
				return {
					ok: false,
					error: {
						code: "ELEMENT_NOT_FOUND",
						message: `Shadow host index ${index} is out of range for selector ${selector}`,
						details: { selector, hostOffset, index, count: matches.elements.length },
					},
				};
			}
			return { ok: true, element: selected };
		}
		if (matches.elements.length > 1) {
			return {
				ok: false,
				error: {
					code: "SELECTOR_AMBIGUOUS",
					message: `Shadow host selector ${selector} matched ${matches.elements.length} elements`,
					details: { selector, hostOffset, count: matches.elements.length },
				},
			};
		}
		return { ok: true, element: matches.elements[0] as Element };
	}

	function resolveUniqueSelector(
		root: Document | ShadowRoot,
		selector: string,
		details: Record<string, unknown>,
	): { ok: true; element: Element } | { ok: false; error: MainWorldErrorData } {
		const matches = queryAll(root, selector);
		if (!matches.ok) {
			return {
				ok: false,
				error: {
					code: "SCRIPT_ERROR",
					message: `Invalid selector ${selector}`,
					details: { selector, cause: matches.message, ...details },
				},
			};
		}
		if (matches.elements.length === 0) {
			return {
				ok: false,
				error: {
					code: "ELEMENT_NOT_FOUND",
					message: `No element matched selector ${selector}`,
					details: { selector, ...details },
				},
			};
		}
		if (matches.elements.length > 1) {
			return {
				ok: false,
				error: {
					code: "SELECTOR_AMBIGUOUS",
					message: `Selector ${selector} matched ${matches.elements.length} elements`,
					details: { selector, count: matches.elements.length, ...details },
				},
			};
		}
		return { ok: true, element: matches.elements[0] as Element };
	}

	function queryAll(
		root: Document | ShadowRoot,
		selector: string,
	): { ok: true; elements: Element[] } | { ok: false; message: string } {
		try {
			return { ok: true, elements: Array.from(root.querySelectorAll(selector)) };
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
	}

	function findRuntimeHandle(
		element: Element,
		items: RuntimeApiPlan[],
	): { plan: RuntimeApiPlan; handle: Record<string, unknown> } | null {
		for (const candidate of elementChain(element)) {
			for (const plan of items) {
				const handle = readPath(candidate as unknown as Record<string, unknown>, plan.locate);
				if (isRecord(handle)) return { plan, handle };
			}
		}
		return null;
	}

	function elementChain(start: Element): Element[] {
		const chain: Element[] = [];
		let current: Element | null = start;
		while (current) {
			chain.push(current);
			if (current.parentElement) {
				current = current.parentElement;
				continue;
			}
			const root = current.getRootNode();
			current = isShadowRoot(root) ? root.host : null;
		}
		return chain;
	}

	function applyRuntimeWrite(handle: Record<string, unknown>, plan: RuntimeApiPlan, nextValue: string): string {
		if (plan.write.kind === 1) {
			const dispatch = handle["dispatch"];
			const state = handle["state"];
			const docValue = isRecord(state) ? state["doc"] : undefined;
			const length = isRecord(docValue) && typeof docValue["length"] === "number" ? docValue["length"] : 0;
			if (typeof dispatch !== "function") throw new Error("missing dispatch");
			dispatch.call(handle, { changes: { from: 0, to: length, insert: nextValue } });
			return readVerifiedValue(handle, plan, nextValue);
		}
		const method = handle[plan.write.name];
		if (typeof method !== "function") throw new Error("missing write method");
		method.call(handle, nextValue, ...(plan.write.tail ?? []));
		return readVerifiedValue(handle, plan, nextValue);
	}

	function readVerifiedValue(
		handle: Record<string, unknown>,
		plan: RuntimeApiPlan,
		fallback: string,
	): string {
		if (!plan.read) return fallback;
		if (plan.read.kind === 1) {
			const state = handle["state"];
			const docValue = isRecord(state) ? state["doc"] : undefined;
			const toString = isRecord(docValue) ? docValue["toString"] : undefined;
			if (typeof toString !== "function") return fallback;
			return normalizeValue(toString.call(docValue), plan) ?? fallback;
		}
		const method = handle[plan.read.name];
		if (typeof method !== "function") return fallback;
		return normalizeValue(method.call(handle), plan) ?? fallback;
	}

	function normalizeValue(input: unknown, plan: RuntimeApiPlan): string | undefined {
		if (typeof input !== "string") return undefined;
		return plan.trimTrailingNewline ? input.replace(/\r?\n$/, "") : input;
	}

	function readPath(value: Record<string, unknown>, path: string[]): unknown {
		let current: unknown = value;
		for (const key of path) {
			if (!isRecord(current) || !(key in current)) return undefined;
			current = current[key];
		}
		return current;
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null;
	}

	function isShadowRoot(value: unknown): value is ShadowRoot {
		return typeof value === "object" && value !== null && "host" in value;
	}

	function hasBusyHint(): boolean {
		try {
			return (
				document.querySelector('[aria-busy="true"], [role="progressbar"], progress:not([value])') !==
				null
			);
		} catch {
			return false;
		}
	}
}

function injectedEval(code: string): MainWorldEvalResult {
	const page = (): PageSnapshot => ({
		url: globalThis.location.href,
		title: document.title,
		readyState:
			document.readyState === "interactive" || document.readyState === "complete"
				? document.readyState
				: "loading",
		busyHint: hasBusyHint(),
	});
	try {
		const result = globalThis.Function(code).call(globalThis);
		return { ok: true, result, page: page() };
	} catch {
		return {
			ok: false,
			error: {
				code: "SCRIPT_ERROR",
				message: "MAIN-world eval failed",
			},
			page: page(),
		};
	}

	function hasBusyHint(): boolean {
		try {
			return (
				document.querySelector('[aria-busy="true"], [role="progressbar"], progress:not([value])') !==
				null
			);
		} catch {
			return false;
		}
	}
}
