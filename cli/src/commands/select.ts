import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { parseTarget } from "../targets.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Select an option from a dropdown" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector for the trigger element" },
		"route-json": { type: "string", description: "JSON route for shadow DOM target" },
		element: { type: "string", description: "Short-lived element handle (e.g. el5)" },
		"option-text": {
			type: "string",
			description: "Text of the option to select",
			required: true,
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		// Validate target
		const targetResult = parseTarget(
			args.selector as string | undefined,
			args["route-json"] as string | undefined,
			args.element as string | undefined,
		);
		if (!targetResult.ok) {
			executeExitPlan(exitUsageError(targetResult.reason));
			return;
		}

		const params: ActionParams["select"] = {
			trigger: targetResult.target,
			optionText: args["option-text"] as string,
		};

		const plan = await sendAction("select", params, globals);
		executeExitPlan(plan);
	},
});
