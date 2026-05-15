import type { DaemonRequestTrace } from "@bproxy/shared";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { makeAuthHook } from "./auth";
import { createClients } from "./clients";
import { createDispatch } from "./dispatch";
import { createPacing } from "./pacing";
import { createPairingStore, type PairingStore } from "./pairing";
import { createPending } from "./pending";
import { commandRoute } from "./routes/command";
import { pairRoute } from "./routes/pair";
import { wsRoute } from "./routes/ws";
import { createSessionRegistry, type SessionRegistry } from "./sessions";

export interface BuildServerOptions {
	port: number;
	daemonToken: string;
	extensionToken: string;
	logger: Logger;
	pairing?: PairingStore;
	sessions?: SessionRegistry;
	traces?: () => readonly DaemonRequestTrace[];
}

export interface BuiltServer {
	app: FastifyInstance;
	clients: ReturnType<typeof createClients>;
	pending: ReturnType<typeof createPending>;
	sessions: SessionRegistry;
	pairing: PairingStore;
}

interface ObjectGraph {
	clients: ReturnType<typeof createClients>;
	pending: ReturnType<typeof createPending>;
	sessions: SessionRegistry;
	pairing: PairingStore;
	dispatch: ReturnType<typeof createDispatch>;
	pacing: ReturnType<typeof createPacing>;
	newClientId: () => string;
	startedAt: number;
	traces: () => readonly DaemonRequestTrace[];
}

function createDeps(opts: BuildServerOptions): ObjectGraph {
	const sessions = opts.sessions ?? createSessionRegistry();
	const clients = createClients();
	const pending = createPending({ maxSize: 100, now: () => Date.now() });
	const dispatch = createDispatch({ clients, pending, sessions });
	const pacing = createPacing({
		sessions,
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		random: () => Math.random(),
	});
	const pairing = opts.pairing ?? createPairingStore({ ttlMs: 300_000, now: () => Date.now() });
	let clientCounter = 0;
	const newClientId = (): string => `client-${++clientCounter}`;
	const traces = opts.traces ?? (() => [] as readonly DaemonRequestTrace[]);
	return {
		clients,
		pending,
		sessions,
		dispatch,
		pacing,
		pairing,
		newClientId,
		startedAt: Date.now(),
		traces,
	};
}

async function registerRoutes(
	app: ReturnType<typeof Fastify>,
	opts: BuildServerOptions,
	deps: ObjectGraph,
	getPort: () => number,
): Promise<void> {
	await app.register(
		commandRoute({
			dispatch: deps.dispatch,
			pacing: deps.pacing,
			logger: opts.logger,
			sessions: deps.sessions,
			debug: {
				clients: deps.clients,
				sessions: deps.sessions,
				startedAt: deps.startedAt,
				get port() {
					return getPort();
				},
				traces: deps.traces,
			},
		}),
	);
	await app.register(
		pairRoute({
			pairing: deps.pairing,
			logger: opts.logger,
			wsUrl: () => `ws://127.0.0.1:${getPort()}/ws`,
		}),
	);
	await app.register(
		wsRoute({
			clients: deps.clients,
			pending: deps.pending,
			logger: opts.logger,
			newClientId: deps.newClientId,
		}),
	);
}

export async function buildServer(opts: BuildServerOptions): Promise<BuiltServer> {
	const app = Fastify({ logger: false });
	const deps = createDeps(opts);

	let resolvedPort = opts.port;
	app.addHook("onListen", async () => {
		const addr = app.server.address();
		if (addr && typeof addr === "object") resolvedPort = addr.port;
	});

	await app.register(websocket);
	app.addHook(
		"preValidation",
		makeAuthHook({
			port: () => resolvedPort,
			daemonToken: () => opts.daemonToken,
			extensionToken: () => opts.extensionToken,
			pairingCodes: () => deps.pairing.active(),
			readBodyPairingCode: (req) => {
				const body = req.body as { code?: string } | undefined;
				return body?.code;
			},
		}),
	);

	await registerRoutes(app, opts, deps, () => resolvedPort);

	return {
		app,
		clients: deps.clients,
		pending: deps.pending,
		sessions: deps.sessions,
		pairing: deps.pairing,
	};
}
