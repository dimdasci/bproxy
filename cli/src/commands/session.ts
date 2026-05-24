import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Manage sessions" },
	subCommands: {
		list: () => import("./session/list.js").then((m) => m.default),
		bind: () => import("./session/bind.js").then((m) => m.default),
		unbind: () => import("./session/unbind.js").then((m) => m.default),
		resume: () => import("./session/resume.js").then((m) => m.default),
	},
	run() {},
});
