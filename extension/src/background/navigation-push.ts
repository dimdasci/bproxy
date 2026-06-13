export interface NavigationPushMessage {
	type: "navigation";
	tabId: number;
	url: string;
	cause: "committed" | "history_state";
}

interface NavigationEventLike {
	tabId: number;
	url?: string;
}

interface NavigationSenderLike {
	sendNavigation?: (message: NavigationPushMessage) => boolean;
}

export function sendNavigationEvent(
	deps: NavigationSenderLike,
	details: NavigationEventLike,
	cause: NavigationPushMessage["cause"],
): void {
	if (!deps.sendNavigation || !details.url) return;
	deps.sendNavigation({ type: "navigation", tabId: details.tabId, url: details.url, cause });
}
