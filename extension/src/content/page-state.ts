import type { PageState } from "@bproxy/shared";

export interface PageStateSource {
	url: string;
	title: string;
	readyState: "loading" | "interactive" | "complete";
	busyHint?: boolean;
}

interface DomSnapshotDeps {
	document: {
		title: string;
		readyState: DocumentReadyState;
		querySelector(selector: string): Element | null;
	};
	location: { href: string };
}

const BUSY_SELECTOR = '[aria-busy="true"], [role="progressbar"], progress:not([value])';

export function snapshotPageState(source: PageStateSource): PageState {
	const state = resolveState(source);
	return {
		url: source.url,
		title: source.title,
		state,
		busy: resolveBusy(source, state),
	};
}

export function snapshotDomPageState(
	deps: DomSnapshotDeps = { document, location: window.location },
): PageState {
	return snapshotPageState({
		url: deps.location.href,
		title: deps.document.title,
		readyState: normalizeReadyState(deps.document.readyState),
		busyHint: hasBusyHint(deps.document),
	});
}

function resolveState(source: PageStateSource): PageState["state"] {
	if (isErrorUrl(source.url)) return "error";
	if (source.readyState !== "complete") return "loading";
	return "ready";
}

function resolveBusy(source: PageStateSource, state: PageState["state"]): boolean {
	if (state === "error") return false;
	if (source.busyHint === true) return true;
	return source.readyState !== "complete";
}

function normalizeReadyState(value: DocumentReadyState): PageStateSource["readyState"] {
	return value === "interactive" || value === "complete" ? value : "loading";
}

function hasBusyHint(doc: DomSnapshotDeps["document"]): boolean {
	return doc.querySelector(BUSY_SELECTOR) !== null;
}

function isErrorUrl(url: string): boolean {
	return (
		url.startsWith("chrome-error://") ||
		url.startsWith("edge-error://") ||
		url.startsWith("about:neterror")
	);
}
