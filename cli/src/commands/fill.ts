import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Fill a form field" },
	args: {
		selector: { type: "string", description: "CSS selector for the target element" },
		"route-json": { type: "string", description: "JSON route for shadow DOM target" },
		value: { type: "string", description: "Value to fill" },
		"value-file": { type: "string", description: "Read value from file" },
		"value-stdin": {
			type: "boolean",
			description: "Read value from stdin",
			default: false,
		},
		method: {
			type: "string",
			description: "Fill method: direct, paste, or runtime-api",
			required: true,
		},
		world: {
			type: "string",
			description: "Execution world: isolated or main",
			required: true,
		},
	},
	run() {},
});
