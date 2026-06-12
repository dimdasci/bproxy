import type { ActionResult } from "@bproxy/shared";
import { childElements, isShadowRootLike, normalizeText } from "../dom-helpers";
import { resolveReadRoot } from "../read-utils";
import type { ContentRpcRequest } from "../rpc";
import type { ReadActionDeps } from "./read-deps";
import {
	IMPLICIT_ROLES,
	INPUT_TYPE_ROLES,
	INTERACTIVE_ROLES,
	INTERACTIVE_TAGS,
	NOISE_TAGS,
	PLACEHOLDER_TAGS,
	TEXT_NAME_TAGS,
} from "./snapshot-roles";

const MAX_DEPTH = 12;
const DEFAULT_DEPTH = 8;
const MAX_TEXT_LENGTH = 80;

interface TreeOptions {
	maxDepth: number;
	interactiveOnly: boolean;
}

interface TreeNode {
	role: string;
	name: string;
	flags: string[];
	children: TreeNode[];
}

export function handleSnapshot(
	request: ContentRpcRequest<"snapshot">,
	deps: ReadActionDeps = {},
): ActionResult["snapshot"] {
	const doc = getDocument(deps);
	const root = request.params.selector
		? resolveReadRoot(request.params.selector, doc)
		: (doc.body ?? doc.documentElement);
	if (!root) return { tree: "", nodeCount: 0 };

	const maxDepth = clampDepth(request.params.maxDepth);
	const interactiveOnly = request.params.interactiveOnly ?? false;
	const nodes = buildTree(root, { maxDepth, interactiveOnly }, 0);
	const lines: string[] = [];
	let nodeCount = 0;
	for (const node of nodes) {
		nodeCount += serializeNode(node, 0, lines);
	}
	return { tree: lines.join("\n"), nodeCount };
}

function buildTree(element: Element, options: TreeOptions, depth: number): TreeNode[] {
	const tag = element.tagName.toLowerCase();
	if (NOISE_TAGS.has(tag) || depth > options.maxDepth) return [];

	const childNodes = buildChildTrees(element, options, depth);
	const role = computeRole(element);
	const name = computeAccessibleName(element);
	const flags = computeFlags(element);

	if (options.interactiveOnly) {
		return buildInteractiveNodes(element, role, name, flags, childNodes, tag);
	}
	return buildFullNodes(element, role, name, flags, childNodes);
}

function buildChildTrees(element: Element, options: TreeOptions, depth: number): TreeNode[] {
	const childNodes: TreeNode[] = [];
	for (const child of getComposedChildren(element)) {
		childNodes.push(...buildTree(child, options, depth + 1));
	}
	return childNodes;
}

function buildInteractiveNodes(
	element: Element,
	role: string,
	name: string,
	flags: string[],
	childNodes: TreeNode[],
	tag: string,
): TreeNode[] {
	if (isInteractiveElement(element)) {
		return [{ role: role || tag, name, flags, children: childNodes }];
	}
	return childNodes;
}

function buildFullNodes(
	element: Element,
	role: string,
	name: string,
	flags: string[],
	childNodes: TreeNode[],
): TreeNode[] {
	if (role || name) {
		return [{ role: role || element.tagName.toLowerCase(), name, flags, children: childNodes }];
	}
	if (childNodes.length === 0) {
		const text = getDirectText(element);
		if (text)
			return [{ role: "text", name: truncate(text, MAX_TEXT_LENGTH), flags: [], children: [] }];
		return [];
	}
	return childNodes;
}

function serializeNode(node: TreeNode, indent: number, lines: string[]): number {
	const prefix = "  ".repeat(indent);
	let line = `${prefix}${node.role}`;
	if (node.name) line += ` "${truncate(node.name, MAX_TEXT_LENGTH)}"`;
	if (node.flags.length > 0) line += ` [${node.flags.join(", ")}]`;
	if (node.children.length > 0) line += ":";
	lines.push(line);
	let count = 1;
	for (const child of node.children) {
		count += serializeNode(child, indent + 1, lines);
	}
	return count;
}

function computeRole(element: Element): string {
	const explicit = element.getAttribute("role")?.trim();
	if (explicit) return explicit;
	const tag = element.tagName.toLowerCase();
	if (tag === "input") return computeInputRole(element);
	if (tag === "a") return element.hasAttribute("href") ? "link" : "";
	if (tag === "section") return computeAccessibleName(element) ? "section" : "";
	return IMPLICIT_ROLES[tag] ?? "";
}

function computeInputRole(element: Element): string {
	const type = (element.getAttribute("type") ?? "text").toLowerCase();
	return INPUT_TYPE_ROLES[type] ?? "textbox";
}

function computeAccessibleName(element: Element): string {
	const ariaLabel = normalizeText(element.getAttribute("aria-label") ?? "");
	if (ariaLabel) return ariaLabel;
	const fromLabelledBy = resolveAriaLabelledBy(element);
	if (fromLabelledBy) return fromLabelledBy;
	return computeNameFromContent(element);
}

function resolveAriaLabelledBy(element: Element): string {
	const labelledBy = element.getAttribute("aria-labelledby");
	if (!labelledBy) return "";
	const doc = element.ownerDocument;
	if (!doc) return "";
	return normalizeText(
		labelledBy
			.split(/\s+/)
			.map((id) => doc.getElementById(id)?.textContent ?? "")
			.filter(Boolean)
			.join(" "),
	);
}

function computeNameFromContent(element: Element): string {
	const tag = element.tagName.toLowerCase();
	if (tag === "img") return normalizeText(element.getAttribute("alt") ?? "");
	const title = normalizeText(element.getAttribute("title") ?? "");
	if (title) return title;
	if (TEXT_NAME_TAGS.has(tag))
		return truncate(normalizeText(element.textContent ?? ""), MAX_TEXT_LENGTH);
	if (PLACEHOLDER_TAGS.has(tag)) return normalizeText(element.getAttribute("placeholder") ?? "");
	return "";
}

function computeFlags(element: Element): string[] {
	const flags: string[] = [];
	addHeadingLevel(element, flags);
	addCheckedState(element, flags);
	addExpandedState(element, flags);
	addDisabledState(element, flags);
	addRequiredState(element, flags);
	addScrollableState(element, flags);
	return flags;
}

function addHeadingLevel(element: Element, flags: string[]): void {
	const match = /^h([1-6])$/i.exec(element.tagName);
	if (match) flags.push(`level=${match[1]}`);
}

function addCheckedState(element: Element, flags: string[]): void {
	const checked = element.getAttribute("aria-checked") ?? (element as HTMLInputElement).checked;
	if (checked === true || checked === "true") flags.push("checked");
}

function addExpandedState(element: Element, flags: string[]): void {
	const expanded = element.getAttribute("aria-expanded");
	if (expanded === "true") flags.push("expanded");
	if (expanded === "false") flags.push("collapsed");
}

function addDisabledState(element: Element, flags: string[]): void {
	if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
		flags.push("disabled");
	}
}

function addRequiredState(element: Element, flags: string[]): void {
	if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") {
		flags.push("required");
	}
}

function addScrollableState(element: Element, flags: string[]): void {
	const htmlEl = element as HTMLElement;
	if (typeof htmlEl.scrollHeight !== "number" || typeof htmlEl.clientHeight !== "number") return;
	if (htmlEl.scrollHeight <= htmlEl.clientHeight) return;
	const style = getComputedStyleSafe(element);
	const ov = readStyleProperty(style, "overflow-y") || readStyleProperty(style, "overflow");
	if (!["", "hidden", "visible"].includes(ov)) flags.push("scrollable");
}

function readStyleProperty(style: CSSStyleDeclaration | null, prop: string): string {
	if (!style) return "";
	if (typeof style.getPropertyValue === "function") return style.getPropertyValue(prop);
	return (style as unknown as Record<string, string>)[prop] ?? "";
}

function isInteractiveElement(element: Element): boolean {
	if (INTERACTIVE_TAGS.has(element.tagName.toLowerCase())) return true;
	if (INTERACTIVE_ROLES.has(element.getAttribute("role") ?? "")) return true;
	if (element.hasAttribute("tabindex")) return true;
	return (element as HTMLElement).isContentEditable === true;
}

function getComposedChildren(element: Element): Element[] {
	const children: Element[] = [];
	if (isShadowRootLike(element.shadowRoot)) children.push(...childElements(element.shadowRoot));
	children.push(...childElements(element));
	return children;
}

function getDirectText(element: Element): string {
	if (element.children.length > 0) return "";
	return normalizeText(element.textContent ?? "");
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength - 1)}…`;
}

function clampDepth(depth: number | undefined): number {
	if (typeof depth !== "number" || !Number.isFinite(depth)) return DEFAULT_DEPTH;
	return Math.min(MAX_DEPTH, Math.max(1, Math.floor(depth)));
}

function getComputedStyleSafe(element: Element): CSSStyleDeclaration | null {
	const view = element.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== "function") return null;
	return view.getComputedStyle(element);
}

function getDocument(deps: ReadActionDeps): Document {
	return deps.document ?? document;
}
