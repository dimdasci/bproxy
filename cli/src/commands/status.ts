import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";

/**
 * Top-level `status` is protocol-backed: an alias for `debug.status`.
 * It requires token preflight (unlike `service status` which is token-free).
 * A token/auth failure exits 2 — it does NOT fall back to service status.
 */
export default defineCommand({
	meta: { description: "Protocol-backed daemon status (requires token)" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const globals = extractGlobals(args);
		const plan = await sendAction("debug.status", {}, globals);
		executeExitPlan(plan);
	},
});
