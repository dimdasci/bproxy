import type { BproxyRequest, BproxyResponse, DaemonRequestTrace, SessionId } from "@bproxy/shared";
import type { FastifyInstance } from "fastify";
import { handleDaemonLocal, isDaemonLocal } from "../debug-actions";
import { parseRequest } from "../schemas";
import { handleSessionLocal, isSessionLocal, validateSession } from "./session-actions";
import { dispatchAndPause, handleTabMediated, isTabMediated } from "./tab-actions";
import type { CommandRouteDeps } from "./types";

export type { CommandRouteDeps } from "./types";

async function executeCommand(cmd: BproxyRequest, deps: CommandRouteDeps): Promise<BproxyResponse> {
	if (isDaemonLocal(cmd.action)) return handleDaemonLocal(cmd, deps.debug);
	if (isSessionLocal(cmd.action)) return await handleSessionLocal(cmd, deps);
	if (isTabMediated(cmd.action)) return await handleTabMediated(cmd, deps);
	return await dispatchAndPause(cmd, deps);
}

function logResponse(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	response: BproxyResponse,
	receivedAt: number,
): void {
	const elapsedMs = Math.max(0, Date.now() - receivedAt);
	const errorCode = !response.ok ? response.error.code : undefined;
	deps.logger.info({
		id: cmd.id,
		event: "response",
		ok: response.ok,
		elapsed_ms: elapsedMs,
		error_code: errorCode,
	});
	deps.trace?.({
		id: cmd.id,
		action: cmd.action,
		session: cmd.session as SessionId,
		receivedAt,
		elapsedMs,
		ok: response.ok,
		errorCode,
	} satisfies DaemonRequestTrace);
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

			const sessionError = validateSession(cmd, deps);
			if (sessionError) {
				logResponse(cmd, deps, sessionError, receivedAt);
				return sessionError;
			}

			const waited = await deps.pacing.waitForSlot(cmd.session, cmd.action);
			if (waited > 0) deps.logger.info({ id: cmd.id, event: "pacing_wait", delay_ms: waited });

			const response = await executeCommand(cmd, deps);
			logResponse(cmd, deps, response, receivedAt);
			return response;
		});
	};
}
