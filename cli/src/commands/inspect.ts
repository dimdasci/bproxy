import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Inspect DOM elements: structure, styles, dimensions" },
	args: {
		...globalArgs,
		selector: {
			type: "string",
			required: true,
			description: "CSS selector to query",
		},
		properties: {
			type: "string",
			description: "Comma-separated CSS properties to include",
		},
		limit: {
			type: "string",
			description: "Max elements to return (default: 10, max: 50)",
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["inspect"] = { selector: args.selector as string };
		if (typeof args.properties === "string") {
			params.properties = args.properties.split(",").map((s) => s.trim());
		}
		if (typeof args.limit === "string") {
			const limit = Number.parseInt(args.limit, 10);
			if (Number.isNaN(limit) || limit < 1) {
				const { exitUsageError } = await import("../exit.js");
				executeExitPlan(exitUsageError(`Invalid limit value: ${args.limit}`));
				return;
			}
			params.limit = limit;
		}
		const plan = await sendAction("inspect", params, globals);
		executeExitPlan(plan);
	},
});
