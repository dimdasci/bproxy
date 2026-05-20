import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { trimPnpmDoubleDash } from "./common.ts";

const stopSignals = ["SIGINT", "SIGTERM"] as const satisfies readonly NodeJS.Signals[];

const { values } = parseArgs({
	args: trimPnpmDoubleDash(process.argv.slice(2)),
	allowPositionals: true,
	options: {
		port: { type: "string", default: "0" },
	},
});

const port = Number.parseInt(values.port, 10);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
	throw new Error(`--port must be an integer between 0 and 65535, got: ${values.port}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, "fixture.html"), "utf8");
const server = createServer((request, response) => {
	if (!request.url || request.url === "/") {
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(html);
		return;
	}

	if (request.url === "/health") {
		response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		response.end('{"ok":true}');
		return;
	}

	if (request.url === "/favicon.ico") {
		response.writeHead(204);
		response.end();
		return;
	}

	response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
	response.end("not found");
});

server.listen(port, "127.0.0.1", () => {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to resolve fixture server address");
	}
	announce(address);
});

for (const signal of stopSignals) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
	});
}

function announce(address: AddressInfo): void {
	process.stdout.write(
		[
			"Smoke fixture ready.",
			`URL: http://127.0.0.1:${address.port}/`,
			"Keep this tab active while running the smoke workflow.",
			"Press Ctrl-C to stop the fixture server.",
		].join("\n") + "\n",
	);
}
