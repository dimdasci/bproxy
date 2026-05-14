import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";

type SendFn = (cmd: BproxyRequest) => void;

interface PendingEntry {
	cmd: BproxyRequest;
	promise: Promise<BproxyResponse>;
	resolve: (r: BproxyResponse) => void;
	timer: NodeJS.Timeout;
}

export interface PendingOptions {
	maxSize: number;
	now?: () => number;
}

export interface PendingMap {
	register(cmd: BproxyRequest, send: SendFn): Promise<BproxyResponse>;
	resolveById(id: string, response: BproxyResponse): void;
	replayForClient(send: SendFn, ids?: readonly string[]): void;
	delete(id: string): void;
	size(): number;
}

function errorResponse(id: string, error: BproxyError): BproxyResponse {
	return { protocol_version: 1, id, ok: false, error };
}

function timeoutResponse(id: string): BproxyResponse {
	return errorResponse(id, {
		code: "TIMEOUT",
		category: "transport",
		retry: "conditional",
		message: `Request ${id} exceeded its deadline`,
	});
}

function overloadedResponse(id: string): BproxyResponse {
	return errorResponse(id, {
		code: "OVERLOADED",
		category: "transport",
		retry: "safe",
		message: "Daemon pending map is full",
	});
}

function makeEntry(
	cmd: BproxyRequest,
	entries: Map<string, PendingEntry>,
	now: () => number,
): PendingEntry {
	let resolveOuter!: (r: BproxyResponse) => void;
	const promise = new Promise<BproxyResponse>((resolve) => {
		resolveOuter = resolve;
	});
	const wait = Math.max(0, cmd.deadline - now());
	const timer = setTimeout(() => {
		const e = entries.get(cmd.id);
		if (!e) return;
		entries.delete(cmd.id);
		e.resolve(timeoutResponse(cmd.id));
	}, wait);
	return { cmd, promise, resolve: resolveOuter, timer };
}

export function createPending(opts: PendingOptions): PendingMap {
	const entries = new Map<string, PendingEntry>();
	const now = opts.now ?? (() => Date.now());

	return {
		register(cmd, send) {
			const existing = entries.get(cmd.id);
			if (existing) return existing.promise;
			if (entries.size >= opts.maxSize) {
				return Promise.resolve(overloadedResponse(cmd.id));
			}
			const entry = makeEntry(cmd, entries, now);
			entries.set(cmd.id, entry);
			send(cmd);
			return entry.promise;
		},

		resolveById(id, response) {
			const e = entries.get(id);
			if (!e) return;
			clearTimeout(e.timer);
			entries.delete(id);
			e.resolve(response);
		},

		replayForClient(send, ids) {
			const filter = ids ? new Set(ids) : null;
			for (const [id, entry] of entries) {
				if (filter && !filter.has(id)) continue;
				send({ ...entry.cmd });
			}
		},

		delete(id) {
			const e = entries.get(id);
			if (!e) return;
			clearTimeout(e.timer);
			entries.delete(id);
		},

		size() {
			return entries.size;
		},
	};
}
