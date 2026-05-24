import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";

export default defineCommand({
	meta: { description: "List active sessions" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("session.list", {}, globals);
		executeExitPlan(plan);
	},
});
