/**
 * Target parsing helpers for CLI write commands.
 *
 * Accepts exactly one of `--selector <css>` or `--route-json <json>`.
 * Produces a shared `ElementTarget` or an error for exit 2.
 */
import type { ElementRoute, ElementTarget } from "./types.js";

export interface TargetOk {
	ok: true;
	target: ElementTarget;
}

export interface TargetError {
	ok: false;
	reason: string;
}

export type TargetResult = TargetOk | TargetError;

/**
 * Parse an ElementTarget from CLI args.
 *
 * Exactly one of `selector` or `routeJson` must be provided.
 * Providing both or neither is an error.
 */
export function parseTarget(
	selector: string | undefined,
	routeJson: string | undefined,
): TargetResult {
	if (selector && routeJson) {
		return { ok: false, reason: "Provide exactly one of --selector or --route-json, not both." };
	}
	if (!selector && !routeJson) {
		return { ok: false, reason: "Provide exactly one of --selector or --route-json." };
	}

	if (selector) {
		return { ok: true, target: { selector } };
	}

	return parseRouteJson(routeJson as string);
}

/**
 * Parse and validate a --route-json string into an ElementTarget with route.
 */
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

/**
 * Structural check for ElementRoute shape.
 */
function isValidRoute(value: unknown): value is ElementRoute {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;

	if (typeof obj["target"] !== "string" || obj["target"].length === 0) return false;
	if (!Array.isArray(obj["hosts"])) return false;

	return obj["hosts"].every(isValidHost);
}

/**
 * Validate a single host entry in the route.
 */
function isValidHost(host: unknown): boolean {
	if (host === null || typeof host !== "object") return false;
	const h = host as Record<string, unknown>;
	if (typeof h["selector"] !== "string" || h["selector"].length === 0) return false;
	if ("index" in h && typeof h["index"] !== "number") return false;
	return true;
}
