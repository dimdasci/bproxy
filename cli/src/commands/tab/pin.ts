import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Pin a tab" },
	args: {
		"tab-id": { type: "string", description: "Tab ID to pin" },
	},
	run() {},
});
