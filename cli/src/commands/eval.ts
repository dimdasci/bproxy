import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan, exitUsageError } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";
import type { ActionParams } from "../types.js";

export default defineCommand({
	meta: { description: "Evaluate JavaScript in the page" },
	args: {
		...globalArgs,
		"allow-eval": {
			type: "boolean",
			description: "Explicit opt-in to eval execution (required)",
			default: false,
		},
		code: { type: "string", description: "JavaScript code to evaluate" },
		file: { type: "string", description: "Read code from file" },
		stdin: { type: "boolean", description: "Read code from stdin", default: false },
	},
	async run({ args }) {
		const globals = extractGlobals(args);

		// Require explicit --allow-eval opt-in
		if (args["allow-eval"] !== true) {
			executeExitPlan(
				exitUsageError(
					"The --allow-eval flag is required to execute arbitrary code. This is a safety guard.",
				),
			);
			return;
		}

		// Resolve code from exactly one source
		const code = resolveCode(
			args.code as string | undefined,
			args.file as string | undefined,
			args.stdin === true,
		);
		if (!code.ok) {
			executeExitPlan(exitUsageError(code.reason));
			return;
		}

		const params: ActionParams["eval"] = { code: code.value };
		const plan = await sendAction("eval", params, globals);
		executeExitPlan(plan);
	},
});

// ─── Code resolution ───────────────────────────────────────────────────

interface CodeOk {
	ok: true;
	value: string;
}
interface CodeError {
	ok: false;
	reason: string;
}

function resolveCode(
	code: string | undefined,
	file: string | undefined,
	stdin: boolean,
): CodeOk | CodeError {
	const sources = [code !== undefined, file !== undefined, stdin].filter(Boolean).length;

	if (sources === 0) {
		return { ok: false, reason: "Provide exactly one of --code, --file, or --stdin." };
	}
	if (sources > 1) {
		return {
			ok: false,
			reason: "Provide exactly one of --code, --file, or --stdin, not multiple.",
		};
	}

	if (code !== undefined) {
		return { ok: true, value: code };
	}

	if (file !== undefined) {
		try {
			return { ok: true, value: readFileSync(file, "utf8") };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `Failed to read --file "${file}": ${msg}` };
		}
	}

	// stdin
	try {
		return { ok: true, value: readFileSync(0, "utf8") };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Failed to read from stdin: ${msg}` };
	}
}
