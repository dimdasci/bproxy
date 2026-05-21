import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Extract visible text from the page" },
	args: {
		selector: { type: "string", description: "CSS selector to scope extraction" },
	},
	run() {},
});
