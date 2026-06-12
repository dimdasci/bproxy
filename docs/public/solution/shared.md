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
    ├── errors.ts             # error codes, categories, structured error shape
    └── sessions.ts           # session state, pacing config
```

## Protocol Envelope

```typescript
// src/protocol.ts
import type { Action, ActionParams, ActionResult } from './actions';

export interface BproxyRequest<A extends Action = Action> {
  protocol_version: 1;
  id: string;
  action: A;
  params: ActionParams[A];
  session: string;
  deadline: number;       // unix ms
  destructive: boolean;
}

// Daemon → extension wire shape. The CLI's HTTP input is `BproxyRequest`;
// the daemon owns the mapping session → tabId and wraps the request with
// `target.tabId` at the dispatch site. Only forwarded actions (browser,
// tab.*, debug.log) use this shape — daemon-local actions (session.*,
// debug.last, debug.status) never carry a target.
export type BproxyForwardedRequest<A extends Action = Action> = BproxyRequest<A> & {
  target: { tabId: number };
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
  | 'scroll'
  | 'screenshot'
  | 'fill'
  | 'fill-form'
  | 'select'
  | 'wait'
  | 'require-human'
  | 'tab.list' | 'tab.pin' | 'tab.unpin' | 'tab.open' | 'tab.close'
  | 'session.list' | 'session.bind' | 'session.unbind' | 'session.resume'
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

// Params per action — exhaustive, compiler-checked
export interface ActionParams {
  navigate: { url: string };
  text: { selector?: string };
  links: { selector?: string; visibleOnly?: boolean; limit?: number };
  images: { selector?: string };
  elements: { form?: boolean };
  outline: {};
  dom: { selector?: string; depth?: number };
  scroll: { by?: string; direction?: 'up' | 'down'; untilStable?: boolean };
  screenshot: { activate?: boolean; debugger?: boolean };
  fill: { 
    target: ElementTarget;  // replaces selector-only
    value: string; 
    method: FillMethod;  // NOT optional — agent must choose
    world: ExecutionWorld; // NOT optional — 'isolated' or 'main'
  };
  'fill-form': { 
    fields: Array<{ 
      target: ElementTarget;  // replaces selector
      value: string; 
      method: FillMethod;  // NOT optional
      world: ExecutionWorld; // NOT optional
    }> 
  };
  select: { trigger: ElementTarget; optionText: string };  // target replaces selector
  wait: { strategy: 'selector' | 'url' | 'navigation'; target: string; timeout?: number };
  'require-human': { reason: string; forAttach?: string };
  'tab.list': {};
  'tab.pin': { tabId?: number };
  'tab.unpin': {};
  'tab.open': { url: string };
  'tab.close': { tabId?: number };
  'session.list': {};
  'session.bind': { tabId: number; pacing?: PacingMode };
  'session.unbind': {};
  'session.resume': {};
  'debug.log': { id?: string; limit?: number };
  'debug.last': { count?: number };
  'debug.status': {};
}

// Results per action — what data contains on success
export interface ActionResult {
  navigate: { url: string; title: string; loadTime: number };
  text: { text: string };
  links: { links: Array<{ text: string; href: string; target: ElementTarget; title?: string; rel?: string; targetAttr?: string; visible?: boolean }> };
  images: { images: Array<{ src: string; alt: string; width: number; height: number }> };
  elements: { elements: Array<ElementInfo> };
  outline: { landmarks: Array<Landmark>; headings: Array<Heading> };
  dom: { html: string };
  scroll: { before: number; after: number; scrolledPx: number; stable: boolean };
  screenshot: { base64: string; format: 'png' | 'jpeg' };
  fill: { filled: boolean; verifiedValue: string };
  'fill-form': { results: Array<{ target: ElementTarget; filled: boolean; verifiedValue: string }> };
  select: { selected: boolean; optionText: string };
  wait: { matched: boolean; elapsed: number };
  'require-human': { resumed: boolean };
  'tab.list': { tabs: Array<TabInfo> };
  'tab.pin': { tabId: number };
  'tab.unpin': {};
  'tab.open': { tabId: number; url: string };
  'tab.close': {};
  'session.list': { sessions: Array<SessionInfo> };
  'session.bind': { session: string; tabId: number };
  'session.unbind': {};
  'session.resume': { session: string };
  'debug.log': { entries: Array<TraceEntry> };
  'debug.last': { requests: Array<DaemonRequestTrace> };
  'debug.status': {
    daemon: { pid: number; port: number; uptimeSec: number };
    wsClients: Array<{ id: string; connectedAt: number }>;
    sessions: Array<SessionInfo>;
    pausedSessions: Array<{ session: string; reason?: string }>;
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
  // Policy
  | 'HUMAN_REQUIRED'
  | 'DEBUGGER_DISABLED'
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

## Session Types

```typescript
// src/sessions.ts
export type PacingMode = 'human' | 'fast';

export interface PacingConfig {
  navigate: { min: number; max: number };
  scroll: { min: number; max: number };
  fill: { min: number; max: number };
}

export const PACING_PRESETS: Record<PacingMode, PacingConfig> = {
  human: {
    navigate: { min: 1500, max: 4000 },
    scroll: { min: 4000, max: 8000 },
    fill: { min: 500, max: 2000 },
  },
  fast: {
    navigate: { min: 300, max: 800 },
    scroll: { min: 500, max: 1500 },
    fill: { min: 100, max: 400 },
  },
};

// "fast" models a power user who knows where they're going — short delays
// with real variance, not zero. Instant zero-delay timing is itself a bot
// signal; pacing must always produce jittered, non-zero intervals.

// Per-session PacingConfig overrides are deferred. When introduced, `session.bind`
// params will accept `pacing?: PacingMode | PacingConfig` and the resolver will
// branch on the runtime shape.

export interface SessionInfo {
  name: string;
  tabId: number | null;
  pacing: PacingMode;
  paused: boolean;
  pauseReason?: string;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  session: string | null;
  injected: boolean;
}
```

## Supporting Types

```typescript
// Used in ActionResult. Composed from ElementTarget so an ElementInfo can be
// passed directly anywhere an ElementTarget is expected (e.g. fed back into
// `fill` after `elements` discovery), with no field-shape drift.
export type ElementInfo = ElementTarget & {
  tag: string;
  type?: string;           // input type
  label?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];      // for select/dropdown
  role?: string;
  // Framework/runtime markers for method selection
  hasShadowRoot?: boolean;
  runtimeHandle?: 'quill' | 'lexical' | 'prosemirror' | 'codemirror' | 'monaco' | 'slate';
};

export interface Landmark {
  tag: string;
  role: string;
  label?: string;
}

export interface Heading {
  level: number;
  text: string;
}

// Extension-side ring buffer entry. Carries `extensionVersion` so the CLI
// can detect stale-build entries served after the extension was reloaded.
// Distinct from `DaemonRequestTrace` (daemon-side `debug.last` shape).
export interface TraceEntry {
  id: string;
  action: string;
  tab: number;
  timestamp: number;
  elapsed: number;
  result: 'ok' | 'error';
  errorCode?: string;
  replay: boolean;
  extensionVersion: string;
}

export interface DaemonRequestTrace {
  id: string;
  action: string;
  session: string;
  receivedAt: number;
  elapsedMs: number;
  ok: boolean;
  errorCode?: string;
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
