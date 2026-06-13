export type MousePoint = {
	clientX: number;
	clientY: number;
};

export function centerPoint(element: Element): MousePoint {
	const rect =
		typeof element.getBoundingClientRect === "function"
			? element.getBoundingClientRect()
			: undefined;
	if (!rect) return { clientX: 0, clientY: 0 };
	return {
		clientX: Math.round(rect.left + rect.width / 2),
		clientY: Math.round(rect.top + rect.height / 2),
	};
}

export function createPointerLikeEvent(
	type: string,
	point: MousePoint,
	options: { bubbles: boolean },
): Event {
	if (typeof PointerEvent === "function") {
		return new PointerEvent(type, {
			bubbles: options.bubbles,
			cancelable: true,
			composed: true,
			clientX: point.clientX,
			clientY: point.clientY,
			button: 0,
			buttons: 1,
			pointerType: "mouse",
			isPrimary: true,
		});
	}
	const event = createMouseFallback(type, point, { bubbles: options.bubbles, cancelable: true });
	defineEventProperty(event, "pointerType", "mouse");
	defineEventProperty(event, "isPrimary", true);
	return event;
}

export function createMouseLikeEvent(
	type: string,
	point: MousePoint,
	options: { bubbles: boolean; cancelable?: boolean; detail?: number },
): Event {
	if (typeof MouseEvent === "function") {
		return new MouseEvent(type, {
			bubbles: options.bubbles,
			cancelable: options.cancelable ?? false,
			composed: true,
			clientX: point.clientX,
			clientY: point.clientY,
			button: 0,
			buttons: 1,
			detail: options.detail ?? 0,
		});
	}
	const event = createMouseFallback(type, point, {
		bubbles: options.bubbles,
		cancelable: options.cancelable ?? false,
	});
	defineEventProperty(event, "detail", options.detail ?? 0);
	return event;
}

function createMouseFallback(
	type: string,
	point: MousePoint,
	init: { bubbles: boolean; cancelable: boolean },
): Event {
	const event =
		typeof MouseEvent === "function"
			? new MouseEvent(type, {
					...init,
					composed: true,
					clientX: point.clientX,
					clientY: point.clientY,
					button: 0,
					buttons: 1,
				})
			: createGenericEvent(type, { ...init, composed: true });
	defineEventProperty(event, "clientX", point.clientX);
	defineEventProperty(event, "clientY", point.clientY);
	defineEventProperty(event, "button", 0);
	defineEventProperty(event, "buttons", 1);
	return event;
}

export function createGenericEvent(type: string, init: EventInit): Event {
	if (typeof Event === "function") return new Event(type, init);
	return {
		type,
		bubbles: Boolean(init.bubbles),
		cancelable: Boolean(init.cancelable),
		composed: Boolean(init.composed),
		defaultPrevented: false,
		preventDefault() {},
		stopImmediatePropagation() {},
		stopPropagation() {},
		NONE: 0,
		CAPTURING_PHASE: 1,
		AT_TARGET: 2,
		BUBBLING_PHASE: 3,
		eventPhase: 2,
		isTrusted: false,
		returnValue: true,
		timeStamp: Date.now(),
		composedPath: () => [],
		initEvent() {},
		cancelBubble: false,
		srcElement: null,
		target: null,
		currentTarget: null,
		composedPathTarget: null,
		bubblesInit: init.bubbles,
	} as unknown as Event;
}

export function defineEventProperty(
	event: Event,
	key: string,
	value: string | number | boolean,
): void {
	try {
		Object.defineProperty(event, key, {
			configurable: true,
			enumerable: true,
			value,
		});
	} catch {
		(event as unknown as Record<string, unknown>)[key] = value;
	}
}
