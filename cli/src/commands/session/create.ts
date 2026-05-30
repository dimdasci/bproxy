import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Create a daemon-managed session" },
	args: {
		...globalArgs,
		label: { type: "string", description: "Optional display label" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["session.create"] = {};
		if (typeof args.label === "string") {
			params.label = args.label;
		}
		const plan = await sendAction("session.create", params, globals);
		executeExitPlan(plan);
	},
});
