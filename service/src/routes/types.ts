import type { DaemonRequestTrace } from "@bproxy/shared";
import type { Logger } from "pino";
import type { DebugDeps } from "../debug-actions";
import type { DispatchEngine } from "../dispatch";
import type { ElementHandleCache } from "../element-handles";
import type { PacingEngine } from "../pacing";
import type { SafetyGuards } from "../safety";
import type { SessionRegistry } from "../sessions";

export interface CommandRouteDeps {
	dispatch: DispatchEngine;
	pacing: PacingEngine;
	safety: SafetyGuards;
	logger: Logger;
	debug: DebugDeps;
	sessions: SessionRegistry;
	elementHandles: ElementHandleCache;
	stateDir: string;
	computeOwnerHash: (nick: string) => string;
	trace?: (entry: DaemonRequestTrace) => void;
}
