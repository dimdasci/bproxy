import type { ActionResult } from "@bproxy/shared";
import { childElements, isShadowRootLike, normalizeText } from "../dom-helpers";
import {
	assertVisibleActionableElement,
	clickElement,
	dispatchChangeEvent,
	focusElement,
} from "../events";
import { type PollingDeps, pollUntilMatch, tabNotVisibleError } from "../polling";
import type { ContentRpcHandlers, ContentRpcRequest } from "../rpc";
import { resolveElementTarget } from "../targeting";

type SelectHandlers = Required<Pick<ContentRpcHandlers, "select">>;

export interface SelectActionDeps extends PollingDeps {
	document?: Document;
}

const OPTION_TIMEOUT_MS = 1500;
const VERIFY_TIMEOUT_MS = 1000;
const OPTION_ROLES = new Set(["option", "menuitem", "treeitem", "tab"]);
const OPTION_PARENT_ROLES = new Set(["listbox", "menu", "radiogroup", "tablist"]);

export function createSelectHandlers(deps: SelectActionDeps = {}): SelectHandlers {
	return {
		select: (request) => handleSelect(request, deps),
	};
}

export async function handleSelect(
	request: ContentRpcRequest<"select">,
	deps: SelectActionDeps = {},
): Promise<ActionResult["select"]> {
	assertDocumentVisible(deps.document);
	const trigger = resolveElementTarget(request.params.trigger, { document: getDocument(deps) });
	assertVisibleActionableElement(trigger);

	if (tagNameOf(trigger) === "select") {
		return handleNativeSelect(trigger, request.params.optionText);
	}

	focusElement(trigger);
	clickElement(trigger);

	const optionResult = await pollUntilMatch(
		{
			read: () => findVisibleOption(getDocument(deps), request.params.optionText),
			matches: (option) => option !== null,
			timeoutMs: OPTION_TIMEOUT_MS,
			respectVisibility: true,
		},
		pollingDeps(deps),
	);
	const option = optionResult.value;
	if (!optionResult.matched || !option) {
		return { selected: false, optionText: request.params.optionText };
	}

	clickElement(option);

	const verifyResult = await pollUntilMatch(
		{
			read: () => isCustomSelectionVerified(trigger, option, request.params.optionText),
			matches: Boolean,
			timeoutMs: VERIFY_TIMEOUT_MS,
			respectVisibility: true,
		},
		pollingDeps(deps),
	);

	return {
		selected: verifyResult.matched && verifyResult.value === true,
		optionText: request.params.optionText,
	};
}

function handleNativeSelect(trigger: Element, optionText: string): ActionResult["select"] {
	const match = findNativeOption(trigger, optionText);
	if (!match) return { selected: false, optionText };

	focusElement(trigger);
	setSelectValue(trigger, match.value);
	markNativeSelection(trigger, match.option);
	dispatchChangeEvent(trigger);

	return {
		selected: isNativeSelectionVerified(trigger, match.option, optionText),
		optionText,
	};
}

function findNativeOption(
	trigger: Element,
	optionText: string,
): { option: Element; value: string } | undefined {
	const normalized = normalizeText(optionText);
	for (const option of walkComposedElements(trigger, { includeRoot: false })) {
		if (tagNameOf(option) !== "option") continue;
		if (normalizeText(option.textContent ?? "") !== normalized) continue;
		return {
			option,
			value: option.getAttribute("value") ?? normalizeText(option.textContent ?? ""),
		};
	}
	return undefined;
}

function setSelectValue(trigger: Element, value: string): void {
	const candidate = trigger as Element & { value?: unknown };
	candidate.value = value;
}

function markNativeSelection(trigger: Element, selectedOption: Element): void {
	for (const option of walkComposedElements(trigger, { includeRoot: false })) {
		if (tagNameOf(option) !== "option") continue;
		if (option === selectedOption) {
			option.setAttribute("selected", "");
			continue;
		}
		removeAttribute(option, "selected");
	}
}

function isNativeSelectionVerified(trigger: Element, option: Element, optionText: string): boolean {
	const candidate = trigger as Element & { value?: unknown };
	const selectedValue = typeof candidate.value === "string" ? candidate.value : undefined;
	const expectedValue = option.getAttribute("value") ?? normalizeText(option.textContent ?? "");
	if (selectedValue === expectedValue) return true;
	return normalizeText(readSelectedOptionText(trigger)) === normalizeText(optionText);
}

function readSelectedOptionText(trigger: Element): string {
	for (const option of walkComposedElements(trigger, { includeRoot: false })) {
		if (tagNameOf(option) !== "option") continue;
		if (option.hasAttribute("selected")) return option.textContent ?? "";
	}
	return "";
}

function findVisibleOption(doc: Document, optionText: string): Element | null {
	const normalized = normalizeText(optionText);
	for (const element of walkComposedElements(doc, { includeRoot: false })) {
		if (!isOptionLikeElement(element)) continue;
		if (!isElementVisibleForOption(element)) continue;
		if (normalizeText(element.textContent ?? "") !== normalized) continue;
		return element;
	}
	return null;
}

function isCustomSelectionVerified(trigger: Element, option: Element, optionText: string): boolean {
	if (option.getAttribute("aria-selected") === "true") return true;
	if (option.getAttribute("aria-checked") === "true") return true;
	if (option.hasAttribute("selected")) return true;
	const triggerText = normalizeText(trigger.textContent ?? "");
	return (
		triggerText === normalizeText(optionText) || triggerText.includes(normalizeText(optionText))
	);
}

function isOptionLikeElement(element: Element): boolean {
	if (tagNameOf(element) === "option") return true;
	const role = element.getAttribute("role")?.trim();
	if (role && OPTION_ROLES.has(role)) return true;
	const parentRole = element.parentElement?.getAttribute("role")?.trim();
	return Boolean(parentRole && OPTION_PARENT_ROLES.has(parentRole));
}

function isElementVisibleForOption(element: Element): boolean {
	try {
		assertVisibleActionableElement(element);
		return true;
	} catch {
		return false;
	}
}

function* walkComposedElements(
	root: Document | ShadowRoot | Element,
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

function assertDocumentVisible(doc: Document | undefined): void {
	if (doc?.visibilityState === "hidden") throw tabNotVisibleError();
}

function getDocument(deps: SelectActionDeps): Document {
	return deps.document ?? document;
}

function pollingDeps(deps: SelectActionDeps): PollingDeps {
	return {
		document: deps.document,
		now: deps.now,
		random: deps.random,
		sleep: deps.sleep,
	};
}

function removeAttribute(element: Element, name: string): void {
	const candidate = element as Element & { removeAttribute?: (attr: string) => void };
	candidate.removeAttribute?.(name);
}

function tagNameOf(element: Element): string {
	return element.tagName.toLowerCase();
}

function isElementLike(root: Document | ShadowRoot | Element): root is Element {
	return "tagName" in root;
}
