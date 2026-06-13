/**
 * Target parsing helpers for CLI write commands.
 *
 * Accepts exactly one of `--selector <css>`, `--route-json <json>`,
 * or `--element <handle>`.
 */
import { HANDLE_PATTERN } from "@bproxy/shared";
import type { ClientElementTarget, ElementHandle, ElementRoute } from "./types.js";

export interface TargetOk {
	ok: true;
	target: ClientElementTarget;
}

export interface TargetError {
	ok: false;
	reason: string;
}

export type TargetResult = TargetOk | TargetError;

export type OptionalTargetResult = TargetResult | { ok: true; target: undefined };

export function parseOptionalTarget(
	selector: string | undefined,
	routeJson: string | undefined,
	element: string | undefined,
): OptionalTargetResult {
	if (!selector && !routeJson && !element) return { ok: true, target: undefined };
	return parseTarget(selector, routeJson, element);
}

export function parseTarget(
	selector: string | undefined,
	routeJson: string | undefined,
	element: string | undefined,
): TargetResult {
	const provided = [selector, routeJson, element].filter((value) => value !== undefined).length;
	if (provided !== 1) {
		return {
			ok: false,
			reason: "Provide exactly one of --selector, --route-json, or --element.",
		};
	}

	if (selector) return { ok: true, target: { selector } };
	if (element) return parseElementHandle(element);
	return parseRouteJson(routeJson as string);
}

function parseElementHandle(handle: string): TargetResult {
	if (!HANDLE_PATTERN.test(handle)) {
		return {
			ok: false,
			reason: String.raw`Invalid --element: must match /^(el|ln)\d+$/.`,
		};
	}
	return { ok: true, target: { handle: handle as ElementHandle } };
}

function parseRouteJson(json: string): TargetResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, reason: "Invalid --route-json: not valid JSON." };
	}

	if (!isValidRoute(parsed)) {
		return {
			ok: false,
			reason:
				'Invalid --route-json: must be { "hosts": [{ "selector": "...", "index?": N }], "target": "..." }.',
		};
	}

	return { ok: true, target: { route: parsed } };
}

function isValidRoute(value: unknown): value is ElementRoute {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;

	if (typeof obj["target"] !== "string" || obj["target"].length === 0) return false;
	if (!Array.isArray(obj["hosts"])) return false;

	return obj["hosts"].every(isValidHost);
}

function isValidHost(host: unknown): boolean {
	if (host === null || typeof host !== "object") return false;
	const entry = host as Record<string, unknown>;
	if (typeof entry["selector"] !== "string" || entry["selector"].length === 0) return false;
	if ("index" in entry && typeof entry["index"] !== "number") return false;
	return true;
}
