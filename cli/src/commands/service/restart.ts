import { defineCommand } from "citty";
import { executeExitPlan, exitSuccess, exitUsageError } from "../../exit.js";
import { globalArgs } from "../../globals.js";
import { resolveStateDir } from "../../paths.js";
import { execServiceBinary, resolveServiceBinary } from "../../service-binary.js";

export default defineCommand({
	meta: { description: "Restart the bproxy daemon (stop then start)" },
	args: {
		...globalArgs,
		port: { type: "string", description: "Port to listen on" },
	},
	async run({ args }) {
		const home = typeof args.home === "string" ? args.home : undefined;
		const port = typeof args.port === "string" ? args.port : undefined;

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

		// Stop the existing daemon (ignore errors — it may not be running)
		await execServiceBinary(binPath, "stop", childEnv);

		// Start a fresh daemon
		if (port) childEnv["BPROXY_PORT"] = port;
		const startResult = await execServiceBinary(binPath, "start", childEnv);

		if (!startResult.ok) {
			executeExitPlan(exitUsageError(startResult.stderr || "Service restart failed during start"));
			return;
		}

		// Parse and re-emit the service start JSON (same shape as start)
		let parsed: unknown;
		try {
			parsed = JSON.parse(startResult.stdout);
		} catch {
			executeExitPlan(exitUsageError(`Service produced invalid JSON: ${startResult.stdout}`));
			return;
		}

		executeExitPlan(exitSuccess(parsed));
	},
});
