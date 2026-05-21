import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Open a new tab" },
	args: {
		url: { type: "string", description: "URL to open", required: true },
	},
	run() {},
});
