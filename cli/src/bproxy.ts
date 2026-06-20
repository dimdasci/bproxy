import { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
import { defineCommand, runMain } from "citty";

// Handle --version before citty (custom format: "bproxy v0.1.0 (protocol v1)")
if (process.argv.length === 3 && process.argv[2] === "--version") {
	process.stdout.write(`bproxy v${VERSION} (protocol v${PROTOCOL_VERSION})\n`);
	process.exit(0);
}

const main = defineCommand({
	meta: {
		name: "bproxy",
		version: VERSION,
		description: "Browser proxy CLI for code agents",
	},
	args: {
		nick: {
			type: "string",
			alias: "n",
			description: "Agent nickname for request scoping",
		},
		session: {
			type: "string",
			alias: "s",
			description: "Session ID for the request",
		},
		timeout: {
			type: "string",
			description: "Protocol deadline in milliseconds",
		},
		home: {
			type: "string",
			description: "Override BPROXY_HOME state directory",
		},
		verbose: {
			type: "boolean",
			alias: "v",
			description: "Write structured diagnostics to stderr",
			default: false,
		},
	},
	subCommands: {
		navigate: () => import("./commands/navigate.js").then((m) => m.default),
		text: () => import("./commands/text.js").then((m) => m.default),
		links: () => import("./commands/links.js").then((m) => m.default),
		images: () => import("./commands/images.js").then((m) => m.default),
		elements: () => import("./commands/elements.js").then((m) => m.default),
		outline: () => import("./commands/outline.js").then((m) => m.default),
		dom: () => import("./commands/dom.js").then((m) => m.default),
		inspect: () => import("./commands/inspect.js").then((m) => m.default),
		snapshot: () => import("./commands/snapshot.js").then((m) => m.default),
		scroll: () => import("./commands/scroll.js").then((m) => m.default),
		click: () => import("./commands/click.js").then((m) => m.default),
		hover: () => import("./commands/hover.js").then((m) => m.default),
		screenshot: () => import("./commands/screenshot.js").then((m) => m.default),
		fill: () => import("./commands/fill.js").then((m) => m.default),
		"fill-form": () => import("./commands/fill-form.js").then((m) => m.default),
		select: () => import("./commands/select.js").then((m) => m.default),
		wait: () => import("./commands/wait.js").then((m) => m.default),
		"require-human": () => import("./commands/require-human.js").then((m) => m.default),
		status: () => import("./commands/status.js").then((m) => m.default),
		doctor: () => import("./commands/doctor.js").then((m) => m.default),
		service: () => import("./commands/service/index.js").then((m) => m.default),
		session: () => import("./commands/session.js").then((m) => m.default),
		tab: () => import("./commands/tab.js").then((m) => m.default),
		debug: () => import("./commands/debug.js").then((m) => m.default),
	},
});

void runMain(main); // NOSONAR — required by eslint no-floating-promises
