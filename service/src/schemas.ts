import type { Action, BproxyRequest } from "@bproxy/shared";
import { z } from "zod";
import { TAB_HANDLE_PATTERN } from "./sessions";

// Runtime list of every action. `satisfies readonly Action[]` makes the
// compiler verify that ACTIONS only contains valid Action literals; the
// _AssertCovers type below verifies the inverse — every Action is present.
export const ACTIONS = [
	"navigate",
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"scroll",
	"screenshot",
	"fill",
	"fill-form",
	"select",
	"wait",
	"require-human",
	"tab.list",
	"tab.pin",
	"tab.unpin",
	"tab.open",
	"tab.close",
	"session.create",
	"session.list",
	"session.bind",
	"session.unbind",
	"session.resume",
	"session.close",
	"debug.log",
	"debug.last",
	"debug.status",
] as const satisfies readonly Action[];

// If a new Action is added to @bproxy/shared without being appended to ACTIONS,
// this type resolves to a non-`true` literal and the constant assignment fails.
type _AssertCovers = Exclude<Action, (typeof ACTIONS)[number]> extends never ? true : false;
const _coverage: _AssertCovers = true;
void _coverage;

const elementTarget = z.union([
	z.object({ selector: z.string() }).strict(),
	z
		.object({
			route: z.object({
				hosts: z.array(z.object({ selector: z.string(), index: z.number().int().optional() })),
				target: z.string(),
			}),
		})
		.strict(),
]);

const fillMethod = z.enum(["direct", "paste", "runtime-api"]);
const executionWorld = z.enum(["isolated", "main"]);
const pacingMode = z.enum(["human", "fast"]);
const tabHandle = z.string().regex(TAB_HANDLE_PATTERN);

export const ACTION_PARAM_SCHEMAS: Record<Action, z.ZodTypeAny> = {
	navigate: z.object({ url: z.string() }).strict(),
	text: z.object({ selector: z.string().optional() }).strict(),
	links: z
		.object({
			selector: z.string().optional(),
			visibleOnly: z.boolean().optional(),
			limit: z.number().int().optional(),
		})
		.strict(),
	images: z.object({ selector: z.string().optional() }).strict(),
	elements: z.object({ form: z.boolean().optional() }).strict(),
	outline: z.object({}).strict(),
	dom: z.object({ selector: z.string().optional(), depth: z.number().int().optional() }).strict(),
	scroll: z
		.object({
			target: elementTarget.optional(),
			by: z.string().optional(),
			direction: z.enum(["up", "down"]).optional(),
			untilStable: z.boolean().optional(),
		})
		.strict(),
	screenshot: z
		.object({
			activate: z.boolean().optional(),
			debugger: z.boolean().optional(),
		})
		.strict(),
	fill: z
		.object({
			target: elementTarget,
			value: z.string(),
			method: fillMethod,
			world: executionWorld,
		})
		.strict(),
	"fill-form": z
		.object({
			fields: z.array(
				z
					.object({
						target: elementTarget,
						value: z.string(),
						method: fillMethod,
						world: executionWorld,
					})
					.strict(),
			),
		})
		.strict(),
	select: z.object({ trigger: elementTarget, optionText: z.string() }).strict(),
	wait: z
		.object({
			strategy: z.enum(["selector", "url", "navigation"]),
			target: z.string(),
			timeout: z.number().int().optional(),
		})
		.strict(),
	"require-human": z.object({ reason: z.string(), forAttach: z.string().optional() }).strict(),
	"tab.list": z.object({}).strict(),
	"tab.pin": z.object({ tab: tabHandle.optional() }).strict(),
	"tab.unpin": z.object({ tab: tabHandle.optional() }).strict(),
	"tab.open": z.object({ url: z.string() }).strict(),
	"tab.close": z.object({ tab: tabHandle.optional() }).strict(),
	"session.create": z.object({ label: z.string().optional() }).strict(),
	"session.list": z.object({}).strict(),
	"session.bind": z.object({ tab: tabHandle, pacing: pacingMode.optional() }).strict(),
	"session.unbind": z.object({}).strict(),
	"session.resume": z.object({}).strict(),
	"session.close": z.object({}).strict(),
	"debug.log": z.object({ id: z.string().optional(), limit: z.number().int().optional() }).strict(),
	"debug.last": z.object({ count: z.number().int().optional() }).strict(),
	"debug.status": z.object({}).strict(),
};

const ENVELOPE_BASE = z.object({
	protocol_version: z.literal(1),
	id: z.string().min(1),
	action: z.string(),
	params: z.unknown(),
	session: z.string(),
	deadline: z.number().int(),
	destructive: z.boolean(),
});

export type ParseResult =
	| { success: true; data: BproxyRequest }
	| { success: false; error: string };

export function parseRequest(input: unknown): ParseResult {
	const envelope = ENVELOPE_BASE.safeParse(input);
	if (!envelope.success) {
		return { success: false, error: envelope.error.message };
	}
	const action = envelope.data.action;
	const schema = (ACTION_PARAM_SCHEMAS as Record<string, z.ZodTypeAny>)[action];
	if (!schema) {
		return { success: false, error: `Unknown action: ${action}` };
	}
	const params = schema.safeParse(envelope.data.params);
	if (!params.success) {
		return { success: false, error: params.error.message };
	}
	return {
		success: true,
		data: {
			...envelope.data,
			action: action as Action,
			params: params.data,
		} as BproxyRequest,
	};
}
