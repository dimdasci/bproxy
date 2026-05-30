import type { BproxyError } from "@bproxy/shared";
import { resolveSelectorTarget } from "./targeting";

export function resolveReadRoot(selector: string | undefined, document: Document): Element {
	if (selector) return resolveSelectorTarget(selector, { document });
	const root = document.body ?? document.documentElement;
	if (root) return root;
	throw elementNotFound("Document body is not available");
}

function elementNotFound(message: string): BproxyError {
	return {
		code: "ELEMENT_NOT_FOUND",
		category: "target",
		retry: "conditional",
		message,
	};
}
