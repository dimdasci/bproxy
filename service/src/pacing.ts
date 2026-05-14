import { type Action, PACING_PRESETS } from "@bproxy/shared";
import type { SessionRegistry } from "./sessions";

type PacedAction = "navigate" | "scroll" | "fill" | "fill-form";
const PACED: ReadonlySet<Action> = new Set<Action>(["navigate", "scroll", "fill", "fill-form"]);

function pacingKey(action: Action): PacedAction | null {
	if (action === "navigate" || action === "scroll" || action === "fill") return action;
	if (action === "fill-form") return "fill-form";
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
			if (!PACED.has(action)) return 0;
			const key = pacingKey(action);
			if (!key) return 0;
			const s = deps.sessions.internal(session);
			const presetKey = key === "fill-form" ? "fill" : key;
			const preset = PACING_PRESETS[s.pacing][presetKey];
			const target = preset.min + deps.random() * (preset.max - preset.min);
			const lastEntry = s.lastActionAt[presetKey];
			if (lastEntry === undefined) {
				s.lastActionAt[presetKey] = deps.now();
				return 0;
			}
			const elapsed = deps.now() - lastEntry;
			const wait = Math.max(0, Math.round(target) - elapsed);
			if (wait > 0) await deps.sleep(wait);
			s.lastActionAt[presetKey] = deps.now();
			return wait;
		},
	};
}
