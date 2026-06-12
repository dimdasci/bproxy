import type { ActionResult, InspectElement } from "@bproxy/shared";
import { walkComposedElements } from "../dom-helpers";
import type { ContentRpcRequest } from "../rpc";
import { createStableSelector } from "../targeting";
import type { ReadActionDeps } from "./read-deps";

const DEFAULT_PROPERTIES = [
	"display",
	"visibility",
	"overflow",
	"overflowX",
	"overflowY",
	"position",
	"opacity",
	"pointerEvents",
];

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_DESCENDANTS = 10_000;
const MAX_CLASS_LENGTH = 100;

export function handleInspect(
	request: ContentRpcRequest<"inspect">,
	deps: ReadActionDeps = {},
): ActionResult["inspect"] {
	const doc = getDocument(deps);
	const selector = request.params.selector;
	const limit = clampLimit(request.params.limit);
	const properties = request.params.properties ?? DEFAULT_PROPERTIES;

	const root = doc.body ?? doc.documentElement ?? doc;
	let matches: NodeListOf<Element>;
	try {
		matches = root.querySelectorAll(selector);
	} catch (error) {
		throw invalidSelector(selector, error);
	}
	const total = matches.length;

	const elements: InspectElement[] = [];
	for (let i = 0; i < Math.min(total, limit); i++) {
		elements.push(inspectElement(matches[i] as Element, i, properties));
	}

	return { elements, total };
}

function inspectElement(element: Element, index: number, properties: string[]): InspectElement {
	const rect = safeGetBoundingClientRect(element);
	const computed = readComputedProperties(element, properties);
	const { scrollable, scrollInfo } = readScrollState(element);
	const selectorStr = safeSelector(element);

	return {
		index,
		tag: element.tagName.toLowerCase(),
		id: element.id ?? "",
		classes: (element.getAttribute("class") ?? "").substring(0, MAX_CLASS_LENGTH),
		role: element.getAttribute("role") ?? "",
		ariaLabel: element.getAttribute("aria-label") ?? "",
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		computed,
		children: element.children.length,
		descendants: countDescendants(element),
		textLength: (element.textContent ?? "").length,
		scrollable,
		scrollInfo,
		selector: selectorStr,
	};
}

function readComputedProperties(element: Element, properties: string[]): Record<string, string> {
	const style = getComputedStyleSafe(element);
	const computed: Record<string, string> = {};
	for (const prop of properties) {
		computed[prop] = readStyleProperty(style, prop);
	}
	return computed;
}

function readStyleProperty(style: CSSStyleDeclaration | null, prop: string): string {
	if (!style) return "";
	if (typeof style.getPropertyValue === "function") return style.getPropertyValue(prop);
	return (style as unknown as Record<string, string>)[prop] ?? "";
}

function readScrollState(element: Element): {
	scrollable: boolean;
	scrollInfo?: InspectElement["scrollInfo"];
} {
	const htmlEl = element as HTMLElement;
	const scrollHeight = htmlEl.scrollHeight ?? 0;
	const clientHeight = htmlEl.clientHeight ?? 0;
	if (scrollHeight <= clientHeight) return { scrollable: false };

	const style = getComputedStyleSafe(element);
	const overflowY = readStyleProperty(style, "overflow-y");
	const overflow = readStyleProperty(style, "overflow");
	const scrollable = !["hidden", "visible"].includes(overflowY || overflow);
	if (!scrollable) return { scrollable: false };

	return {
		scrollable: true,
		scrollInfo: { scrollTop: htmlEl.scrollTop, scrollHeight, clientHeight },
	};
}

function safeSelector(element: Element): string {
	try {
		return createStableSelector(element);
	} catch {
		return element.tagName.toLowerCase();
	}
}

function countDescendants(element: Element): number {
	let count = 0;
	// walkComposedElements with includeRoot:true enters shadow roots.
	// We subtract 1 because includeRoot yields the root itself.
	for (const _el of walkComposedElements(element, { includeRoot: true })) {
		count++;
		if (count >= MAX_DESCENDANTS + 1) break;
	}
	return Math.min(count - 1, MAX_DESCENDANTS);
}

function safeGetBoundingClientRect(element: Element): DOMRect {
	if (typeof element.getBoundingClientRect === "function") {
		return element.getBoundingClientRect();
	}
	return { x: 0, y: 0, width: 0, height: 0 } as DOMRect;
}

function getComputedStyleSafe(element: Element): CSSStyleDeclaration | null {
	const view = element.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== "function") return null;
	return view.getComputedStyle(element);
}

function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function getDocument(deps: ReadActionDeps): Document {
	return deps.document ?? document;
}

function invalidSelector(
	selector: string,
	cause: unknown,
): {
	code: string;
	category: string;
	retry: string;
	message: string;
	details?: Record<string, unknown>;
} {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: `Invalid selector: ${selector}`,
		details: {
			selector,
			cause: cause instanceof Error ? cause.message : String(cause),
		},
	};
}
