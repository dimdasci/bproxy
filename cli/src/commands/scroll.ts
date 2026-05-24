import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Scroll the page" },
	args: {
		...globalArgs,
		by: { type: "string", description: "Scroll amount (e.g. 'page', '500px')" },
		direction: { type: "string", description: "Scroll direction: up or down" },
		"until-stable": {
			type: "boolean",
			description: "Scroll until position stabilizes",
			default: false,
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["scroll"] = {};

		if (typeof args.by === "string") {
			params.by = args.by;
		}
		if (typeof args.direction === "string") {
			if (args.direction !== "up" && args.direction !== "down") {
				executeExitPlan(
					exitUsageError(`Invalid direction: ${args.direction}. Must be 'up' or 'down'.`),
				);
				return;
			}
			params.direction = args.direction;
		}
		if (args["until-stable"] === true) {
			params.untilStable = true;
		}

		const plan = await sendAction("scroll", params, globals);
		executeExitPlan(plan);
	},
});
