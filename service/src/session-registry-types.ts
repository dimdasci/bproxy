import type { SessionInfo, TabHandle, TabInfo } from "@bproxy/shared";

export interface InternalTabInfo extends TabInfo {
	chromeTabId: number;
}

export interface InternalSession extends SessionInfo {
	owner: string;
	lastActionAt: Record<string, number>;
	tabs: Map<TabHandle, InternalTabInfo>;
	nextTabOrdinal: number;
}
