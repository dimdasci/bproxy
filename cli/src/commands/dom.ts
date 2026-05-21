import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Get DOM HTML of the page or a subtree" },
	args: {
		selector: { type: "string", description: "CSS selector to scope extraction" },
		depth: { type: "string", description: "Maximum depth to traverse" },
	},
	run() {},
});
