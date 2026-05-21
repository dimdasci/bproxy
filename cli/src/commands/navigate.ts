import { defineCommand } from "citty";
import type { Action } from "../types.js";

const action: Action = "navigate";

export default defineCommand({
	meta: { description: "Navigate to a URL" },
	args: {
		url: { type: "string", description: "Target URL", required: true },
	},
	run() {
		void action;
	},
});
