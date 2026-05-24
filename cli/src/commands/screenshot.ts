import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Take a screenshot of the page" },
	args: {
		...globalArgs,
		activate: {
			type: "boolean",
			description: "Activate the tab before capture",
			default: false,
		},
		debugger: {
			type: "boolean",
			description:
				"Use debugger protocol for capture (requires extension config; normally returns DEBUGGER_DISABLED)",
			default: false,
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["screenshot"] = {};

		if (args.activate === true) {
			params.activate = true;
		}
		if (args.debugger === true) {
			params.debugger = true;
		}

		const plan = await sendAction("screenshot", params, globals);
		executeExitPlan(plan);
	},
});
