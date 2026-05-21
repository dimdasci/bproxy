import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Show recent daemon requests" },
	args: {
		count: { type: "string", description: "Number of recent requests to show" },
	},
	run() {},
});
