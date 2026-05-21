import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "List interactive elements on the page" },
	args: {
		form: { type: "boolean", description: "Show only form elements", default: false },
	},
	run() {},
});
