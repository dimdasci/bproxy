import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Bind session to a tab" },
	args: {
		"tab-id": { type: "string", description: "Tab ID to bind", required: true },
		pacing: { type: "string", description: "Pacing mode: human or fast" },
	},
	run() {},
});
