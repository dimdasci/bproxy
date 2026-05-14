import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { PendingMap } from "./pending";
import type { SessionRegistry } from "./sessions";

export interface DispatchDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	sessions: SessionRegistry;
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
			if (session.tabId === null) {
				return errorResponse(cmd.id, {
					code: "TAB_NOT_FOUND",
					category: "target",
					retry: "never",
					message: `Session '${cmd.session}' has no bound tab`,
				});
			}

			return withTabLock(session.tabId, () => deps.pending.register(cmd, client.send));
		},
	};
}
