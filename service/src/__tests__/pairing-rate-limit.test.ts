import { describe, expect, it } from "vitest";
import { createPairingRateLimiter } from "../pairing-rate-limit";

describe("pairing rate limiter", () => {
	it("allows the first five failures and blocks the sixth within the window", () => {
		let now = 0;
		const limiter = createPairingRateLimiter({ now: () => now });

		for (let i = 0; i < 5; i++) {
			expect(limiter.isLimited()).toBe(false);
			limiter.recordFailure();
			now += 1000;
		}

		expect(limiter.isLimited()).toBe(true);
	});

	it("resets after the fixed window expires", () => {
		let now = 10_000;
		const limiter = createPairingRateLimiter({ now: () => now });

		for (let i = 0; i < 5; i++) limiter.recordFailure();
		expect(limiter.isLimited()).toBe(true);

		now = 70_000;
		expect(limiter.isLimited()).toBe(false);
		limiter.recordFailure();
		expect(limiter.isLimited()).toBe(false);
	});

	it("does not change counters unless a failure is recorded", () => {
		const limiter = createPairingRateLimiter({ now: () => 0 });

		for (let i = 0; i < 10; i++) expect(limiter.isLimited()).toBe(false);
	});
});
