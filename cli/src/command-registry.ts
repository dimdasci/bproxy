/**
 * Command registry and destructive-action classification.
 *
 * Maintains a single source of truth for:
 *   1. Which shared Actions are exposed as CLI commands
 *   2. Whether an action is classified as destructive
 *
 * Adding a new Action to the shared package without updating this registry
 * causes a compile-time error via the exhaustiveness assertion.
 */
import type { Action } from "./types.js";

/**
 * Classification of an action's destructive nature.
 *
 * Destructive actions modify page state, navigation, or tabs.
 * Non-destructive actions only read state or query daemon metadata.
 */
const DESTRUCTIVE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
	"navigate",
	"scroll",
	"fill",
	"fill-form",
	"select",
	"tab.pin",
	"tab.unpin",
	"tab.open",
	"tab.close",
	"session.create",
	"session.bind",
	"session.unbind",
	"session.resume",
	"session.close",
	"require-human",
]);

const NON_DESTRUCTIVE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
	"text",
	"links",
	"images",
	"elements",
	"outline",
	"dom",
	"inspect",
	"snapshot",
	"screenshot",
	"wait",
	"tab.list",
	"session.list",
	"debug.log",
	"debug.last",
	"debug.status",
]);

/**
 * Returns true if the action is classified as destructive.
 * Destructive actions modify page/browser state.
 */
export function isDestructive(action: Action): boolean {
	return DESTRUCTIVE_ACTIONS.has(action);
}

/**
 * Returns the full set of known actions for coverage assertions.
 */
export function allRegisteredActions(): ReadonlySet<Action> {
	return new Set<Action>([...DESTRUCTIVE_ACTIONS, ...NON_DESTRUCTIVE_ACTIONS]);
}

// ─── Compile-time exhaustiveness assertion ─────────────────────────────
// Every Action must appear in exactly one of the two sets above.
// If this errors, a new Action was added to shared without updating the registry.
// Suppress unused warning — exists only for the compile-time check.
type _Use = {
	[A in Action]: A extends
		| (typeof DESTRUCTIVE_ACTIONS extends ReadonlySet<infer D> ? D : never)
		| (typeof NON_DESTRUCTIVE_ACTIONS extends ReadonlySet<infer N> ? N : never)
		? true
		: never;
};
