/* compile-time assertions */
import type {
	Action,
	ActionParams,
	ActionResult,
	DaemonRequestTrace,
	ForwardedActionParams,
	TraceEntry,
} from "./actions";
import type { ErrorCode } from "./errors";
import type { ClientElementTarget } from "./handles";
import type { BproxyForwardedRequest, BproxyRequest } from "./protocol";
import type { PacingMode, SessionId, SessionInfo, TabHandle, TabInfo } from "./sessions";
import type { ElementTarget } from "./targets";

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
type _ClickParams = Expect<Equals<ActionParams["click"], { target: ClientElementTarget }>>;
type _HoverParams = Expect<Equals<ActionParams["hover"], { target: ClientElementTarget }>>;
type _ForwardedClickParams = Expect<
	Equals<ForwardedActionParams["click"], { target: ElementTarget }>
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
type _ClickResult = Expect<
	Equals<ActionResult["click"], { clicked: true; disappeared: boolean; stable: boolean }>
>;
type _HoverResult = Expect<
	Equals<ActionResult["hover"], { hovered: true; stable: boolean; elapsed: number }>
>;
