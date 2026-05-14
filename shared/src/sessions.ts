export type PacingMode = "human" | "fast";

export interface PacingConfig {
	navigate: { min: number; max: number };
	scroll: { min: number; max: number };
	fill: { min: number; max: number };
}

export const PACING_PRESETS: Record<PacingMode, PacingConfig> = {
	human: {
		navigate: { min: 1500, max: 4000 },
		scroll: { min: 4000, max: 8000 },
		fill: { min: 500, max: 2000 },
	},
	fast: {
		navigate: { min: 300, max: 800 },
		scroll: { min: 500, max: 1500 },
		fill: { min: 100, max: 400 },
	},
};

export interface SessionInfo {
	name: string;
	tabId: number | null;
	pacing: PacingMode;
	paused: boolean;
	pauseReason?: string;
}

export interface TabInfo {
	id: number;
	url: string;
	title: string;
	session: string | null;
	injected: boolean;
}
