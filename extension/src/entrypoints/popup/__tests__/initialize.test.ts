import { PROTOCOL_VERSION } from "@bproxy/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PairingBootstrap } from "../../../background/storage";
import type { BadgeState } from "../../../background/ws-client";
import { createFakeStorageItem } from "../../../test/fakes/storage";
import { initializePopup, type PopupInitDeps } from "../main";

// Minimal DOM surface required by initializePopup's rendering helpers.
// The test environment is Node (not jsdom); we wire up just enough of
// the DOM API to exercise the async logic path without a full browser.

interface FakeElement {
	textContent: string;
	dataset: Record<string, string>;
	replaceChildren: ReturnType<typeof vi.fn>;
	setAttribute: ReturnType<typeof vi.fn>;
	append: ReturnType<typeof vi.fn>;
}

function fakeElement(): FakeElement {
	return {
		textContent: "",
		dataset: {},
		replaceChildren: vi.fn(),
		setAttribute: vi.fn(),
		append: vi.fn(),
	};
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

function makeDeps(
	state: BadgeState | null,
	stored: PairingBootstrap | null = bootstrap(),
): PopupInitDeps {
	return {
		storage: createFakeStorageItem<PairingBootstrap | null>("local:bootstrap", stored),
		queryState: async () => state,
	};
}

describe("initializePopup", () => {
	let elements: Record<string, FakeElement>;

	beforeEach(() => {
		elements = {
			"version-info": fakeElement(),
			"connection-status": fakeElement(),
			submit: fakeElement(),
			status: fakeElement(),
		};
		const svgEl = fakeElement();
		vi.stubGlobal("document", {
			getElementById: (id: string) => elements[id] ?? null,
			createElementNS: () => svgEl,
			createTextNode: (text: string) => ({ textContent: text }),
		});
	});

	it("renders paired state when background reports connected", async () => {
		await initializePopup(makeDeps("connected"));

		expect(elements["connection-status"]!.replaceChildren).toHaveBeenCalled();
		expect(elements["submit"]!.textContent).toBe("Re-pair with new code");
	});

	it("renders connecting state from live query", async () => {
		await initializePopup(makeDeps("connecting"));

		expect(elements["submit"]!.textContent).toBe("Re-pair with new code");
	});

	it("renders disconnected when has bootstrap but SW is disconnected", async () => {
		await initializePopup(makeDeps("disconnected"));

		expect(elements["submit"]!.textContent).toBe("Re-pair with new code");
	});

	it("renders not-paired when no bootstrap and query returns null", async () => {
		await initializePopup(makeDeps(null, null));

		expect(elements["submit"]!.textContent).toBe("Pair extension");
	});

	it("handles storage read failure gracefully (treats as no bootstrap)", async () => {
		const deps: PopupInitDeps = {
			storage: {
				async getValue() {
					throw new Error("storage corrupt");
				},
			},
			queryState: async () => "disconnected",
		};

		await initializePopup(deps);

		// Storage failed → hasBootstrap=false, state=disconnected → "Not paired"
		expect(elements["submit"]!.textContent).toBe("Pair extension");
	});

	it("sets status output to idle after rendering", async () => {
		await initializePopup(makeDeps("connected"));

		expect(elements["status"]!.dataset["state"]).toBe("idle");
		expect(elements["status"]!.textContent).toBe("");
	});
});
