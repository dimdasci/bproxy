import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs, parseTabHandle } from "../../globals.js";
import type { ActionParams } from "../../types.js";

export default defineCommand({
	meta: { description: "Bind session to a logical tab handle" },
	args: {
		...globalArgs,
		tab: { type: "string", description: "Logical tab handle (e.g. t1)", required: true },
		pacing: { type: "string", description: "Pacing mode: human or fast" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		const tab = parseTabHandle(args.tab as string);
		if (!tab) {
			executeExitPlan(exitUsageError(`Invalid tab handle: ${args.tab}. Must look like t1.`));
			return;
		}

		const params: ActionParams["session.bind"] = { tab };

		if (typeof args.pacing === "string") {
			if (args.pacing !== "human" && args.pacing !== "fast") {
				executeExitPlan(
					exitUsageError(`Invalid pacing: ${args.pacing}. Must be 'human' or 'fast'.`),
				);
				return;
			}
			params.pacing = args.pacing;
		}

		const plan = await sendAction("session.bind", params, globals);
		executeExitPlan(plan);
	},
});
