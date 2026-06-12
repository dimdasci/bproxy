import { defineCommand } from "citty";
import { sendAction } from "../../client.js";
import { executeExitPlan, exitUsageError } from "../../exit.js";
import { extractGlobals, globalArgs, parseTabHandle } from "../../globals.js";
import type { ActionParams } from "../../types.js";

type TabHandleAction = "tab.close" | "tab.pin" | "tab.unpin";

export function defineTabHandleCommand(action: TabHandleAction, description: string) {
	return defineCommand({
		meta: { description },
		args: {
			...globalArgs,
			tab: { type: "string", description: "Logical tab handle (defaults to bound tab)" },
		},
		async run({ args }) {
			const globals = extractGlobals(args);
			const params: ActionParams[TabHandleAction] = {};

			if (typeof args.tab === "string") {
				const tab = parseTabHandle(args.tab);
				if (!tab) {
					executeExitPlan(exitUsageError(`Invalid tab handle: ${args.tab}. Must look like t1.`));
					return;
				}
				params.tab = tab;
			}

			const plan = await sendAction(action, params, globals);
			executeExitPlan(plan);
		},
	});
}
