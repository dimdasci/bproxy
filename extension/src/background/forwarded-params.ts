import type { ActionParams, BproxyForwardedRequest } from "@bproxy/shared";
import type { ForwardedAction } from "./forwarded-actions";

export function paramsValidForAction<A extends ForwardedAction>(
	action: A,
	value: unknown,
): value is ActionParams[A] {
	const validators: { [K in ForwardedAction]: (input: unknown) => input is ActionParams[K] } = {
		navigate: isNavigateParams,
		text: isSelectorParams,
		links: isLinksParams,
		images: isSelectorParams,
		elements: isElementsParams,
		outline: isEmptyParams,
		dom: isDomParams,
		scroll: isScrollParams,
		screenshot: isScreenshotParams,
		fill: isFillParams,
		"fill-form": isFillFormParams,
		select: isSelectParams,
		wait: isWaitParams,
		"require-human": isRequireHumanParams,
		"tab.pin": isOptionalTabHandleParams,
		"tab.unpin": isOptionalTabHandleParams,
		"tab.open": isNavigateParams,
		"tab.close": isOptionalTabHandleParams,
		"debug.log": isDebugLogParams,
	};
	return validators[action](value);
}

function isNavigateParams(value: unknown): value is ActionParams["navigate"] {
	return isStrictObject(value, ["url"]) && typeof value["url"] === "string";
}

function isSelectorParams(value: unknown): value is ActionParams["text"] {
	return isOptionalStringObject(value, ["selector"]);
}

function isLinksParams(value: unknown): value is ActionParams["links"] {
	return (
		isStrictObject(value, ["selector", "visibleOnly", "limit"]) &&
		(value["selector"] === undefined || typeof value["selector"] === "string") &&
		(value["visibleOnly"] === undefined || typeof value["visibleOnly"] === "boolean") &&
		(value["limit"] === undefined || isInteger(value["limit"]))
	);
}

function isElementsParams(value: unknown): value is ActionParams["elements"] {
	return isOptionalBooleanObject(value, ["form"]);
}

function isEmptyParams(value: unknown): value is Record<string, never> {
	return isStrictObject(value, []);
}

function isDomParams(value: unknown): value is ActionParams["dom"] {
	return (
		isStrictObject(value, ["selector", "depth"]) &&
		(value["selector"] === undefined || typeof value["selector"] === "string") &&
		(value["depth"] === undefined || isInteger(value["depth"]))
	);
}

function isScrollParams(value: unknown): value is ActionParams["scroll"] {
	return (
		isStrictObject(value, ["by", "direction", "untilStable"]) &&
		(value["by"] === undefined || typeof value["by"] === "string") &&
		(value["direction"] === undefined ||
			value["direction"] === "up" ||
			value["direction"] === "down") &&
		(value["untilStable"] === undefined || typeof value["untilStable"] === "boolean")
	);
}

function isScreenshotParams(value: unknown): value is ActionParams["screenshot"] {
	return isOptionalBooleanObject(value, ["activate", "debugger"]);
}

function isFillParams(value: unknown): value is ActionParams["fill"] {
	return (
		isStrictObject(value, ["target", "value", "method", "world"]) &&
		isElementTarget(value["target"]) &&
		typeof value["value"] === "string" &&
		(value["method"] === "direct" ||
			value["method"] === "paste" ||
			value["method"] === "runtime-api") &&
		(value["world"] === "isolated" || value["world"] === "main")
	);
}

function isFillFormParams(value: unknown): value is ActionParams["fill-form"] {
	return (
		isStrictObject(value, ["fields"]) &&
		Array.isArray(value["fields"]) &&
		value["fields"].every(
			(field) =>
				isStrictObject(field, ["target", "value", "method", "world"]) &&
				isElementTarget(field["target"]) &&
				typeof field["value"] === "string" &&
				(field["method"] === "direct" ||
					field["method"] === "paste" ||
					field["method"] === "runtime-api") &&
				(field["world"] === "isolated" || field["world"] === "main"),
		)
	);
}

function isSelectParams(value: unknown): value is ActionParams["select"] {
	return (
		isStrictObject(value, ["trigger", "optionText"]) &&
		isElementTarget(value["trigger"]) &&
		typeof value["optionText"] === "string"
	);
}

function isWaitParams(value: unknown): value is ActionParams["wait"] {
	return (
		isStrictObject(value, ["strategy", "target", "timeout"]) &&
		(value["strategy"] === "selector" ||
			value["strategy"] === "url" ||
			value["strategy"] === "navigation") &&
		typeof value["target"] === "string" &&
		(value["timeout"] === undefined || isInteger(value["timeout"]))
	);
}

function isRequireHumanParams(value: unknown): value is ActionParams["require-human"] {
	return (
		isStrictObject(value, ["reason", "forAttach"]) &&
		typeof value["reason"] === "string" &&
		(value["forAttach"] === undefined || typeof value["forAttach"] === "string")
	);
}

function isOptionalTabHandleParams(value: unknown): value is ActionParams["tab.pin"] {
	return (
		isStrictObject(value, ["tab"]) &&
		(value["tab"] === undefined ||
			(typeof value["tab"] === "string" && /^t[1-9]\d*$/.test(value["tab"])))
	);
}

function isDebugLogParams(value: unknown): value is ActionParams["debug.log"] {
	return (
		isStrictObject(value, ["id", "limit"]) &&
		(value["id"] === undefined || typeof value["id"] === "string") &&
		(value["limit"] === undefined || isInteger(value["limit"]))
	);
}

function isElementTarget(value: unknown): value is ActionParams["fill"]["target"] {
	if (!isRecord(value)) return false;
	if (hasOnlyKeys(value, ["selector"])) {
		return typeof value["selector"] === "string";
	}
	if (hasOnlyKeys(value, ["route"])) {
		return isElementRoute(value["route"]);
	}
	return false;
}

function isElementRoute(value: unknown): boolean {
	if (!isStrictObject(value, ["hosts", "target"])) return false;
	if (!Array.isArray(value["hosts"])) return false;
	if (typeof value["target"] !== "string") return false;
	return value["hosts"].every(
		(host) =>
			isStrictObject(host, ["selector", "index"]) &&
			typeof host["selector"] === "string" &&
			(host["index"] === undefined || isInteger(host["index"])),
	);
}

function isOptionalStringObject(value: unknown, keys: string[]): boolean {
	if (!isStrictObject(value, keys)) return false;
	return keys.every((key) => {
		const field = value[key];
		return field === undefined || typeof field === "string";
	});
}

function isOptionalBooleanObject(value: unknown, keys: string[]): boolean {
	if (!isStrictObject(value, keys)) return false;
	return keys.every((key) => {
		const field = value[key];
		return field === undefined || typeof field === "boolean";
	});
}

function isStrictObject(value: unknown, keys: string[]): value is Record<string, unknown> {
	return isRecord(value) && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

export function isTarget(value: unknown): value is BproxyForwardedRequest["target"] {
	return isStrictObject(value, ["tabId"]) && (value["tabId"] === null || isInteger(value["tabId"]));
}
