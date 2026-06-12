import type { DaemonRequestTrace } from "@bproxy/shared";
import type { Logger } from "pino";
import type { DebugDeps } from "../debug-actions";
import type { DispatchEngine } from "../dispatch";
import type { PacingEngine } from "../pacing";
import type { SessionRegistry } from "../sessions";

export interface CommandRouteDeps {
	dispatch: DispatchEngine;
	pacing: PacingEngine;
	logger: Logger;
	debug: DebugDeps;
	sessions: SessionRegistry;
	trace?: (entry: DaemonRequestTrace) => void;
}
