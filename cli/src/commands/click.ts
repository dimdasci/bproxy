import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { parseTarget } from "../targets.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Click a visible target element" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector for the target element" },
		"route-json": { type: "string", description: "JSON route for shadow DOM target" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const targetResult = parseTarget(
			args.selector as string | undefined,
			args["route-json"] as string | undefined,
		);
		if (!targetResult.ok) {
			executeExitPlan(exitUsageError(targetResult.reason));
			return;
		}

		const params: ActionParams["click"] = {
			target: targetResult.target,
		};
		const plan = await sendAction("click", params, globals);
		executeExitPlan(plan);
	},
});
