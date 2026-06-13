import type {
	ElementHandle,
	ElementInfo,
	ElementTarget,
	LinkInfo,
	SessionId,
	TabHandle,
} from "@bproxy/shared";
import type {
	HandleEntry,
	HandleError,
	HandleHints,
	HandleSourceAction,
} from "./element-handle-types";

export function buildHandle(sourceAction: HandleSourceAction, ordinal: number): ElementHandle {
	return `${sourceAction === "elements" ? "el" : "ln"}${ordinal}` as ElementHandle;
}

export function resolveActionableTarget(
	sourceAction: HandleSourceAction,
	entry: ElementInfo | LinkInfo,
): { target: ElementTarget; hints?: HandleHints } | null {
	if (sourceAction === "elements") return resolveElementTarget(entry as ElementInfo);
	return resolveLinkTarget(entry as LinkInfo);
}

export function compareByAge(left: HandleEntry, right: HandleEntry): number {
	return left.createdAt - right.createdAt;
}

export function groupByScope(
	entries: HandleEntry[],
): Array<{ scope: { session: SessionId; tab: TabHandle }; count: number }> {
	const groups = new Map<
		string,
		{ scope: { session: SessionId; tab: TabHandle }; count: number }
	>();
	for (const entry of entries) {
		const key = `${entry.session}:${entry.tab}`;
		const current = groups.get(key);
		if (current) {
			current.count += 1;
			continue;
		}
		groups.set(key, { scope: { session: entry.session, tab: entry.tab }, count: 1 });
	}
	return [...groups.values()];
}

export function notFoundError(handle: string): HandleError {
	return {
		code: "ELEMENT_HANDLE_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message: `Element handle '${handle}' was not found or has expired`,
		details: { handle },
	};
}

export function staleError(handle: string): HandleError {
	return {
		code: "ELEMENT_HANDLE_STALE",
		category: "target",
		retry: "conditional",
		message: `Element handle '${handle}' is stale for the current page`,
		details: { handle },
	};
}

export function scopeMismatchError(
	handle: string,
	session: SessionId,
	tab: TabHandle,
): HandleError {
	return {
		code: "ELEMENT_HANDLE_SCOPE_MISMATCH",
		category: "target",
		retry: "never",
		message: `Element handle '${handle}' does not belong to session '${session}' tab '${tab}'`,
		details: { handle, session, tab },
	};
}

function resolveElementTarget(
	entry: ElementInfo,
): { target: ElementTarget; hints?: HandleHints } | null {
	const target = pickElementTarget(entry);
	if (!target) return null;
	return {
		target,
		hints: { tag: entry.tag, role: entry.role, textSnippet: entry.label ?? entry.placeholder },
	};
}

function resolveLinkTarget(entry: LinkInfo): { target: ElementTarget; hints?: HandleHints } | null {
	const target = pickElementTarget(entry.target);
	if (!target) return null;
	return { target, hints: { href: entry.href, textSnippet: entry.text } };
}

function pickElementTarget(target: unknown): ElementTarget | null {
	if (!target || typeof target !== "object") return null;
	const record = target as Record<string, unknown>;
	if (typeof record["selector"] === "string") return { selector: record["selector"] };
	if (record["route"] && typeof record["route"] === "object") {
		return { route: record["route"] as Extract<ElementTarget, { route: unknown }>["route"] };
	}
	return null;
}
