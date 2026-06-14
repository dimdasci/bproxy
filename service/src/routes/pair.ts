import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { PairingStore } from "../pairing";
import type { PairingRateLimiter } from "../pairing-rate-limit";

const ClaimBody = z.object({ code: z.string() }).strict();

type PairingFailureCode =
	| "PAIRING_CODE_INVALID"
	| "PAIRING_CODE_EXPIRED"
	| "PAIRING_CODE_CONSUMED"
	| "PAIRING_RATE_LIMITED";

function pairingError(code: PairingFailureCode): {
	ok: false;
	error: { code: PairingFailureCode };
} {
	return { ok: false, error: { code } };
}

export interface PairRouteDeps {
	pairing: PairingStore;
	rateLimiter: PairingRateLimiter;
	logger: Logger;
	wsUrl: () => string;
	activateExtensionToken: (token: string) => void;
}

export function pairRoute(deps: PairRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.post("/pair/claim", async (request, reply) => {
			if (deps.rateLimiter.isLimited()) {
				deps.logger.warn({ event: "pair_claim_rate_limited" });
				return reply.code(429).send(pairingError("PAIRING_RATE_LIMITED"));
			}

			const body = ClaimBody.safeParse(request.body);
			if (!body.success) {
				deps.rateLimiter.recordFailure();
				deps.logger.warn({ event: "pair_claim_failed", code: "PAIRING_CODE_INVALID" });
				return reply.code(400).send(pairingError("PAIRING_CODE_INVALID"));
			}

			const r = deps.pairing.claim(body.data.code, () => ({
				extensionToken: randomBytes(32).toString("base64url"),
				wsUrl: deps.wsUrl(),
				protocolVersion: 1,
			}));
			if (!r.ok) {
				deps.rateLimiter.recordFailure();
				deps.logger.warn({ event: "pair_claim_failed", code: r.code });
				return reply.code(401).send(pairingError(r.code));
			}
			deps.activateExtensionToken(r.bootstrap.extensionToken);
			deps.logger.info({ event: "pair_claim_ok" });
			return { ok: true, data: r.bootstrap };
		});
	};
}
