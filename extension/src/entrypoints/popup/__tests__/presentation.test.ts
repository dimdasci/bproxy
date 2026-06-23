import { readFileSync } from "node:fs";
import { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { formatVersionInfo, getConnectionStatusViewModel } from "../main";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function expectLink(label: string, href: string): void {
	const hrefPattern = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	expect(html).toMatch(
		new RegExp(
			`<a[^>]*href="${hrefPattern}"[^>]*target="_blank"[^>]*rel="noreferrer"[^>]*>${label}</a>`,
		),
	);
}

describe("popup presentation", () => {
	it("renders title, subtitle, status line, and stable pairing controls", () => {
		expect(html).toContain("<title>bproxy</title>");
		expect(html).toContain("Human-in-the-loop browser bridge for AI agents.");
		expect(html).toContain('id="connection-status"');
		expect(html).toContain('id="pair-form"');
		expect(html).toContain('id="code"');
		expect(html).toContain('id="submit"');
		expect(html).toContain("Pair extension");
		expect(html).toContain('id="status"');
		expect(html).toContain(
			"Run <code>bproxy service start</code> and paste the one-time code shown by the daemon.",
		);
	});

	it("renders footer metadata, links, and attribution", () => {
		expect(html).toContain('id="version-info"');
		expectLink("Documentation", "https://dimdasci.github.io/bproxy/");
		expectLink("Privacy", "https://dimdasci.github.io/bproxy/privacy/");
		expectLink("MIT", "https://github.com/dimdasci/bproxy/blob/main/LICENSE");
		expect(html).toContain("Created by Dim Kharitonov");
		expect(html).toContain('aria-label="bproxy on GitHub"');
		expect(html).toContain('href="https://github.com/dimdasci/bproxy"');
	});
});

describe("formatVersionInfo", () => {
	it("renders shared version metadata", () => {
		expect(formatVersionInfo()).toBe(`Extension ${VERSION} · Protocol ${PROTOCOL_VERSION}`);
	});

	it("falls back to empty values without throwing", () => {
		expect(formatVersionInfo(null, null)).toBe("Extension · Protocol");
	});
});

describe("getConnectionStatusViewModel", () => {
	it("shows green paired state when live state is connected", () => {
		expect(getConnectionStatusViewModel("connected", true)).toEqual({
			text: "Paired with local daemon",
			tone: "ok",
			submitLabel: "Re-pair with new code",
		});
	});

	it("shows green paired state even without bootstrap when connected", () => {
		// Edge case: connected but storage read failed
		expect(getConnectionStatusViewModel("connected", false)).toEqual({
			text: "Paired with local daemon",
			tone: "ok",
			submitLabel: "Re-pair with new code",
		});
	});

	it("shows connecting state when live state is connecting", () => {
		expect(getConnectionStatusViewModel("connecting", true)).toEqual({
			text: "Connecting\u2026",
			tone: "muted",
			submitLabel: "Re-pair with new code",
		});
	});

	it("shows disconnected when has bootstrap but WS is down", () => {
		expect(getConnectionStatusViewModel("disconnected", true)).toEqual({
			text: "Disconnected",
			tone: "muted",
			submitLabel: "Re-pair with new code",
		});
	});

	it("shows disconnected when has bootstrap but state query returned error", () => {
		expect(getConnectionStatusViewModel("error", true)).toEqual({
			text: "Disconnected",
			tone: "muted",
			submitLabel: "Re-pair with new code",
		});
	});

	it("shows not-paired when no bootstrap and disconnected", () => {
		expect(getConnectionStatusViewModel("disconnected", false)).toEqual({
			text: "Not paired",
			tone: "muted",
			submitLabel: "Pair extension",
		});
	});

	it("shows not-paired when no bootstrap and state is null (query failed)", () => {
		expect(getConnectionStatusViewModel(null, false)).toEqual({
			text: "Not paired",
			tone: "muted",
			submitLabel: "Pair extension",
		});
	});

	it("shows not-paired when no bootstrap and state is error", () => {
		expect(getConnectionStatusViewModel("error", false)).toEqual({
			text: "Not paired",
			tone: "muted",
			submitLabel: "Pair extension",
		});
	});

	it("shows disconnected when has bootstrap but state query returned null", () => {
		expect(getConnectionStatusViewModel(null, true)).toEqual({
			text: "Disconnected",
			tone: "muted",
			submitLabel: "Re-pair with new code",
		});
	});
});
