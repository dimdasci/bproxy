import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { parseTarget } from "../targets.js";
import type { Action, ActionParams } from "../types.js";

/**
 * Factory for commands that take exactly one ElementTarget and nothing else.
 * Eliminates duplication between click, hover, and any future single-target actuators.
 */
export function defineTargetAction<A extends Action>(
	action: A & { [K in A]: ActionParams[K] extends { target: unknown } ? K : never }[A],
	description: string,
) {
	return defineCommand({
		meta: { description },
		args: {
			...globalArgs,
			selector: { type: "string", description: "CSS selector for the target element" },
			"route-json": { type: "string", description: "JSON route for shadow DOM target" },
			element: { type: "string", description: "Short-lived element handle (e.g. el5)" },
		},
		async run({ args }) {
			const globals = extractGlobals(args);
			const targetResult = parseTarget(
				args.selector as string | undefined,
				args["route-json"] as string | undefined,
				args.element as string | undefined,
			);
			if (!targetResult.ok) {
				executeExitPlan(exitUsageError(targetResult.reason));
				return;
			}

			const params = { target: targetResult.target } as ActionParams[A];
			const plan = await sendAction(action, params, globals);
			executeExitPlan(plan);
		},
	});
}
