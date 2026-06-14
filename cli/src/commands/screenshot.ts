import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { type ExitPlan, executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import { resolveStateDir, sessionTmpPath } from "../paths.js";
import { writeScreenshotFile } from "../screenshot-file.js";
import type { ActionParams, BproxyResponse } from "../types.js";

function resolveOutputDir(
	explicit: string | undefined,
	home: string | undefined,
	session: string | undefined,
): string | undefined {
	if (explicit) return explicit;
	if (session) return sessionTmpPath(resolveStateDir(home, process.env), session);
	return undefined;
}

function materializeScreenshot(plan: ExitPlan, outputDir: string): void {
	const response = plan.stdout as BproxyResponse<"screenshot">;
	if (!response.ok) return;
	const { base64, format } = response.data;
	try {
		const result = writeScreenshotFile(outputDir, base64, format);
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

		if (args.activate === true) params.activate = true;
		if (args.debugger === true) params.debugger = true;

		const plan = await sendAction("screenshot", params, globals);
		const outputDir = resolveOutputDir(args["output-dir"], globals.home, globals.session);

		if (outputDir && plan.code === 0 && plan.stdout) {
			materializeScreenshot(plan, outputDir);
		}

		executeExitPlan(plan);
	},
});
