import type {
	Action,
	BproxyError,
	BproxyForwardedRequest,
	BproxyRequest,
	BproxyResponse,
	ElementTarget,
} from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { ElementHandleCache } from "./element-handles";
import type { PendingMap } from "./pending";
import type { SessionRegistry } from "./sessions";

export interface DispatchDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	sessions: SessionRegistry;
	elementHandles: ElementHandleCache;
	/** Emitted when a request is forwarded to the extension WS.
	 *  `tab` is the internal Chrome tab id (or null for background-handled actions).
	 *  This value appears only in daemon-side structured logs for operator debugging;
	 *  it is never exposed in CLI stdout, CLI --verbose stderr, or protocol responses. */
	onForwarded?: (info: { id: string; wsClient: string; tab: number | null }) => void;
}

export interface DispatchSendOptions {
	targetTabId?: number | null;
}

export interface DispatchEngine {
	send(cmd: BproxyRequest, options?: DispatchSendOptions): Promise<BproxyResponse>;
}

const BACKGROUND_HANDLED_ACTIONS = new Set<Action>(["tab.open"]);

function errorResponse(id: string, error: BproxyError): BproxyResponse {
	return { protocol_version: 1, id, ok: false, error };
}

// Per-tab FIFO serializer: runs one command at a time per tabId.
function createTabLock() {
	const queues = new Map<number, Array<() => void>>();
	const locked = new Map<number, boolean>();

	function unlock(tabId: number): void {
		const queue = queues.get(tabId);
		if (queue && queue.length > 0) {
			queue.shift()!();
		} else {
			locked.delete(tabId);
			queues.delete(tabId);
		}
	}

	return function withTabLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			async function run() {
				try {
					const result = await fn();
					resolve(result);
				} catch (e) {
					reject(e);
				} finally {
					unlock(tabId);
				}
			}

			if (locked.get(tabId)) {
				let queue = queues.get(tabId);
				if (!queue) {
					queue = [];
					queues.set(tabId, queue);
				}
				queue.push(run);
			} else {
				locked.set(tabId, true);
				void run(); // NOSONAR
			}
		});
	};
}

export function createDispatch(deps: DispatchDeps): DispatchEngine {
	const withTabLock = createTabLock();

	return {
		async send(cmd, options = {}) {
			const client = deps.clients.any();
			if (!client) {
				return errorResponse(cmd.id, {
					code: "NO_EXTENSION",
					category: "transport",
					retry: "conditional",
					message: "No extension WebSocket client is connected",
				});
			}

			const session = deps.sessions.get(cmd.session);
			if (!session) {
				return errorResponse(cmd.id, {
					code: "SESSION_NOT_FOUND",
					category: "target",
					retry: "conditional",
					message: `Session '${cmd.session}' was not found`,
					details: { session: cmd.session },
				});
			}

			// Precedence (normative): paused → unbound → forward.
			// A paused session refuses every forwarded action without going
			// to the WS — daemon-local actions (session.*, debug.last,
			// debug.status) are unaffected because they never reach dispatch.
			if (session.paused) {
				// SessionRegistry.pause() permits an undefined reason; the fallback
				// keeps the WS error message human-readable in that case.
				const reason = session.pauseReason ?? "session paused";
				return errorResponse(cmd.id, {
					code: "HUMAN_REQUIRED",
					category: "policy",
					retry: "never",
					message: `Session '${cmd.session}' is paused: ${reason}`,
				});
			}

			const tabId = resolveTargetTabId(cmd, deps.sessions, options.targetTabId);
			if (tabId.kind === "error") {
				return errorResponse(cmd.id, tabId.error);
			}

			const rewritten = rewriteHandleTargets(cmd, deps, options.targetTabId);
			if (rewritten.kind === "error") {
				return errorResponse(cmd.id, rewritten.error);
			}

			const forwarded: BproxyForwardedRequest = {
				...cmd,
				params: rewritten.params,
				target: { tabId: tabId.value },
			};
			const registerPending = () =>
				deps.pending.register(forwarded, (wireCmd) => {
					deps.onForwarded?.({ id: wireCmd.id, wsClient: client.id, tab: tabId.value });
					client.send(wireCmd);
				});
			if (tabId.value === null) {
				return await registerPending();
			}
			return await withTabLock(tabId.value, registerPending);
		},
	};
}

function rewriteHandleTargets(
	cmd: BproxyRequest,
	deps: DispatchDeps,
	overrideTabId: number | null | undefined,
):
	| { kind: "ok"; params: BproxyForwardedRequest["params"] }
	| { kind: "error"; error: BproxyError } {
	if (overrideTabId !== undefined || BACKGROUND_HANDLED_ACTIONS.has(cmd.action)) {
		return { kind: "ok", params: cmd.params as BproxyForwardedRequest["params"] };
	}
	const bound = deps.sessions.resolveBound(cmd.session);
	if (!bound) {
		return {
			kind: "error",
			error: {
				code: "TAB_NOT_FOUND",
				category: "target",
				retry: "never",
				message: `Session '${cmd.session}' has no bound tab`,
			},
		};
	}
	return resolveParamsForAction(cmd, deps.elementHandles, bound.tab);
}

function resolveParamsForAction(
	cmd: BproxyRequest,
	elementHandles: ElementHandleCache,
	tab: NonNullable<ReturnType<SessionRegistry["resolveBound"]>>["tab"],
):
	| { kind: "ok"; params: BproxyForwardedRequest["params"] }
	| { kind: "error"; error: BproxyError } {
	switch (cmd.action) {
		case "click":
		case "hover":
			return resolveSingleTargetParams(cmd, elementHandles, tab, "target");
		case "fill":
			return resolveSingleTargetParams(cmd, elementHandles, tab, "target");
		case "scroll":
			return resolveOptionalTargetParams(cmd, elementHandles, tab);
		case "select":
			return resolveSingleTargetParams(cmd, elementHandles, tab, "trigger");
		case "fill-form":
			return resolveFillFormParams(cmd, elementHandles, tab);
		default:
			return { kind: "ok", params: cmd.params as BproxyForwardedRequest["params"] };
	}
}

function resolveSingleTargetParams(
	cmd: BproxyRequest,
	elementHandles: ElementHandleCache,
	tab: NonNullable<ReturnType<SessionRegistry["resolveBound"]>>["tab"],
	key: "target" | "trigger",
):
	| { kind: "ok"; params: BproxyForwardedRequest["params"] }
	| { kind: "error"; error: BproxyError } {
	const params = cmd.params as Record<string, unknown>;
	const resolved = resolveClientTarget(cmd, elementHandles, tab, params[key]);
	if (resolved.kind === "error") return resolved;
	return {
		kind: "ok",
		params: { ...params, [key]: resolved.target } as BproxyForwardedRequest["params"],
	};
}

function resolveOptionalTargetParams(
	cmd: BproxyRequest,
	elementHandles: ElementHandleCache,
	tab: NonNullable<ReturnType<SessionRegistry["resolveBound"]>>["tab"],
):
	| { kind: "ok"; params: BproxyForwardedRequest["params"] }
	| { kind: "error"; error: BproxyError } {
	const params = cmd.params as Record<string, unknown>;
	if (params["target"] === undefined) {
		return { kind: "ok", params: params as BproxyForwardedRequest["params"] };
	}
	const resolved = resolveClientTarget(cmd, elementHandles, tab, params["target"]);
	if (resolved.kind === "error") return resolved;
	return {
		kind: "ok",
		params: { ...params, target: resolved.target } as BproxyForwardedRequest["params"],
	};
}

function resolveFillFormParams(
	cmd: BproxyRequest,
	elementHandles: ElementHandleCache,
	tab: NonNullable<ReturnType<SessionRegistry["resolveBound"]>>["tab"],
):
	| { kind: "ok"; params: BproxyForwardedRequest["params"] }
	| { kind: "error"; error: BproxyError } {
	const params = cmd.params as { fields: Array<Record<string, unknown>> };
	const fields: Array<Record<string, unknown>> = [];
	for (const field of params.fields) {
		const resolved = resolveClientTarget(cmd, elementHandles, tab, field["target"]);
		if (resolved.kind === "error") return resolved;
		fields.push({ ...field, target: resolved.target });
	}
	return { kind: "ok", params: { fields } as BproxyForwardedRequest["params"] };
}

function resolveClientTarget(
	cmd: BproxyRequest,
	elementHandles: ElementHandleCache,
	tab: NonNullable<ReturnType<SessionRegistry["resolveBound"]>>["tab"],
	value: unknown,
): { kind: "ok"; target: ElementTarget } | { kind: "error"; error: BproxyError } {
	if (!isHandleRef(value)) return { kind: "ok", target: value as ElementTarget };
	const resolved = elementHandles.resolve(cmd.session, tab, value.handle);
	if (!resolved.ok) return { kind: "error", error: resolved.error };
	return { kind: "ok", target: resolved.target };
}

function isHandleRef(value: unknown): value is { handle: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>)["handle"] === "string"
	);
}

function resolveTargetTabId(
	cmd: BproxyRequest,
	sessions: SessionRegistry,
	overrideTabId: number | null | undefined,
): { kind: "ok"; value: number | null } | { kind: "error"; error: BproxyError } {
	if (overrideTabId !== undefined) {
		return { kind: "ok", value: overrideTabId };
	}
	if (BACKGROUND_HANDLED_ACTIONS.has(cmd.action)) {
		return { kind: "ok", value: null };
	}

	const bound = sessions.resolveBound(cmd.session);
	if (!bound) {
		return {
			kind: "error",
			error: {
				code: "TAB_NOT_FOUND",
				category: "target",
				retry: "never",
				message: `Session '${cmd.session}' has no bound tab`,
			},
		};
	}
	return { kind: "ok", value: bound.chromeTabId };
}
