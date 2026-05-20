import { describe, expect, it } from "vitest";
import { doc, el } from "../../test/fixtures/fake-dom";
import { pollUntilMatch, pollUntilStable, subtreeSignature } from "../polling";

describe("polling", () => {
	it("uses jittered intervals from the injected random source", async () => {
		const clock = createVirtualClock([0, 0.5, 1]);
		let value = 0;

		const result = await pollUntilMatch(
			{
				read: () => {
					value += 1;
					return value;
				},
				matches: (current) => current >= 4,
				intervalMinMs: 180,
				intervalMaxMs: 250,
			},
			clock,
		);

		expect(clock.sleeps).toEqual([180, 215, 250]);
		expect(result).toEqual({ matched: true, elapsed: 645, checks: 4, value: 4 });
	});

	it("times out when the sample never reaches a stable value", async () => {
		const clock = createVirtualClock([0]);
		let toggle = false;

		const result = await pollUntilStable(
			{
				read: () => {
					toggle = !toggle;
					return toggle ? "a" : "b";
				},
				timeoutMs: 500,
				intervalMinMs: 100,
				intervalMaxMs: 100,
			},
			clock,
		);

		expect(result).toEqual({ stable: false, elapsed: 500, checks: 6, value: "b" });
	});

	it("captures subtree-signature changes across bounded depth", () => {
		const page = doc(
			el("html", {
				children: [
					el("body", {
						children: [el("section", { children: [el("p", { text: "alpha" })] })],
					}),
				],
			}),
		);
		const before = subtreeSignature((page.body ?? page.documentElement) as unknown as Element);
		page.body?.append(el("aside", { text: "beta" }));
		const after = subtreeSignature((page.body ?? page.documentElement) as unknown as Element);

		expect(after).not.toBe(before);
	});
});

function createVirtualClock(randomValues: number[]) {
	let now = 0;
	let index = 0;
	const sleeps: number[] = [];

	return {
		now: () => now,
		random: () => randomValues[Math.min(index++, randomValues.length - 1)] ?? 0,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			now += ms;
		},
		sleeps,
	};
}
