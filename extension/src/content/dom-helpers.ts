type DiscoveryRoot = Document | ShadowRoot | Element;

export function isElementVisible(element: Element): boolean {
	if (isHiddenByAttributes(element)) return false;
	if (hasZeroRect(element)) return false;
	if (isHiddenByStyle(element)) return false;
	return true;
}

export function* composedAncestors(start: Element): Iterable<Element> {
	let current: Element | null = start;
	while (current) {
		yield current;
		current = composedParent(current);
	}
}

export function composedParent(element: Element): Element | null {
	if (element.parentElement) return element.parentElement;
	const root = element.getRootNode();
	return isShadowRootLike(root) ? root.host : null;
}

export function matchesSelectorSafe(element: Element, selector: string): boolean {
	try {
		return element.matches(selector);
	} catch {
		return false;
	}
}

export function isShadowRootLike(value: unknown): value is ShadowRoot {
	return typeof value === "object" && value !== null && "host" in value && "children" in value;
}

export function childElements(root: DiscoveryRoot): Element[] {
	return Array.from(root.children ?? []);
}

export function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function escapeCssString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isHiddenByAttributes(element: Element): boolean {
	return element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true";
}

function hasZeroRect(element: Element): boolean {
	const rect =
		typeof element.getBoundingClientRect === "function"
			? element.getBoundingClientRect()
			: undefined;
	return Boolean(rect && rect.width <= 0 && rect.height <= 0);
}

function isHiddenByStyle(element: Element): boolean {
	const style = getComputedStyleSafe(element);
	return style?.display === "none" || style?.visibility === "hidden";
}

function getComputedStyleSafe(element: Element): CSSStyleDeclaration | null {
	const view = element.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== "function") return null;
	return view.getComputedStyle(element);
}
