import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
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

function isSessionLocal(action: BproxyRequest["action"]): boolean {
	return (
		action === "session.list" ||
		action === "session.bind" ||
		action === "session.unbind" ||
		action === "session.resume"
	);
}

function handleSessionLocal(
	cmd: BproxyRequest,
	sessions: SessionRegistry,
	logger: Logger,
): BproxyResponse {
	if (cmd.action === "session.list") {
		return {
			protocol_version: 1,
			id: cmd.id,
			ok: true,
			data: { sessions: sessions.list() },
			page: pageOk(),
			replay: false,
		};
	}

	if (cmd.action === "session.bind") {
		const params = cmd.params as { tabId: number; pacing?: "human" | "fast" };
		sessions.bind(cmd.session, params.tabId, params.pacing);
		if (params.pacing) {
			logger.info({ event: "pacing_config", session: cmd.session, mode: params.pacing });
		}
		return {
			protocol_version: 1,
			id: cmd.id,
			ok: true,
			data: { session: cmd.session, tabId: params.tabId },
			page: pageOk(),
			replay: false,
		};
	}

	if (cmd.action === "session.unbind") {
		sessions.unbind(cmd.session);
		return {
			protocol_version: 1,
			id: cmd.id,
			ok: true,
			data: {},
			page: pageOk(),
			replay: false,
		};
	}

	sessions.resume(cmd.session);
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: true,
		data: { session: cmd.session },
		page: pageOk(),
		replay: false,
	};
}

async function executeCommand(cmd: BproxyRequest, deps: CommandRouteDeps): Promise<BproxyResponse> {
	if (isDaemonLocal(cmd.action)) return handleDaemonLocal(cmd, deps.debug);
	if (isSessionLocal(cmd.action)) return handleSessionLocal(cmd, deps.sessions, deps.logger);
	// Forwarded path. Distinguish an extension-authored HUMAN_REQUIRED (must
	// pause) from a daemon-synthesized one (session already paused — must not
	// overwrite the original reason). Read live state immediately before
	// mutating: a pre-dispatch snapshot is racy under concurrent requests.
	const response = await deps.dispatch.send(cmd);
	if (!response.ok && response.error.code === "HUMAN_REQUIRED") {
		const live = deps.sessions.getOrCreate(cmd.session);
		if (!live.paused) deps.sessions.pause(cmd.session, response.error.message);
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
