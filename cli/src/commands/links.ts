import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Extract structured links from the page" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector to scope extraction" },
		"visible-only": {
			type: "boolean",
			description: "Return only visible links",
			default: false,
		},
		limit: { type: "string", description: "Maximum links to return" },
		"href-contains": {
			type: "string",
			description: "Filter links by substring match on absolute href",
		},
		offset: { type: "string", description: "Number of matching links to skip (pagination)" },
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["links"] = {};

		if (typeof args.selector === "string") {
			params.selector = args.selector;
		}
		if (args["visible-only"] === true) {
			params.visibleOnly = true;
		}
		if (typeof args.limit === "string") {
			const limit = parseIntegerArg(args.limit, { min: 1 });
			if (limit === null) {
				executeExitPlan(
					exitUsageError(`Invalid limit: ${args.limit}. Must be a positive integer.`),
				);
				return;
			}
			params.limit = limit;
		}
		if (typeof args["href-contains"] === "string") {
			params.hrefContains = args["href-contains"];
		}
		if (typeof args.offset === "string") {
			const offset = parseIntegerArg(args.offset, { min: 0 });
			if (offset === null) {
				executeExitPlan(
					exitUsageError(`Invalid offset: ${args.offset}. Must be a non-negative integer.`),
				);
				return;
			}
			params.offset = offset;
		}

		const plan = await sendAction("links", params, globals);
		executeExitPlan(plan);
	},
});

function parseIntegerArg(raw: string, options: { min: number }): number | null {
	if (!/^[0-9]+$/.test(raw)) return null;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < options.min) return null;
	return parsed;
}
