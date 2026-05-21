import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";

export default defineCommand({
	meta: { description: "Unbind session from its tab" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("session.unbind", {}, globals);
		executeExitPlan(plan);
	},
});
