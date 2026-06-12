import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Get accessibility tree snapshot of the page" },
	args: {
		...globalArgs,
		selector: {
			type: "string",
			description: "CSS selector to scope the snapshot",
		},
		maxDepth: {
			type: "string",
			description: "Max tree depth (default: 8, max: 12)",
		},
		interactiveOnly: {
			type: "boolean",
			description: "Only show interactive elements",
			default: false,
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["snapshot"] = {};
		if (typeof args.selector === "string") {
			params.selector = args.selector;
		}
		if (typeof args.maxDepth === "string") {
			const depth = Number.parseInt(args.maxDepth, 10);
			if (Number.isNaN(depth) || depth < 1) {
				const { exitUsageError } = await import("../exit.js");
				executeExitPlan(exitUsageError(`Invalid maxDepth value: ${args.maxDepth}`));
				return;
			}
			params.maxDepth = depth;
		}
		if (args.interactiveOnly) {
			params.interactiveOnly = true;
		}
		const plan = await sendAction("snapshot", params, globals);
		executeExitPlan(plan);
	},
});
