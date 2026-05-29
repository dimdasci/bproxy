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
	| "SESSION_NOT_FOUND"
	| "TAB_HANDLE_NOT_FOUND"
	| "TAB_NOT_IN_SESSION"
	// Policy
	| "HUMAN_REQUIRED"
	| "EVAL_DISABLED"
	| "DEBUGGER_DISABLED"
	| "SESSION_REQUIRED"
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
