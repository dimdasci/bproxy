import type { PacingMode, SessionInfo } from "@bproxy/shared";

interface InternalSession extends SessionInfo {
	lastActionAt: Record<string, number>;
}

export interface SessionRegistry {
	getOrCreate(name: string): SessionInfo;
	bind(name: string, tabId: number, pacing?: PacingMode): void;
	unbind(name: string): void;
	pause(name: string, reason?: string): void;
	resume(name: string): void;
	list(): SessionInfo[];
	internal(name: string): InternalSession;
}

export function createSessionRegistry(): SessionRegistry {
	const sessions = new Map<string, InternalSession>();

	function getOrCreate(name: string): InternalSession {
		let s = sessions.get(name);
		if (!s) {
			s = { name, tabId: null, pacing: "human", paused: false, lastActionAt: {} };
			sessions.set(name, s);
		}
		return s;
	}

	return {
		getOrCreate,
		bind(name, tabId, pacing) {
			const s = getOrCreate(name);
			s.tabId = tabId;
			if (pacing) s.pacing = pacing;
		},
		unbind(name) {
			const s = sessions.get(name);
			if (!s) return;
			s.tabId = null;
			// `session.unbind` is allowed from `paused` too — it clears both
			// the tab binding and the pause flag (see docs/views/04-session-state.md).
			s.paused = false;
			delete s.pauseReason;
		},
		pause(name, reason) {
			const s = getOrCreate(name);
			s.paused = true;
			s.pauseReason = reason;
		},
		resume(name) {
			const s = sessions.get(name);
			if (s) {
				s.paused = false;
				delete s.pauseReason;
			}
		},
		list() {
			return [...sessions.values()];
		},
		internal: getOrCreate,
	};
}
