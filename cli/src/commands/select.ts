import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Select an option from a dropdown" },
	args: {
		selector: { type: "string", description: "CSS selector for the trigger element" },
		"route-json": { type: "string", description: "JSON route for shadow DOM target" },
		"option-text": {
			type: "string",
			description: "Text of the option to select",
			required: true,
		},
	},
	run() {},
});
