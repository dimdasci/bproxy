import { defineCommand } from "citty";

export default defineCommand({
	meta: { description: "Scroll the page" },
	args: {
		by: { type: "string", description: "Scroll amount (e.g. 'page', '500px')" },
		direction: { type: "string", description: "Scroll direction: up or down" },
		"until-stable": {
			type: "boolean",
			description: "Scroll until position stabilizes",
			default: false,
		},
	},
	run() {},
});
