import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Bind session to a tab" },
	args: {
		...globalArgs,
		"tab-id": { type: "string", description: "Tab ID to bind", required: true },
		pacing: { type: "string", description: "Pacing mode: human or fast" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		const tabId = Number.parseInt(args["tab-id"] as string, 10);
		if (Number.isNaN(tabId) || tabId <= 0) {
			executeExitPlan(
				exitUsageError(`Invalid tab-id: ${args["tab-id"]}. Must be a positive integer.`),
			);
			return;
		}

		const params: ActionParams["session.bind"] = { tabId };

		if (typeof args.pacing === "string") {
			if (args.pacing !== "human" && args.pacing !== "fast") {
				executeExitPlan(
					exitUsageError(`Invalid pacing: ${args.pacing}. Must be 'human' or 'fast'.`),
				);
				return;
			}
			params.pacing = args.pacing;
		}

		const plan = await sendAction("session.bind", params, globals);
		executeExitPlan(plan);
	},
});
