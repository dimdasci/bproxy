import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "List interactive elements on the page" },
	args: {
		...globalArgs,
		form: { type: "boolean", description: "Show only form elements", default: false },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["elements"] = {};
		if (args.form === true) {
			params.form = true;
		}
		const plan = await sendAction("elements", params, globals);
		executeExitPlan(plan);
	},
});
