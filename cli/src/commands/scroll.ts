import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { parseOptionalTarget } from "../targets.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Scroll the page" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector for the element to scroll" },
		"route-json": { type: "string", description: "JSON route for shadow DOM scroll target" },
		by: { type: "string", description: "Scroll amount (e.g. 'viewport', '500px')" },
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
		const targetResult = parseOptionalTarget(
			args.selector as string | undefined,
			args["route-json"] as string | undefined,
		);
		if (!targetResult.ok) {
			executeExitPlan(exitUsageError(targetResult.reason));
			return;
		}
		if (targetResult.target) {
			params.target = targetResult.target;
		}

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
