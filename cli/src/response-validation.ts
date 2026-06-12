import type { BproxyResponse } from "./types.js";

interface ValidationOk {
	ok: true;
	response: BproxyResponse;
}

interface ValidationError {
	ok: false;
	reason: string;
}

type ValidationResult = ValidationOk | ValidationError;

/**
 * Minimal CLI-side guard for BproxyResponse shape.
 * Does not import service schemas. Only checks the structural contract.
 */
export function validateResponse(body: unknown, expectedId: string): ValidationResult {
	if (body === null || typeof body !== "object") {
		return { ok: false, reason: "Daemon response is not a JSON object" };
	}

	const obj = body as Record<string, unknown>;

	const headerCheck = validateHeaders(obj, expectedId);
	if (headerCheck) return headerCheck;

	if (obj["ok"] === true) return validateSuccessBranch(obj);
	return validateErrorBranch(obj);
}

function validateHeaders(obj: Record<string, unknown>, expectedId: string): ValidationError | null {
	if (obj["protocol_version"] !== 1) {
		return {
			ok: false,
			reason: `Unexpected protocol_version: ${JSON.stringify(obj["protocol_version"])}`,
		};
	}
	if (typeof obj["id"] !== "string") {
		return { ok: false, reason: "Daemon response missing 'id' field" };
	}
	if (obj["id"] !== expectedId) {
		return { ok: false, reason: `Response id mismatch: expected ${expectedId}, got ${obj["id"]}` };
	}
	if (typeof obj["ok"] !== "boolean") {
		return { ok: false, reason: "Daemon response missing 'ok' field" };
	}
	return null;
}

function validateSuccessBranch(obj: Record<string, unknown>): ValidationResult {
	if (!("data" in obj)) {
		return { ok: false, reason: "Success response missing 'data' field" };
	}
	if (!("page" in obj)) {
		return { ok: false, reason: "Success response missing 'page' field" };
	}
	return { ok: true, response: obj as unknown as BproxyResponse };
}

function validateErrorBranch(obj: Record<string, unknown>): ValidationResult {
	if (!("error" in obj) || typeof obj["error"] !== "object" || obj["error"] === null) {
		return { ok: false, reason: "Error response missing 'error' object" };
	}
	const error = obj["error"] as Record<string, unknown>;
	if (typeof error["code"] !== "string") {
		return { ok: false, reason: "Error response missing 'error.code' string" };
	}
	return { ok: true, response: obj as unknown as BproxyResponse };
}
