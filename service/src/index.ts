import { loadConfig } from "./config";
import type { LifecycleStartResult, LifecycleStatusResult, LifecycleStopResult } from "./lifecycle";
import { startDetached, startForeground, status, stop } from "./lifecycle";

async function main(): Promise<number> {
	const cmd = process.argv[2];
	const config = loadConfig();
	switch (cmd) {
		case "start": {
			const result: LifecycleStartResult = await startDetached(config);
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return 0;
		}
		case "daemonize": {
			await startForeground(config);
			return 0;
		}
		case "stop": {
			const result: LifecycleStopResult = await stop(config);
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return 0;
		}
		case "status": {
			const s: LifecycleStatusResult = status(config);
			process.stdout.write(`${JSON.stringify(s)}\n`);
			return 0;
		}
		default:
			process.stdout.write("usage: bproxy-service <start|stop|status>\n");
			return cmd ? 2 : 0;
	}
}

try {
	const code = await main();
	process.exit(code);
} catch (error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}
