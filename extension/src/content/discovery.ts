import type { ElementInfo } from "@bproxy/shared";
import {
	childElements,
	composedAncestors,
	escapeCssString,
	isElementVisible,
	isShadowRootLike,
	matchesSelectorSafe,
	normalizeText,
} from "./dom-helpers";
import { safeCreateElementTarget } from "./targeting";

export interface DiscoveryPoint {
	x: number;
	y: number;
}

export interface DiscoveryOptions {
	document?: Document;
	formOnly?: boolean;
	point?: DiscoveryPoint;
	scope?: Document | ShadowRoot | Element;
}

type DiscoveryRoot = Document | ShadowRoot | Element;

type RuntimeHandle = ElementInfo["runtimeHandle"];

const CONTAINER_SELECTOR =
	'form, dialog, [role="dialog"], [popover], [role="listbox"], [role="combobox"]';
const DIALOG_SELECTOR = 'dialog, [role="dialog"], [popover], [aria-modal="true"]';
const INTERACTIVE_ROLES = new Set([
	"button",
	"checkbox",
	"combobox",
	"link",
	"listbox",
	"menuitem",
	"option",
	"radio",
	"switch",
	"tab",
	"textbox",
]);

export function discoverInteractiveElements(options: DiscoveryOptions = {}): Array<ElementInfo> {
	for (const roots of collectDiscoveryRoots(options)) {
		const matches = discoverWithinRoots(roots, options);
		if (matches.length > 0) return matches;
	}
	return [];
}

function collectDiscoveryRoots(options: DiscoveryOptions = {}): Array<Array<DiscoveryRoot>> {
	return discoverySteps(options).filter((group) => group.length > 0);
}

export function probeRuntimeHandle(root: Element | ShadowRoot): RuntimeHandle | undefined {
	for (const candidate of walkSubtree(root, { includeRoot: isElementLike(root) })) {
		const handle = runtimeHandleOn(candidate);
		if (handle) return handle;
	}
	return undefined;
}

function discoverySteps(options: DiscoveryOptions): Array<Array<DiscoveryRoot>> {
	const doc = options.document ?? document;
	const steps: Array<Array<DiscoveryRoot>> = [];

	const active = getDeepActiveElement(doc);
	if (active) steps.push(rootsFromFocusedElement(active));

	const dialogs = collectVisibleContainers(doc, DIALOG_SELECTOR);
	if (dialogs.length > 0) steps.push(dialogs);

	if (options.point && typeof doc.elementsFromPoint === "function") {
		const hitRoots = rootsFromHitTest(doc.elementsFromPoint(options.point.x, options.point.y));
		if (hitRoots.length > 0) steps.push(hitRoots);
	}

	steps.push([options.scope ?? fallbackScope(doc)]);
	return steps;
}

function discoverWithinRoots(
	roots: Array<DiscoveryRoot>,
	options: DiscoveryOptions,
): Array<ElementInfo> {
	const seen = new Set<Element>();
	const discovered: Array<ElementInfo> = [];

	for (const root of roots) {
		for (const element of collectInteractiveElements(root, options.formOnly === true)) {
			if (seen.has(element)) continue;
			seen.add(element);
			const info = toElementInfo(element);
			if (info) discovered.push(info);
		}
	}

	return discovered;
}

function collectInteractiveElements(root: DiscoveryRoot, formOnly: boolean): Element[] {
	const matches: Element[] = [];
	for (const element of walkSubtree(root, { includeRoot: isElementLike(root) })) {
		if (!isInteractiveElement(element, formOnly)) continue;
		if (!isElementVisible(element)) continue;
		matches.push(element);
	}
	return matches;
}

function rootsFromFocusedElement(element: Element): Element[] {
	const roots: Element[] = [];
	for (const ancestor of composedAncestors(element)) {
		if (matchesSelectorSafe(ancestor, CONTAINER_SELECTOR)) roots.push(ancestor);
	}
	roots.push(element);
	return dedupeElements(roots);
}

function rootsFromHitTest(elements: Element[]): Element[] {
	const roots: Element[] = [];
	for (const element of elements) {
		for (const ancestor of composedAncestors(element)) {
			if (matchesSelectorSafe(ancestor, CONTAINER_SELECTOR)) roots.push(ancestor);
		}
		roots.push(element);
	}
	return dedupeElements(roots);
}

function collectVisibleContainers(doc: Document, selector: string): Element[] {
	const matches: Element[] = [];
	for (const element of walkSubtree(doc, { includeRoot: false })) {
		if (!matchesSelectorSafe(element, selector)) continue;
		if (!isElementVisible(element)) continue;
		matches.push(element);
	}
	return dedupeElements(matches);
}

function fallbackScope(doc: Document): DiscoveryRoot {
	return doc.body ?? doc.documentElement ?? doc;
}

function toElementInfo(element: Element): ElementInfo | undefined {
	const target = safeCreateElementTarget(element);
	if (!target) return undefined;

	const info = {
		tag: element.tagName.toLowerCase(),
		type: element.getAttribute("type") ?? undefined,
		label: readLabel(element) || undefined,
		value: readValue(element) || undefined,
		placeholder: element.getAttribute("placeholder") ?? undefined,
		required: isRequired(element) || undefined,
		options: readOptions(element),
		role: element.getAttribute("role") ?? undefined,
		hasShadowRoot: isShadowRootLike(element.shadowRoot) || undefined,
		runtimeHandle: runtimeHandleFor(element),
	};
	return typeof target.selector === "string"
		? { ...info, selector: target.selector }
		: { ...info, route: target.route };
}

function runtimeHandleFor(element: Element): RuntimeHandle | undefined {
	return isShadowRootLike(element.shadowRoot)
		? probeRuntimeHandle(element.shadowRoot)
		: probeRuntimeHandle(element);
}

function readLabel(element: Element): string {
	return readAriaLabel(element) || readAssociatedLabel(element) || readWrappingLabel(element) || "";
}

function readAriaLabel(element: Element): string {
	return element.getAttribute("aria-label")?.trim() ?? "";
}

function readAssociatedLabel(element: Element): string {
	const id = element.getAttribute("id")?.trim();
	if (!id) return "";
	const selector = `label[for="${escapeCssString(id)}"]`;
	return normalizeText(element.ownerDocument?.querySelector(selector)?.textContent ?? "");
}

function readWrappingLabel(element: Element): string {
	for (const ancestor of composedAncestors(element)) {
		if (ancestor === element || ancestor.tagName.toLowerCase() !== "label") continue;
		const text = normalizeText(ancestor.textContent ?? "");
		if (text) return text;
	}
	return "";
}

function readOptions(element: Element): string[] | undefined {
	if (element.tagName.toLowerCase() !== "select") return undefined;
	const options: string[] = [];
	for (const child of Array.from(element.children)) {
		if (child.tagName.toLowerCase() !== "option") continue;
		const text = normalizeText(child.textContent ?? "");
		if (text) options.push(text);
	}
	return options.length > 0 ? options : undefined;
}

function readValue(element: Element): string {
	const candidate = element as Element & { value?: unknown; isContentEditable?: boolean };
	// <button>.value is always "" (the HTML value attribute, not visual content).
	// For buttons, the meaningful content is textContent.
	const tag = element.tagName.toLowerCase();
	if (tag !== "button" && typeof candidate.value === "string") return candidate.value;
	if (candidate.isContentEditable === true) return normalizeText(element.textContent ?? "");
	return normalizeText(element.textContent ?? "");
}

function isRequired(element: Element): boolean {
	return element.hasAttribute("required") || element.getAttribute("aria-required") === "true";
}

function isInteractiveElement(element: Element, formOnly: boolean): boolean {
	if (isNativeFormField(element) || isContentEditable(element)) return true;
	if (formOnly) return false;
	return isGeneralInteractiveElement(element);
}

function isNativeFormField(element: Element): boolean {
	const tag = element.tagName.toLowerCase();
	if (tag === "input") return element.getAttribute("type") !== "hidden";
	return tag === "textarea" || tag === "select";
}

function isGeneralInteractiveElement(element: Element): boolean {
	const tag = element.tagName.toLowerCase();
	if (tag === "button") return true;
	if (tag === "a") return element.hasAttribute("href");
	if (hasInteractiveRole(element)) return true;
	return hasFocusableTabIndex(element);
}

function hasInteractiveRole(element: Element): boolean {
	const role = element.getAttribute("role")?.trim();
	return Boolean(role && INTERACTIVE_ROLES.has(role));
}

function hasFocusableTabIndex(element: Element): boolean {
	const tabIndex = element.getAttribute("tabindex");
	return tabIndex !== null && tabIndex !== "-1";
}

function isContentEditable(element: Element): boolean {
	return element.getAttribute("contenteditable") === "true";
}

function getDeepActiveElement(doc: Document): Element | null {
	let active = doc.activeElement;
	while (active && isShadowRootLike(active.shadowRoot) && active.shadowRoot.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active;
}

function* walkSubtree(root: DiscoveryRoot, options: { includeRoot: boolean }): Iterable<Element> {
	const stack: Element[] = [];
	if (options.includeRoot && isElementLike(root)) stack.push(root);
	for (const child of childElements(root)) stack.push(child);

	while (stack.length > 0) {
		const current = stack.shift() as Element;
		yield current;
		if (isShadowRootLike(current.shadowRoot)) {
			for (const child of childElements(current.shadowRoot)) stack.unshift(child);
		}
		for (const child of [...childElements(current)].reverse()) stack.unshift(child);
	}
}

function runtimeHandleOn(element: Element): RuntimeHandle | undefined {
	const candidate = element as Element & {
		__quill?: unknown;
		__lexicalEditor?: unknown;
		ProseMirror?: unknown;
		cmView?: unknown;
		__monacoEditor?: unknown;
		__slateEditor?: unknown;
	};
	if (candidate.__quill) return "quill";
	if (candidate.__lexicalEditor) return "lexical";
	if (candidate.ProseMirror) return "prosemirror";
	if (candidate.cmView) return "codemirror";
	if (candidate.__monacoEditor) return "monaco";
	if (candidate.__slateEditor) return "slate";
	return undefined;
}

function dedupeElements(elements: Element[]): Element[] {
	const seen = new Set<Element>();
	return elements.filter((element) => {
		if (seen.has(element)) return false;
		seen.add(element);
		return true;
	});
}

function isElementLike(value: DiscoveryRoot): value is Element {
	return "tagName" in value;
}
