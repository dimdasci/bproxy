import { defineCommand } from "citty";
import { executeExitPlan, exitSuccess, exitUsageError } from "../../exit.js";
import { globalArgs } from "../../globals.js";
import { resolveStateDir } from "../../paths.js";
import { execServiceBinary, resolveServiceBinary } from "../../service-binary.js";

export default defineCommand({
	meta: { description: "Check daemon process status (token-free)" },
	args: {
		...globalArgs,
	},
	async run({ args }) {
		const home = typeof args.home === "string" ? args.home : undefined;

		const binPath = resolveServiceBinary({ env: process.env });
		if (!binPath) {
			executeExitPlan(
				exitUsageError(
					"Cannot find service binary. Set BPROXY_SERVICE_BIN, build the service package (pnpm --filter @bproxy/service build), or ensure bproxy-service is on PATH.",
				),
			);
			return;
		}

		const stateDir = resolveStateDir(home, process.env);
		const childEnv: NodeJS.ProcessEnv = { ...process.env, BPROXY_HOME: stateDir };

		const result = await execServiceBinary(binPath, "status", childEnv);

		if (!result.ok) {
			executeExitPlan(exitUsageError(result.stderr || "Service status check failed"));
			return;
		}

		// Parse and re-emit the service status JSON
		let parsed: unknown;
		try {
			parsed = JSON.parse(result.stdout);
		} catch {
			executeExitPlan(exitUsageError(`Service produced invalid JSON: ${result.stdout}`));
			return;
		}

		executeExitPlan(exitSuccess(parsed));
	},
});
