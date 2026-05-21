import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";

export default defineCommand({
	meta: { description: "Navigate to a URL" },
	args: {
		...globalArgs,
		url: { type: "string", description: "Target URL", required: true },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("navigate", { url: args.url as string }, globals);
		executeExitPlan(plan);
	},
});
