import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { PairingStore } from "../pairing";

const ClaimBody = z.object({ code: z.string() }).strict();

export interface PairRouteDeps {
	pairing: PairingStore;
	logger: Logger;
	wsUrl: () => string;
	activateExtensionToken: (token: string) => void;
}

export function pairRoute(deps: PairRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.post("/pair/claim", async (request, reply) => {
			const body = ClaimBody.safeParse(request.body);
			if (!body.success) {
				return reply.code(400).send({
					ok: false,
					error: { code: "PAIRING_CODE_INVALID", message: "code required" },
				});
			}
			const r = deps.pairing.claim(body.data.code, () => ({
				extensionToken: randomBytes(32).toString("base64url"),
				wsUrl: deps.wsUrl(),
				protocolVersion: 1,
			}));
			if (!r.ok) {
				deps.logger.warn({ event: "pair_claim_failed", code: r.code });
				return reply.code(401).send({ ok: false, error: { code: r.code } });
			}
			deps.activateExtensionToken(r.bootstrap.extensionToken);
			deps.logger.info({ event: "pair_claim_ok" });
			return { ok: true, data: r.bootstrap };
		});
	};
}
