import type { DaemonRequestTrace } from "@bproxy/shared";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { makeHeaderAuthHook } from "./auth";
import { createClients } from "./clients";
import { createDispatch } from "./dispatch";
import { ElementHandleCache } from "./element-handles";
import { createPacing } from "./pacing";
import { createPairingStore, type PairingStore } from "./pairing";
import { createPairingRateLimiter, type PairingRateLimiter } from "./pairing-rate-limit";
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
	pairingRateLimiter?: PairingRateLimiter;
	pairingRateLimitNow?: () => number;
	sessions?: SessionRegistry;
	traces?: () => readonly DaemonRequestTrace[];
	onExtensionTokenChanged?: (token: string) => void;
}

export interface BuiltServer {
	app: FastifyInstance;
	clients: ReturnType<typeof createClients>;
	pending: ReturnType<typeof createPending>;
	sessions: SessionRegistry;
	pairing: PairingStore;
	pairingRateLimiter: PairingRateLimiter;
}

interface ObjectGraph {
	clients: ReturnType<typeof createClients>;
	pending: ReturnType<typeof createPending>;
	sessions: SessionRegistry;
	pairing: PairingStore;
	pairingRateLimiter: PairingRateLimiter;
	dispatch: ReturnType<typeof createDispatch>;
	elementHandles: ElementHandleCache;
	pacing: ReturnType<typeof createPacing>;
	newClientId: () => string;
	startedAt: number;
	traces: () => readonly DaemonRequestTrace[];
	pushTrace: (entry: DaemonRequestTrace) => void;
}

interface TraceRing {
	push: (entry: DaemonRequestTrace) => void;
	read: () => readonly DaemonRequestTrace[];
}

function createTraceRing(capacity = 200): TraceRing {
	const buffer: DaemonRequestTrace[] = [];
	let start = 0;
	let size = 0;
	return {
		push(entry) {
			if (size < capacity) {
				buffer.push(entry);
				size++;
			} else {
				buffer[start] = entry;
				start = (start + 1) % capacity;
			}
		},
		read() {
			if (size < capacity) return buffer.slice();
			return [...buffer.slice(start), ...buffer.slice(0, start)];
		},
	};
}

function createDeps(opts: BuildServerOptions): ObjectGraph {
	const sessions = opts.sessions ?? createSessionRegistry();
	const clients = createClients();
	const pending = createPending({
		maxSize: 100,
		now: () => Date.now(),
		onTimeout: ({ id, elapsedMs }) => {
			opts.logger.warn({ id, event: "timeout", elapsed_ms: elapsedMs });
		},
		onReplay: ({ id, wsClient }) => {
			opts.logger.info({ id, event: "replay", ws_client: wsClient });
		},
	});
	const elementHandles = new ElementHandleCache({ logger: opts.logger });
	const dispatch = createDispatch({
		clients,
		pending,
		sessions,
		elementHandles,
		onForwarded: ({ id, wsClient, tab }) => {
			opts.logger.info({ id, event: "forwarded", ws_client: wsClient, tab });
		},
	});
	const pacing = createPacing({
		sessions,
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		random: () => Math.random(),
	});
	const pairing = opts.pairing ?? createPairingStore({ ttlMs: 300_000, now: () => Date.now() });
	const pairingRateLimiter =
		opts.pairingRateLimiter ??
		createPairingRateLimiter({ now: opts.pairingRateLimitNow ?? (() => Date.now()) });
	let clientCounter = 0;
	const newClientId = (): string => `client-${++clientCounter}`;
	const ring = createTraceRing();
	const traces = opts.traces ?? (() => ring.read());

	return {
		clients,
		pending,
		sessions,
		dispatch,
		elementHandles,
		pacing,
		pairing,
		pairingRateLimiter,
		newClientId,
		startedAt: Date.now(),
		traces,
		pushTrace: ring.push,
	};
}

async function registerRoutes(
	app: ReturnType<typeof Fastify>,
	opts: BuildServerOptions,
	deps: ObjectGraph,
	getPort: () => number,
	activateExtensionToken: (token: string) => void,
): Promise<void> {
	await app.register(
		commandRoute({
			dispatch: deps.dispatch,
			pacing: deps.pacing,
			logger: opts.logger,
			sessions: deps.sessions,
			elementHandles: deps.elementHandles,
			trace: deps.pushTrace,
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
			rateLimiter: deps.pairingRateLimiter,
			logger: opts.logger,
			wsUrl: () => `ws://127.0.0.1:${getPort()}/ws`,
			activateExtensionToken,
		}),
	);
	await app.register(
		wsRoute({
			clients: deps.clients,
			pending: deps.pending,
			logger: opts.logger,
			newClientId: deps.newClientId,
			elementHandles: deps.elementHandles,
		}),
	);
}

export async function buildServer(opts: BuildServerOptions): Promise<BuiltServer> {
	const app = Fastify({ logger: false });
	const deps = createDeps(opts);

	let activeExtensionToken = opts.extensionToken;
	let resolvedPort = opts.port;
	app.addHook("onListen", async () => {
		const addr = app.server.address();
		if (addr && typeof addr === "object") resolvedPort = addr.port;
	});

	await app.register(websocket);
	app.addHook(
		"onRequest",
		makeHeaderAuthHook({
			port: () => resolvedPort,
			daemonToken: () => opts.daemonToken,
			extensionToken: () => activeExtensionToken,
		}),
	);

	await registerRoutes(
		app,
		opts,
		deps,
		() => resolvedPort,
		(token) => {
			activeExtensionToken = token;
			opts.onExtensionTokenChanged?.(token);
		},
	);

	return {
		app,
		clients: deps.clients,
		pending: deps.pending,
		sessions: deps.sessions,
		pairing: deps.pairing,
		pairingRateLimiter: deps.pairingRateLimiter,
	};
}
