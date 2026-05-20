import type {
	BproxyError,
	BproxyForwardedRequest,
	BproxyRequest,
	BproxyResponse,
} from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { PendingMap } from "./pending";
import type { SessionRegistry } from "./sessions";

export interface DispatchDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	sessions: SessionRegistry;
	onForwarded?: (info: { id: string; wsClient: string; tab: number }) => void;
}

export interface DispatchEngine {
	send(cmd: BproxyRequest): Promise<BproxyResponse>;
}

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
			function run() {
				let p: Promise<T>;
				try {
					p = fn();
				} catch (e) {
					reject(e);
					unlock(tabId);
					return;
				}
				p.then(
					(v) => {
						resolve(v);
						unlock(tabId);
					},
					(e: unknown) => {
						reject(e);
						unlock(tabId);
					},
				);
			}

			if (!locked.get(tabId)) {
				locked.set(tabId, true);
				run();
			} else {
				let queue = queues.get(tabId);
				if (!queue) {
					queue = [];
					queues.set(tabId, queue);
				}
				queue.push(run);
			}
		});
	};
}

export function createDispatch(deps: DispatchDeps): DispatchEngine {
	const withTabLock = createTabLock();

	return {
		async send(cmd) {
			const client = deps.clients.any();
			if (!client) {
				return errorResponse(cmd.id, {
					code: "NO_EXTENSION",
					category: "transport",
					retry: "conditional",
					message: "No extension WebSocket client is connected",
				});
			}

			const session = deps.sessions.getOrCreate(cmd.session);

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

			if (session.tabId === null) {
				return errorResponse(cmd.id, {
					code: "TAB_NOT_FOUND",
					category: "target",
					retry: "never",
					message: `Session '${cmd.session}' has no bound tab`,
				});
			}

			const tabId = session.tabId;
			const forwarded: BproxyForwardedRequest = { ...cmd, target: { tabId } };
			return withTabLock(tabId, () =>
				deps.pending.register(forwarded, (wireCmd) => {
					deps.onForwarded?.({ id: wireCmd.id, wsClient: client.id, tab: tabId });
					client.send(wireCmd);
				}),
			);
		},
	};
}
