/** Role and tag lookup tables for the snapshot action. */

export const NOISE_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

export const IMPLICIT_ROLES: Record<string, string> = {
	a: "link",
	button: "button",
	h1: "heading",
	h2: "heading",
	h3: "heading",
	h4: "heading",
	h5: "heading",
	h6: "heading",
	img: "img",
	input: "textbox",
	select: "combobox",
	textarea: "textbox",
	nav: "navigation",
	main: "main",
	aside: "complementary",
	header: "banner",
	footer: "contentinfo",
	section: "section",
	ul: "list",
	ol: "list",
	li: "listitem",
	table: "table",
	form: "form",
	dialog: "dialog",
	article: "article",
	search: "search",
};

export const INPUT_TYPE_ROLES: Record<string, string> = {
	checkbox: "checkbox",
	radio: "radio",
	submit: "button",
	button: "button",
	reset: "button",
	range: "slider",
	number: "spinbutton",
	search: "searchbox",
};

export const INTERACTIVE_TAGS = new Set([
	"a",
	"button",
	"input",
	"select",
	"textarea",
	"details",
	"summary",
]);

export const INTERACTIVE_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"combobox",
	"checkbox",
	"radio",
	"switch",
	"tab",
	"menuitem",
	"option",
	"slider",
	"spinbutton",
	"searchbox",
]);

export const TEXT_NAME_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "a", "button"]);
export const PLACEHOLDER_TAGS = new Set(["input", "textarea"]);
