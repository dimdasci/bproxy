import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Close a tab" },
	args: {
		...globalArgs,
		"tab-id": { type: "string", description: "Tab ID to close" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["tab.close"] = {};

		if (typeof args["tab-id"] === "string") {
			const tabId = Number.parseInt(args["tab-id"], 10);
			if (Number.isNaN(tabId) || tabId <= 0) {
				executeExitPlan(
					exitUsageError(`Invalid tab-id: ${args["tab-id"]}. Must be a positive integer.`),
				);
				return;
			}
			params.tabId = tabId;
		}

		const plan = await sendAction("tab.close", params, globals);
		executeExitPlan(plan);
	},
});
