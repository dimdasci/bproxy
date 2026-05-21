import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type {
	ActionParams,
	ElementRoute,
	ElementTarget,
	ExecutionWorld,
	FillMethod,
} from "../types.js";

const VALID_METHODS: FillMethod[] = ["direct", "paste", "runtime-api"];
const VALID_WORLDS: ExecutionWorld[] = ["isolated", "main"];

export default defineCommand({
	meta: { description: "Fill multiple form fields" },
	args: {
		...globalArgs,
		json: { type: "string", description: "JSON payload with fields array" },
		file: { type: "string", description: "Read payload from file" },
		stdin: { type: "boolean", description: "Read payload from stdin", default: false },
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		// Resolve payload from exactly one source
		const payload = resolvePayload(
			args.json as string | undefined,
			args.file as string | undefined,
			args.stdin === true,
		);
		if (!payload.ok) {
			executeExitPlan(exitUsageError(payload.reason));
			return;
		}

		// Validate payload shape
		const validation = validateFieldsPayload(payload.value);
		if (!validation.ok) {
			executeExitPlan(exitUsageError(validation.reason));
			return;
		}

		const params: ActionParams["fill-form"] = { fields: validation.fields };
		const plan = await sendAction("fill-form", params, globals);
		executeExitPlan(plan);
	},
});

// ─── Payload resolution ────────────────────────────────────────────────

interface PayloadOk {
	ok: true;
	value: string;
}
interface PayloadError {
	ok: false;
	reason: string;
}

function resolvePayload(
	json: string | undefined,
	file: string | undefined,
	stdin: boolean,
): PayloadOk | PayloadError {
	const sources = [json !== undefined, file !== undefined, stdin].filter(Boolean).length;

	if (sources === 0) {
		return { ok: false, reason: "Provide exactly one of --json, --file, or --stdin." };
	}
	if (sources > 1) {
		return {
			ok: false,
			reason: "Provide exactly one of --json, --file, or --stdin, not multiple.",
		};
	}

	if (json !== undefined) {
		return { ok: true, value: json };
	}

	if (file !== undefined) {
		try {
			return { ok: true, value: readFileSync(file, "utf8") };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `Failed to read --file "${file}": ${msg}` };
		}
	}

	// stdin
	try {
		return { ok: true, value: readFileSync(0, "utf8") };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Failed to read from stdin: ${msg}` };
	}
}

// ─── Payload validation ────────────────────────────────────────────────

interface FieldEntry {
	target: ElementTarget;
	value: string;
	method: FillMethod;
	world: ExecutionWorld;
}

interface ValidationOk {
	ok: true;
	fields: FieldEntry[];
}
interface ValidationError {
	ok: false;
	reason: string;
}

function validateFieldsPayload(raw: string): ValidationOk | ValidationError {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "Payload is not valid JSON." };
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: 'Payload must be an object with a "fields" array.' };
	}

	const obj = parsed as Record<string, unknown>;
	if (!Array.isArray(obj["fields"])) {
		return { ok: false, reason: 'Payload must contain a "fields" array.' };
	}

	const fields: FieldEntry[] = [];
	for (let i = 0; i < obj["fields"].length; i++) {
		const entry = obj["fields"][i] as Record<string, unknown>;
		const result = validateField(entry, i);
		if (!result.ok) return result;
		fields.push(result.field);
	}

	return { ok: true, fields };
}

interface FieldOk {
	ok: true;
	field: FieldEntry;
}

function validateField(entry: Record<string, unknown>, index: number): FieldOk | ValidationError {
	if (entry === null || typeof entry !== "object") {
		return { ok: false, reason: `fields[${index}]: must be an object.` };
	}

	// Validate target
	const target = validateTarget(entry["target"], index);
	if (!target.ok) return target;

	// Validate value
	if (typeof entry["value"] !== "string") {
		return { ok: false, reason: `fields[${index}]: "value" must be a string.` };
	}

	// Validate method
	if (!VALID_METHODS.includes(entry["method"] as FillMethod)) {
		return {
			ok: false,
			reason: `fields[${index}]: "method" must be one of: ${VALID_METHODS.join(", ")}.`,
		};
	}

	// Validate world
	if (!VALID_WORLDS.includes(entry["world"] as ExecutionWorld)) {
		return {
			ok: false,
			reason: `fields[${index}]: "world" must be one of: ${VALID_WORLDS.join(", ")}.`,
		};
	}

	return {
		ok: true,
		field: {
			target: target.target,
			value: entry["value"] as string,
			method: entry["method"] as FillMethod,
			world: entry["world"] as ExecutionWorld,
		},
	};
}

interface TargetOk {
	ok: true;
	target: ElementTarget;
}

function validateTarget(target: unknown, index: number): TargetOk | ValidationError {
	if (target === null || typeof target !== "object") {
		return { ok: false, reason: `fields[${index}]: "target" must be an object.` };
	}

	const t = target as Record<string, unknown>;
	const hasSelector = typeof t["selector"] === "string";
	const hasRoute = t["route"] !== undefined && t["route"] !== null;

	const exclusivity = checkTargetExclusivity(hasSelector, hasRoute, index);
	if (exclusivity) return exclusivity;

	if (hasSelector) {
		return { ok: true, target: { selector: t["selector"] as string } };
	}

	return validateRouteTarget(t["route"] as Record<string, unknown>, index);
}

function checkTargetExclusivity(
	hasSelector: boolean,
	hasRoute: boolean,
	index: number,
): ValidationError | null {
	if (hasSelector && hasRoute) {
		return {
			ok: false,
			reason: `fields[${index}]: "target" must have either "selector" or "route", not both.`,
		};
	}
	if (!hasSelector && !hasRoute) {
		return {
			ok: false,
			reason: `fields[${index}]: "target" must have either "selector" or "route".`,
		};
	}
	return null;
}

function validateRouteTarget(
	route: Record<string, unknown>,
	index: number,
): TargetOk | ValidationError {
	if (typeof route["target"] !== "string") {
		return { ok: false, reason: `fields[${index}]: "target.route.target" must be a string.` };
	}
	if (!Array.isArray(route["hosts"])) {
		return { ok: false, reason: `fields[${index}]: "target.route.hosts" must be an array.` };
	}

	return { ok: true, target: { route: route as unknown as ElementRoute } };
}
