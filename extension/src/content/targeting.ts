import type { BproxyError, ElementRoute, ElementTarget } from "@bproxy/shared";

export interface TargetingDeps {
	document?: Document;
}

type QueryRoot = Document | ShadowRoot;

type SelectorCandidate = {
	selector: string;
	index?: number;
};

const SELECTOR_ATTRS = ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label"];

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

export function createStableSelector(
	element: Element,
	root: QueryRoot = getElementRoot(element),
): string {
	for (const selector of createSelectorCandidates(element)) {
		if (selectsExactly(root, selector, element)) return selector;
	}

	const segments: string[] = [];
	let current: Element | null = element;
	while (current) {
		segments.unshift(createPathSegment(current));
		const selector = segments.join(" > ");
		if (selectsExactly(root, selector, element)) return selector;
		current = getSelectorParent(current, root);
	}

	return segments.join(" > ");
}

function createRouteHostSelector(host: Element, root: QueryRoot): SelectorCandidate {
	for (const selector of createSelectorCandidates(host)) {
		const matches = queryAll(root, selector, { kind: "generated-host", selector });
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

function createSelectorCandidates(element: Element): string[] {
	const candidates = new Set<string>();
	pushCandidate(candidates, idSelector(element));
	for (const selector of attributeSelectors(element, [
		...SELECTOR_ATTRS,
		"placeholder",
		"role",
		"type",
	])) {
		pushCandidate(candidates, selector);
	}
	if (element.getAttribute("contenteditable")?.trim() === "true") {
		pushCandidate(candidates, '[contenteditable="true"]');
	}
	return [...candidates];
}

function createPathSegment(element: Element): string {
	const id = element.id.trim();
	if (id.length > 0) return `${tagNameOf(element)}#${escapeCssIdentifier(id)}`;

	const firstAttributeSelector = attributeSelectors(element, [
		...SELECTOR_ATTRS,
		"placeholder",
		"role",
		"type",
	])[0];
	if (firstAttributeSelector) return firstAttributeSelector;

	if (element.getAttribute("contenteditable") === "true") {
		return `${tagNameOf(element)}[contenteditable="true"]`;
	}

	return `${tagNameOf(element)}:nth-of-type(${nthOfType(element)})`;
}

function getSelectorParent(element: Element, root: QueryRoot): Element | null {
	const parent = element.parentElement;
	if (!parent) return null;
	return getElementRoot(parent) === root ? parent : null;
}

function selectsExactly(root: QueryRoot, selector: string, expected: Element): boolean {
	const matches = queryAll(root, selector, { kind: "generated-selector", selector });
	return matches.length === 1 && matches[0] === expected;
}

function queryAll(root: QueryRoot, selector: string, details: Record<string, unknown>): Element[] {
	try {
		return Array.from(root.querySelectorAll(selector));
	} catch (error) {
		throw invalidSelector(selector, details, error);
	}
}

function nthOfType(element: Element): number {
	const parent = element.parentElement;
	const siblings = parent ? Array.from(parent.children) : getRootChildren(getElementRoot(element));
	const sameTag = siblings.filter((candidate) => tagNameOf(candidate) === tagNameOf(element));
	return sameTag.indexOf(element) + 1;
}

function getRootChildren(root: QueryRoot): Element[] {
	return Array.from(root.children ?? []);
}

function getElementRoot(element: Element): QueryRoot {
	const root = element.getRootNode();
	if (isShadowRootLike(root)) return root;
	return (element.ownerDocument ?? document) as Document;
}

function tagNameOf(element: Element): string {
	return element.tagName.toLowerCase();
}

function idSelector(element: Element): string | undefined {
	const id = element.id.trim();
	return id.length > 0 ? `#${escapeCssIdentifier(id)}` : undefined;
}

function attributeSelectors(element: Element, attrs: string[]): string[] {
	return attrs
		.map((attr) => selectorForAttribute(element, attr))
		.filter((value): value is string => typeof value === "string");
}

function selectorForAttribute(element: Element, attr: string): string | undefined {
	const value = element.getAttribute(attr)?.trim();
	if (!value) return undefined;
	return `${tagNameOf(element)}[${attr}="${escapeCssString(value)}"]`;
}

function pushCandidate(candidates: Set<string>, selector: string | undefined): void {
	if (selector) candidates.add(selector);
}

function hasOpenShadowRoot(element: Element): element is Element & { shadowRoot: ShadowRoot } {
	return isShadowRootLike(element.shadowRoot);
}

function isShadowRootLike(value: unknown): value is ShadowRoot {
	return (
		typeof value === "object" && value !== null && "host" in value && "querySelectorAll" in value
	);
}

function escapeCssIdentifier(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function escapeCssString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
