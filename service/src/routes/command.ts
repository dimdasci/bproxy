import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { type DebugDeps, handleDaemonLocal, isDaemonLocal } from "../debug-actions";
import type { DispatchEngine } from "../dispatch";
import type { PacingEngine } from "../pacing";
import { parseRequest } from "../schemas";

export interface CommandRouteDeps {
	dispatch: DispatchEngine;
	pacing: PacingEngine;
	logger: Logger;
	debug: DebugDeps;
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
			deps.logger.info({
				id: cmd.id,
				action: cmd.action,
				session: cmd.session,
				destructive: cmd.destructive,
				event: "received",
			});

			const waited = await deps.pacing.waitForSlot(cmd.session, cmd.action);
			if (waited > 0) deps.logger.info({ id: cmd.id, event: "pacing_wait", delay_ms: waited });

			const response = isDaemonLocal(cmd.action)
				? handleDaemonLocal(cmd, deps.debug)
				: await deps.dispatch.send(cmd);

			deps.logger.info({
				id: cmd.id,
				event: "response",
				ok: response.ok,
				error_code: !response.ok ? response.error.code : undefined,
			});
			return response;
		});
	};
}
