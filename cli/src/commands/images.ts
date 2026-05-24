import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "List images on the page" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector to scope extraction" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["images"] = {};
		if (typeof args.selector === "string") {
			params.selector = args.selector;
		}
		const plan = await sendAction("images", params, globals);
		executeExitPlan(plan);
	},
});
