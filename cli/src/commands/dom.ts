import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Get DOM HTML of the page or a subtree" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector to scope extraction" },
		depth: { type: "string", description: "Maximum depth to traverse" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["dom"] = {};
		if (typeof args.selector === "string") {
			params.selector = args.selector;
		}
		if (typeof args.depth === "string") {
			const depth = Number.parseInt(args.depth, 10);
			if (Number.isNaN(depth) || depth < 0) {
				const { exitUsageError } = await import("../exit.js");
				executeExitPlan(exitUsageError(`Invalid depth value: ${args.depth}`));
				return;
			}
			params.depth = depth;
		}
		const plan = await sendAction("dom", params, globals);
		executeExitPlan(plan);
	},
});
