import { describe, expect, it, vi } from "vitest";
import type { PairingBootstrap } from "../../../background/storage";
import { createFakeStorageItem } from "../../../test/fakes/storage";
import { type PairingDeps, runPairing } from "../pairing";

// Build a `fetch` stub that returns the given body/status as `Response`-like
// for the popup's narrow needs (status + json()). Avoids dragging in undici
// `Response` polyfills and keeps the test runtime in pure Node.
function makeFetch(
	status: number,
	body: unknown,
	{ throwOnJson = false }: { throwOnJson?: boolean } = {},
) {
	return vi.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		async json() {
			if (throwOnJson) throw new SyntaxError("Unexpected token in JSON");
			return body;
		},
	}));
}

function happyBody(overrides: Partial<PairingBootstrap> = {}) {
	const data: PairingBootstrap = {
		extensionToken: "tok-abc",
		wsUrl: "ws://127.0.0.1:9615/ws",
		protocolVersion: 1,
		issuedAt: 1000,
		expiresAt: 9999,
		nonce: "n-1",
		...overrides,
	};
	return { ok: true, data };
}

function makeDeps(overrides: Partial<PairingDeps> = {}): PairingDeps & {
	storage: ReturnType<typeof createFakeStorageItem<PairingBootstrap | null>>;
	sendMessage: ReturnType<typeof vi.fn>;
} {
	const storage = createFakeStorageItem<PairingBootstrap | null>("local:bootstrap", null);
	const sendMessage = vi.fn(async () => undefined);
	return {
		fetch: makeFetch(200, happyBody()) as unknown as typeof globalThis.fetch,
		storage,
		sendMessage,
		now: () => 5000,
		...overrides,
		// keep storage/sendMessage references after spread so callers can
		// observe them even when overriding fetch/now.
		...(overrides.storage ? { storage: overrides.storage } : {}),
		...(overrides.sendMessage ? { sendMessage: overrides.sendMessage } : {}),
	} as PairingDeps & {
		storage: ReturnType<typeof createFakeStorageItem<PairingBootstrap | null>>;
		sendMessage: ReturnType<typeof vi.fn>;
	};
}

describe("runPairing", () => {
	it("happy path: validated payload is persisted and pair.complete is sent", async () => {
		const deps = makeDeps();
		const res = await runPairing({ code: "ABCD-EFGH" }, deps);

		expect(res).toEqual({ ok: true });
		expect(deps.fetch).toHaveBeenCalledWith(
			"http://127.0.0.1:9615/pair/claim",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "Content-Type": "application/json" }),
				body: JSON.stringify({ code: "ABCD-EFGH" }),
			}),
		);
		const stored = await deps.storage.getValue();
		expect(stored).toEqual({
			extensionToken: "tok-abc",
			wsUrl: "ws://127.0.0.1:9615/ws",
			protocolVersion: 1,
			issuedAt: 1000,
			expiresAt: 9999,
			nonce: "n-1",
		});
		expect(deps.sendMessage).toHaveBeenCalledWith({ type: "pair.complete" });
	});

	it("daemon returns PAIRING_CODE_INVALID → forwards code, no storage, no notify", async () => {
		const deps = makeDeps({
			fetch: makeFetch(401, {
				ok: false,
				error: { code: "PAIRING_CODE_INVALID" },
			}) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "BAD" }, deps);

		expect(res).toMatchObject({ ok: false, code: "PAIRING_CODE_INVALID" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("non-loopback wsUrl is rejected with INVALID_WS_URL", async () => {
		const deps = makeDeps({
			fetch: makeFetch(
				200,
				happyBody({ wsUrl: "ws://example.com:9615/ws" }),
			) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "INVALID_WS_URL" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("wss scheme is rejected with INVALID_WS_URL", async () => {
		const deps = makeDeps({
			fetch: makeFetch(
				200,
				happyBody({ wsUrl: "wss://127.0.0.1:9615/ws" }),
			) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "INVALID_WS_URL" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("protocolVersion !== 1 is rejected with UNSUPPORTED_PROTOCOL_VERSION", async () => {
		const deps = makeDeps({
			fetch: makeFetch(200, {
				ok: true,
				data: { ...happyBody().data, protocolVersion: 2 },
			}) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL_VERSION" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("expiresAt in the past is rejected with BOOTSTRAP_EXPIRED", async () => {
		const deps = makeDeps({
			fetch: makeFetch(200, happyBody({ expiresAt: 4000 })) as unknown as typeof globalThis.fetch,
			now: () => 5000,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "BOOTSTRAP_EXPIRED" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("missing nonce is rejected with MISSING_NONCE", async () => {
		const data: Partial<PairingBootstrap> = { ...happyBody().data };
		delete data.nonce;
		const deps = makeDeps({
			fetch: makeFetch(200, { ok: true, data }) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "MISSING_NONCE" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("HTTP 500 with malformed JSON is rejected with PAIR_TRANSPORT_ERROR", async () => {
		const deps = makeDeps({
			fetch: makeFetch(500, null, { throwOnJson: true }) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "PAIR_TRANSPORT_ERROR" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("fetch rejects (network down) → PAIR_TRANSPORT_ERROR", async () => {
		const deps = makeDeps({
			fetch: vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "X" }, deps);

		expect(res).toMatchObject({ ok: false, code: "PAIR_TRANSPORT_ERROR" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});

	it("sendMessage throwing after persist → PAIR_NOTIFY_FAILED, but storage is retained", async () => {
		const sendMessage = vi.fn(async () => {
			throw new Error("Receiving end does not exist.");
		});
		const deps = makeDeps({ sendMessage });

		const res = await runPairing({ code: "OK" }, deps);

		expect(res).toMatchObject({ ok: false, code: "PAIR_NOTIFY_FAILED" });
		// Storage IS retained: pairing finished, only the wake-up failed.
		// A future SW restart will pick up the persisted bootstrap.
		expect(await deps.storage.getValue()).toMatchObject({ extensionToken: "tok-abc" });
		expect(sendMessage).toHaveBeenCalled();
	});

	it("400 with PAIRING_CODE_INVALID code is forwarded as-is", async () => {
		const deps = makeDeps({
			fetch: makeFetch(400, {
				ok: false,
				error: { code: "PAIRING_CODE_INVALID", message: "code required" },
			}) as unknown as typeof globalThis.fetch,
		});

		const res = await runPairing({ code: "" }, deps);

		expect(res).toMatchObject({ ok: false, code: "PAIRING_CODE_INVALID" });
		expect(await deps.storage.getValue()).toBeNull();
		expect(deps.sendMessage).not.toHaveBeenCalled();
	});
});
