import type { ActionResult } from "@bproxy/shared";
import { isElementVisible, normalizeText, walkComposedElements } from "../dom-helpers";
import { readDeepText } from "../read-tree";
import { resolveReadRoot } from "../read-utils";
import type { ContentRpcRequest } from "../rpc";
import { safeCreateElementTarget } from "../targeting";

export interface LinkActionDeps {
	document?: Document;
}

const DEFAULT_LINK_LIMIT = 100;
const MAX_LINK_LIMIT = 500;
const NOISE_TAGS = new Set(["script", "style", "noscript", "template"]);
const DEFAULT_BASE_URI = "https://example.test/";

export function handleLinks(
	request: ContentRpcRequest<"links">,
	deps: LinkActionDeps = {},
): ActionResult["links"]["links"] {
	const document = getDocument(deps);
	const root = resolveReadRoot(request.params.selector, document);
	const visibleOnly = request.params.visibleOnly === true;
	const limit = normalizeLimit(request.params.limit);
	const links: ActionResult["links"]["links"] = [];

	for (const element of walkComposedElements(root, { includeRoot: true })) {
		if (links.length >= limit) break;
		const link = toLinkInfo(element, document, visibleOnly);
		if (link) links.push(link);
	}

	return links;
}

function toLinkInfo(
	element: Element,
	document: Document,
	visibleOnly: boolean,
): ActionResult["links"]["links"][number] | undefined {
	if (!isAnchorElement(element)) return undefined;

	const href = normalizeHref(element, document);
	if (!href) return undefined;

	const visible = isLinkVisible(element);
	if (visibleOnly && !visible) return undefined;

	const target = safeCreateElementTarget(element);
	if (!target) return undefined;

	return {
		text: readLinkText(element, visibleOnly),
		href,
		target,
		title: readOptionalAttribute(element, "title"),
		rel: readOptionalAttribute(element, "rel"),
		targetAttr: readOptionalAttribute(element, "target"),
		visible,
	};
}

function getDocument(deps: LinkActionDeps): Document {
	return deps.document ?? document;
}

function readLinkText(element: Element, visibleOnly: boolean): string {
	const text = readDeepText(element, { visibleOnly, isNoiseTag });
	if (text) return text;

	const ariaLabel = normalizeText(element.getAttribute("aria-label") ?? "");
	if (ariaLabel) return ariaLabel;

	const title = normalizeText(element.getAttribute("title") ?? "");
	if (title) return title;

	return normalizeText(element.getAttribute("href") ?? "");
}

function normalizeHref(element: Element, document: Document): string {
	const rawHref = normalizeText(element.getAttribute("href") ?? "");
	if (!rawHref) return "";

	const candidate = element as Element & { href?: unknown };
	if (typeof candidate.href === "string" && candidate.href.trim().length > 0) {
		return candidate.href;
	}

	try {
		return new URL(rawHref, readBaseUri(document)).href;
	} catch {
		return "";
	}
}

function readBaseUri(document: Document): string {
	const candidate = document as Document & { baseURI?: unknown; URL?: unknown; location?: { href?: unknown } };
	if (typeof candidate.baseURI === "string" && candidate.baseURI.length > 0) return candidate.baseURI;
	if (typeof candidate.URL === "string" && candidate.URL.length > 0) return candidate.URL;
	if (typeof candidate.location?.href === "string" && candidate.location.href.length > 0) {
		return candidate.location.href;
	}
	return DEFAULT_BASE_URI;
}

function isLinkVisible(element: Element): boolean {
	return isElementVisible(element) && intersectsViewport(element);
}

function intersectsViewport(element: Element): boolean {
	const rect = readRect(element);
	if (!rect) return true;
	if (rect.bottom <= 0 || rect.right <= 0) return false;

	const viewport = readViewport(element);
	if (viewport.width !== undefined && rect.left >= viewport.width) return false;
	if (viewport.height !== undefined && rect.top >= viewport.height) return false;
	return true;
}

function readRect(element: Element): DOMRect | null {
	return typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
}

function readViewport(element: Element): { width?: number; height?: number } {
	const view = element.ownerDocument?.defaultView as { innerWidth?: unknown; innerHeight?: unknown } | null;
	return {
		width: typeof view?.innerWidth === "number" ? view.innerWidth : undefined,
		height: typeof view?.innerHeight === "number" ? view.innerHeight : undefined,
	};
}

function readOptionalAttribute(element: Element, name: string): string | undefined {
	const value = normalizeText(element.getAttribute(name) ?? "");
	return value || undefined;
}

function isAnchorElement(element: Element): boolean {
	return element.tagName.toLowerCase() === "a" && element.hasAttribute("href");
}

function isNoiseTag(element: Element): boolean {
	return NOISE_TAGS.has(element.tagName.toLowerCase());
}

function normalizeLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LINK_LIMIT;
	return Math.min(MAX_LINK_LIMIT, Math.max(1, Math.floor(limit)));
}
