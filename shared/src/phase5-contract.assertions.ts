/* eslint-disable @typescript-eslint/no-unused-vars -- compile-time assertions */
import type { Action, ActionParams, ActionResult, DaemonRequestTrace, TraceEntry } from "./actions";
import type { ErrorCode } from "./errors";
import type { BproxyForwardedRequest, BproxyRequest } from "./protocol";
import type { PacingMode, SessionId, SessionInfo, TabHandle, TabInfo } from "./sessions";

type Equals<A, B> = ((<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: false) &
	((<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2 ? true : false);
type Expect<T extends true> = T;

type _SessionCreateParams = Expect<Equals<ActionParams["session.create"], { label?: string }>>;
type _SessionCloseParams = Expect<Equals<ActionParams["session.close"], Record<string, never>>>;
type _LinksParams = Expect<
	Equals<ActionParams["links"], { selector?: string; visibleOnly?: boolean; limit?: number }>
>;
type _TabPinUsesLogicalHandle = Expect<Equals<ActionParams["tab.pin"], { tab?: TabHandle }>>;
type _TabCloseUsesLogicalHandle = Expect<Equals<ActionParams["tab.close"], { tab?: TabHandle }>>;
type _BindUsesLogicalTab = Expect<
	Equals<ActionParams["session.bind"], { tab: TabHandle; pacing?: PacingMode }>
>;
type _TabOpenUsesLogicalHandles = Expect<
	Equals<
		ActionResult["tab.open"],
		{ session: SessionId; tab: TabHandle; bound: boolean; url: string }
	>
>;
type _TabListIsScoped = Expect<
	Equals<ActionResult["tab.list"], { session: SessionId; tabs: Array<TabInfo> }>
>;
type _TabPinResultUsesLogicalHandle = Expect<
	Equals<ActionResult["tab.pin"], { tab: TabHandle; pinned: true }>
>;
type _TabCloseResultUsesLogicalHandle = Expect<
	Equals<ActionResult["tab.close"], { tab: TabHandle; closed: true }>
>;
type _SessionInfoUsesLogicalBinding = Expect<
	Equals<SessionInfo["tab"], TabHandle | null> & Equals<SessionInfo["id"], SessionId>
>;
type _RequestUsesSessionId = Expect<Equals<BproxyRequest["session"], SessionId>>;
type _TraceUsesNarrowActionAndErrorCode = Expect<
	Equals<TraceEntry["action"], Action> &
		Equals<TraceEntry["errorCode"], ErrorCode | undefined> &
		Equals<DaemonRequestTrace["action"], Action> &
		Equals<DaemonRequestTrace["errorCode"], ErrorCode | undefined>
>;
type _TabInfoUsesLogicalHandle = Expect<Equals<TabInfo["tab"], TabHandle>>;
type _ForwardedTargetAllowsNull = Expect<
	Equals<BproxyForwardedRequest["target"]["tabId"], number | null>
>;
type _DebugStatusExposesSessionTabs = Expect<
	Equals<
		ActionResult["debug.status"]["sessionTabs"][number],
		{ session: SessionId; tabs: Array<TabInfo> }
	>
>;
