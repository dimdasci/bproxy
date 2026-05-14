import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthInput {
	url: string;
	method: string;
	headers: Record<string, string | undefined>;
	port: number;
	daemonToken: string;
	extensionToken: string;
	validPairingCodes: Set<string>;
	bodyPairingCode?: string;
}

export type AuthDecision = { ok: true } | { ok: false; reason: string };

function constantTimeEquals(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

function checkHost(host: string | undefined, port: number): boolean {
	if (!host) return false;
	return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function checkOrigin(origin: string | undefined, route: "command" | "pair" | "ws"): boolean {
	if (!origin) return route === "command"; // CLI has no Origin
	return origin.startsWith("chrome-extension://");
}

function checkFetchSite(value: string | undefined): boolean {
	if (!value) return true;
	return value === "none" || value === "same-origin";
}

function routeFor(url: string, method: string): "command" | "pair" | "ws" | null {
	if (method === "POST" && url === "/") return "command";
	if (method === "POST" && url === "/pair/claim") return "pair";
	if (method === "GET" && url === "/ws") return "ws";
	return null;
}

function parseBearer(header: string | undefined): string | null {
	if (!header) return null;
	const m = /^Bearer\s+(.+)$/i.exec(header);
	return m ? (m[1] ?? null) : null;
}

function parseWsAuth(header: string | undefined): string | null {
	if (!header) return null;
	const parts = header.split(",").map((p) => p.trim());
	const tok = parts.find((p) => p.startsWith("auth."));
	if (!tok) return null;
	try {
		return Buffer.from(tok.slice("auth.".length), "base64url").toString("utf8");
	} catch {
		return null;
	}
}

function checkCommandAuth(input: AuthInput): AuthDecision {
	const bearer = parseBearer(input.headers["authorization"]);
	if (!bearer || !constantTimeEquals(bearer, input.daemonToken)) {
		return { ok: false, reason: "bad bearer" };
	}
	return { ok: true };
}

function checkPairAuth(input: AuthInput): AuthDecision {
	const code = input.bodyPairingCode ?? "";
	if (!input.validPairingCodes.has(code)) {
		return { ok: false, reason: "bad pairing code" };
	}
	return { ok: true };
}

function checkWsAuth(input: AuthInput): AuthDecision {
	const token = parseWsAuth(input.headers["sec-websocket-protocol"]);
	if (!token || !constantTimeEquals(token, input.extensionToken)) {
		return { ok: false, reason: "bad ws auth" };
	}
	return { ok: true };
}

export function evaluateAuth(input: AuthInput): AuthDecision {
	const route = routeFor(input.url, input.method);
	if (!route) return { ok: false, reason: "unknown route" };

	if (!checkHost(input.headers["host"], input.port)) {
		return { ok: false, reason: "bad host" };
	}
	if (!checkOrigin(input.headers["origin"], route)) {
		return { ok: false, reason: "bad origin" };
	}
	if (!checkFetchSite(input.headers["sec-fetch-site"])) {
		return { ok: false, reason: "bad sec-fetch-site" };
	}

	if (route === "command") return checkCommandAuth(input);
	if (route === "pair") return checkPairAuth(input);
	return checkWsAuth(input);
}

export interface AuthHookDeps {
	port: () => number;
	daemonToken: () => string;
	extensionToken: () => string;
	pairingCodes: () => Set<string>;
	readBodyPairingCode: (req: FastifyRequest) => string | undefined;
}

export function makeAuthHook(deps: AuthHookDeps) {
	return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
		const decision = evaluateAuth({
			url: req.url,
			method: req.method,
			headers: req.headers as Record<string, string | undefined>,
			port: deps.port(),
			daemonToken: deps.daemonToken(),
			extensionToken: deps.extensionToken(),
			validPairingCodes: deps.pairingCodes(),
			bodyPairingCode: deps.readBodyPairingCode(req),
		});
		if (!decision.ok) {
			return reply
				.code(401)
				.send({ ok: false, error: { code: "UNAUTHORIZED", reason: decision.reason } });
		}
	};
}
