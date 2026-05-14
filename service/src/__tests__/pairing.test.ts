import { describe, expect, it } from "vitest";
import { createPairingStore } from "../pairing";

describe("pairing store", () => {
	it("issues a code in the ABCD-EFGH shape", () => {
		const store = createPairingStore({ ttlMs: 300_000, now: () => 0 });
		const { code } = store.issue();
		expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	});

	it("claim returns a bootstrap payload exactly once", () => {
		const store = createPairingStore({ ttlMs: 300_000, now: () => 0 });
		const { code } = store.issue();
		const r1 = store.claim(code);
		const r2 = store.claim(code);
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.code).toBe("PAIRING_CODE_CONSUMED");
	});

	it("claim fails when the code is expired", () => {
		let now = 0;
		const store = createPairingStore({ ttlMs: 1000, now: () => now });
		const { code } = store.issue();
		now = 5000;
		const r = store.claim(code);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("PAIRING_CODE_EXPIRED");
	});

	it("claim fails for unknown code", () => {
		const store = createPairingStore({ ttlMs: 1000, now: () => 0 });
		const r = store.claim("ZZZZ-ZZZZ");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("PAIRING_CODE_INVALID");
	});

	it("active() lists unconsumed, unexpired codes", () => {
		let now = 0;
		const store = createPairingStore({ ttlMs: 1000, now: () => now });
		const a = store.issue();
		const b = store.issue();
		store.claim(a.code);
		expect(store.active()).toEqual(new Set([b.code]));
		now = 5000;
		expect(store.active()).toEqual(new Set());
	});
});
