import { type Action, type PacingConfig, PACING_PRESETS } from "@bproxy/shared";
import type { SessionRegistry } from "./sessions";

function pacingKey(action: Action): keyof PacingConfig | null {
	if (action === "navigate" || action === "scroll") return action;
	if (action === "fill" || action === "fill-form") return "fill";
	return null;
}

export interface PacingDeps {
	sessions: SessionRegistry;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
}

export interface PacingEngine {
	waitForSlot(session: string, action: Action): Promise<number>;
}

export function createPacing(deps: PacingDeps): PacingEngine {
	return {
		async waitForSlot(session, action) {
			const key = pacingKey(action);
			if (!key) return 0;
			const s = deps.sessions.internal(session);
			const preset = PACING_PRESETS[s.pacing][key];
			const target = preset.min + deps.random() * (preset.max - preset.min);
			const lastEntry = s.lastActionAt[key];
			if (lastEntry === undefined) {
				s.lastActionAt[key] = deps.now();
				return 0;
			}
			const elapsed = deps.now() - lastEntry;
			const wait = Math.max(0, Math.round(target) - elapsed);
			if (wait > 0) await deps.sleep(wait);
			s.lastActionAt[key] = deps.now();
			return wait;
		},
	};
}
