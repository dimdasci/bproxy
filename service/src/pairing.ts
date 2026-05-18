import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface PairingBootstrap {
	extensionToken: string;
	wsUrl: string;
	protocolVersion: 1;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export type ClaimResult =
	| { ok: true; bootstrap: PairingBootstrap }
	| { ok: false; code: "PAIRING_CODE_INVALID" | "PAIRING_CODE_EXPIRED" | "PAIRING_CODE_CONSUMED" };

export interface PairingStore {
	issue(): { code: string; expiresAt: number };
	claim(
		code: string,
		makeBootstrap?: () => Omit<PairingBootstrap, "issuedAt" | "expiresAt" | "nonce">,
	): ClaimResult;
	active(): Set<string>;
}

interface PairingDeps {
	ttlMs: number;
	now: () => number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomBlock(): string {
	const buf = randomBytes(4);
	let s = "";
	for (let i = 0; i < 4; i++) s += ALPHABET.charAt(buf[i]! % ALPHABET.length);
	return s;
}

function constantEq(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

interface Entry {
	code: string;
	expiresAt: number;
	issuedAt: number;
	consumed: boolean;
}

export function createPairingStore(deps: PairingDeps): PairingStore {
	const entries = new Map<string, Entry>();

	function purgeExpired(): void {
		const now = deps.now();
		for (const [k, v] of entries) if (v.expiresAt < now) entries.delete(k);
	}

	function find(code: string): Entry | null {
		for (const e of entries.values()) if (constantEq(e.code, code)) return e;
		return null;
	}

	function defaultBootstrap(): Omit<PairingBootstrap, "issuedAt" | "expiresAt" | "nonce"> {
		return {
			extensionToken: randomBytes(32).toString("base64url"),
			wsUrl: "ws://127.0.0.1:9615/ws",
			protocolVersion: 1,
		};
	}

	return {
		issue() {
			const code = `${randomBlock()}-${randomBlock()}`;
			const issuedAt = deps.now();
			const expiresAt = issuedAt + deps.ttlMs;
			entries.set(code, { code, expiresAt, issuedAt, consumed: false });
			return { code, expiresAt };
		},
		claim(code, makeBootstrap) {
			const entry = find(code);
			if (!entry) {
				purgeExpired();
				return { ok: false, code: "PAIRING_CODE_INVALID" };
			}
			if (entry.expiresAt < deps.now()) {
				purgeExpired();
				return { ok: false, code: "PAIRING_CODE_EXPIRED" };
			}
			if (entry.consumed) return { ok: false, code: "PAIRING_CODE_CONSUMED" };
			entry.consumed = true;
			const baseline = makeBootstrap?.() ?? defaultBootstrap();
			return {
				ok: true,
				bootstrap: {
					...baseline,
					issuedAt: entry.issuedAt,
					expiresAt: entry.expiresAt,
					nonce: randomUUID(),
				},
			};
		},
		active() {
			purgeExpired();
			const out = new Set<string>();
			for (const e of entries.values()) if (!e.consumed) out.add(e.code);
			return out;
		},
	};
}
