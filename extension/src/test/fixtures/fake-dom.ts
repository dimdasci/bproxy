import {
	matchesAnySelector,
	type QueryElementLike,
	type QueryRootLike,
	queryWithin,
} from "./fake-dom-query";

type AttrValue = string | true;

type RectInit = {
	width?: number;
	height?: number;
	top?: number;
	left?: number;
};

type ElementInit = {
	attrs?: Record<string, AttrValue>;
	text?: string;
	value?: string;
	rect?: RectInit;
	style?: { display?: string; visibility?: string; pointerEvents?: string };
	shadow?: FakeShadowRoot;
	children?: FakeElement[];
};

export class FakeElement implements QueryElementLike {
	tagName: string;
	id = "";
	children: FakeElement[] = [];
	parentElement: FakeElement | null = null;
	ownerDocument: FakeDocument | null = null;
	shadowRoot: FakeShadowRoot | null = null;
	textContent = "";
	isContentEditable = false;
	style: { display?: string; visibility?: string; pointerEvents?: string } = {};
	emittedEvents: Event[] = [];
	private readonly attributes = new Map<string, string>();
	private readonly listeners = new Map<string, Array<(event: Event) => void>>();
	private rect: Required<RectInit> = defaultRect();
	private parentRoot: FakeDocument | FakeShadowRoot | null = null;
	private currentValue: string | undefined;

	constructor(tagName: string, init: ElementInit = {}) {
		this.tagName = tagName.toUpperCase();
		applyElementInit(this, init);
	}

	get innerText(): string {
		const childText = this.children
			.map((child) => child.innerText)
			.filter(Boolean)
			.join(" ");
		return normalizeText([this.textContent, childText].filter(Boolean).join(" "));
	}

	get value(): string | undefined {
		return this.currentValue;
	}

	set value(next: string | undefined) {
		this.currentValue = next;
	}

	get isConnected(): boolean {
		return this.ownerDocument !== null;
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
		if (name === "id") this.id = value;
		if (name === "contenteditable") this.isContentEditable = value === "true";
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
		if (name === "id") this.id = "";
		if (name === "contenteditable") this.isContentEditable = false;
	}

	append(...children: FakeElement[]): this {
		for (const child of children) {
			child.parentElement = this;
			child.parentRoot = null;
			child.setOwnerDocument(this.ownerDocument);
			this.children.push(child);
		}
		return this;
	}

	remove(): void {
		if (this.parentElement) {
			this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
			this.parentElement = null;
		}
		if (this.parentRoot instanceof FakeShadowRoot) {
			this.parentRoot.children = this.parentRoot.children.filter((child) => child !== this);
		}
		if (this.parentRoot instanceof FakeDocument) {
			this.parentRoot.children = this.parentRoot.children.filter((child) => child !== this);
			this.parentRoot.documentElement = this.parentRoot.children[0] ?? null;
			this.parentRoot.body = this.parentRoot.querySelector("body");
		}
		this.parentRoot = null;
		this.setOwnerDocument(null);
	}

	attachShadowRoot(root: FakeShadowRoot): FakeShadowRoot {
		this.shadowRoot = root;
		root.host = this;
		root.setOwnerDocument(this.ownerDocument);
		return root;
	}

	setRootParent(root: FakeDocument | FakeShadowRoot): void {
		this.parentElement = null;
		this.parentRoot = root;
		this.setOwnerDocument(root instanceof FakeDocument ? root : root.ownerDocument);
	}

	setOwnerDocument(doc: FakeDocument | null): void {
		this.ownerDocument = doc;
		for (const child of this.children) child.setOwnerDocument(doc);
		this.shadowRoot?.setOwnerDocument(doc);
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		return queryWithin(this, selector) as FakeElement[];
	}

	matches(selector: string): boolean {
		return matchesAnySelector(this, selector);
	}

	closest(selector: string): FakeElement | null {
		if (this.matches(selector)) return this;
		let ancestor: FakeElement | null =
			this.parentElement ??
			(this.parentRoot instanceof FakeShadowRoot ? this.parentRoot.host : null);
		while (ancestor) {
			if (ancestor.matches(selector)) return ancestor;
			ancestor =
				ancestor.parentElement ??
				(ancestor.parentRoot instanceof FakeShadowRoot ? ancestor.parentRoot.host : null);
		}
		return null;
	}

	getRootNode(): FakeDocument | FakeShadowRoot {
		if (this.parentElement) return this.parentElement.getRootNode();
		if (this.parentRoot) return this.parentRoot;
		return this.ownerDocument ?? new FakeDocument();
	}

	getBoundingClientRect(): DOMRect {
		return {
			width: this.rect.width,
			height: this.rect.height,
			top: this.rect.top,
			left: this.rect.left,
			right: this.rect.left + this.rect.width,
			bottom: this.rect.top + this.rect.height,
			x: this.rect.left,
			y: this.rect.top,
			toJSON: () => ({ ...this.rect }),
		};
	}

	setRect(rect: RectInit): void {
		this.rect = { ...this.rect, ...rect };
	}

	addEventListener(type: string, listener: (event: Event) => void): void {
		const current = this.listeners.get(type) ?? [];
		current.push(listener);
		this.listeners.set(type, current);
	}

	removeEventListener(type: string, listener: (event: Event) => void): void {
		const current = this.listeners.get(type);
		if (!current) return;
		this.listeners.set(
			type,
			current.filter((candidate) => candidate !== listener),
		);
	}

	dispatchEvent(event: Event): boolean {
		try {
			Object.defineProperty(event, "target", { configurable: true, value: this });
			Object.defineProperty(event, "currentTarget", { configurable: true, value: this });
		} catch {
			// ignore synthetic event property failures in tests
		}
		this.emittedEvents.push(event);
		for (const listener of this.listeners.get(event.type) ?? []) listener(event);
		return true;
	}

	focus(): void {
		const root = this.getRootNode();
		if (root instanceof FakeShadowRoot) {
			root.activeElement = this;
			if (root.ownerDocument) root.ownerDocument.activeElement = root.host;
			return;
		}
		root.activeElement = this;
	}

	click(): void {
		this.dispatchEvent(createEvent("click"));
	}
}

export class FakeShadowRoot implements QueryRootLike {
	host!: FakeElement;
	children: FakeElement[] = [];
	activeElement: FakeElement | null = null;
	ownerDocument: FakeDocument | null = null;

	append(...children: FakeElement[]): this {
		for (const child of children) {
			child.setRootParent(this);
			this.children.push(child);
		}
		return this;
	}

	setOwnerDocument(doc: FakeDocument | null): void {
		this.ownerDocument = doc;
		for (const child of this.children) child.setOwnerDocument(doc);
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		return queryWithin(this, selector) as FakeElement[];
	}
}

export class FakeDocument implements QueryRootLike {
	children: FakeElement[] = [];
	activeElement: FakeElement | null = null;
	body: FakeElement | null = null;
	documentElement: FakeElement | null = null;
	visibilityState: DocumentVisibilityState = "visible";
	readyState: DocumentReadyState = "complete";
	defaultView = {
		getComputedStyle: (element: FakeElement) =>
			({
				display: element.style.display ?? "block",
				visibility: element.style.visibility ?? "visible",
				pointerEvents: element.style.pointerEvents ?? "auto",
			}) as CSSStyleDeclaration,
	};
	private hitTest: FakeElement[] = [];

	append(...children: FakeElement[]): this {
		for (const child of children) {
			child.setRootParent(this);
			this.children.push(child);
		}
		this.documentElement = this.children[0] ?? null;
		this.body = this.querySelector("body");
		return this;
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		return queryWithin(this, selector) as FakeElement[];
	}

	setHitTest(elements: FakeElement[]): void {
		this.hitTest = elements;
	}

	elementsFromPoint(): FakeElement[] {
		return [...this.hitTest];
	}
}

export function el(tagName: string, init: ElementInit = {}): FakeElement {
	return new FakeElement(tagName, init);
}

export function shadow(...children: FakeElement[]): FakeShadowRoot {
	return new FakeShadowRoot().append(...children);
}

export function doc(...children: FakeElement[]): FakeDocument {
	return new FakeDocument().append(...children);
}

function applyElementInit(element: FakeElement, init: ElementInit): void {
	element.textContent = init.text ?? "";
	if (init.value !== undefined) element.value = init.value;
	element.style = { ...init.style };
	element.setRect(init.rect ?? defaultRect());
	for (const [name, raw] of Object.entries(init.attrs ?? {})) {
		element.setAttribute(name, raw === true ? "" : raw);
	}
	if (init.shadow) element.attachShadowRoot(init.shadow);
	for (const child of init.children ?? []) element.append(child);
}

function defaultRect(): Required<RectInit> {
	return { width: 100, height: 20, top: 0, left: 0 };
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function createEvent(type: string): Event {
	if (typeof Event === "function") return new Event(type, { bubbles: true, composed: true });
	return { type, bubbles: true, composed: true } as Event;
}
