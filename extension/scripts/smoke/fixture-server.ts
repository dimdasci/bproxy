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
const searchHtml = readFileSync(resolve(here, "fixture.html"), "utf8");
const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");

	if (url.pathname === "/" || url.pathname === "/search") {
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(searchHtml);
		return;
	}

	if (url.pathname.startsWith("/detail/")) {
		const slug = url.pathname.slice("/detail/".length) || "unknown";
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(detailHtml(slug));
		return;
	}

	if (url.pathname === "/health") {
		response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		response.end('{"ok":true}');
		return;
	}

	if (url.pathname === "/favicon.ico") {
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
	const baseUrl = `http://127.0.0.1:${address.port}`;
	process.stdout.write(
		[
			"Smoke fixture ready.",
			`Base URL: ${baseUrl}`,
			`Search URL: ${baseUrl}/search?q=bproxy+smoke`,
			`Detail URL: ${baseUrl}/detail/alpha`,
			"Use the base URL with smoke:workflow after pairing the extension.",
			"Press Ctrl-C to stop the fixture server.",
		].join("\n") + "\n",
	);
}

function detailHtml(slug: string): string {
	const title = escapeHtml(slug.replaceAll("-", " "));
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Detail ${title}</title>
		<style>
			:root {
				color-scheme: light;
				font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}
			body {
				margin: 0;
				background: #f8fafc;
				color: #0f172a;
			}
			main {
				max-width: 48rem;
				margin: 0 auto;
				padding: 2rem 1rem 6rem;
			}
			.card {
				background: white;
				border: 1px solid #cbd5e1;
				border-radius: 0.75rem;
				padding: 1rem;
				box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
			}
		</style>
	</head>
	<body>
		<main>
			<section class="card">
				<h1 id="detail-heading">Detail page for ${title}</h1>
				<p>
					This page exists so the Phase 5 smoke workflow can validate URL-driven navigation
					and rendered-text reads after a fresh <code>tab.open</code> bootstrap.
				</p>
				<p>
					The workflow should navigate here, read <code>main</code>, and then terminate the
					session with <code>session.close</code>.
				</p>
				<p><a href="/search?q=bproxy+smoke">Back to search</a></p>
			</section>
		</main>
	</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
