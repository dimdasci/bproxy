import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Request human intervention" },
	args: {
		reason: { type: "string", description: "Reason for human intervention", required: true },
		"for-attach": { type: "string", description: "Selector string for attach context" },
	},
	run() {},
});
