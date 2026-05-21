import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";

export default defineCommand({
	meta: { description: "Get page outline (landmarks and headings)" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("outline", {}, globals);
		executeExitPlan(plan);
	},
});
