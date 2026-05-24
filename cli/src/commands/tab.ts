import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Manage browser tabs" },
	subCommands: {
		list: () => import("./tab/list.js").then((m) => m.default),
		pin: () => import("./tab/pin.js").then((m) => m.default),
		unpin: () => import("./tab/unpin.js").then((m) => m.default),
		open: () => import("./tab/open.js").then((m) => m.default),
		close: () => import("./tab/close.js").then((m) => m.default),
	},
	run() {},
});
