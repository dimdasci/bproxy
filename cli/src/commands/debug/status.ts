import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";

export default defineCommand({
	meta: { description: "Show full daemon status" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("debug.status", {}, globals);
		executeExitPlan(plan);
	},
});
