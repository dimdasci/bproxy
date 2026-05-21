import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Wait for a condition on the page" },
	args: {
		strategy: {
			type: "string",
			description: "Wait strategy: selector, url, or navigation",
			required: true,
		},
		target: { type: "string", description: "Target value for the strategy", required: true },
		timeout: { type: "string", description: "Timeout in milliseconds" },
	},
	run() {},
});
