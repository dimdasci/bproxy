import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Query extension trace log" },
	args: {
		...globalArgs,
		id: { type: "string", description: "Filter by request ID" },
		limit: { type: "string", description: "Maximum entries to return" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["debug.log"] = {};

		if (typeof args.id === "string") {
			params.id = args.id;
		}
		if (typeof args.limit === "string") {
			const limit = Number.parseInt(args.limit, 10);
			if (Number.isNaN(limit) || limit <= 0) {
				executeExitPlan(
					exitUsageError(`Invalid limit: ${args.limit}. Must be a positive integer.`),
				);
				return;
			}
			params.limit = limit;
		}

		const plan = await sendAction("debug.log", params, globals);
		executeExitPlan(plan);
	},
});
