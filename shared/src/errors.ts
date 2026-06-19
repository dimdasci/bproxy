export type ErrorCode =
	// Transport
	| "NO_EXTENSION"
	| "TIMEOUT"
	| "OVERLOADED"
	| "WS_DISCONNECTED"
	// Target
	| "TAB_NOT_FOUND"
	| "ELEMENT_NOT_FOUND"
	| "ELEMENT_NOT_ACTIONABLE"
	| "SELECTOR_AMBIGUOUS"
	| "INVALID_SESSION_ID"
	// Well-formed session ids that do not resolve are terminal: callers must
	// create a new session rather than retrying the old id.
	| "SESSION_NOT_FOUND"
	| "TAB_HANDLE_NOT_FOUND"
	| "TAB_NOT_IN_SESSION"
	| "ELEMENT_HANDLE_NOT_FOUND"
	| "ELEMENT_HANDLE_STALE"
	| "ELEMENT_HANDLE_SCOPE_MISMATCH"
	// Policy
	| "HUMAN_REQUIRED"
	| "DEBUGGER_DISABLED"
	| "SESSION_REQUIRED"
	| "SESSION_SCOPE_MISMATCH"
	| "METRONOME_DETECTED"
	| "RATE_LIMITED"
	// Execution
	| "SCRIPT_ERROR"
	| "NAVIGATION_FAILED"
	| "TAB_NOT_VISIBLE";

export type ErrorCategory = "transport" | "target" | "policy" | "execution";

export type RetryHint = "safe" | "conditional" | "never";

export interface BproxyError {
	code: ErrorCode;
	category: ErrorCategory;
	retry: RetryHint;
	message: string;
	suggestedAction?: string;
	details?: Record<string, unknown>;
}
