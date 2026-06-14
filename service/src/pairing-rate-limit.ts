export interface PairingRateLimiter {
	isLimited(): boolean;
	recordFailure(): void;
	reset(): void;
}

export interface PairingRateLimiterOptions {
	windowMs?: number;
	maxFailures?: number;
	now: () => number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_FAILURES = 5;

export function createPairingRateLimiter(opts: PairingRateLimiterOptions): PairingRateLimiter {
	const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
	const maxFailures = opts.maxFailures ?? DEFAULT_MAX_FAILURES;
	let windowStart: number | null = null;
	let failures = 0;

	function windowActive(now: number): boolean {
		return windowStart !== null && now < windowStart + windowMs;
	}

	function clearExpired(now: number): void {
		if (!windowActive(now)) {
			windowStart = null;
			failures = 0;
		}
	}

	return {
		isLimited() {
			const current = opts.now();
			clearExpired(current);
			return failures >= maxFailures;
		},
		recordFailure() {
			const current = opts.now();
			clearExpired(current);
			if (windowStart === null) {
				windowStart = current;
				failures = 1;
				return;
			}
			failures++;
		},
		reset() {
			windowStart = null;
			failures = 0;
		},
	};
}
