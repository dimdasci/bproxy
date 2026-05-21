import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Take a screenshot of the page" },
	args: {
		activate: {
			type: "boolean",
			description: "Activate the tab before capture",
			default: false,
		},
		debugger: {
			type: "boolean",
			description: "Use debugger protocol for capture",
			default: false,
		},
	},
	run() {},
});
