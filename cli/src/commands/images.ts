import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "List images on the page" },
	args: {
		selector: { type: "string", description: "CSS selector to scope extraction" },
	},
	run() {},
});
