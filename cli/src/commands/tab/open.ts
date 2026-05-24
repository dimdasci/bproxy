import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan } from "../../exit.js";
import { extractGlobals, globalArgs } from "../../globals.js";

export default defineCommand({
	meta: { description: "Open a new tab" },
	args: {
		...globalArgs,
		url: { type: "string", description: "URL to open", required: true },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("tab.open", { url: args.url as string }, globals);
		executeExitPlan(plan);
	},
});
