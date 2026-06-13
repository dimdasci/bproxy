import type { BproxyError, FillMethod } from "@bproxy/shared";
import { isElementVisible } from "./dom-helpers";
import {
	centerPoint,
	createGenericEvent,
	createMouseLikeEvent,
	createPointerLikeEvent,
	defineEventProperty,
} from "./synthetic-events";

type EditableElement = Element & {
	value?: unknown;
	textContent: string | null;
	isContentEditable?: boolean;
	focus?: () => void;
	dispatchEvent?: (event: Event) => boolean;
	click?: () => void;
};

export function assertIsolatedFillMethod(method: FillMethod, world: "isolated" | "main"): void {
	if (method === "runtime-api") {
		throw scriptError(
			"fill method runtime-api must be executed in MAIN world by the background worker",
		);
	}
	if (world !== "isolated") {
		throw scriptError(`fill method ${method} requires world "isolated"`);
	}
}

export function assertWritableFillTarget(element: Element): void {
	assertVisibleActionableElement(element);
	if (isHiddenInput(element)) {
		throw elementNotActionable("Hidden inputs are not writable", { tag: tagNameOf(element) });
	}
	if (!isWritableTextControl(element) && !isWritableContentEditable(element)) {
		throw elementNotActionable("Target element does not support fill writes", {
			tag: tagNameOf(element),
			type: element.getAttribute("type") ?? undefined,
		});
	}
	if (isDisabled(element)) {
		throw elementNotActionable("Target element is disabled", { tag: tagNameOf(element) });
	}
	if (isReadOnly(element)) {
		throw elementNotActionable("Target element is read-only", { tag: tagNameOf(element) });
	}
}

export function assertVisibleActionableElement(element: Element): void {
	if (!isElementVisible(element)) {
		throw elementNotActionable("Target element is not visible", { tag: tagNameOf(element) });
	}
}

export function assertInteractableElement(element: Element): void {
	assertVisibleActionableElement(element);
	if (isDisabled(element)) {
		throw elementNotActionable("Target element is disabled", { tag: tagNameOf(element) });
	}
	if (hasPointerEventsNone(element)) {
		throw elementNotActionable("Target element does not accept pointer events", {
			tag: tagNameOf(element),
		});
	}
}

export function applyDirectFill(element: Element, value: string): string {
	assertWritableFillTarget(element);
	setEditableValue(element, value);
	return readEditableValue(element);
}

export function applyPasteFill(element: Element, value: string): string {
	assertWritableFillTarget(element);
	focusElement(element);
	setEditableValue(element, value);
	dispatchEventSafe(element, createPasteInputEvent("beforeinput", value));
	dispatchEventSafe(element, createPasteInputEvent("input", value));
	dispatchEventSafe(element, createGenericEvent("change", { bubbles: true, composed: true }));
	return readEditableValue(element);
}

export function readEditableValue(element: Element): string {
	if (isWritableTextControl(element)) {
		const candidate = element as EditableElement;
		if (typeof candidate.value === "string") return candidate.value;
		return element.getAttribute("value") ?? "";
	}
	if (isWritableContentEditable(element)) {
		return element.textContent ?? "";
	}
	return "";
}

export function focusElement(element: Element): void {
	const candidate = element as EditableElement;
	candidate.focus?.();
}

export function clickElement(element: Element): void {
	const point = centerPoint(element);
	dispatchEventSafe(element, createPointerLikeEvent("pointerdown", point, { bubbles: true }));
	dispatchEventSafe(
		element,
		createMouseLikeEvent("mousedown", point, { bubbles: true, cancelable: true, detail: 1 }),
	);
	dispatchEventSafe(element, createPointerLikeEvent("pointerup", point, { bubbles: true }));
	dispatchEventSafe(
		element,
		createMouseLikeEvent("mouseup", point, { bubbles: true, cancelable: true, detail: 1 }),
	);

	const candidate = element as EditableElement;
	if (typeof candidate.click === "function") {
		candidate.click();
		return;
	}
	dispatchEventSafe(
		element,
		createMouseLikeEvent("click", point, { bubbles: true, cancelable: true, detail: 1 }),
	);
}

export function hoverElement(element: Element): void {
	const point = centerPoint(element);
	dispatchEventSafe(element, createPointerLikeEvent("pointerover", point, { bubbles: true }));
	dispatchEventSafe(element, createPointerLikeEvent("pointerenter", point, { bubbles: false }));
	dispatchEventSafe(element, createMouseLikeEvent("mouseover", point, { bubbles: true }));
	dispatchEventSafe(element, createMouseLikeEvent("mouseenter", point, { bubbles: false }));
	dispatchEventSafe(element, createPointerLikeEvent("pointermove", point, { bubbles: true }));
	dispatchEventSafe(element, createMouseLikeEvent("mousemove", point, { bubbles: true }));
}

export function dispatchChangeEvent(element: Element): void {
	dispatchEventSafe(element, createGenericEvent("change", { bubbles: true, composed: true }));
}

function setEditableValue(element: Element, value: string): void {
	if (isWritableTextControl(element)) {
		setPropertyValue(element, "value", value);
		return;
	}
	if (isWritableContentEditable(element)) {
		setPropertyValue(element, "textContent", value);
		return;
	}
	throw elementNotActionable("Target element does not support fill writes", {
		tag: tagNameOf(element),
	});
}

function setPropertyValue(
	element: EditableElement,
	property: "value" | "textContent",
	value: string,
): void {
	const setter = findPropertySetter(element, property);
	if (setter) {
		setter.call(element, value);
		return;
	}
	if (property === "textContent") {
		element.textContent = value;
		return;
	}
	element.value = value;
}

function findPropertySetter(
	target: object,
	property: "value" | "textContent",
): ((this: object, value: string) => void) | undefined {
	let current: object | null = target;
	while (current) {
		const descriptor = Object.getOwnPropertyDescriptor(current, property);
		if (descriptor?.set) return descriptor.set as (this: object, value: string) => void;
		current = Object.getPrototypeOf(current) as object | null;
	}
	return undefined;
}

function isWritableTextControl(element: Element): boolean {
	const tag = tagNameOf(element);
	if (tag === "textarea") return true;
	if (tag !== "input") return false;
	const type = (element.getAttribute("type") ?? "text").trim().toLowerCase();
	return type !== "hidden";
}

function isHiddenInput(element: Element): boolean {
	return (
		tagNameOf(element) === "input" &&
		(element.getAttribute("type") ?? "").toLowerCase() === "hidden"
	);
}

function isWritableContentEditable(element: Element): boolean {
	const candidate = element as EditableElement;
	return candidate.isContentEditable === true || element.getAttribute("contenteditable") === "true";
}

function isDisabled(element: Element): boolean {
	return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

function isReadOnly(element: Element): boolean {
	return element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true";
}

function hasPointerEventsNone(element: Element): boolean {
	const view = element.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== "function") return false;
	return view.getComputedStyle(element).pointerEvents === "none";
}

function dispatchEventSafe(element: Element, event: Event): void {
	const candidate = element as EditableElement;
	candidate.dispatchEvent?.(event);
}

function createPasteInputEvent(type: "beforeinput" | "input", value: string): Event {
	if (typeof InputEvent === "function") {
		return new InputEvent(type, {
			bubbles: true,
			cancelable: type === "beforeinput",
			composed: true,
			data: value,
			inputType: "insertFromPaste",
		});
	}
	const event = createGenericEvent(type, {
		bubbles: true,
		cancelable: type === "beforeinput",
		composed: true,
	});
	defineEventProperty(event, "data", value);
	defineEventProperty(event, "inputType", "insertFromPaste");
	return event;
}

function tagNameOf(element: Element): string {
	return element.tagName.toLowerCase();
}

function elementNotActionable(message: string, details?: Record<string, unknown>): BproxyError {
	return {
		code: "ELEMENT_NOT_ACTIONABLE",
		category: "target",
		retry: "conditional",
		message,
		details,
	};
}

function scriptError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}
