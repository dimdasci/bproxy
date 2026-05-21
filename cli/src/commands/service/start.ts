import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Start the bproxy daemon" },
	args: {
		port: { type: "string", description: "Port to listen on" },
	},
	run() {},
});
