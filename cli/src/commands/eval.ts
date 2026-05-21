import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Evaluate JavaScript in the page" },
	args: {
		"allow-eval": {
			type: "boolean",
			description: "Explicit opt-in to eval execution",
			required: true,
		},
		code: { type: "string", description: "JavaScript code to evaluate" },
		file: { type: "string", description: "Read code from file" },
		stdin: { type: "boolean", description: "Read code from stdin", default: false },
	},
	run() {},
});
