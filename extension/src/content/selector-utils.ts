import { escapeCssString, isShadowRootLike } from "./dom-helpers";

export type QueryRoot = Document | ShadowRoot;

const SELECTOR_ATTRS = ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label"];
const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function createSelectorCandidates(element: Element): string[] {
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

export function createPathSegment(element: Element): string {
	const idSelector = pathIdSelector(element);
	if (idSelector) return idSelector;

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

	return createNthPathSegment(element);
}

export function createNthPathSegment(element: Element): string {
	return `${tagNameOf(element)}:nth-of-type(${nthOfType(element)})`;
}

export function getSelectorParent(element: Element, root: QueryRoot): Element | null {
	const parent = element.parentElement;
	if (!parent) return null;
	return getElementRoot(parent) === root ? parent : null;
}

export function getElementRoot(element: Element): QueryRoot {
	const root = element.getRootNode();
	if (isShadowRootLike(root)) return root;
	return (element.ownerDocument ?? document) as Document;
}

export function hasOpenShadowRoot(
	element: Element,
): element is Element & { shadowRoot: ShadowRoot } {
	return isShadowRootLike(element.shadowRoot);
}

export function tagNameOf(element: Element): string {
	return element.tagName.toLowerCase();
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

function idSelector(element: Element): string | undefined {
	const id = element.id.trim();
	if (id.length === 0) return undefined;
	if (SIMPLE_IDENTIFIER.test(id)) return `#${id}`;
	return `${tagNameOf(element)}[id="${escapeCssString(id)}"]`;
}

function pathIdSelector(element: Element): string | undefined {
	const id = element.id.trim();
	if (id.length === 0) return undefined;
	if (SIMPLE_IDENTIFIER.test(id)) return `${tagNameOf(element)}#${id}`;
	return `${tagNameOf(element)}[id="${escapeCssString(id)}"]`;
}

function attributeSelectors(element: Element, attrs: string[]): string[] {
	return attrs
		.map((attr) => selectorForAttribute(element, attr))
		.filter((value): value is string => typeof value === "string");
}

function selectorForAttribute(element: Element, attr: string): string | undefined {
	const value = element.getAttribute(attr);
	if (!value || value.trim().length === 0) return undefined;
	return `${tagNameOf(element)}[${attr}="${escapeCssString(value)}"]`;
}

function pushCandidate(candidates: Set<string>, selector: string | undefined): void {
	if (selector) candidates.add(selector);
}
