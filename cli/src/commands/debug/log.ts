import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Query extension trace log" },
	args: {
		id: { type: "string", description: "Filter by request ID" },
		limit: { type: "string", description: "Maximum entries to return" },
	},
	run() {},
});
