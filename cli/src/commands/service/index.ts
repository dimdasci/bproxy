import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Manage the bproxy daemon service" },
	subCommands: {
		start: () => import("./start.js").then((m) => m.default),
		stop: () => import("./stop.js").then((m) => m.default),
		status: () => import("./status.js").then((m) => m.default),
		restart: () => import("./restart.js").then((m) => m.default),
		install: () => import("./install.js").then((m) => m.installCommand),
		uninstall: () => import("./install.js").then((m) => m.uninstallCommand),
	},
	run() {},
});
