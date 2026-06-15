---
title: Shared Types
---

The `shared/` package defines the TypeScript types that form the contract between CLI, daemon, and extension. All three components import from this package. No runtime code — types only (plus a few const enums/objects that inline at compile time).

**Decisions that constrain this:** ADR-005 (TypeScript).

## Project Layout

```
shared/
├── package.json              # name: "@bproxy/shared", no runtime deps
├── tsconfig.json
└── src/
    ├── index.ts              # re-exports
    ├── protocol.ts           # request/response envelope
    ├── actions.ts            # action names, per-action params and results
    ├── handles.ts            # daemon-owned element handle aliases at the CLI/daemon boundary
    ├── errors.ts             # error codes, categories, structured error shape
    └── sessions.ts           # session/tab identifiers, pacing config
```

## Protocol Envelope

```typescript
// src/protocol.ts
import type { Action, ActionParams, ActionResult } from './actions';
import type { BproxyError } from './errors';
import type { SessionId } from './sessions';

export interface BproxyRequest<A extends Action = Action> {
  protocol_version: 1;
  id: string;
  action: A;
  params: ActionParams[A];
  session: SessionId;
  deadline: number;       // unix ms
  destructive: boolean;
}

// Daemon → extension wire shape. The CLI's HTTP input is `BproxyRequest`;
// the daemon owns the mapping session → tabId and wraps the request with
// `target.tabId` at the dispatch site. Only forwarded actions use this shape —
// daemon-local actions (session.*, debug.last, debug.status) never carry a target.
//
// `target.tabId` may be `null` for background-handled actions that do not
// require an existing tab (tab.open, tab.list, tab.close).
export type BproxyForwardedRequest<A extends Action = Action> = BproxyRequest<A> & {
  target: { tabId: number | null };
};

export interface BproxySuccessResponse<A extends Action = Action> {
  protocol_version: 1;
  id: string;
  ok: true;
  data: ActionResult[A];
  page: PageState;
  replay: boolean;
}

export interface BproxyErrorResponse {
  protocol_version: 1;
  id: string;
  ok: false;
  error: BproxyError;
}

export type BproxyResponse<A extends Action = Action> =
  | BproxySuccessResponse<A>
  | BproxyErrorResponse;

export interface PageState {
  url: string;
  title: string;
  state: 'loading' | 'ready' | 'error';
  busy: boolean;
}
```

## Actions — Discriminated Union

```typescript
// src/actions.ts
export type Action =
  | 'navigate'
  | 'text'
  | 'links'
  | 'images'
  | 'elements'
  | 'outline'
  | 'dom'
  | 'inspect'
  | 'snapshot'
  | 'scroll'
  | 'click'
  | 'hover'
  | 'screenshot'
  | 'fill'
  | 'fill-form'
  | 'select'
  | 'wait'
  | 'require-human'
  | 'tab.list' | 'tab.pin' | 'tab.unpin' | 'tab.open' | 'tab.close'
  | 'session.create' | 'session.list' | 'session.bind'
  | 'session.unbind' | 'session.resume' | 'session.close'
  | 'debug.log' | 'debug.last' | 'debug.status';

// Types for fill methods and world
export type FillMethod = 'direct' | 'paste' | 'runtime-api';
export type ExecutionWorld = 'isolated' | 'main';

// Shadow-DOM route representation (ADR-014)
export interface ElementRoute {
  hosts: Array<{ selector: string; index?: number }>;  // shadow host chain from document
  target: string;  // selector within deepest shadow root
}

// Target must be exactly one strategy: light-DOM selector or shadow route
export type ElementTarget =
  | { selector: string; route?: never }
  | { selector?: never; route: ElementRoute };

// Short-lived daemon-owned alias, accepted only at the CLI/daemon boundary.
export type ElementHandle = string & { readonly __brand: 'ElementHandle' };
export interface ElementHandleRef { handle: ElementHandle }
export type ClientElementTarget = ElementTarget | ElementHandleRef;

// Params per action — exhaustive, compiler-checked
export interface ActionParams {
  navigate: { url: string };
  text: { selector?: string };
  links: { selector?: string; visibleOnly?: boolean; limit?: number };
  images: { selector?: string };
  elements: { form?: boolean };
  outline: Record<string, never>;
  dom: { selector?: string; depth?: number };
  inspect: { selector: string; properties?: string[]; limit?: number };
  snapshot: { selector?: string; maxDepth?: number; interactiveOnly?: boolean };
  scroll: { target?: ClientElementTarget; by?: string; direction?: 'up' | 'down' };
  click: { target: ClientElementTarget };
  hover: { target: ClientElementTarget };
  screenshot: { activate?: boolean; debugger?: boolean };
  fill: {
    target: ClientElementTarget;
    value: string;
    method: FillMethod;    // NOT optional — agent must choose
    world: ExecutionWorld; // NOT optional — 'isolated' or 'main'
  };
  'fill-form': {
    fields: Array<{
      target: ClientElementTarget;
      value: string;
      method: FillMethod;
      world: ExecutionWorld;
    }>
  };
  select: { trigger: ClientElementTarget; optionText: string };
  wait: { strategy: 'selector' | 'url' | 'navigation'; target: string; timeout?: number };
  'require-human': { reason: string; forAttach?: string };
  'tab.list': Record<string, never>;
  'tab.pin': { tab?: TabHandle };
  'tab.unpin': { tab?: TabHandle };
  'tab.open': { url: string };
  'tab.close': { tab?: TabHandle };
  'session.create': { label?: string };
  'session.list': Record<string, never>;
  'session.bind': { tab: TabHandle; pacing?: PacingMode };
  'session.unbind': Record<string, never>;
  'session.resume': Record<string, never>;
  'session.close': Record<string, never>;
  'debug.log': { id?: string; limit?: number };
  'debug.last': { count?: number };
  'debug.status': Record<string, never>;
}

// Results per action — what data contains on success
export interface ActionResult {
  navigate: { url: string; title: string; loadTime: number };
  text: { text: string };
  links: { links: Array<LinkInfo> };
  images: { images: Array<{ src: string; alt: string; width: number; height: number }> };
  elements: { elements: Array<ElementInfo> };
  outline: { landmarks: Array<Landmark>; headings: Array<Heading> };
  dom: { html: string };
  inspect: { elements: Array<InspectElement>; total: number };
  snapshot: { tree: string; nodeCount: number };
  scroll: {
    target: 'viewport' | 'element';
    before: number;
    after: number;
    scrolledPx: number;
    moved: boolean;
    stable: boolean;
    scrollHeight?: number;
    clientHeight?: number;
  };
  click: { clicked: true; disappeared: boolean; stable: boolean };
  hover: { hovered: true; stable: boolean; elapsed: number };
  screenshot: { base64: string; format: 'png' | 'jpeg' };
  fill: { filled: boolean; verifiedValue: string };
  'fill-form': { results: Array<{ target: ElementTarget; filled: boolean; verifiedValue: string }> };
  select: { selected: boolean; optionText: string };
  wait: { matched: boolean; elapsed: number };
  'require-human': { resumed: boolean };
  'tab.list': { session: SessionId; tabs: Array<TabInfo> };
  'tab.pin': { tab: TabHandle; pinned: true };
  'tab.unpin': { tab: TabHandle; pinned: false };
  'tab.open': { session: SessionId; tab: TabHandle; bound: boolean; url: string };
  'tab.close': { tab: TabHandle; closed: true };
  'session.create': { session: SessionId; label?: string };
  'session.list': { sessions: Array<SessionInfo> };
  'session.bind': { session: SessionId; tab: TabHandle };
  'session.unbind': Record<string, never>;
  'session.resume': { session: SessionId };
  'session.close': { session: SessionId; closedTabs: number };
  'debug.log': { entries: Array<TraceEntry> };
  'debug.last': { requests: Array<DaemonRequestTrace> };
  'debug.status': {
    daemon: { pid: number; port: number; uptimeSec: number; version: string; protocolVersion: number };
    wsClients: Array<{ id: string; connectedAt: number; protocolVersion: number }>;
    sessions: Array<SessionInfo>;
    sessionTabs: Array<{ session: SessionId; tabs: Array<TabInfo> }>;
    pausedSessions: Array<{ session: SessionId; reason?: string }>;
  };
}
```

Adding a new action requires updating `Action`, `ActionParams`, and `ActionResult`. The compiler forces all consumers (CLI command, daemon dispatch, extension handler) to handle it.

## Error Taxonomy

```typescript
// src/errors.ts
export type ErrorCode =
  // Transport
  | 'NO_EXTENSION'
  | 'TIMEOUT'
  | 'OVERLOADED'
  | 'WS_DISCONNECTED'
  // Target
  | 'TAB_NOT_FOUND'
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_ACTIONABLE'
  | 'SELECTOR_AMBIGUOUS'
  | 'INVALID_SESSION_ID'
  | 'SESSION_NOT_FOUND'
  | 'TAB_HANDLE_NOT_FOUND'
  | 'TAB_NOT_IN_SESSION'
  | 'ELEMENT_HANDLE_NOT_FOUND'
  | 'ELEMENT_HANDLE_STALE'
  | 'ELEMENT_HANDLE_SCOPE_MISMATCH'
  // Policy
  | 'HUMAN_REQUIRED'
  | 'DEBUGGER_DISABLED'
  | 'SESSION_REQUIRED'
  // Execution
  | 'SCRIPT_ERROR'
  | 'NAVIGATION_FAILED'
  | 'TAB_NOT_VISIBLE';

export type ErrorCategory = 'transport' | 'target' | 'policy' | 'execution';

export type RetryHint = 'safe' | 'conditional' | 'never';

export interface BproxyError {
  code: ErrorCode;
  category: ErrorCategory;
  retry: RetryHint;
  message: string;
  suggestedAction?: string;
  details?: Record<string, unknown>;
}
```

## Session and Tab Identifiers

```typescript
// src/sessions.ts

// Branded types — prevent accidental string/number interchange
declare const sessionIdBrand: unique symbol;
declare const tabHandleBrand: unique symbol;

// 6-character base32 lowercase, e.g. "m4q7z2"
export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };

// Session-scoped logical handle, e.g. "t1", "t2"
export type TabHandle = `t${number}` & { readonly [tabHandleBrand]: 'TabHandle' };

export type PacingMode = 'human' | 'fast';

export interface PacingConfig {
  navigate: { min: number; max: number };
  scroll: { min: number; max: number };
  interaction: { min: number; max: number };
  fill: { min: number; max: number };
}

export const PACING_PRESETS: Record<PacingMode, PacingConfig> = {
  human: {
    navigate: { min: 1500, max: 4000 },
    scroll: { min: 4000, max: 8000 },
    interaction: { min: 500, max: 2000 },
    fill: { min: 500, max: 2000 },
  },
  fast: {
    navigate: { min: 300, max: 800 },
    scroll: { min: 500, max: 1500 },
    interaction: { min: 100, max: 400 },
    fill: { min: 100, max: 400 },
  },
};

export interface SessionInfo {
  id: SessionId;
  label?: string;
  tab: TabHandle | null;   // bound logical tab, or null if unbound
  pacing: PacingMode;
  paused: boolean;
  pauseReason?: string;
}

export interface TabInfo {
  tab: TabHandle;          // logical handle, never a raw Chrome id
  url: string;
  title: string;
  bound: boolean;          // true if this is the session's active tab
}
```

## Supporting Types

```typescript
// Used in ActionResult. Composed from ElementTarget so an ElementInfo can be
// passed directly anywhere an ElementTarget is expected.
export type ElementInfo = ElementTarget & {
  tag: string;
  handle?: ElementHandle;
  type?: string;           // input type
  label?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];      // for select/dropdown
  role?: string;
  hasShadowRoot?: boolean;
  runtimeHandle?: 'quill' | 'lexical' | 'prosemirror' | 'codemirror' | 'monaco' | 'slate';
};

export interface LinkInfo {
  text: string;
  href: string;
  target: ElementTarget;
  handle?: ElementHandle;
  title?: string;
  rel?: string;
  targetAttr?: string;
  visible?: boolean;
}

export interface InspectElement {
  index: number;
  tag: string;
  id: string;
  classes: string;
  role: string;
  ariaLabel: string;
  rect: { x: number; y: number; width: number; height: number };
  computed: Record<string, string>;
  children: number;
  descendants: number;
  textLength: number;
  scrollable: boolean;
  scrollInfo?: { scrollTop: number; scrollHeight: number; clientHeight: number };
  selector: string;
}

export interface Landmark {
  tag: string;
  role: string;
  label?: string;
}

export interface Heading {
  level: number;
  text: string;
}

// Extension-side ring buffer entry for debug.log
export interface TraceEntry {
  id: string;
  action: Action;
  tab: number;
  timestamp: number;
  elapsed: number;
  result: 'ok' | 'error';
  errorCode?: ErrorCode;
  replay: boolean;
  extensionVersion: string;
}

// Daemon-side ring buffer entry for debug.last
export interface DaemonRequestTrace {
  id: string;
  action: Action;
  session: SessionId;
  receivedAt: number;
  elapsedMs: number;
  ok: boolean;
  errorCode?: ErrorCode;
  replayed?: boolean;
}
```

## Package Configuration

```json
{
  "name": "@bproxy/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts"
}
```

Consumers in the monorepo reference it as a workspace dependency. TypeScript resolves types directly from source — no build step needed for the shared package during development.
