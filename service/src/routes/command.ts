import {
	type BproxyRequest,
	type BproxyResponse,
	type DaemonRequestTrace,
	type ElementInfo,
	isValidNick,
	type LinkInfo,
	type SessionId,
	type TraceEntry,
} from "@bproxy/shared";
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
	const response = await dispatchAndPause(cmd, deps);
	const filtered = filterDebugLogEntries(cmd, deps, response);
	return decorateReadHandles(cmd, deps, filtered);
}

function decorateReadHandles(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	response: BproxyResponse,
): BproxyResponse {
	if (!response.ok) return response;
	if (cmd.action !== "elements" && cmd.action !== "links") return response;
	const bound = deps.sessions.resolveBound(cmd.session);
	if (!bound) return response;
	const pageEpoch = deps.elementHandles.getPageEpoch(bound.chromeTabId)?.epoch ?? 0;
	if (cmd.action === "elements") {
		const elements = deps.elementHandles.mint(
			cmd.session,
			bound.tab,
			bound.chromeTabId,
			"elements",
			(response.data as { elements: ElementInfo[] }).elements,
			response.page.url,
			pageEpoch,
		) as ElementInfo[];
		return { ...response, data: { ...(response.data as object), elements } };
	}
	const linksData = response.data as { links: LinkInfo[]; total: number; capped?: boolean };
	const links = deps.elementHandles.mint(
		cmd.session,
		bound.tab,
		bound.chromeTabId,
		"links",
		linksData.links,
		response.page.url,
		pageEpoch,
	) as LinkInfo[];
	return { ...response, data: { ...linksData, links } };
}

function filterDebugLogEntries(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	response: BproxyResponse,
): BproxyResponse {
	if (cmd.action !== "debug.log" || !response.ok) return response;
	const entries = (response.data as { entries: TraceEntry[] }).entries.filter(
		(entry) => entry.session !== undefined && deps.sessions.getOwner(entry.session) === cmd.nick,
	);
	return { ...response, data: { entries } };
}

function logResponse(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	response: BproxyResponse,
	receivedAt: number,
): void {
	const elapsedMs = Math.max(0, Date.now() - receivedAt);
	const errorCode = response.ok ? undefined : response.error.code;
	deps.logger.info({
		id: cmd.id,
		event: "response",
		ok: response.ok,
		elapsed_ms: elapsedMs,
		error_code: errorCode,
		ownerHash: deps.computeOwnerHash(cmd.nick),
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

async function finalizeResponse(
	cmd: BproxyRequest,
	deps: CommandRouteDeps,
	response: BproxyResponse,
	receivedAt: number,
): Promise<BproxyResponse> {
	if (!response.ok) {
		const delayMs = await deps.safety.delayForError();
		if (delayMs > 0) deps.logger.info({ id: cmd.id, event: "error_delay", delay_ms: delayMs });
	}
	logResponse(cmd, deps, response, receivedAt);
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
			if (!isValidNick(cmd.nick)) {
				return reply.code(400).send({
					ok: false,
					error: { code: "BAD_REQUEST", message: "nick must match /^[a-z][a-z0-9]{5}$/" },
				});
			}
			const receivedAt = Date.now();
			deps.logger.info({
				id: cmd.id,
				action: cmd.action,
				session: cmd.session,
				destructive: cmd.destructive,
				event: "received",
				ownerHash: deps.computeOwnerHash(cmd.nick),
			});

			const safetyError = deps.safety.checkIngress(cmd.nick);
			if (safetyError) {
				return await finalizeResponse(
					cmd,
					deps,
					{ protocol_version: 1, id: cmd.id, ok: false, error: safetyError },
					receivedAt,
				);
			}

			const sessionError = validateSession(cmd, deps);
			if (sessionError) return await finalizeResponse(cmd, deps, sessionError, receivedAt);

			const waited = await deps.pacing.waitForSlot(cmd.session, cmd.action);
			if (waited > 0) deps.logger.info({ id: cmd.id, event: "pacing_wait", delay_ms: waited });

			const response = await executeCommand(cmd, deps);
			return await finalizeResponse(cmd, deps, response, receivedAt);
		});
	};
}
