import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { type DebugDeps, handleDaemonLocal, isDaemonLocal } from "../debug-actions";
import type { DispatchEngine } from "../dispatch";
import type { PacingEngine } from "../pacing";
import { parseRequest } from "../schemas";
import type { SessionRegistry } from "../sessions";

export interface CommandRouteDeps {
	dispatch: DispatchEngine;
	pacing: PacingEngine;
	logger: Logger;
	debug: DebugDeps;
	sessions: SessionRegistry;
}

function pageOk() {
	return { url: "", title: "", state: "ready" as const, busy: false };
}

function success(cmd: BproxyRequest, data: unknown): BproxyResponse {
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: true,
		data,
		page: pageOk(),
		replay: false,
	} as BproxyResponse;
}

function failure(cmd: BproxyRequest, error: BproxyError): BproxyResponse {
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: false,
		error,
	};
}

function isSessionLocal(action: BproxyRequest["action"]): boolean {
	return (
		action === "session.create" ||
		action === "session.list" ||
		action === "session.bind" ||
		action === "session.unbind" ||
		action === "session.resume" ||
		action === "session.close"
	);
}

function isSessionExempt(action: BproxyRequest["action"]): boolean {
	return (
		action === "session.create" ||
		action === "session.list" ||
		action === "debug.last" ||
		action === "debug.status"
	);
}

function validateSession(cmd: BproxyRequest, sessions: SessionRegistry): BproxyResponse | null {
	if (isSessionExempt(cmd.action)) return null;
	if (!cmd.session) {
		return failure(cmd, {
			code: "SESSION_REQUIRED",
			category: "policy",
			retry: "conditional",
			message: "This action requires an explicit session id",
			suggestedAction: "Create a session first or bootstrap with tab open --url ...",
		});
	}
	if (!sessions.isValidSessionId(cmd.session)) {
		return failure(cmd, {
			code: "INVALID_SESSION_ID",
			category: "target",
			retry: "never",
			message: `Session '${cmd.session}' must match /^[a-z2-7]{6}$/`,
			details: { session: cmd.session },
		});
	}
	if (!sessions.has(cmd.session)) {
		return failure(cmd, {
			code: "SESSION_NOT_FOUND",
			category: "target",
			retry: "conditional",
			message: `Session '${cmd.session}' was not found`,
			details: { session: cmd.session },
		});
	}
	return null;
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

	deps.sessions.close(cmd.session);
	if (firstFatalError) return failure(cmd, firstFatalError);
	return success(cmd, { session: cmd.session, closedTabs });
}

async function handleSessionLocal(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
): Promise<BproxyResponse> {
	if (cmd.action === "session.create") {
		const created = deps.sessions.create((cmd.params as { label?: string }).label);
		return success(cmd, { session: created.id, label: created.label });
	}

	if (cmd.action === "session.list") {
		return success(cmd, { sessions: deps.sessions.list() });
	}

	if (cmd.action === "session.bind") {
		const params = cmd.params as { tab: string; pacing?: "human" | "fast" };
		if (!deps.sessions.resolveTab(cmd.session, params.tab)) {
			const code = deps.sessions.hasTabAnywhere(params.tab)
				? "TAB_NOT_IN_SESSION"
				: "TAB_HANDLE_NOT_FOUND";
			return failure(cmd, {
				code,
				category: "target",
				retry: "conditional",
				message:
					code === "TAB_NOT_IN_SESSION"
						? `Tab '${params.tab}' does not belong to session '${cmd.session}'`
						: `Tab '${params.tab}' was not found in session '${cmd.session}'`,
				details: { session: cmd.session, tab: params.tab },
			});
		}
		deps.sessions.bind(cmd.session, params.tab, params.pacing);
		if (params.pacing) {
			deps.logger.info({ event: "pacing_config", session: cmd.session, mode: params.pacing });
		}
		return success(cmd, { session: cmd.session, tab: params.tab });
	}

	if (cmd.action === "session.unbind") {
		deps.sessions.unbind(cmd.session);
		return success(cmd, {});
	}

	if (cmd.action === "session.resume") {
		deps.sessions.resume(cmd.session);
		return success(cmd, { session: cmd.session });
	}

	return await handleSessionClose(cmd as BproxyRequest<"session.close">, deps);
}

async function executeCommand(cmd: BproxyRequest, deps: CommandRouteDeps): Promise<BproxyResponse> {
	if (isDaemonLocal(cmd.action)) return handleDaemonLocal(cmd, deps.debug);
	if (isSessionLocal(cmd.action)) return await handleSessionLocal(cmd, deps);
	// Forwarded path. Distinguish an extension-authored HUMAN_REQUIRED (must
	// pause) from a daemon-synthesized one (session already paused — must not
	// overwrite the original reason). Read live state immediately before
	// mutating: a pre-dispatch snapshot is racy under concurrent requests.
	const response = await deps.dispatch.send(cmd);
	if (!response.ok && response.error.code === "HUMAN_REQUIRED") {
		const live = deps.sessions.get(cmd.session);
		if (live && !live.paused) deps.sessions.pause(cmd.session, response.error.message);
	}
	return response;
}

export function commandRoute(deps: CommandRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.post("/", async (request, reply) => {
			const parsed = parseRequest(request.body);
			if (!parsed.success) {
				return reply.code(400).send({
					ok: false,
					error: { code: "BAD_REQUEST", message: parsed.error },
				});
			}
			const cmd = parsed.data;
			const receivedAt = Date.now();
			deps.logger.info({
				id: cmd.id,
				action: cmd.action,
				session: cmd.session,
				destructive: cmd.destructive,
				event: "received",
			});

			const sessionError = validateSession(cmd, deps.sessions);
			if (sessionError) {
				const failed = sessionError as Extract<BproxyResponse, { ok: false }>;
				deps.logger.info({
					id: cmd.id,
					event: "response",
					ok: false,
					elapsed_ms: Math.max(0, Date.now() - receivedAt),
					error_code: failed.error.code,
				});
				return failed;
			}

			const waited = await deps.pacing.waitForSlot(cmd.session, cmd.action);
			if (waited > 0) deps.logger.info({ id: cmd.id, event: "pacing_wait", delay_ms: waited });

			const response = await executeCommand(cmd, deps);

			deps.logger.info({
				id: cmd.id,
				event: "response",
				ok: response.ok,
				elapsed_ms: Math.max(0, Date.now() - receivedAt),
				error_code: !response.ok ? response.error.code : undefined,
			});
			return response;
		});
	};
}
