import { PROTOCOL_VERSION } from "@bproxy/shared";
import type { PairingBootstrap } from "../../background/storage";
import type { StorageItem } from "../../background/storage-item";

// Endpoint defaulted in spec to loopback:9615. Kept as a module constant so
// the popup UI and tests can refer to a single source of truth. If the
// daemon port ever becomes configurable for extension bootstrap, widen here
// (PairingDeps.url already lets callers override).
export const PAIR_CLAIM_URL = "http://127.0.0.1:9615/pair/claim";

export type PairingErrorCode =
	| "PAIRING_CODE_INVALID"
	| "PAIRING_CODE_EXPIRED"
	| "PAIRING_CODE_CONSUMED"
	| "PAIRING_RATE_LIMITED"
	| "INVALID_PAYLOAD_SHAPE"
	| "INVALID_WS_URL"
	| "UNSUPPORTED_PROTOCOL_VERSION"
	| "BOOTSTRAP_EXPIRED"
	| "MISSING_NONCE"
	| "PAIR_TRANSPORT_ERROR"
	| "PAIR_NOTIFY_FAILED";

export type PairingResult = { ok: true } | { ok: false; code: PairingErrorCode; message?: string };

export interface ResponseLike {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

// Test-shaped fetch seam: structural subset of the platform `fetch` so the
// real `globalThis.fetch.bind(globalThis)` is structurally assignable
// without a cast, and tests can supply a tiny fake that only needs `ok`,
// `status`, and `json()`.
export type PairingFetch = (url: string, init: RequestInit) => Promise<ResponseLike>;

export interface PairingDeps {
	fetch: PairingFetch;
	storage: StorageItem<PairingBootstrap | null>;
	sendMessage: (msg: { type: "pair.complete" }) => Promise<unknown>;
	now: () => number;
	url?: string;
}

export interface PairingRequest {
	code: string;
}

type ValidateOk = { ok: true; value: PairingBootstrap };
type ValidateErr = { ok: false; code: PairingErrorCode; message?: string };

/**
 * Run the popup pairing flow:
 *
 *   1. POST `{ code }` to `/pair/claim`.
 *   2. Validate the daemon's success envelope (`{ ok, data }`) and the
 *      bootstrap payload (loopback `wsUrl`, `protocolVersion === 2`,
 *      future `expiresAt`, non-empty nonce/token).
 *      Daemon pairing failures, including rate limiting, pass through by code.
 *   3. Persist via the typed `bootstrapItem` storage seam.
 *   4. Fire-and-forget `chrome.runtime.sendMessage({ type: "pair.complete" })`
 *      so the background worker can re-read storage and reconnect.
 *
 * All side-effects are injected so this module is unit-testable without
 * jsdom, the real `chrome` global, or a live daemon.
 *
 * If `sendMessage` throws AFTER storage has been written, the result is
 * `{ ok: false, code: "PAIR_NOTIFY_FAILED" }`. We intentionally keep the
 * persisted bootstrap: pairing succeeded on the daemon side, and the
 * background SW will pick it up on its next startup. The "failure" is
 * only the immediate wake-up signal.
 */
export async function runPairing(req: PairingRequest, deps: PairingDeps): Promise<PairingResult> {
	const url = deps.url ?? PAIR_CLAIM_URL;

	let res: ResponseLike;
	let body: unknown;
	try {
		res = await deps.fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: req.code }),
		});
		body = await res.json();
	} catch {
		return { ok: false, code: "PAIR_TRANSPORT_ERROR" };
	}

	if (!res.ok) {
		// Daemon-shaped error envelope: `{ ok: false, error: { code, message? } }`.
		const code = extractDaemonErrorCode(body);
		if (code) return { ok: false, code, message: extractDaemonErrorMessage(body) };
		return { ok: false, code: "PAIR_TRANSPORT_ERROR" };
	}

	const validation = validateBootstrap(body, deps.now());
	if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

	await deps.storage.setValue(validation.value);

	try {
		await deps.sendMessage({ type: "pair.complete" });
	} catch {
		// Storage already persisted — pairing on the daemon side is done.
		// The background SW will reconnect at its next startup using the
		// stored bootstrap. Surface a distinct code so the popup can hint
		// at "reopen the popup" without claiming the whole flow failed.
		return { ok: false, code: "PAIR_NOTIFY_FAILED" };
	}

	return { ok: true };
}

/**
 * Validate the bootstrap envelope returned by `POST /pair/claim`.
 *
 * Each failed check produces a distinct, machine-readable error code so the
 * popup can surface a precise hint without parsing message strings.
 */
export function validateBootstrap(input: unknown, now: number): ValidateOk | ValidateErr {
	if (!isRecord(input) || input["ok"] !== true || !isRecord(input["data"])) {
		return { ok: false, code: "INVALID_PAYLOAD_SHAPE" };
	}
	const d = input["data"];

	const shape = validateShape(d);
	if (!shape.ok) return shape;
	if (!isLoopbackWsUrl(shape.value.wsUrl)) {
		return {
			ok: false,
			code: "INVALID_WS_URL",
			message: `not a loopback ws URL: ${shape.value.wsUrl}`,
		};
	}
	if (shape.value.expiresAt <= now) {
		return { ok: false, code: "BOOTSTRAP_EXPIRED" };
	}

	return { ok: true, value: shape.value };
}

// Pulled out of `validateBootstrap` so each function stays under the
// `complexity` ESLint cap; this checks only the field shapes, not the
// runtime invariants (loopback / freshness).
function validateShape(d: Record<string, unknown>): ValidateOk | ValidateErr {
	const extensionToken = d["extensionToken"];
	if (typeof extensionToken !== "string" || extensionToken.length === 0) {
		return { ok: false, code: "INVALID_PAYLOAD_SHAPE", message: "missing extensionToken" };
	}
	const wsUrl = d["wsUrl"];
	if (typeof wsUrl !== "string") {
		// Type-shape failure ("wsUrl absent or not a string") is `INVALID_PAYLOAD_SHAPE`;
		// `INVALID_WS_URL` is reserved for semantic failures (non-loopback, non-`ws:`).
		return { ok: false, code: "INVALID_PAYLOAD_SHAPE", message: "wsUrl missing" };
	}
	const protocolVersion = d["protocolVersion"];
	if (protocolVersion !== PROTOCOL_VERSION) {
		return {
			ok: false,
			code: "UNSUPPORTED_PROTOCOL_VERSION",
			message: `expected ${PROTOCOL_VERSION}, got ${String(protocolVersion)}`,
		};
	}
	const issuedAt = d["issuedAt"];
	if (typeof issuedAt !== "number") {
		return { ok: false, code: "INVALID_PAYLOAD_SHAPE", message: "issuedAt must be a number" };
	}
	const expiresAt = d["expiresAt"];
	if (typeof expiresAt !== "number") {
		return { ok: false, code: "INVALID_PAYLOAD_SHAPE", message: "expiresAt must be a number" };
	}
	const nonce = d["nonce"];
	if (typeof nonce !== "string" || nonce.length === 0) {
		return { ok: false, code: "MISSING_NONCE" };
	}

	return {
		ok: true,
		value: { extensionToken, wsUrl, protocolVersion: PROTOCOL_VERSION, issuedAt, expiresAt, nonce },
	};
}

function isLoopbackWsUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	if (parsed.protocol !== "ws:") return false;
	return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DAEMON_ERROR_CODES: ReadonlySet<PairingErrorCode> = new Set<PairingErrorCode>([
	"PAIRING_CODE_INVALID",
	"PAIRING_CODE_EXPIRED",
	"PAIRING_CODE_CONSUMED",
	"PAIRING_RATE_LIMITED",
]);

function extractDaemonErrorCode(body: unknown): PairingErrorCode | null {
	if (!isRecord(body)) return null;
	if (body["ok"] !== false) return null;
	const err = body["error"];
	if (!isRecord(err)) return null;
	const code = err["code"];
	if (typeof code !== "string") return null;
	return DAEMON_ERROR_CODES.has(code as PairingErrorCode) ? (code as PairingErrorCode) : null;
}

function extractDaemonErrorMessage(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined;
	const err = body["error"];
	if (!isRecord(err)) return undefined;
	const message = err["message"];
	return typeof message === "string" ? message : undefined;
}
