import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { parseTarget } from "../targets.js";
import type { ActionParams, ExecutionWorld, FillMethod } from "../types.js";

const VALID_METHODS: FillMethod[] = ["direct", "paste", "runtime-api"];
const VALID_WORLDS: ExecutionWorld[] = ["isolated", "main"];

export default defineCommand({
	meta: { description: "Fill a form field" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector for the target element" },
		"route-json": { type: "string", description: "JSON route for shadow DOM target" },
		value: { type: "string", description: "Value to fill" },
		"value-file": { type: "string", description: "Read value from file" },
		"value-stdin": {
			type: "boolean",
			description: "Read value from stdin",
			default: false,
		},
		method: {
			type: "string",
			description: "Fill method: direct, paste, or runtime-api",
			required: true,
		},
		world: {
			type: "string",
			description: "Execution world: isolated or main",
			required: true,
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		// Validate target
		const targetResult = parseTarget(
			args.selector as string | undefined,
			args["route-json"] as string | undefined,
		);
		if (!targetResult.ok) {
			executeExitPlan(exitUsageError(targetResult.reason));
			return;
		}

		// Validate method
		const method = args.method as string;
		if (!VALID_METHODS.includes(method as FillMethod)) {
			executeExitPlan(
				exitUsageError(`Invalid method: ${method}. Must be one of: ${VALID_METHODS.join(", ")}.`),
			);
			return;
		}

		// Validate world
		const world = args.world as string;
		if (!VALID_WORLDS.includes(world as ExecutionWorld)) {
			executeExitPlan(
				exitUsageError(`Invalid world: ${world}. Must be one of: ${VALID_WORLDS.join(", ")}.`),
			);
			return;
		}

		// Resolve value from exactly one source
		const value = resolveValue(
			args.value as string | undefined,
			args["value-file"] as string | undefined,
			args["value-stdin"] === true,
		);
		if (!value.ok) {
			executeExitPlan(exitUsageError(value.reason));
			return;
		}

		const params: ActionParams["fill"] = {
			target: targetResult.target,
			value: value.value,
			method: method as FillMethod,
			world: world as ExecutionWorld,
		};

		const plan = await sendAction("fill", params, globals);
		executeExitPlan(plan);
	},
});

interface ValueOk {
	ok: true;
	value: string;
}
interface ValueError {
	ok: false;
	reason: string;
}

function resolveValue(
	value: string | undefined,
	valueFile: string | undefined,
	valueStdin: boolean,
): ValueOk | ValueError {
	const sources = [value !== undefined, valueFile !== undefined, valueStdin].filter(Boolean).length;

	if (sources === 0) {
		return { ok: false, reason: "Provide exactly one of --value, --value-file, or --value-stdin." };
	}
	if (sources > 1) {
		return {
			ok: false,
			reason: "Provide exactly one of --value, --value-file, or --value-stdin, not multiple.",
		};
	}

	if (value !== undefined) {
		return { ok: true, value };
	}

	if (valueFile !== undefined) {
		try {
			return { ok: true, value: readFileSync(valueFile, "utf8") };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `Failed to read --value-file "${valueFile}": ${msg}` };
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
