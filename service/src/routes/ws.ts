import type { BproxyForwardedRequest, BproxyResponse } from "@bproxy/shared";
import "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import type { WebSocket } from "ws";
import type { ClientsRegistry } from "../clients";
import type { ElementHandleCache } from "../element-handles";
import type { PendingMap } from "../pending";

export interface WsRouteDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	logger: Logger;
	newClientId: () => string;
	elementHandles: ElementHandleCache;
}

export function wsRoute(deps: WsRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.get("/ws", { websocket: true }, (socket: WebSocket, _req: FastifyRequest) => {
			const id = deps.newClientId();
			deps.logger.info({ event: "ws_connect", ws_client: id });

			const sendFn = (cmd: BproxyForwardedRequest) => socket.send(JSON.stringify(cmd));
			const handle = { id, send: sendFn };
			deps.clients.add(handle);

			deps.pending.replayForClient(sendFn, undefined, id);

			const heartbeat = setInterval(() => {
				try {
					socket.ping();
				} catch {
					/* socket already closed */
				}
			}, 20_000);

			socket.on("message", (raw: Buffer | string) => {
				try {
					const msg = JSON.parse(raw.toString()) as unknown;
					if (isHeartbeatPing(msg)) {
						socket.send(JSON.stringify({ type: "pong", ts: readHeartbeatTs(msg) }));
						return;
					}
					if (isNavigationMessage(msg)) {
						deps.elementHandles.handleNavigation(msg.tabId, msg.url);
						return;
					}
					if (hasResponseId(msg)) {
						deps.pending.resolveById(msg.id, msg);
					}
				} catch (e) {
					deps.logger.warn({ event: "ws_bad_message", err: String(e) });
				}
			});

			socket.on("close", (_code?: number, reason?: Buffer) => {
				clearInterval(heartbeat);
				deps.clients.remove(id);
				if (deps.clients.size() === 0) deps.elementHandles.clearPageEpochs();
				deps.logger.info({
					event: "ws_disconnect",
					ws_client: id,
					reason: reason ? reason.toString() : undefined,
				});
			});
		});
	};
}

function isHeartbeatPing(value: unknown): value is { type: "ping"; ts?: unknown } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>)["type"] === "ping"
	);
}

function readHeartbeatTs(value: { ts?: unknown }): number | undefined {
	return typeof value.ts === "number" ? value.ts : undefined;
}

function isNavigationMessage(value: unknown): value is {
	type: "navigation";
	tabId: number;
	url: string;
	cause: "committed" | "history_state";
} {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>)["type"] === "navigation" &&
		typeof (value as Record<string, unknown>)["tabId"] === "number" &&
		typeof (value as Record<string, unknown>)["url"] === "string" &&
		((value as Record<string, unknown>)["cause"] === "committed" ||
			(value as Record<string, unknown>)["cause"] === "history_state")
	);
}

function hasResponseId(value: unknown): value is BproxyResponse & { id: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>)["id"] === "string"
	);
}
