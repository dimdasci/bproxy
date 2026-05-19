import { childElements, isElementVisible, isShadowRootLike, normalizeText } from "./dom-helpers";

const SERIALIZED_ATTRS = [
	"id",
	"class",
	"name",
	"type",
	"role",
	"aria-label",
	"placeholder",
	"href",
	"src",
	"alt",
	"title",
];
const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

export function readDeepText(
	root: Element,
	options: { visibleOnly: boolean; isNoiseTag: (element: Element) => boolean },
): string {
	const parts: string[] = [];
	appendText(root, parts, options, true);
	return normalizeText(parts.join(" "));
}

export function readOwnText(element: Element): string {
	const candidate = element as Element & { childNodes?: ArrayLike<ChildNode> };
	if (candidate.childNodes) {
		const direct = Array.from(candidate.childNodes)
			.filter((node) => node.nodeType === Node.TEXT_NODE)
			.map((node) => node.textContent ?? "")
			.join(" ");
		return normalizeText(direct);
	}
	return normalizeText(element.textContent ?? "");
}

export function serializeElementTree(
	element: Element,
	options: { depth: number; isRoot: boolean; isNoiseTag: (element: Element) => boolean },
): string | null {
	if (shouldSkipSerializedElement(element, options)) return null;

	const tag = element.tagName.toLowerCase();
	const attrs = serializeAttributes(element);
	const content = serializeElementContent(element, options);
	if (VOID_TAGS.has(tag) && content.length === 0) return `<${tag}${attrs} />`;
	return `<${tag}${attrs}>${content}</${tag}>`;
}

function appendText(
	element: Element,
	parts: string[],
	options: { visibleOnly: boolean; isNoiseTag: (element: Element) => boolean },
	isRoot: boolean,
): void {
	if (shouldSkipTextElement(element, options, isRoot)) return;

	const ownText = readOwnText(element);
	if (ownText) parts.push(ownText);
	appendChildrenText(element.shadowRoot, parts, options);
	appendChildrenText(element, parts, options);
}

function appendChildrenText(
	root: Element | ShadowRoot | null,
	parts: string[],
	options: { visibleOnly: boolean; isNoiseTag: (element: Element) => boolean },
): void {
	if (!root) return;
	if (isShadowRootLike(root) || isElementLike(root)) {
		for (const child of childElements(root)) {
			appendText(child, parts, options, false);
		}
	}
}

function shouldSkipTextElement(
	element: Element,
	options: { visibleOnly: boolean; isNoiseTag: (element: Element) => boolean },
	isRoot: boolean,
): boolean {
	if (options.isNoiseTag(element)) return true;
	if (!options.visibleOnly) return false;
	if (isRoot) return !isElementVisible(element);
	return !isElementVisible(element);
}

function shouldSkipSerializedElement(
	element: Element,
	options: { isRoot: boolean; isNoiseTag: (element: Element) => boolean },
): boolean {
	return options.isNoiseTag(element) || (!options.isRoot && !isElementVisible(element));
}

function serializeElementContent(
	element: Element,
	options: { depth: number; isRoot: boolean; isNoiseTag: (element: Element) => boolean },
): string {
	const parts: string[] = [];
	const ownText = readOwnText(element);
	if (ownText) parts.push(escapeHtml(ownText));

	const childChunks =
		options.depth > 0
			? serializeChildren(element, options.depth - 1, options.isNoiseTag)
			: serializeCollapsedChildren(element);
	parts.push(...childChunks);
	return parts.join("");
}

function serializeChildren(
	element: Element,
	depth: number,
	isNoiseTag: (element: Element) => boolean,
): string[] {
	const chunks = serializeShadowChildren(element, depth, isNoiseTag);
	for (const child of childElements(element)) {
		const serialized = serializeElementTree(child, { depth, isRoot: false, isNoiseTag });
		if (serialized) chunks.push(serialized);
	}
	return chunks;
}

function serializeShadowChildren(
	element: Element,
	depth: number,
	isNoiseTag: (element: Element) => boolean,
): string[] {
	if (!isShadowRootLike(element.shadowRoot)) return [];
	const serialized = childElements(element.shadowRoot)
		.map((child) => serializeElementTree(child, { depth, isRoot: false, isNoiseTag }))
		.filter((value): value is string => typeof value === "string");
	return serialized.length > 0 ? [`<shadow-root>${serialized.join("")}</shadow-root>`] : [];
}

function serializeCollapsedChildren(element: Element): string[] {
	return hasSerializedChildren(element) ? ["…"] : [];
}

function hasSerializedChildren(element: Element): boolean {
	if (childElements(element).length > 0) return true;
	return isShadowRootLike(element.shadowRoot) && childElements(element.shadowRoot).length > 0;
}

function serializeAttributes(element: Element): string {
	return SERIALIZED_ATTRS.flatMap((name) => {
		const value = element.getAttribute(name);
		return value && value.length > 0 ? [` ${name}="${escapeHtml(value)}"`] : [];
	}).join("");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function isElementLike(root: Element | ShadowRoot): root is Element {
	return "tagName" in root;
}
