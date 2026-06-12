import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs, parseTabHandle } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Unpin a session-owned tab" },
	args: {
		...globalArgs,
		tab: { type: "string", description: "Logical tab handle (defaults to bound tab)" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["tab.unpin"] = {};
		if (typeof args.tab === "string") {
			const tab = parseTabHandle(args.tab);
			if (!tab) {
				executeExitPlan(exitUsageError(`Invalid tab handle: ${args.tab}. Must look like t1.`));
				return;
			}
			params.tab = tab;
		}
		const plan = await sendAction("tab.unpin", params, globals);
		executeExitPlan(plan);
	},
});
