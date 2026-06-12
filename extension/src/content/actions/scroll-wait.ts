import type { ActionResult } from "@bproxy/shared";
import {
	type PollingDeps,
	pollUntilMatch,
	pollUntilStable,
	subtreeSignature,
	tabNotVisibleError,
} from "../polling";
import type { ContentRpcHandlers, ContentRpcRequest } from "../rpc";
import { resolveElementTarget } from "../targeting";

const DEFAULT_SCROLL_VIEWPORT_RATIO = 0.85;

type ScrollWaitActionName = Extract<keyof ContentRpcHandlers, "scroll" | "wait">;
type ScrollWaitHandlers = Required<Pick<ContentRpcHandlers, ScrollWaitActionName>>;

export interface ScrollWaitDocument {
	visibilityState?: DocumentVisibilityState;
	readyState?: DocumentReadyState;
	body?: Element | null;
	documentElement?: Element | null;
	querySelector(selector: string): Element | null;
}

export interface ScrollWaitWindow {
	innerHeight: number;
	scrollY?: number;
	pageYOffset?: number;
	scrollBy(options: ScrollToOptions): void;
}

export interface ScrollWaitDeps extends PollingDeps {
	document?: ScrollWaitDocument;
	window?: ScrollWaitWindow;
	location?: { href: string };
}

export function createScrollWaitHandlers(deps: ScrollWaitDeps = {}): ScrollWaitHandlers {
	return {
		scroll: (request) => handleScroll(request, deps),
		wait: (request) => handleWait(request, deps),
	};
}

export async function handleScroll(
	request: ContentRpcRequest<"scroll">,
	deps: ScrollWaitDeps = {},
): Promise<ActionResult["scroll"]> {
	const doc = getDocument(deps);
	const win = getWindow(deps);

	if (doc.visibilityState === "hidden") {
		throw tabNotVisibleError();
	}

	if (request.params.target) {
		const element = resolveElementTarget(request.params.target, { document: doc as Document });
		const baseDistance = readElementClientHeight(element) || win.innerHeight;
		const distance = resolveScrollDistance(
			request.params.by,
			request.params.direction,
			baseDistance,
		);
		return scrollElement(element, distance, deps, doc);
	}

	const distance = resolveScrollDistance(
		request.params.by,
		request.params.direction,
		win.innerHeight,
	);
	return scrollViewport(win, distance, deps, doc);
}

export async function handleWait(
	request: ContentRpcRequest<"wait">,
	deps: ScrollWaitDeps = {},
): Promise<ActionResult["wait"]> {
	if (request.params.strategy === "selector") {
		return waitForSelector(request.params.target, request.params.timeout, deps);
	}
	if (request.params.strategy === "url") {
		return waitForUrl(request.params.target, request.params.timeout, deps);
	}
	return waitForNavigation(request.params.target, request.params.timeout, deps);
}

async function waitForSelector(
	target: string,
	timeoutMs: number | undefined,
	deps: ScrollWaitDeps,
): Promise<ActionResult["wait"]> {
	const result = await pollUntilMatch(
		{
			read: () => getDocument(deps).querySelector(target) !== null,
			matches: Boolean,
			timeoutMs,
		},
		pollingDeps(deps),
	);
	return { matched: result.matched, elapsed: result.elapsed };
}

async function waitForUrl(
	target: string,
	timeoutMs: number | undefined,
	deps: ScrollWaitDeps,
): Promise<ActionResult["wait"]> {
	const result = await pollUntilMatch(
		{
			read: () => getLocation(deps).href,
			matches: (href) => href === target,
			timeoutMs,
		},
		pollingDeps(deps),
	);
	return { matched: result.matched, elapsed: result.elapsed };
}

async function waitForNavigation(
	target: string,
	timeoutMs: number | undefined,
	deps: ScrollWaitDeps,
): Promise<ActionResult["wait"]> {
	const documentOverride = deps.document;
	const urlResult = await pollUntilMatch(
		{
			read: () => getLocation(deps).href,
			matches: (href) => href === target,
			timeoutMs,
		},
		pollingDeps(deps),
	);
	if (!urlResult.matched) return { matched: false, elapsed: urlResult.elapsed };

	const readyResult = await pollUntilMatch(
		{
			read: () => getDocument(deps).readyState ?? "loading",
			matches: (state) => state === "complete",
			timeoutMs: remainingTimeout(timeoutMs, urlResult.elapsed),
		},
		pollingDeps(deps, documentOverride),
	);
	if (!readyResult.matched) {
		return { matched: false, elapsed: urlResult.elapsed + readyResult.elapsed };
	}

	const stableResult = await pollUntilStable(
		{
			read: () => subtreeSignature(getDocument(deps).body ?? getDocument(deps).documentElement),
			timeoutMs: remainingTimeout(timeoutMs, urlResult.elapsed + readyResult.elapsed),
		},
		pollingDeps(deps, documentOverride),
	);
	return {
		matched: stableResult.stable,
		elapsed: urlResult.elapsed + readyResult.elapsed + stableResult.elapsed,
	};
}

async function scrollViewport(
	win: ScrollWaitWindow,
	distance: number,
	deps: ScrollWaitDeps,
	doc: ScrollWaitDocument,
): Promise<ActionResult["scroll"]> {
	const before = readScrollTop(win);
	win.scrollBy({ top: distance, behavior: "smooth" });
	const stable = await waitForScrollStable(() => readScrollTop(win), deps, doc);
	const after = readScrollTop(win);
	const scrolledPx = after - before;
	return {
		target: "viewport",
		before,
		after,
		scrolledPx,
		moved: scrolledPx !== 0,
		stable: stable && scrolledPx !== 0,
	};
}

async function scrollElement(
	element: Element,
	distance: number,
	deps: ScrollWaitDeps,
	doc: ScrollWaitDocument,
): Promise<ActionResult["scroll"]> {
	const before = element.scrollTop;
	element.scrollBy({ top: distance, behavior: "smooth" });
	const stable = await waitForScrollStable(() => element.scrollTop, deps, doc);
	const after = element.scrollTop;
	const scrolledPx = after - before;
	return {
		target: "element",
		before,
		after,
		scrolledPx,
		moved: scrolledPx !== 0,
		stable: stable && scrolledPx !== 0,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
	};
}

async function waitForScrollStable(
	readPosition: () => number,
	deps: ScrollWaitDeps,
	doc: ScrollWaitDocument,
): Promise<boolean> {
	return (
		await pollUntilStable(
			{
				read: () => `${readPosition()}:${subtreeSignature(doc.body ?? doc.documentElement)}`,
				respectVisibility: true,
			},
			pollingDeps(deps, doc),
		)
	).stable;
}

function readElementClientHeight(element: Element): number {
	return element.clientHeight > 0 ? element.clientHeight : 0;
}

function resolveScrollDistance(
	by: string | undefined,
	direction: "up" | "down" | undefined,
	viewportHeight: number,
): number {
	const baseDistance = parseDistance(by, viewportHeight);
	return direction === "up" ? -Math.abs(baseDistance) : Math.abs(baseDistance);
}

function parseDistance(by: string | undefined, viewportHeight: number): number {
	const normalized = by?.trim().toLowerCase();
	if (!normalized || normalized === "viewport") {
		return Math.round(viewportHeight * DEFAULT_SCROLL_VIEWPORT_RATIO);
	}
	const px = /^(-?\d+)(?:px)?$/.exec(normalized);
	if (px) return Number.parseInt(px[1] as string, 10);
	throw new Error(`Unsupported scroll distance: ${by}`);
}

function readScrollTop(win: ScrollWaitWindow): number {
	if (typeof win.scrollY === "number") return win.scrollY;
	if (typeof win.pageYOffset === "number") return win.pageYOffset;
	return 0;
}

function remainingTimeout(total: number | undefined, elapsed: number): number | undefined {
	if (total === undefined) return undefined;
	return Math.max(0, total - elapsed);
}

function getDocument(deps: ScrollWaitDeps): ScrollWaitDocument {
	return deps.document ?? document;
}

function getWindow(deps: ScrollWaitDeps): ScrollWaitWindow {
	return deps.window ?? window;
}

function getLocation(deps: ScrollWaitDeps): { href: string } {
	return deps.location ?? window.location;
}

function pollingDeps(deps: ScrollWaitDeps, documentOverride?: ScrollWaitDocument): PollingDeps {
	return {
		document: documentOverride ?? deps.document,
		now: deps.now,
		random: deps.random,
		sleep: deps.sleep,
	};
}
