import type { BproxyError } from "@bproxy/shared";

interface TimeoutDeps {
	setTimeout: (cb: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	rpcTimeoutMs: number;
}

export async function withTimeout(deps: TimeoutDeps, promise: Promise<unknown>): Promise<unknown> {
	let timer: unknown = null;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = deps.setTimeout(() => reject(timeoutError(deps.rpcTimeoutMs)), deps.rpcTimeoutMs);
			}),
		]);
	} finally {
		if (timer !== null) deps.clearTimeout(timer);
	}
}

export function tabNotFoundError(tabId: number): BproxyError {
	return {
		code: "TAB_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message: `Target tab ${tabId} was not found`,
		details: { tabId },
	};
}

export function timeoutError(timeoutMs: number): BproxyError {
	return {
		code: "TIMEOUT",
		category: "transport",
		retry: "conditional",
		message: `Timed out waiting for tab activity after ${timeoutMs}ms`,
		details: { timeoutMs },
	};
}

export function tabRuntimeScriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}
