import type { BproxyError } from "@bproxy/shared";
import type { PageSnapshot } from "./main-world-injected-types";

type MainWorldErrorData = {
	code: BproxyError["code"];
	message: string;
	details?: Record<string, unknown>;
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

export function injectedEval(code: string): MainWorldEvalResult {
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
	} catch (error) {
		const details = describeThrown(error);
		return {
			ok: false,
			error: {
				code: "SCRIPT_ERROR",
				message: `MAIN-world eval failed: ${details.message}`,
				details,
			},
			page: page(),
		};
	}

	function describeThrown(error: unknown): Record<string, unknown> & { message: string } {
		if (error instanceof Error) {
			return {
				name: error.name,
				message: error.message,
			};
		}
		return { message: String(error) };
	}

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
