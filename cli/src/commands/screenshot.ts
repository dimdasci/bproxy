import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { writeScreenshotFile } from "../screenshot-file.js";
import type { ActionParams, BproxyResponse } from "../types.js";

export default defineCommand({
	meta: { description: "Take a screenshot of the page" },
	args: {
		...globalArgs,
		activate: {
			type: "boolean",
			description: "Activate the tab before capture",
			default: false,
		},
		debugger: {
			type: "boolean",
			description:
				"Use debugger protocol for capture (requires extension config; normally returns DEBUGGER_DISABLED)",
			default: false,
		},
		"output-dir": {
			type: "string",
			description: "Write screenshot to this directory and return file path instead of base64",
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["screenshot"] = {};

		if (args.activate === true) {
			params.activate = true;
		}
		if (args.debugger === true) {
			params.debugger = true;
		}

		const plan = await sendAction("screenshot", params, globals);

		// When --output-dir is provided and the request succeeded, materialize
		// the screenshot bytes to disk and replace base64 with file metadata.
		const outputDir = args["output-dir"];
		if (outputDir && plan.code === 0 && plan.stdout) {
			const response = plan.stdout as BproxyResponse<"screenshot">;
			if (response.ok) {
				const { base64, format } = response.data;
				try {
					const result = writeScreenshotFile(outputDir, base64, format);
					// Replace data: swap base64 blob for file metadata
					plan.stdout = {
						...response,
						data: { format: result.format, file: result.file, size: result.size },
					};
				} catch (err) {
					plan.code = 2;
					plan.stdout = undefined;
					plan.stderr = `Failed to write screenshot: ${err instanceof Error ? err.message : String(err)}`;
				}
			}
		}

		executeExitPlan(plan);
	},
});
