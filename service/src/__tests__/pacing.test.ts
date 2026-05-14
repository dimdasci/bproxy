import { PACING_PRESETS } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createPacing } from "../pacing";
import { createSessionRegistry } from "../sessions";

describe("pacing engine", () => {
	// One pinned-jitter test locks the formula. Other tests assert ranges so
	// changes to the jitter formula don't churn unrelated tests.
	it("waits the configured delay on a paced action (pinned jitter)", async () => {
		let clock = 1_000_000;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot("s", "navigate"); // first call: no prior action → no wait
		expect(sleeps).toEqual([]);

		clock += 100; // 100ms later, second navigate. preset 1500–4000, mid → 2750
		await pacing.waitForSlot("s", "navigate");
		expect(sleeps).toEqual([2750 - 100]);
	});

	it("waits a delay inside the preset range under real jitter", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => Math.random(),
		});

		await pacing.waitForSlot("s", "navigate"); // no prior action
		await pacing.waitForSlot("s", "navigate");
		expect(sleeps.length).toBe(1);
		const { min, max } = PACING_PRESETS.human.navigate;
		expect(sleeps[0]).toBeGreaterThanOrEqual(min - 1);
		expect(sleeps[0]).toBeLessThanOrEqual(max);
	});

	it("passes through unpaced actions immediately", async () => {
		const sleep = vi.fn();
		const pacing = createPacing({
			sessions: createSessionRegistry(),
			now: () => 0,
			sleep,
			random: () => 0,
		});
		await pacing.waitForSlot("s", "text");
		await pacing.waitForSlot("s", "elements");
		expect(sleep).not.toHaveBeenCalled();
	});

	it("respects per-session pacing mode override (pinned)", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.bind("fast-session", 1, "fast");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot("fast-session", "fill"); // first call
		clock += 10;
		await pacing.waitForSlot("fast-session", "fill"); // fast preset 100–400 → 250
		expect(sleeps).toEqual([250 - 10]);
	});

	it("never sleeps when elapsed already exceeds the configured delay", async () => {
		let clock = 0;
		const sleep = vi.fn(async (ms: number) => {
			clock += ms;
		});
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep,
			random: () => 0.5,
		});

		await pacing.waitForSlot("s", "navigate");
		clock += 10_000; // wait longer than the preset max
		await pacing.waitForSlot("s", "navigate");
		// Sleep must not be called for the second slot — elapsed already exceeds target.
		expect(sleep).not.toHaveBeenCalled();
	});
});
