import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import type { DispatchEngine } from "../dispatch";
import { createSessionTmpDir } from "../session-tmp";
import type { SessionRegistry } from "../sessions";
import { failure, success } from "./responses";
import type { CommandRouteDeps } from "./types";

type ResolvedTab = NonNullable<ReturnType<SessionRegistry["resolveBound"]>>;

export function isTabMediated(action: BproxyRequest["action"]): boolean {
	return (
		action === "tab.open" ||
		action === "tab.list" ||
		action === "tab.pin" ||
		action === "tab.unpin" ||
		action === "tab.close"
	);
}

export async function dispatchAndPause(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	options?: Parameters<DispatchEngine["send"]>[1],
): Promise<BproxyResponse> {
	const response = await deps.dispatch.send(cmd, options);
	if (!response.ok && response.error.code === "HUMAN_REQUIRED") {
		const live = deps.sessions.get(cmd.session);
		if (live && !live.paused) deps.sessions.pause(cmd.session, response.error.message);
	}
	return response;
}

export async function handleTabMediated(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	if (cmd.action === "tab.list") return handleTabList(cmd, deps);
	if (cmd.action === "tab.open") return await handleTabOpen(cmd as BproxyRequest<"tab.open">, deps);
	return await handleBoundTabAction(cmd, deps);
}

function handleTabList(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse {
	return success(cmd, {
		session: cmd.session,
		tabs: deps.sessions.listTabs(cmd.session),
	});
}

async function handleTabOpen(
	cmd: BproxyRequest<"tab.open">,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	const createdSession = !cmd.session;
	const session = cmd.session || deps.sessions.create().id;
	const request = { ...cmd, session } as BproxyRequest<"tab.open">;
	const opened = await dispatchAndPause(request, deps, { targetTabId: null });
	if (!opened.ok) return tabOpenFailure(opened, deps, createdSession, session);

	const data = opened.data as { tabId?: unknown; url?: unknown };
	if (typeof data.tabId !== "number") {
		return invalidTabOpenResponse(request, deps, createdSession, session);
	}

	const tab = deps.sessions.registerTab(session, data.tabId, {
		url: typeof data.url === "string" ? data.url : cmd.params.url,
		title: opened.page.title,
		bind: true,
	});
	const tmpDir = createSessionTmpDir(deps.stateDir, session);
	return success(
		request,
		{ session, tab: tab.tab, bound: true, url: tab.url, tmpDir },
		opened.page,
	);
}

function tabOpenFailure(
	response: BproxyResponse,
	deps: CommandRouteDeps,
	createdSession: boolean,
	session: string,
): BproxyResponse {
	cleanupCreatedSession(deps, createdSession, session);
	return response;
}

function invalidTabOpenResponse(
	request: BproxyRequest,
	deps: CommandRouteDeps,
	createdSession: boolean,
	session: string,
): BproxyResponse {
	cleanupCreatedSession(deps, createdSession, session);
	return failure(request, {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: "Extension returned tab.open without a numeric tab id",
	});
}

function cleanupCreatedSession(
	deps: CommandRouteDeps,
	createdSession: boolean,
	session: string,
): void {
	if (createdSession && deps.sessions.has(session)) deps.sessions.close(session);
}

async function handleBoundTabAction(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	const resolved = resolveSessionTab(cmd, deps, (cmd.params as { tab?: string }).tab);
	if ("ok" in resolved) return resolved;
	if (cmd.action === "tab.pin") return await handleTabPin(cmd, deps, resolved);
	if (cmd.action === "tab.unpin") return await handleTabUnpin(cmd, deps, resolved);
	return await handleTabClose(cmd, deps, resolved);
}

function resolveSessionTab(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	requestedTab: string | undefined,
): ResolvedTab | BproxyResponse {
	if (requestedTab) return resolveRequestedTab(cmd, deps, requestedTab);

	const bound = deps.sessions.resolveBound(cmd.session);
	if (bound) return bound;
	return failure(cmd, {
		code: "TAB_NOT_FOUND",
		category: "target",
		retry: "never",
		message: `Session '${cmd.session}' has no bound tab`,
	});
}

function resolveRequestedTab(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	requestedTab: string,
): ResolvedTab | BproxyResponse {
	const resolved = deps.sessions.resolveTab(cmd.session, requestedTab);
	if (resolved) return resolved;
	const code = deps.sessions.hasTabAnywhere(requestedTab)
		? "TAB_NOT_IN_SESSION"
		: "TAB_HANDLE_NOT_FOUND";
	return failure(cmd, {
		code,
		category: "target",
		retry: "conditional",
		message:
			code === "TAB_NOT_IN_SESSION"
				? `Tab '${requestedTab}' does not belong to session '${cmd.session}'`
				: `Tab '${requestedTab}' was not found in session '${cmd.session}'`,
		details: { session: cmd.session, tab: requestedTab },
	});
}

async function handleTabPin(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	resolved: ResolvedTab,
): Promise<BproxyResponse> {
	const pinned = await dispatchAndPause(cmd, deps, { targetTabId: resolved.chromeTabId });
	if (!pinned.ok) return pinned;
	return success(cmd, { tab: resolved.tab, pinned: true }, pinned.page);
}

async function handleTabUnpin(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	resolved: ResolvedTab,
): Promise<BproxyResponse> {
	const unpinned = await dispatchAndPause(cmd, deps, { targetTabId: resolved.chromeTabId });
	if (!unpinned.ok) return unpinned;
	return success(cmd, { tab: resolved.tab, pinned: false }, unpinned.page);
}

async function handleTabClose(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	resolved: ResolvedTab,
): Promise<BproxyResponse> {
	const closed = await dispatchAndPause(cmd, deps, { targetTabId: resolved.chromeTabId });
	if (!closed.ok) return closed;
	deps.sessions.removeTab(cmd.session, resolved.tab);
	deps.elementHandles.invalidateForTab(resolved.chromeTabId);
	return success(cmd, { tab: resolved.tab, closed: true }, closed.page);
}
