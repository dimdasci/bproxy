import type { BproxyRequest } from "@bproxy/shared";
import { PACING_PRESETS } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createPacing } from "../pacing";
import { createSessionRegistry } from "../sessions";

const SESSION = "m4q8z2" as BproxyRequest["session"];
const FAST_SESSION = "f4st22" as BproxyRequest["session"];

describe("pacing engine", () => {
	it("waits the configured delay on a paced action (pinned jitter)", async () => {
		let clock = 1_000_000;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate(SESSION);
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot(SESSION, "navigate");
		expect(sleeps).toEqual([]);

		clock += 100;
		await pacing.waitForSlot(SESSION, "navigate");
		expect(sleeps).toEqual([2750 - 100]);
	});

	it("waits a delay inside the preset range under real jitter", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate(SESSION);
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => Math.random(),
		});

		await pacing.waitForSlot(SESSION, "navigate");
		await pacing.waitForSlot(SESSION, "navigate");
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
		await pacing.waitForSlot(SESSION, "text");
		await pacing.waitForSlot(SESSION, "elements");
		expect(sleep).not.toHaveBeenCalled();
	});

	it("respects per-session pacing mode override (pinned)", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate(FAST_SESSION);
		sessions.bind(FAST_SESSION, 1, "fast");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot(FAST_SESSION, "fill");
		clock += 10;
		await pacing.waitForSlot(FAST_SESSION, "fill");
		expect(sleeps).toEqual([250 - 10]);
	});

	it("never sleeps when elapsed already exceeds the configured delay", async () => {
		let clock = 0;
		const sleep = vi.fn(async (ms: number) => {
			clock += ms;
		});
		const sessions = createSessionRegistry();
		sessions.getOrCreate(SESSION);
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep,
			random: () => 0.5,
		});

		await pacing.waitForSlot(SESSION, "navigate");
		clock += 10_000;
		await pacing.waitForSlot(SESSION, "navigate");
		expect(sleep).not.toHaveBeenCalled();
	});
});
