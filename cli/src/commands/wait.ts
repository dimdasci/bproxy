import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Wait for a condition on the page" },
	args: {
		...globalArgs,
		strategy: {
			type: "string",
			description: "Wait strategy: selector, url, or navigation",
			required: true,
		},
		target: { type: "string", description: "Target value for the strategy", required: true },
		timeout: {
			type: "string",
			description: "Wait timeout in milliseconds (distinct from global --timeout deadline)",
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const strategy = args.strategy as string;

		if (strategy !== "selector" && strategy !== "url" && strategy !== "navigation") {
			executeExitPlan(
				exitUsageError(
					`Invalid strategy: ${strategy}. Must be 'selector', 'url', or 'navigation'.`,
				),
			);
			return;
		}

		const params: ActionParams["wait"] = {
			strategy,
			target: args.target as string,
		};

		// Wait-specific timeout (protocol wait timeout, not the CLI deadline)
		if (typeof args.timeout === "string") {
			const ms = Number.parseInt(args.timeout, 10);
			if (Number.isNaN(ms) || ms <= 0) {
				executeExitPlan(exitUsageError(`Invalid wait timeout value: ${args.timeout}`));
				return;
			}
			params.timeout = ms;
		}

		const plan = await sendAction("wait", params, globals);
		executeExitPlan(plan);
	},
});
