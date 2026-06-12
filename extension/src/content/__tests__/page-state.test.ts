import { describe, expect, it } from "vitest";
import { snapshotDomPageState, snapshotPageState } from "../page-state";

describe("snapshotPageState", () => {
	it("marks loading documents as busy", () => {
		expect(
			snapshotPageState({
				url: "https://example.test/loading",
				title: "Loading",
				readyState: "loading",
			}),
		).toEqual({
			url: "https://example.test/loading",
			title: "Loading",
			state: "loading",
			busy: true,
		});
	});

	it("marks browser error documents as error and not busy", () => {
		expect(
			snapshotPageState({
				url: "chrome-error://chromewebdata/",
				title: "This site can't be reached",
				readyState: "complete",
			}),
		).toEqual({
			url: "chrome-error://chromewebdata/",
			title: "This site can't be reached",
			state: "error",
			busy: false,
		});
	});

	it("keeps ready documents busy when the page exposes a busy hint", () => {
		expect(
			snapshotPageState({
				url: "https://example.test/app",
				title: "App",
				readyState: "complete",
				busyHint: true,
			}),
		).toEqual({
			url: "https://example.test/app",
			title: "App",
			state: "ready",
			busy: true,
		});
	});
});

function makeDeps(opts: { selector?: string | null; isVisible?: boolean }) {
	const el = opts.selector === null ? null : ({ tagName: "DIV" } as unknown as Element);
	return {
		document: {
			title: "Test",
			readyState: "complete" as DocumentReadyState,
			querySelector: (_sel: string) => el,
		},
		location: { href: "https://example.test/page" },
		isVisible: (_e: Element) => opts.isVisible ?? false,
	};
}

describe("snapshotDomPageState — busy visibility", () => {
	it("reports busy: false when busy element exists but is hidden", () => {
		const state = snapshotDomPageState(makeDeps({ selector: "found", isVisible: false }));
		expect(state.busy).toBe(false);
	});

	it("reports busy: true when busy element exists and is visible", () => {
		const state = snapshotDomPageState(makeDeps({ selector: "found", isVisible: true }));
		expect(state.busy).toBe(true);
	});

	it("reports busy: false when no busy elements exist", () => {
		const state = snapshotDomPageState(makeDeps({ selector: null }));
		expect(state.busy).toBe(false);
	});
});
