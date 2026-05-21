import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Close a tab" },
	args: {
		"tab-id": { type: "string", description: "Tab ID to close" },
	},
	run() {},
});
