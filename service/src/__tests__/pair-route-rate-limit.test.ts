import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCapturedLogger } from "../logger";
import { createPairingStore, type PairingStore } from "../pairing";
import { type BuiltServer, buildServer } from "../server";

interface PairingErrorBody {
	ok: false;
	error: { code: string; message?: string };
}

interface PairingSuccessBody {
	ok: true;
	data: { extensionToken: string };
}

let built: BuiltServer;
let now: number;

async function makeServer(pairing?: PairingStore): Promise<BuiltServer> {
	return buildServer({
		port: 9615,
		daemonToken: "daemon-token",
		extensionToken: "extension-token",
		logger: buildCapturedLogger().logger,
		pairing,
		pairingRateLimitNow: () => now,
	});
}

async function claim(payload: unknown) {
	return built.app.inject({
		method: "POST",
		url: "/pair/claim",
		headers: {
			host: "127.0.0.1:9615",
			origin: "chrome-extension://test",
			"content-type": "application/json",
		},
		payload: JSON.stringify(payload),
	});
}

function bodyOf<T>(response: { body: string }): T {
	return JSON.parse(response.body) as T;
}

beforeEach(async () => {
	now = 0;
	built = await makeServer();
});

afterEach(async () => {
	await built.app.close();
});

describe("POST /pair/claim rate limiting", () => {
	it.each([
		["missing code", {}],
		["non-string code", { code: 1234 }],
		["extra field", { code: "ABCD-EFGH", extra: true }],
	])("schema failure (%s) returns a code-only 400 and counts", async (_name, payload) => {
		const res = await claim(payload);
		expect(res.statusCode).toBe(400);
		expect(bodyOf<PairingErrorBody>(res)).toEqual({
			ok: false,
			error: { code: "PAIRING_CODE_INVALID" },
		});
	});

	it("schema failures count toward the global limit", async () => {
		for (let i = 0; i < 5; i++) {
			const res = await claim({ code: 1234 });
			expect(res.statusCode).toBe(400);
		}

		const limited = await claim({ code: 1234 });
		expect(limited.statusCode).toBe(429);
		expect(bodyOf<PairingErrorBody>(limited)).toEqual({
			ok: false,
			error: { code: "PAIRING_RATE_LIMITED" },
		});
	});

	it("invalid claims return 401 and count toward the global limit", async () => {
		const first = await claim({ code: "WRONG-CODE" });
		expect(first.statusCode).toBe(401);
		expect(bodyOf<PairingErrorBody>(first)).toEqual({
			ok: false,
			error: { code: "PAIRING_CODE_INVALID" },
		});

		for (let i = 0; i < 4; i++) await claim({ code: "WRONG-CODE" });
		const limited = await claim({ code: "WRONG-CODE" });
		expect(limited.statusCode).toBe(429);
		expect(bodyOf<PairingErrorBody>(limited).error.code).toBe("PAIRING_RATE_LIMITED");
	});

	it("expired failures count toward the global limit", async () => {
		await built.app.close();
		let pairingNow = 0;
		const pairing = createPairingStore({ ttlMs: 1000, now: () => pairingNow });
		built = await makeServer(pairing);
		const issue = built.pairing.issue();
		pairingNow = 5000;

		const expired = await claim({ code: issue.code });
		expect(expired.statusCode).toBe(401);
		expect(bodyOf<PairingErrorBody>(expired).error.code).toBe("PAIRING_CODE_EXPIRED");

		for (let i = 0; i < 4; i++) await claim({ code: "WRONG-CODE" });
		const limited = await claim({ code: "WRONG-CODE" });
		expect(limited.statusCode).toBe(429);
	});

	it("consumed failures count toward the global limit", async () => {
		const issue = built.pairing.issue();
		const ok = await claim({ code: issue.code });
		expect(ok.statusCode).toBe(200);

		for (let i = 0; i < 5; i++) {
			const consumed = await claim({ code: issue.code });
			expect(consumed.statusCode).toBe(401);
			expect(bodyOf<PairingErrorBody>(consumed).error.code).toBe("PAIRING_CODE_CONSUMED");
		}

		const limited = await claim({ code: "WRONG-CODE" });
		expect(limited.statusCode).toBe(429);
	});

	it("allows attempts again after the fixed window expires", async () => {
		for (let i = 0; i < 5; i++) await claim({ code: "WRONG-CODE" });
		expect((await claim({ code: "WRONG-CODE" })).statusCode).toBe(429);

		now = 60_000;
		const afterWindow = await claim({ code: "WRONG-CODE" });
		expect(afterWindow.statusCode).toBe(401);
		expect(bodyOf<PairingErrorBody>(afterWindow).error.code).toBe("PAIRING_CODE_INVALID");
	});

	it("successful claims do not consume the failure budget", async () => {
		for (let i = 0; i < 5; i++) {
			const issue = built.pairing.issue();
			const res = await claim({ code: issue.code });
			expect(res.statusCode).toBe(200);
			expect(bodyOf<PairingSuccessBody>(res).data.extensionToken.length).toBeGreaterThan(0);
		}

		const invalid = await claim({ code: "WRONG-CODE" });
		expect(invalid.statusCode).toBe(401);
	});

	it("valid code still succeeds after prior failures below the limit", async () => {
		for (let i = 0; i < 4; i++) await claim({ code: "WRONG-CODE" });
		const issue = built.pairing.issue();

		const res = await claim({ code: issue.code });
		expect(res.statusCode).toBe(200);
		expect(bodyOf<PairingSuccessBody>(res).ok).toBe(true);
	});

	it("valid code is rejected during lockout and succeeds after expiry", async () => {
		const issue = built.pairing.issue();
		for (let i = 0; i < 5; i++) await claim({ code: "WRONG-CODE" });

		const locked = await claim({ code: issue.code });
		expect(locked.statusCode).toBe(429);
		expect(bodyOf<PairingErrorBody>(locked)).toEqual({
			ok: false,
			error: { code: "PAIRING_RATE_LIMITED" },
		});

		now = 60_000;
		const afterWindow = await claim({ code: issue.code });
		expect(afterWindow.statusCode).toBe(200);
		expect(bodyOf<PairingSuccessBody>(afterWindow).ok).toBe(true);
	});
});
