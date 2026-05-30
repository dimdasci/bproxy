type DiscoveryRoot = Document | ShadowRoot | Element;

export type ComposedWalkRoot = Document | ShadowRoot | Element;

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

export function* walkComposedElements(
	root: ComposedWalkRoot,
	options: { includeRoot: boolean },
): Iterable<Element> {
	const queue: Element[] =
		options.includeRoot && isElementLike(root) ? [root] : [...childElements(root)];

	while (queue.length > 0) {
		const current = queue.shift() as Element;
		yield current;
		if (isShadowRootLike(current.shadowRoot)) {
			for (const child of childElements(current.shadowRoot)) queue.unshift(child);
		}
		for (const child of [...childElements(current)].reverse()) queue.unshift(child);
	}
}

export function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function escapeCssString(value: string): string {
	let escaped = "";
	for (const char of value) {
		const codePoint = char.codePointAt(0) as number;
		if (codePoint === 0x0) {
			escaped += "\uFFFD";
			continue;
		}
		if (char === '"' || char === "\\") {
			escaped += `\\${char}`;
			continue;
		}
		if ((codePoint >= 0x1 && codePoint <= 0x1f) || codePoint === 0x7f) {
			escaped += `\\${codePoint.toString(16)} `;
			continue;
		}
		escaped += char;
	}
	return escaped;
}

function isElementLike(root: ComposedWalkRoot): root is Element {
	return "tagName" in root;
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
