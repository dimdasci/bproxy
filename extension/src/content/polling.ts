import type { BproxyError } from "@bproxy/shared";
import { childElements, isShadowRootLike, normalizeText } from "./dom-helpers";

const DEFAULT_INTERVAL_MIN_MS = 180;
const DEFAULT_INTERVAL_MAX_MS = 250;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STABLE_COUNT = 2;
const MAX_SIGNATURE_DEPTH = 3;
const MAX_SIGNATURE_CHILDREN = 12;

export interface PollingDeps {
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	document?: { visibilityState?: DocumentVisibilityState };
}

export interface PollUntilStableOptions {
	read: () => number | string;
	timeoutMs?: number;
	intervalMinMs?: number;
	intervalMaxMs?: number;
	stableCount?: number;
	respectVisibility?: boolean;
}

export interface PollUntilMatchOptions<T> {
	read: () => T;
	matches: (value: T) => boolean;
	timeoutMs?: number;
	intervalMinMs?: number;
	intervalMaxMs?: number;
	respectVisibility?: boolean;
}

export interface PollUntilStableResult {
	stable: boolean;
	elapsed: number;
	checks: number;
	value: number | string;
}

export interface PollUntilMatchResult<T> {
	matched: boolean;
	elapsed: number;
	checks: number;
	value: T;
}

export async function pollUntilStable(
	options: PollUntilStableOptions,
	deps: PollingDeps = {},
): Promise<PollUntilStableResult> {
	assertVisible(options.respectVisibility === true, deps.document);

	const startedAt = getNow(deps)();
	const timeoutMs = normalizeTimeout(options.timeoutMs);
	const stableCount = normalizeStableCount(options.stableCount);
	let checks = 1;
	let value = options.read();
	let consecutiveStable = 1;

	if (stableCount <= 1) {
		return { stable: true, elapsed: 0, checks, value };
	}

	while (true) {
		const elapsed = getNow(deps)() - startedAt;
		if (elapsed >= timeoutMs) {
			return { stable: false, elapsed, checks, value };
		}

		const delay = Math.min(
			nextIntervalMs(options.intervalMinMs, options.intervalMaxMs, getRandom(deps)),
			timeoutMs - elapsed,
		);
		await getSleep(deps)(delay);
		assertVisible(options.respectVisibility === true, deps.document);

		checks += 1;
		const nextValue = options.read();
		const matched = nextValue === value;
		if (matched) {
			consecutiveStable += 1;
		} else {
			value = nextValue;
			consecutiveStable = 1;
		}

		if (consecutiveStable >= stableCount) {
			return {
				stable: true,
				elapsed: getNow(deps)() - startedAt,
				checks,
				value,
			};
		}
	}
}

export async function pollUntilMatch<T>(
	options: PollUntilMatchOptions<T>,
	deps: PollingDeps = {},
): Promise<PollUntilMatchResult<T>> {
	assertVisible(options.respectVisibility === true, deps.document);

	const startedAt = getNow(deps)();
	const timeoutMs = normalizeTimeout(options.timeoutMs);
	let checks = 1;
	let value = options.read();

	if (options.matches(value)) {
		return { matched: true, elapsed: 0, checks, value };
	}

	while (true) {
		const elapsed = getNow(deps)() - startedAt;
		if (elapsed >= timeoutMs) {
			return { matched: false, elapsed, checks, value };
		}

		const delay = Math.min(
			nextIntervalMs(options.intervalMinMs, options.intervalMaxMs, getRandom(deps)),
			timeoutMs - elapsed,
		);
		await getSleep(deps)(delay);
		assertVisible(options.respectVisibility === true, deps.document);

		checks += 1;
		value = options.read();
		if (options.matches(value)) {
			return {
				matched: true,
				elapsed: getNow(deps)() - startedAt,
				checks,
				value,
			};
		}
	}
}

export function nextIntervalMs(
	minMs: number | undefined,
	maxMs: number | undefined,
	random: () => number,
): number {
	const normalizedMin = normalizeIntervalMin(minMs);
	const normalizedMax = normalizeIntervalMax(maxMs, normalizedMin);
	if (normalizedMin === normalizedMax) return normalizedMin;
	const sample = clampRandom(random());
	return Math.round(normalizedMin + (normalizedMax - normalizedMin) * sample);
}

export function subtreeSignature(
	root: Document | ShadowRoot | Element | null | undefined,
	maxDepth = MAX_SIGNATURE_DEPTH,
): string {
	if (!root) return "";
	return serializeSignatureRoot(root, Math.max(0, Math.floor(maxDepth)));
}

export function tabNotVisibleError(): BproxyError {
	return {
		code: "TAB_NOT_VISIBLE",
		category: "execution",
		retry: "conditional",
		message: "Target tab is not visible",
		suggestedAction: "Bring the target tab to the foreground and retry.",
	};
}

function serializeSignatureRoot(root: Document | ShadowRoot | Element, depth: number): string {
	if (isElementLike(root)) return serializeSignatureElement(root, depth);
	const tag = isShadowRootLike(root) ? "shadow" : "document";
	return `${tag}[${childElements(root)
		.slice(0, MAX_SIGNATURE_CHILDREN)
		.map((child) => serializeSignatureElement(child, depth - 1))
		.join("|")}]`;
}

function serializeSignatureElement(element: Element, depth: number): string {
	const children = childElements(element).slice(0, MAX_SIGNATURE_CHILDREN);
	const shadowChildren = isShadowRootLike(element.shadowRoot)
		? childElements(element.shadowRoot).slice(0, MAX_SIGNATURE_CHILDREN)
		: [];
	const textLength = normalizeText(element.textContent ?? "").length;
	const head = `${element.tagName.toLowerCase()}:${textLength}:${children.length}/${shadowChildren.length}`;
	if (depth <= 0) return head;

	const light = children.map((child) => serializeSignatureElement(child, depth - 1)).join(",");
	const shadow = shadowChildren
		.map((child) => serializeSignatureElement(child, depth - 1))
		.join(",");
	return `${head}[${light}]<${shadow}>`;
}

function assertVisible(
	respectVisibility: boolean,
	doc: { visibilityState?: DocumentVisibilityState } | undefined,
): void {
	if (respectVisibility && doc?.visibilityState === "hidden") {
		throw tabNotVisibleError();
	}
}

function getNow(deps: PollingDeps): () => number {
	return deps.now ?? (() => Date.now());
}

function getSleep(deps: PollingDeps): (ms: number) => Promise<void> {
	return deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

function getRandom(deps: PollingDeps): () => number {
	return deps.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000);
}

function normalizeTimeout(timeoutMs: number | undefined): number {
	if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
	return Math.max(0, Math.floor(timeoutMs));
}

function normalizeStableCount(stableCount: number | undefined): number {
	if (stableCount === undefined) return DEFAULT_STABLE_COUNT;
	if (!Number.isFinite(stableCount)) return DEFAULT_STABLE_COUNT;
	return Math.max(1, Math.floor(stableCount));
}

function normalizeIntervalMin(minMs: number | undefined): number {
	if (minMs === undefined || !Number.isFinite(minMs)) return DEFAULT_INTERVAL_MIN_MS;
	return Math.max(1, Math.floor(minMs));
}

function normalizeIntervalMax(maxMs: number | undefined, minMs: number): number {
	if (maxMs === undefined || !Number.isFinite(maxMs)) return DEFAULT_INTERVAL_MAX_MS;
	return Math.max(minMs, Math.floor(maxMs));
}

function clampRandom(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function isElementLike(root: Document | ShadowRoot | Element): root is Element {
	return "tagName" in root;
}
