/**
 * Version constants — single source of truth for runtime version checks.
 *
 * Package version is kept in sync with root package.json by the release script.
 * Protocol version is independent and changes only on breaking wire format changes.
 */

/** Current bproxy package version (semver). */
export const VERSION = "0.8.0";

/** Protocol version for the daemon↔CLI↔extension wire format. */
export const PROTOCOL_VERSION = 1;
