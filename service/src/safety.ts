import type { BproxyError } from "@bproxy/shared";
import type { SafetyConfig } from "./daemon-config";

interface NickSafetyState {
	lastRequestAt?: number;
	rateWindow: number[];
	metronome: MetronomeState;
}

interface MetronomeState {
	lastArrival?: number;
	lastInterval?: number;
	equalCount: number;
}

export interface SafetyDeps {
	config: SafetyConfig;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
}

export interface SafetyGuards {
	checkIngress(nick: string): BproxyError | null;
	delayForError(): Promise<number>;
}

export function createSafetyGuards(deps: SafetyDeps): SafetyGuards {
	const states = new Map<string, NickSafetyState>();

	return {
		checkIngress(nick) {
			const now = deps.now();
			const state = getState(states, nick);

			const minIntervalError = checkMinInterval(state, now, deps.config.minInterval.ms);
			if (minIntervalError) return rateLimitedError(minIntervalError);

			const rateCapError = checkRateCap(state, now, deps.config.rateCap.requestsPerMinute);
			if (rateCapError) return rateLimitedError(rateCapError);

			const metronomeInterval = checkMetronome(state, now, deps.config);
			if (metronomeInterval !== null) {
				return metronomeDetectedError(
					deps.config.metronome.consecutiveEqual,
					Math.round(metronomeInterval),
				);
			}

			return null;
		},

		async delayForError() {
			const { minMs, maxMs } = deps.config.errorDelay;
			const wait = jitterMs(minMs, maxMs, deps.random);
			if (wait > 0) await deps.sleep(wait);
			return wait;
		},
	};
}

function getState(states: Map<string, NickSafetyState>, nick: string): NickSafetyState {
	const existing = states.get(nick);
	if (existing) return existing;
	const created: NickSafetyState = {
		rateWindow: [],
		metronome: { equalCount: 0 },
	};
	states.set(nick, created);
	return created;
}

function checkMinInterval(
	state: NickSafetyState,
	now: number,
	minIntervalMs: number,
): number | null {
	const previous = state.lastRequestAt;
	state.lastRequestAt = now;
	if (previous === undefined) return null;
	const elapsed = Math.max(0, now - previous);
	if (elapsed >= minIntervalMs) return null;
	return minIntervalMs - elapsed;
}

function checkRateCap(state: NickSafetyState, now: number, limit: number): number | null {
	pruneWindow(state.rateWindow, now);
	if (state.rateWindow.length >= limit) {
		const oldest = state.rateWindow[0];
		if (oldest === undefined) return 60_000;
		return Math.max(1, oldest + 60_000 - now);
	}
	state.rateWindow.push(now);
	return null;
}

function pruneWindow(window: number[], now: number): void {
	const cutoff = now - 60_000;
	while (window[0] !== undefined && window[0] <= cutoff) {
		window.shift();
	}
}

function checkMetronome(state: NickSafetyState, now: number, config: SafetyConfig): number | null {
	const tracker = state.metronome;
	const lastArrival = tracker.lastArrival;
	if (lastArrival === undefined) {
		tracker.lastArrival = now;
		return null;
	}

	const interval = Math.max(0, now - lastArrival);
	const { minInterval, metronome } = config;
	if (interval < minInterval.ms || interval > metronome.maxIntervalMs) {
		resetMetronomeTo(tracker, now);
		return null;
	}

	if (tracker.lastInterval === undefined) {
		tracker.lastArrival = now;
		tracker.lastInterval = interval;
		tracker.equalCount = 1;
		return null;
	}

	if (!isWithinTolerance(interval, tracker.lastInterval, metronome.tolerance)) {
		resetMetronomeTo(tracker, now);
		return null;
	}

	const nextCount = tracker.equalCount + 1;
	if (nextCount >= metronome.consecutiveEqual) {
		resetMetronome(tracker);
		return interval;
	}

	tracker.lastArrival = now;
	tracker.lastInterval = interval;
	tracker.equalCount = nextCount;
	return null;
}

function resetMetronome(state: MetronomeState): void {
	delete state.lastArrival;
	delete state.lastInterval;
	state.equalCount = 0;
}

function resetMetronomeTo(state: MetronomeState, now: number): void {
	state.lastArrival = now;
	delete state.lastInterval;
	state.equalCount = 0;
}

function isWithinTolerance(current: number, previous: number, tolerance: number): boolean {
	return Math.abs(current - previous) / previous < tolerance;
}

function jitterMs(minMs: number, maxMs: number, random: () => number): number {
	if (minMs === maxMs) return minMs;
	return Math.round(minMs + random() * (maxMs - minMs));
}

function rateLimitedError(retryAfter: number): BproxyError {
	return {
		code: "RATE_LIMITED",
		category: "policy",
		retry: "safe",
		message: "Rate limit exceeded for this agent.",
		suggestedAction: `Slow down. Wait at least ${retryAfter}ms before the next command.`,
		details: { retryAfter },
	};
}

function metronomeDetectedError(consecutiveEqual: number, approxIntervalMs: number): BproxyError {
	return {
		code: "METRONOME_DETECTED",
		category: "policy",
		retry: "never",
		message: `Request timing is too regular. ${consecutiveEqual} consecutive commands arrived at equal intervals (~${approxIntervalMs}ms). This pattern is detectable as automation.`,
		suggestedAction:
			"Do not write scripts or programs to call bproxy in a loop. Control each bproxy command directly — read the result, decide what to do next, then act. If you absolutely must use programmatic control, add random variance to timing. A human does not operate a browser with fixed intervals.",
	};
}
