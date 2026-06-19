import { describe, expect, it } from "vitest";
import { DEFAULT_DAEMON_CONFIG, type SafetyConfig } from "../daemon-config";
import { createSafetyGuards } from "../safety";

interface HarnessOptions {
	config?: Partial<SafetyConfig>;
	random?: () => number;
}

function buildSafetyConfig(config?: Partial<SafetyConfig>): SafetyConfig {
	return {
		minInterval: { ...DEFAULT_DAEMON_CONFIG.safety.minInterval, ...config?.minInterval },
		rateCap: { ...DEFAULT_DAEMON_CONFIG.safety.rateCap, ...config?.rateCap },
		errorDelay: { ...DEFAULT_DAEMON_CONFIG.safety.errorDelay, ...config?.errorDelay },
		metronome: { ...DEFAULT_DAEMON_CONFIG.safety.metronome, ...config?.metronome },
	};
}

function createHarness(opts: HarnessOptions = {}) {
	let now = 0;
	const sleeps: number[] = [];
	const safety = createSafetyGuards({
		config: buildSafetyConfig(opts.config),
		now: () => now,
		sleep: async (ms) => {
			sleeps.push(ms);
			now += ms;
		},
		random: opts.random ?? (() => 0),
	});
	return {
		safety,
		sleeps,
		setNow(value: number) {
			now = value;
		},
	};
}

describe("safety guards", () => {
	it("rejects requests below the minimum interval with RATE_LIMITED", () => {
		const h = createHarness({
			config: { minInterval: { ms: 900 } },
		});

		h.setNow(0);
		expect(h.safety.checkIngress("halbot")).toBeNull();

		h.setNow(500);
		expect(h.safety.checkIngress("halbot")).toMatchObject({
			code: "RATE_LIMITED",
			details: { retryAfter: 400 },
		});
	});

	it("enforces the per-nick sliding-window rate cap", () => {
		const h = createHarness({
			config: {
				minInterval: { ms: 1 },
				rateCap: { requestsPerMinute: 2 },
			},
		});

		h.setNow(0);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(1_000);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(2_000);
		expect(h.safety.checkIngress("halbot")).toMatchObject({
			code: "RATE_LIMITED",
			details: { retryAfter: 58_000 },
		});
	});

	it("detects metronomic request timing", () => {
		const h = createHarness({
			config: {
				minInterval: { ms: 100 },
				metronome: { tolerance: 0.1, consecutiveEqual: 3, maxIntervalMs: 60_000 },
			},
		});

		h.setNow(0);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(1_000);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(2_000);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(3_000);
		expect(h.safety.checkIngress("halbot")).toMatchObject({
			code: "METRONOME_DETECTED",
			message: expect.stringContaining("~1000ms"),
		});
	});

	it("resets the metronome streak after a pattern break", () => {
		const h = createHarness({
			config: {
				minInterval: { ms: 100 },
				metronome: { tolerance: 0.1, consecutiveEqual: 3, maxIntervalMs: 60_000 },
			},
		});

		h.setNow(0);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(1_000);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(2_000);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(3_300);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(4_300);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(5_300);
		expect(h.safety.checkIngress("halbot")).toBeNull();
		h.setNow(6_300);
		expect(h.safety.checkIngress("halbot")).toMatchObject({
			code: "METRONOME_DETECTED",
		});
	});

	it("delays error responses with configured jitter", async () => {
		const h = createHarness({
			config: {
				errorDelay: { minMs: 500, maxMs: 500 },
			},
		});

		await expect(h.safety.delayForError()).resolves.toBe(500);
		expect(h.sleeps).toEqual([500]);
	});
});
