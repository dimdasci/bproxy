import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Show recent daemon requests" },
	args: {
		...globalArgs,
		count: { type: "string", description: "Number of recent requests to show" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["debug.last"] = {};

		if (typeof args.count === "string") {
			const count = Number.parseInt(args.count, 10);
			if (Number.isNaN(count) || count <= 0) {
				executeExitPlan(
					exitUsageError(`Invalid count: ${args.count}. Must be a positive integer.`),
				);
				return;
			}
			params.count = count;
		}

		const plan = await sendAction("debug.last", params, globals);
		executeExitPlan(plan);
	},
});
