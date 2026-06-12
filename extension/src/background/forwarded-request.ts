import type { BproxyForwardedRequest } from "@bproxy/shared";
import { type ForwardedAction, isForwardedAction } from "./forwarded-actions";
import { isTarget, paramsValidForAction } from "./forwarded-params";

type ParseResult =
	| { success: true; data: BproxyForwardedRequest<ForwardedAction> }
	| { success: false; error: string; id?: string };

type EnvelopeValidation =
	| {
			success: true;
			data: {
				protocol_version: 1;
				id: string;
				action: ForwardedAction;
				params: unknown;
				session: string;
				deadline: number;
				destructive: boolean;
				target: { tabId: number | null };
			};
	  }
	| { success: false; error: string; id?: string };

interface EnvelopeRecord extends Record<string, unknown> {
	protocol_version?: unknown;
	id?: unknown;
	action?: unknown;
	params?: unknown;
	session?: unknown;
	deadline?: unknown;
	destructive?: unknown;
	target?: unknown;
}

export function parseForwardedRequest(raw: unknown): ParseResult {
	const decoded = decodeRawMessage(raw);
	if (!decoded.success) return decoded;
	const validated = validateEnvelope(decoded.data);
	if (!validated.success) return validated;
	const env = validated.data;
	return {
		success: true,
		data: {
			protocol_version: 1,
			id: env.id,
			action: env.action,
			params: env.params,
			session: env.session,
			deadline: env.deadline,
			destructive: env.destructive,
			target: { tabId: env.target.tabId },
		} as BproxyForwardedRequest<ForwardedAction>,
	};
}

function validateEnvelope(input: EnvelopeRecord): EnvelopeValidation {
	const id = readNonEmptyString(input["id"]);
	const shapeError = validateEnvelopeShape(input, id);
	if (shapeError) return shapeError;
	if (!id) {
		return { success: false, error: "id must be a non-empty string" };
	}
	const action = readNonEmptyString(input["action"]);
	if (!action || !isForwardedAction(action)) {
		return { success: false, id, error: "action must be one of the forwarded action literals" };
	}
	const session = readNonEmptyString(input["session"]);
	if (!session) {
		return { success: false, id, error: "session must be a non-empty string" };
	}
	if (!Number.isInteger(input["deadline"])) {
		return { success: false, id, error: "deadline must be an integer" };
	}
	if (typeof input["destructive"] !== "boolean") {
		return { success: false, id, error: "destructive must be a boolean" };
	}
	if (!isTarget(input["target"])) {
		return { success: false, id, error: "target must be { tabId: integer|null }" };
	}
	if (!paramsValidForAction(action, input["params"])) {
		return { success: false, id, error: `params are invalid for action ${action}` };
	}
	return {
		success: true,
		data: {
			protocol_version: 1,
			id,
			action,
			params: input["params"],
			session,
			deadline: input["deadline"] as number,
			destructive: input["destructive"],
			target: input["target"],
		},
	};
}

function decodeRawMessage(
	raw: unknown,
): { success: true; data: EnvelopeRecord } | { success: false; error: string; id?: string } {
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!isRecord(parsed)) return { success: false, error: "message must decode to an object" };
			return { success: true, data: parsed };
		} catch {
			return { success: false, error: "message is not valid JSON" };
		}
	}
	if (!isRecord(raw)) {
		return { success: false, error: "message must be a JSON object" };
	}
	return { success: true, data: raw };
}

function validateEnvelopeShape(
	input: EnvelopeRecord,
	id: string | undefined,
): { success: false; error: string; id?: string } | undefined {
	if (!hasExpectedKeys(input)) {
		return { success: false, id, error: "unexpected top-level keys" };
	}
	if (input["protocol_version"] !== 1) {
		return { success: false, id, error: "protocol_version must be 1" };
	}
	return undefined;
}

function hasExpectedKeys(input: EnvelopeRecord): boolean {
	const allowed = new Set([
		"protocol_version",
		"id",
		"action",
		"params",
		"session",
		"deadline",
		"destructive",
		"target",
	]);
	return Object.keys(input).every((key) => allowed.has(key));
}

function readNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is EnvelopeRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
