import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Manage sessions" },
	subCommands: {
		create: () => import("./session/create.js").then((m) => m.default),
		list: () => import("./session/list.js").then((m) => m.default),
		bind: () => import("./session/bind.js").then((m) => m.default),
		unbind: () => import("./session/unbind.js").then((m) => m.default),
		resume: () => import("./session/resume.js").then((m) => m.default),
		close: () => import("./session/close.js").then((m) => m.default),
	},
	run() {},
});
