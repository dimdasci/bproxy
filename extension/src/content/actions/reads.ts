import type { ActionResult, Landmark } from "@bproxy/shared";
import { discoverInteractiveElements } from "../discovery";
import {
	escapeCssString,
	isElementVisible,
	normalizeText,
	walkComposedElements,
} from "../dom-helpers";
import { readDeepText, serializeElementTree } from "../read-tree";
import { resolveReadRoot } from "../read-utils";
import type { ContentRpcHandlers, ContentRpcRequest } from "../rpc";
import { handleInspect } from "./inspect";
import { handleLinks } from "./links";
import { handleSnapshot } from "./snapshot";

export type { ReadActionDeps } from "./read-deps";

import type { ReadActionDeps } from "./read-deps";

type ReadActionName = Extract<
	keyof ContentRpcHandlers,
	"text" | "links" | "images" | "elements" | "outline" | "dom" | "inspect" | "snapshot"
>;

type ReadActionHandlers = Required<Pick<ContentRpcHandlers, ReadActionName>>;

type ReadRoot = Document | ShadowRoot | Element;

const NOISE_TAGS = new Set(["script", "style", "noscript", "template"]);
const LANDMARK_ROLES = new Set([
	"banner",
	"complementary",
	"contentinfo",
	"form",
	"main",
	"navigation",
	"region",
	"search",
]);
const IMPLICIT_LANDMARK_ROLES = new Map<string, Landmark["role"]>([
	["aside", "complementary"],
	["footer", "contentinfo"],
	["form", "form"],
	["header", "banner"],
	["main", "main"],
	["nav", "navigation"],
	["search", "search"],
]);
const DEFAULT_DOM_DEPTH = 3;
const MAX_DOM_DEPTH = 6;

export function createReadHandlers(deps: ReadActionDeps = {}): ReadActionHandlers {
	return {
		text: (request) => ({ text: handleText(request, deps) }),
		links: (request) => handleLinks(request, deps),
		images: (request) => ({ images: handleImages(request, deps) }),
		elements: (request) => ({ elements: handleElements(request, deps) }),
		outline: (_request) => handleOutline(deps),
		dom: (request) => ({ html: handleDom(request, deps) }),
		inspect: (request) => handleInspect(request, deps),
		snapshot: (request) => handleSnapshot(request, deps),
	};
}

export function handleText(
	request: ContentRpcRequest<"text">,
	deps: ReadActionDeps = {},
): ActionResult["text"]["text"] {
	const root = resolveReadRoot(request.params.selector, getDocument(deps));
	if (!isElementVisible(root)) return readDeepText(root, { visibleOnly: false, isNoiseTag });
	return readDeepText(root, { visibleOnly: true, isNoiseTag });
}

export function handleImages(
	request: ContentRpcRequest<"images">,
	deps: ReadActionDeps = {},
): ActionResult["images"]["images"] {
	const root = resolveReadRoot(request.params.selector, getDocument(deps));
	const images: ActionResult["images"]["images"] = [];

	for (const element of walkComposedElements(root, { includeRoot: true })) {
		if (isNoiseTag(element)) continue;
		if (element.tagName.toLowerCase() !== "img") continue;
		if (!isElementVisible(element)) continue;
		const src = readImageSrc(element);
		if (!src) continue;
		const dimensions = readImageDimensions(element);
		images.push({
			src,
			alt: readImageAlt(element),
			width: dimensions.width,
			height: dimensions.height,
		});
	}

	return images;
}

export function handleElements(
	request: ContentRpcRequest<"elements">,
	deps: ReadActionDeps = {},
): ActionResult["elements"]["elements"] {
	return discoverInteractiveElements({
		document: getDocument(deps),
		formOnly: request.params.form === true,
	});
}

export function handleOutline(deps: ReadActionDeps = {}): ActionResult["outline"] {
	const root = resolveDocumentReadRoot(deps);
	const landmarks: ActionResult["outline"]["landmarks"] = [];
	const headings: ActionResult["outline"]["headings"] = [];

	for (const element of walkComposedElements(root, { includeRoot: isElementRoot(root) })) {
		if (isNoiseTag(element) || !isElementVisible(element)) continue;

		const landmark = toLandmark(element);
		if (landmark) landmarks.push(landmark);

		const heading = toHeading(element);
		if (heading) headings.push(heading);
	}

	return { landmarks, headings };
}

export function handleDom(
	request: ContentRpcRequest<"dom">,
	deps: ReadActionDeps = {},
): ActionResult["dom"]["html"] {
	const root = resolveReadRoot(request.params.selector, getDocument(deps));
	return (
		serializeElementTree(root, {
			depth: normalizeDepth(request.params.depth),
			isRoot: true,
			isNoiseTag,
		}) ?? ""
	);
}

function resolveDocumentReadRoot(deps: ReadActionDeps): ReadRoot {
	const doc = getDocument(deps);
	return doc.body ?? doc.documentElement ?? doc;
}

function getDocument(deps: ReadActionDeps): Document {
	return deps.document ?? document;
}

function readImageSrc(element: Element): string {
	const image = element as Element & { currentSrc?: string; src?: string };
	return image.currentSrc || image.src || element.getAttribute("src") || "";
}

function readImageAlt(element: Element): string {
	const image = element as Element & { alt?: string };
	return image.alt || element.getAttribute("alt") || "";
}

function readImageDimensions(element: Element): { width: number; height: number } {
	const image = element as Element & {
		naturalWidth?: number;
		naturalHeight?: number;
		width?: number;
		height?: number;
	};
	const naturalWidth = asPositiveNumber(image.naturalWidth);
	const naturalHeight = asPositiveNumber(image.naturalHeight);
	if (naturalWidth && naturalHeight) return { width: naturalWidth, height: naturalHeight };

	const rect =
		typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
	const renderedWidth = asPositiveNumber(rect?.width) ?? asPositiveNumber(image.width) ?? 0;
	const renderedHeight = asPositiveNumber(rect?.height) ?? asPositiveNumber(image.height) ?? 0;
	return { width: renderedWidth, height: renderedHeight };
}

function toLandmark(element: Element): Landmark | undefined {
	const explicitRole = element.getAttribute("role")?.trim();
	const tag = element.tagName.toLowerCase();
	const implicitRole = IMPLICIT_LANDMARK_ROLES.get(tag);
	const role = explicitRole && LANDMARK_ROLES.has(explicitRole) ? explicitRole : implicitRole;
	if (!role) return undefined;

	const label = readAccessibleLabel(element);
	if ((role === "form" || role === "region") && !label) return undefined;
	return {
		tag,
		role,
		label: label || undefined,
	};
}

function toHeading(element: Element): ActionResult["outline"]["headings"][number] | undefined {
	const tag = element.tagName.toLowerCase();
	const match = /^h([1-6])$/.exec(tag);
	if (!match) return undefined;
	const text = readDeepText(element, { visibleOnly: true, isNoiseTag });
	if (!text) return undefined;
	return { level: Number.parseInt(match[1] as string, 10), text };
}

function readAccessibleLabel(element: Element): string {
	const ariaLabel = normalizeText(element.getAttribute("aria-label") ?? "");
	if (ariaLabel) return ariaLabel;

	const labelledBy = normalizeText(element.getAttribute("aria-labelledby") ?? "");
	if (!labelledBy) return "";
	const doc = element.ownerDocument;
	if (!doc) return "";

	return normalizeText(
		labelledBy
			.split(/\s+/)
			.map((id) => doc.querySelector(`[id="${escapeCssString(id)}"]`)?.textContent ?? "")
			.filter(Boolean)
			.join(" "),
	);
}

function normalizeDepth(depth: number | undefined): number {
	if (typeof depth !== "number" || !Number.isFinite(depth)) return DEFAULT_DOM_DEPTH;
	return Math.min(MAX_DOM_DEPTH, Math.max(0, Math.floor(depth)));
}

function isElementRoot(root: ReadRoot): root is Element {
	return "tagName" in root;
}

function isNoiseTag(element: Element): boolean {
	return NOISE_TAGS.has(element.tagName.toLowerCase());
}

function asPositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
