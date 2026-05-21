import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Debug and observability commands" },
	subCommands: {
		log: () => import("./debug/log.js").then((m) => m.default),
		last: () => import("./debug/last.js").then((m) => m.default),
		status: () => import("./debug/status.js").then((m) => m.default),
	},
	run() {},
});
