import { describe, expect, it } from "vitest";
import { snapshotPageState } from "../page-state";

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
