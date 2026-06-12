import type { BproxyError, ElementRoute, ElementTarget } from "@bproxy/shared";
import { isShadowRootLike } from "./dom-helpers";
import {
	createNthPathSegment,
	createPathSegment,
	createSelectorCandidates,
	getElementRoot,
	getSelectorParent,
	hasOpenShadowRoot,
	type QueryRoot,
	tagNameOf,
} from "./selector-utils";

export interface TargetingDeps {
	document?: Document;
}

type SelectorCandidate = {
	selector: string;
	index?: number;
};

export function resolveElementTarget(target: ElementTarget, deps: TargetingDeps = {}): Element {
	const doc = deps.document ?? document;
	if (typeof target.selector === "string")
		return resolveSelectorTarget(target.selector, { document: doc });
	return resolveRouteTarget(target.route, { document: doc });
}

export function resolveSelectorTarget(selector: string, deps: TargetingDeps = {}): Element {
	const doc = deps.document ?? document;
	return resolveUniqueSelector(selector, doc, { kind: "selector", selector });
}

export function resolveRouteTarget(route: ElementRoute, deps: TargetingDeps = {}): Element {
	let root: QueryRoot = deps.document ?? document;

	for (const [hostOffset, host] of route.hosts.entries()) {
		const matches = queryAll(root, host.selector, {
			kind: "route-host",
			selector: host.selector,
			hostOffset,
		});
		if (matches.length === 0) {
			throw elementNotFound(`No shadow host matched route selector ${host.selector}`, {
				hostOffset,
				selector: host.selector,
			});
		}
		const selected = selectRouteHost(matches, host.selector, host.index, hostOffset);
		if (!hasOpenShadowRoot(selected)) {
			throw elementNotFound(`Shadow host ${host.selector} has no open shadow root`, {
				hostOffset,
				selector: host.selector,
				closedShadow: true,
			});
		}
		root = selected.shadowRoot;
	}

	return resolveUniqueSelector(route.target, root, {
		kind: "route-target",
		selector: route.target,
	});
}

export function createElementTarget(element: Element): ElementTarget {
	const root = getElementRoot(element);
	if (!isShadowRootLike(root)) {
		return { selector: createStableSelector(element, root) };
	}

	const hosts: ElementRoute["hosts"] = [];
	let currentRoot: QueryRoot = root;
	while (isShadowRootLike(currentRoot)) {
		const host = currentRoot.host;
		const parentRoot = getElementRoot(host);
		hosts.unshift(createRouteHostSelector(host, parentRoot));
		currentRoot = parentRoot;
	}

	return {
		route: {
			hosts,
			target: createStableSelector(element, root),
		},
	};
}

export function safeCreateElementTarget(element: Element): ElementTarget | undefined {
	try {
		return createElementTarget(element);
	} catch {
		return undefined;
	}
}

export function createStableSelector(
	element: Element,
	root: QueryRoot = getElementRoot(element),
): string {
	for (const selector of createSelectorCandidates(element)) {
		if (selectsExactly(root, selector, element)) return selector;
	}

	const preferredPath = createPathSelector(element, root, createPathSegment);
	if (preferredPath) return preferredPath;

	return (
		createPathSelector(element, root, createNthPathSegment) ??
		buildPathSelector(element, root, createNthPathSegment) ??
		tagNameOf(element)
	);
}

function createRouteHostSelector(host: Element, root: QueryRoot): SelectorCandidate {
	for (const selector of createSelectorCandidates(host)) {
		const matches = tryQueryAll(root, selector);
		if (!matches) continue;
		const index = matches.indexOf(host);
		if (index === -1) continue;
		if (matches.length === 1) return { selector };
		return { selector, index };
	}
	return { selector: createStableSelector(host, root) };
}

function resolveUniqueSelector(
	selector: string,
	root: QueryRoot,
	details: Record<string, unknown>,
): Element {
	const matches = queryAll(root, selector, details);
	if (matches.length === 0) {
		throw elementNotFound(`No element matched selector ${selector}`, { selector, ...details });
	}
	if (matches.length > 1) {
		throw selectorAmbiguous(`Selector ${selector} matched ${matches.length} elements`, {
			selector,
			count: matches.length,
			...details,
		});
	}
	return matches[0] as Element;
}

function selectRouteHost(
	matches: Element[],
	selector: string,
	index: number | undefined,
	hostOffset: number,
): Element {
	if (index !== undefined) {
		const selected = matches[index];
		if (!selected) {
			throw elementNotFound(`Shadow host index ${index} is out of range for selector ${selector}`, {
				hostOffset,
				selector,
				index,
				count: matches.length,
			});
		}
		return selected;
	}
	if (matches.length > 1) {
		throw selectorAmbiguous(`Shadow host selector ${selector} matched ${matches.length} elements`, {
			hostOffset,
			selector,
			count: matches.length,
		});
	}
	return matches[0] as Element;
}

function createPathSelector(
	element: Element,
	root: QueryRoot,
	segmentFor: (element: Element) => string,
): string | undefined {
	const segments: string[] = [];
	let current: Element | null = element;
	while (current) {
		segments.unshift(segmentFor(current));
		const selector = segments.join(" > ");
		if (selectsExactly(root, selector, element)) return selector;
		current = getSelectorParent(current, root);
	}
	return undefined;
}

function buildPathSelector(
	element: Element,
	root: QueryRoot,
	segmentFor: (element: Element) => string,
): string | undefined {
	const segments: string[] = [];
	let current: Element | null = element;
	while (current) {
		segments.unshift(segmentFor(current));
		current = getSelectorParent(current, root);
	}
	return segments.length > 0 ? segments.join(" > ") : undefined;
}

function selectsExactly(root: QueryRoot, selector: string, expected: Element): boolean {
	const matches = tryQueryAll(root, selector);
	return Boolean(matches?.length === 1 && matches[0] === expected);
}

function queryAll(root: QueryRoot, selector: string, details: Record<string, unknown>): Element[] {
	try {
		return Array.from(root.querySelectorAll(selector));
	} catch (error) {
		throw invalidSelector(selector, details, error);
	}
}

function tryQueryAll(root: QueryRoot, selector: string): Element[] | null {
	try {
		return Array.from(root.querySelectorAll(selector));
	} catch {
		return null;
	}
}

function elementNotFound(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "ELEMENT_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message,
		details,
	};
}

function selectorAmbiguous(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "SELECTOR_AMBIGUOUS",
		category: "target",
		retry: "conditional",
		message,
		details,
	};
}

function invalidSelector(
	selector: string,
	details: Record<string, unknown>,
	cause: unknown,
): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: `Invalid selector ${selector}`,
		details: {
			selector,
			cause: cause instanceof Error ? cause.message : String(cause),
			...details,
		},
	};
}
