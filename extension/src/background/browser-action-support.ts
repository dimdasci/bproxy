import type { BproxyError, PageState } from "@bproxy/shared";
import { snapshotPageState } from "../content/page-state";
import type { TabLike } from "./tabs";

export function pageStateFromTab(tab: TabLike): PageState {
	return snapshotPageState({
		url: tab.url ?? "",
		title: tab.title ?? "",
		readyState: tab.status === "complete" ? "complete" : "loading",
	});
}

export function emptyPageState(): PageState {
	return { url: "", title: "", state: "ready", busy: false };
}

export function parseCapturedImage(value: string): { base64: string; format: "png" | "jpeg" } {
	const match = /^data:image\/(png|jpeg);base64,(.+)$/u.exec(value);
	if (match) {
		return {
			format: match[1] === "jpeg" ? "jpeg" : "png",
			base64: match[2] ?? "",
		};
	}
	return { format: "png", base64: value };
}

export function evalDisabledError(): BproxyError {
	return {
		code: "EVAL_DISABLED",
		category: "policy",
		retry: "never",
		message: "Eval mode is off in the browser extension.",
		suggestedAction:
			"Ask a human to open the bproxy extension popup, enable Eval mode, then retry with --allow-eval.",
	};
}

export function debuggerDisabledError(): BproxyError {
	return {
		code: "DEBUGGER_DISABLED",
		category: "policy",
		retry: "never",
		message:
			"Debugger-backed screenshots are disabled unless the extension is reloaded with an explicit opt-in.",
		suggestedAction:
			"Retry without --debugger, or enable the debugger screenshot path in the extension build.",
	};
}

export function humanRequiredError(
	message: string,
	details: Record<string, unknown> & { suggestedAction?: string },
): BproxyError {
	return {
		code: "HUMAN_REQUIRED",
		category: "policy",
		retry: "conditional",
		message,
		suggestedAction:
			details.suggestedAction ??
			(details["forAttach"]
				? "Complete the requested browser action manually, then run `bproxy session resume`."
				: "Resolve the page state in the browser, then run `bproxy session resume`."),
		details,
	};
}

export function navigationFailed(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "NAVIGATION_FAILED",
		category: "execution",
		retry: "conditional",
		message,
		details,
	};
}

export function tabNotVisible(tabId: number): BproxyError {
	return {
		code: "TAB_NOT_VISIBLE",
		category: "execution",
		retry: "conditional",
		message: `Target tab ${tabId} is not visible for captureVisibleTab`,
		details: { tabId },
	};
}

export function scriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
