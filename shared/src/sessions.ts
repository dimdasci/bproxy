export type PacingMode = "human" | "fast";

declare const sessionIdBrand: unique symbol;
declare const tabHandleBrand: unique symbol;

export type SessionId = string & { readonly [sessionIdBrand]: "SessionId" };
export type TabHandle = `t${number}` & { readonly [tabHandleBrand]: "TabHandle" };

export interface PacingConfig {
	navigate: { min: number; max: number };
	scroll: { min: number; max: number };
	interaction: { min: number; max: number };
	fill: { min: number; max: number };
}

export const PACING_PRESETS: Record<PacingMode, PacingConfig> = {
	human: {
		navigate: { min: 1500, max: 4000 },
		scroll: { min: 4000, max: 8000 },
		interaction: { min: 500, max: 2000 },
		fill: { min: 500, max: 2000 },
	},
	fast: {
		navigate: { min: 300, max: 800 },
		scroll: { min: 500, max: 1500 },
		interaction: { min: 100, max: 400 },
		fill: { min: 100, max: 400 },
	},
};

export interface SessionInfo {
	id: SessionId;
	label?: string;
	tab: TabHandle | null;
	pacing: PacingMode;
	paused: boolean;
	pauseReason?: string;
}

export interface TabInfo {
	tab: TabHandle;
	url: string;
	title: string;
	bound: boolean;
}
