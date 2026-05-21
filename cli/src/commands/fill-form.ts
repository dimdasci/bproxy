import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Fill multiple form fields" },
	args: {
		json: { type: "string", description: "JSON payload with fields array" },
		file: { type: "string", description: "Read payload from file" },
		stdin: { type: "boolean", description: "Read payload from stdin", default: false },
	},
	run() {},
});
