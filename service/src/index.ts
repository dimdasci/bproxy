import { loadConfig } from "./config";
import { startDetached, startForeground, status, stop } from "./lifecycle";

async function main(): Promise<number> {
	const cmd = process.argv[2];
	const config = loadConfig();
	switch (cmd) {
		case "start": {
			await startDetached(config);
			return 0;
		}
		case "daemonize": {
			await startForeground(config);
			return 0;
		}
		case "stop": {
			await stop(config);
			return 0;
		}
		case "status": {
			const s = status(config);
			process.stdout.write(`${JSON.stringify(s)}\n`);
			return 0;
		}
		default:
			process.stdout.write("usage: bproxy-service <start|stop|status>\n");
			return cmd ? 2 : 0;
	}
}

void main()
	.then((code) => process.exit(code))
	.catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exit(1);
	});
