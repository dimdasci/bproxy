import { readFileSync } from "node:fs";
import { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import type { PairingBootstrap } from "../../../background/storage";
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

function bootstrap(overrides: Partial<PairingBootstrap> = {}): PairingBootstrap {
	return {
		extensionToken: "tok-123",
		wsUrl: "ws://127.0.0.1:9615/ws",
		protocolVersion: PROTOCOL_VERSION,
		issuedAt: 100,
		expiresAt: 10_000,
		nonce: "nonce-1",
		...overrides,
	};
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
	it("renders gray not-paired state when no bootstrap exists", () => {
		expect(getConnectionStatusViewModel(null, 5_000)).toEqual({
			text: "Not paired",
			tone: "muted",
			submitLabel: "Pair extension",
		});
	});

	it("renders gray not-paired state when bootstrap is expired", () => {
		expect(getConnectionStatusViewModel(bootstrap({ expiresAt: 4_000 }), 5_000)).toEqual({
			text: "Not paired",
			tone: "muted",
			submitLabel: "Pair extension",
		});
	});

	it("renders green paired state when bootstrap is present and fresh", () => {
		expect(getConnectionStatusViewModel(bootstrap(), 5_000)).toEqual({
			text: "Paired with local daemon",
			tone: "ok",
			submitLabel: "Re-pair with new code",
		});
	});
});
