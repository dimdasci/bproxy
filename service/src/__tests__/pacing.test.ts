import type { BproxyRequest } from "@bproxy/shared";
import { PACING_PRESETS } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createPacing } from "../pacing";
import { createSessionRegistry } from "../sessions";

const SESSION = "m4q8z2" as BproxyRequest["session"];
const FAST_SESSION = "f4st22" as BproxyRequest["session"];

function createTestHarness(opts: { random?: () => number; session?: string } = {}) {
	let clock = 0;
	const sleeps: number[] = [];
	const sessions = createSessionRegistry();
	const sid = (opts.session ?? SESSION) as BproxyRequest["session"];
	sessions.getOrCreate(sid);
	const pacing = createPacing({
		sessions,
		now: () => clock,
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
		random: opts.random ?? (() => 0.5),
	});
	return {
		pacing,
		sessions,
		sleeps,
		get clock() {
			return clock;
		},
		set clock(v: number) {
			clock = v;
		},
		advance(ms: number) {
			clock += ms;
		},
	};
}

describe("pacing engine", () => {
	it("waits the configured delay on a paced action (pinned jitter)", async () => {
		const h = createTestHarness();
		h.clock = 1_000_000;

		await h.pacing.waitForSlot(SESSION, "navigate");
		expect(h.sleeps).toEqual([]);

		h.advance(100);
		await h.pacing.waitForSlot(SESSION, "navigate");
		expect(h.sleeps).toEqual([2750 - 100]);
	});

	it("waits a delay inside the preset range under real jitter", async () => {
		// Deterministic PRNG (linear congruential) to avoid Math.random() security hotspot
		let seed = 42;
		const prng = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 0x100000000;
		};
		const h = createTestHarness({ random: prng });

		await h.pacing.waitForSlot(SESSION, "navigate");
		await h.pacing.waitForSlot(SESSION, "navigate");
		expect(h.sleeps.length).toBe(1);
		const { min, max } = PACING_PRESETS.human.navigate;
		expect(h.sleeps[0]).toBeGreaterThanOrEqual(min - 1);
		expect(h.sleeps[0]).toBeLessThanOrEqual(max);
	});

	it("paces click and hover through the interaction bucket", async () => {
		const h = createTestHarness();

		await h.pacing.waitForSlot(SESSION, "click");
		h.advance(10);
		await h.pacing.waitForSlot(SESSION, "hover");
		expect(h.sleeps).toEqual([1250 - 10]);
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
		const h = createTestHarness({ session: FAST_SESSION });
		h.sessions.bind(FAST_SESSION, 1, "fast");

		await h.pacing.waitForSlot(FAST_SESSION, "fill");
		h.advance(10);
		await h.pacing.waitForSlot(FAST_SESSION, "fill");
		expect(h.sleeps).toEqual([250 - 10]);
	});

	it("never sleeps when elapsed already exceeds the configured delay", async () => {
		const h = createTestHarness();

		await h.pacing.waitForSlot(SESSION, "navigate");
		h.advance(10_000);
		await h.pacing.waitForSlot(SESSION, "navigate");
		expect(h.sleeps).toHaveLength(0);
	});
});
