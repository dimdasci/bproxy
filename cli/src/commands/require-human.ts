import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Request human intervention" },
	args: {
		...globalArgs,
		reason: { type: "string", description: "Reason for human intervention", required: true },
		"for-attach": { type: "string", description: "Selector string for attach context" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		const params: ActionParams["require-human"] = {
			reason: args.reason as string,
		};
		if (typeof args["for-attach"] === "string") {
			params.forAttach = args["for-attach"];
		}

		const plan = await sendAction("require-human", params, globals);
		executeExitPlan(plan);
	},
});
