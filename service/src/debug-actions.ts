import {
	type BproxyRequest,
	type BproxyResponse,
	type DaemonRequestTrace,
	PROTOCOL_VERSION,
	VERSION,
} from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { SessionRegistry } from "./sessions";

export interface DebugDeps {
	clients: ClientsRegistry;
	sessions: SessionRegistry;
	startedAt: number;
	port: number;
	traces: () => readonly DaemonRequestTrace[];
}

export function isDaemonLocal(action: string): boolean {
	return action === "debug.last" || action === "debug.status";
}

function pageOk() {
	return { url: "", title: "", state: "ready" as const, busy: false };
}

export function handleDaemonLocal(cmd: BproxyRequest, deps: DebugDeps): BproxyResponse {
	if (cmd.action === "debug.last") {
		const params = cmd.params as { count?: number };
		const count = params.count ?? 50;
		return {
			protocol_version: 1,
			id: cmd.id,
			ok: true,
			data: { requests: deps.traces().slice(-count) },
			page: pageOk(),
			replay: false,
		};
	}
	const sessions = deps.sessions.list();
	const sessionTabs = sessions.map((session) => ({
		session: session.id,
		tabs: deps.sessions.listTabs(session.id),
	}));
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: true,
		data: {
			daemon: {
				pid: process.pid,
				port: deps.port,
				uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
				version: VERSION,
				protocolVersion: PROTOCOL_VERSION,
			},
			wsClients: deps.clients
				.all()
				.map((c) => ({ id: c.id, connectedAt: 0, protocolVersion: PROTOCOL_VERSION })),
			sessions,
			sessionTabs,
			pausedSessions: sessions
				.filter((s) => s.paused)
				.map((s) => ({ session: s.id, reason: s.pauseReason })),
		},
		page: pageOk(),
		replay: false,
	};
}
