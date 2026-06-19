import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { createSessionTmpDir, removeSessionTmpDir } from "../session-tmp";
import { failure, success } from "./responses";
import type { CommandRouteDeps } from "./types";

export function isSessionLocal(action: BproxyRequest["action"]): boolean {
	return (
		action === "session.create" ||
		action === "session.list" ||
		action === "session.bind" ||
		action === "session.unbind" ||
		action === "session.resume" ||
		action === "session.close"
	);
}

export function isSessionExempt(action: BproxyRequest["action"]): boolean {
	return (
		action === "session.create" ||
		action === "session.list" ||
		action === "debug.last" ||
		action === "debug.status"
	);
}

export function validateSession(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse | null {
	if (isSessionExempt(cmd.action)) return null;
	if (!cmd.session) {
		if (cmd.action === "tab.open") return null;
		return missingSession(cmd);
	}
	if (!deps.sessions.isValidSessionId(cmd.session)) return invalidSession(cmd);
	if (!deps.sessions.has(cmd.session)) return sessionNotFound(cmd);
	if (deps.sessions.getOwner(cmd.session) !== cmd.nick) return sessionScopeMismatch(cmd);
	return null;
}

export async function handleSessionLocal(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	if (cmd.action === "session.create") return handleSessionCreate(cmd, deps);
	if (cmd.action === "session.list")
		return success(cmd, { sessions: deps.sessions.listByOwner(cmd.nick) });
	if (cmd.action === "session.bind") return handleSessionBind(cmd, deps);
	if (cmd.action === "session.unbind") return handleSessionUnbind(cmd, deps);
	if (cmd.action === "session.resume") return handleSessionResume(cmd, deps);
	return await handleSessionClose(cmd as BproxyRequest<"session.close">, deps);
}

function missingSession(cmd: BproxyRequest): BproxyResponse {
	return failure(cmd, {
		code: "SESSION_REQUIRED",
		category: "policy",
		retry: "conditional",
		message: "This action requires an explicit session id",
		suggestedAction: "Create a session first or bootstrap with tab open --url ...",
	});
}

function invalidSession(cmd: BproxyRequest): BproxyResponse {
	return failure(cmd, {
		code: "INVALID_SESSION_ID",
		category: "target",
		retry: "never",
		message: `Session '${cmd.session}' must match /^[a-z2-7]{6}$/`,
		details: { session: cmd.session },
	});
}

function sessionNotFound(cmd: BproxyRequest): BproxyResponse {
	return failure(cmd, {
		code: "SESSION_NOT_FOUND",
		category: "target",
		retry: "never",
		message: `Session '${cmd.session}' was not found`,
		suggestedAction: `Session '${cmd.session}' is permanently closed or never existed. Do not retry. Create a new session with 'bproxy tab open --url ... -n ${cmd.nick}'. If you need historical diagnostics, inspect BPROXY_HOME/logs/ and correlate entries with your ownerHash.`,
		details: { session: cmd.session },
	});
}

function sessionScopeMismatch(cmd: BproxyRequest): BproxyResponse {
	return failure(cmd, {
		code: "SESSION_SCOPE_MISMATCH",
		category: "policy",
		retry: "never",
		message: `Session '${cmd.session}' does not belong to this agent`,
		suggestedAction: `This session belongs to another agent. Create your own session with 'bproxy tab open --url ... -n ${cmd.nick}' or check that you are using the correct --nick value.`,
		details: { session: cmd.session },
	});
}

function handleSessionCreate(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse {
	const created = deps.sessions.create(cmd.nick, (cmd.params as { label?: string }).label);
	const tmpDir = createSessionTmpDir(deps.stateDir, created.id);
	return success(cmd, {
		session: created.id,
		label: created.label,
		tmpDir,
		ownerHash: deps.computeOwnerHash(cmd.nick),
	});
}

function handleSessionBind(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse {
	const params = cmd.params as { tab: string; pacing?: "human" | "fast" };
	if (!deps.sessions.resolveTab(cmd.session, params.tab))
		return sessionBindTargetError(cmd, deps, params.tab);
	deps.sessions.bind(cmd.session, params.tab, params.pacing);
	if (params.pacing) {
		deps.logger.info({
			event: "pacing_config",
			session: cmd.session,
			mode: params.pacing,
			ownerHash: deps.computeOwnerHash(cmd.nick),
		});
	}
	return success(cmd, { session: cmd.session, tab: params.tab });
}

function sessionBindTargetError(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	tab: string,
): BproxyResponse {
	const code = deps.sessions.hasTabAnywhere(tab) ? "TAB_NOT_IN_SESSION" : "TAB_HANDLE_NOT_FOUND";
	return failure(cmd, {
		code,
		category: "target",
		retry: "conditional",
		message:
			code === "TAB_NOT_IN_SESSION"
				? `Tab '${tab}' does not belong to session '${cmd.session}'`
				: `Tab '${tab}' was not found in session '${cmd.session}'`,
		details: { session: cmd.session, tab },
	});
}

function handleSessionUnbind(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse {
	deps.sessions.unbind(cmd.session);
	return success(cmd, {});
}

function handleSessionResume(cmd: BproxyRequest, deps: CommandRouteDeps): BproxyResponse {
	deps.sessions.resume(cmd.session);
	return success(cmd, { session: cmd.session });
}

function isBestEffortCloseError(error: BproxyError): boolean {
	return error.code === "TAB_NOT_FOUND" || error.category === "transport";
}

async function handleSessionClose(
	cmd: BproxyRequest<"session.close">,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	const handles = deps.sessions.listTabs(cmd.session).map((tab) => tab.tab);
	deps.sessions.resume(cmd.session);

	let closedTabs = 0;
	let firstFatalError: BproxyError | null = null;
	for (const [index, handle] of handles.entries()) {
		deps.sessions.bind(cmd.session, handle);
		const closeResponse = await deps.dispatch.send({
			protocol_version: 1,
			id: `${cmd.id}:close:${index + 1}`,
			action: "tab.close",
			nick: cmd.nick,
			params: {},
			session: cmd.session,
			deadline: cmd.deadline,
			destructive: true,
		});
		if (!closeResponse.ok && !isBestEffortCloseError(closeResponse.error) && !firstFatalError) {
			firstFatalError = closeResponse.error;
		}
		deps.sessions.removeTab(cmd.session, handle);
		closedTabs += 1;
	}

	deps.elementHandles.invalidateForSession(cmd.session);
	deps.sessions.close(cmd.session);
	removeSessionTmpDir(deps.stateDir, cmd.session);
	if (firstFatalError) return failure(cmd, firstFatalError);
	return success(cmd, { session: cmd.session, closedTabs });
}
