import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { type ExitPlan, executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Extract visible text from the page" },
	args: {
		...globalArgs,
		selector: { type: "string", description: "CSS selector to scope extraction" },
		after: { type: "string", description: "Emit text starting at the first marker match" },
		"limit-chars": {
			type: "string",
			description: "Maximum characters to emit after CLI-local text slicing",
		},
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const params: ActionParams["text"] = {};
		if (typeof args.selector === "string") {
			params.selector = args.selector;
		}

		const limitChars = parsePositiveIntegerArg(args["limit-chars"]);
		if (limitChars === null) {
			executeExitPlan(
				exitUsageError(
					`Invalid limit-chars: ${String(args["limit-chars"])}. Must be a positive integer.`,
				),
			);
			return;
		}

		const plan = await sendAction("text", params, globals);
		executeExitPlan(
			transformTextExitPlan(plan, {
				after: typeof args.after === "string" ? args.after : undefined,
				limitChars,
			}),
		);
	},
});

interface TextTransformOptions {
	after?: string;
	limitChars?: number;
}

interface TextSuccessResponse {
	ok: true;
	data: { text: string; [key: string]: unknown };
	[key: string]: unknown;
}

export function transformTextExitPlan(plan: ExitPlan, options: TextTransformOptions): ExitPlan {
	if (plan.code !== 0 || plan.stdout === undefined || !isTextSuccessResponse(plan.stdout)) {
		return plan;
	}
	if (options.after === undefined && options.limitChars === undefined) return plan;

	const text = plan.stdout.data.text;
	const transformed = transformTextData(text, options);
	return {
		...plan,
		stdout: {
			...plan.stdout,
			data: { ...plan.stdout.data, ...transformed },
		},
	};
}

function transformTextData(text: string, options: TextTransformOptions) {
	if (options.after !== undefined) {
		const markerOffset = text.indexOf(options.after);
		if (markerOffset < 0) return { text, markerFound: false };

		const sliced = applyLimit(text.slice(markerOffset), options.limitChars);
		return { text: sliced, markerFound: true, markerOffset };
	}

	return { text: applyLimit(text, options.limitChars) };
}

function applyLimit(text: string, limitChars: number | undefined): string {
	return limitChars === undefined ? text : text.slice(0, limitChars);
}

function parsePositiveIntegerArg(value: unknown): number | undefined | null {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isTextSuccessResponse(value: unknown): value is TextSuccessResponse {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { ok?: unknown; data?: unknown };
	if (candidate.ok !== true || typeof candidate.data !== "object" || candidate.data === null) {
		return false;
	}
	return typeof (candidate.data as { text?: unknown }).text === "string";
}
