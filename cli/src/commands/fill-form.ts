import { readFileSync } from "node:fs";
import { HANDLE_PATTERN } from "@bproxy/shared";
import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type {
	ActionParams,
	ClientElementTarget,
	ElementHandle,
	ElementRoute,
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
		const payload = resolvePayload(
			args.json as string | undefined,
			args.file as string | undefined,
			args.stdin === true,
		);
		if (!payload.ok) {
			executeExitPlan(exitUsageError(payload.reason));
			return;
		}

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
	if (json !== undefined) return { ok: true, value: json };
	if (file !== undefined) return readPayloadFile(file);
	return readPayloadStdin();
}

function readPayloadFile(file: string): PayloadOk | PayloadError {
	try {
		return { ok: true, value: readFileSync(file, "utf8") };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Failed to read --file "${file}": ${msg}` };
	}
}

function readPayloadStdin(): PayloadOk | PayloadError {
	try {
		return { ok: true, value: readFileSync(0, "utf8") };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Failed to read from stdin: ${msg}` };
	}
}

interface FieldEntry {
	target: ClientElementTarget;
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
	const parsed = parsePayload(raw);
	if (!parsed.ok) return parsed;
	if (!Array.isArray(parsed.value["fields"])) {
		return { ok: false, reason: 'Payload must contain a "fields" array.' };
	}

	const fields: FieldEntry[] = [];
	for (const [index, item] of parsed.value["fields"].entries()) {
		const validated = validateField(item, index);
		if (!validated.ok) return validated;
		fields.push(validated.field);
	}
	return { ok: true, fields };
}

function parsePayload(raw: string): { ok: true; value: Record<string, unknown> } | ValidationError {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "Payload is not valid JSON." };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: 'Payload must be an object with a "fields" array.' };
	}
	return { ok: true, value: parsed as Record<string, unknown> };
}

interface FieldOk {
	ok: true;
	field: FieldEntry;
}

function validateField(entry: unknown, index: number): FieldOk | ValidationError {
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
		return { ok: false, reason: `fields[${index}]: must be an object.` };
	}
	const record = entry as Record<string, unknown>;
	const target = validateTarget(record["target"], index);
	if (!target.ok) return target;
	const value = validateValue(record["value"], index);
	if (!value.ok) return value;
	const method = validateMethod(record["method"], index);
	if (!method.ok) return method;
	const world = validateWorld(record["world"], index);
	if (!world.ok) return world;
	return {
		ok: true,
		field: {
			target: target.target,
			value: value.value,
			method: method.method,
			world: world.world,
		},
	};
}

interface TargetOk {
	ok: true;
	target: ClientElementTarget;
}

function validateTarget(target: unknown, index: number): TargetOk | ValidationError {
	if (target === null || typeof target !== "object" || Array.isArray(target)) {
		return { ok: false, reason: `fields[${index}]: "target" must be an object.` };
	}
	const record = target as Record<string, unknown>;
	const hasSelector = typeof record["selector"] === "string";
	const hasRoute = record["route"] !== undefined && record["route"] !== null;
	const hasHandle = typeof record["handle"] === "string";
	const kindCount = [hasSelector, hasRoute, hasHandle].filter(Boolean).length;
	if (kindCount !== 1) {
		return {
			ok: false,
			reason: `fields[${index}]: "target" must have exactly one of "selector", "route", or "handle".`,
		};
	}
	if (hasSelector) return { ok: true, target: { selector: record["selector"] as string } };
	if (hasHandle) return validateHandleTarget(record["handle"] as string, index);
	return validateRouteTarget(record["route"] as Record<string, unknown>, index);
}

function validateHandleTarget(handle: string, index: number): TargetOk | ValidationError {
	if (!HANDLE_PATTERN.test(handle)) {
		return {
			ok: false,
			reason: `fields[${index}]: "target.handle" must match /^(el|ln)\\d+$/.`,
		};
	}
	return { ok: true, target: { handle: handle as ElementHandle } };
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

function validateValue(
	value: unknown,
	index: number,
): { ok: true; value: string } | ValidationError {
	if (typeof value !== "string") {
		return { ok: false, reason: `fields[${index}]: "value" must be a string.` };
	}
	return { ok: true, value };
}

function validateMethod(
	method: unknown,
	index: number,
): { ok: true; method: FillMethod } | ValidationError {
	if (!VALID_METHODS.includes(method as FillMethod)) {
		return {
			ok: false,
			reason: `fields[${index}]: "method" must be one of: ${VALID_METHODS.join(", ")}.`,
		};
	}
	return { ok: true, method: method as FillMethod };
}

function validateWorld(
	world: unknown,
	index: number,
): { ok: true; world: ExecutionWorld } | ValidationError {
	if (!VALID_WORLDS.includes(world as ExecutionWorld)) {
		return {
			ok: false,
			reason: `fields[${index}]: "world" must be one of: ${VALID_WORLDS.join(", ")}.`,
		};
	}
	return { ok: true, world: world as ExecutionWorld };
}
