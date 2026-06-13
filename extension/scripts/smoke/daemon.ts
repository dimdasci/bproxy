import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { trimPnpmDoubleDash } from "./common.ts";

interface PairingCodeAnnouncement {
	pairingCode: string;
	expiresAt: number;
}

const stopSignals = ["SIGINT", "SIGTERM"] as const satisfies readonly NodeJS.Signals[];

const { values } = parseArgs({
	args: trimPnpmDoubleDash(process.argv.slice(2)),
	allowPositionals: true,
	options: {
		home: { type: "string" },
		port: { type: "string", default: "9615" },
		logLevel: { type: "string", default: "warn" },
	},
});

const port = Number.parseInt(values.port, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`--port must be an integer between 1 and 65535, got: ${values.port}`);
}

const home = values.home ?? mkdtempSync(resolve(tmpdir(), "bproxy-smoke-"));
const here = dirname(fileURLToPath(import.meta.url));
const serviceEntry = resolve(here, "../../../service/dist/index.mjs");
const child = spawn(process.execPath, [serviceEntry, "daemonize"], {
	env: {
		...process.env,
		BPROXY_HOME: home,
		BPROXY_PORT: String(port),
		BPROXY_LOG_LEVEL: values.logLevel,
	},
	stdio: ["ignore", "pipe", "inherit"],
});

if (!child.stdout) {
	throw new Error("Failed to capture daemon stdout");
}

let announced = false;
let buffer = "";
let shuttingDown = false;

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
	buffer += chunk;
	while (buffer.includes("\n")) {
		const newlineIndex = buffer.indexOf("\n");
		const line = buffer.slice(0, newlineIndex).trim();
		buffer = buffer.slice(newlineIndex + 1);
		if (!line || announced) continue;
		announce(parsePairingCodeAnnouncement(line));
		announced = true;
	}
});

child.on("exit", (code, signal) => {
	if (shuttingDown) {
		process.exit(code ?? 0);
	}
	if (!announced) {
		process.stderr.write(
			`Smoke daemon exited before announcing a pairing code (code=${code}, signal=${signal ?? "none"}). Did you run pnpm --filter @bproxy/service build?\n`,
		);
	}
	process.exit(code ?? 1);
});

for (const signal of stopSignals) {
	process.once(signal, () => {
		shuttingDown = true;
		child.kill(signal);
	});
}

function announce(info: PairingCodeAnnouncement): void {
	process.stdout.write(
		[
			"Smoke daemon ready.",
			`BPROXY_HOME=${home}`,
			`Port: ${port}`,
			`Pairing code: ${info.pairingCode}`,
			`Expires at: ${info.expiresAt}`,
			"Load extension/.output/chrome-mv3/ in Chrome, open the popup, and pair with this code.",
			"Press Ctrl-C to stop the daemon.",
		].join("\n") + "\n",
	);
}

function parsePairingCodeAnnouncement(raw: string): PairingCodeAnnouncement {
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Daemon startup announcement must be a JSON object");
	}
	const pairingCode = Reflect.get(parsed, "pairingCode");
	const expiresAt = Reflect.get(parsed, "expiresAt");
	if (typeof pairingCode !== "string" || typeof expiresAt !== "number") {
		throw new TypeError("Daemon startup announcement must include pairingCode and expiresAt");
	}
	return { pairingCode, expiresAt };
}
