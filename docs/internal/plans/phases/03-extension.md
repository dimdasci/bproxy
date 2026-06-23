---
title: Phase 3 — Extension
---

> **For implementers:** this is a work-decomposition plan, not a code transcript. Keep tasks small, test from the boundary inward, and update the views/docs when the implementation settles.

**Goal:** Ship `@bproxy/extension` — a loadable Chrome MV3 extension built with WXT that pairs with the Phase 2 daemon, maintains an authenticated WebSocket connection, executes browser-side action primitives, and exposes extension-side traces through `debug.log`.

**Strategy:** Close the daemon↔extension contract gaps first, then build the extension in three layers: background service worker transport, content-script DOM primitives, and browser API actions. Design assertions are as important as happy-path behaviour: read mode must stay quiet, writes must use the selected method exactly, MAIN-world execution must be one-shot, and the bundle must not introduce MutationObserver or default web-accessible resources.

**Spec:** `docs/public/solution/extension.md`.
**Roadmap entry:** [Phase 3 in roadmap.md](../roadmap.md#phase-3--extension).
**Current system context:** `docs/public/views/02-containers.md`, `docs/public/views/04-session-state.md`, `docs/public/views/06-threat-model.md`.

**Decisions that constrain this phase:**

- [ADR-001](../../decisions.md#adr-001-default-instrumentation-strategy--read-mode) — programmatic injection only; no default MAIN-world presence.
- [ADR-002](../../decisions.md#adr-002-extension-framework--wxt) — WXT.
- [ADR-006](../../decisions.md#adr-006-dom-polling-over-mutationobserver) — jittered, visibility-aware DOM polling; no MutationObserver.
- [ADR-007](../../decisions.md#adr-007-three-method-write-contract) — `direct` / `paste` / `runtime-api`, no `auto`.
- [ADR-009](../../decisions.md#adr-009-observability-as-a-first-class-design-constraint) — request `id` is the correlation key.
- [ADR-011](../../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) — popup-driven pairing.
- [ADR-013](../../decisions.md#adr-013-main-world-runtime-api-writes), [ADR-015](../../decisions.md#adr-015-main-world-hygiene-contract), [ADR-016](../../decisions.md#adr-016-web_accessible_resources-default-deny) — MAIN-world and exposure hygiene.
- [ADR-014](../../decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting), [ADR-017](../../decisions.md#adr-017-sensoractuator-boundary), [ADR-018](../../decisions.md#adr-018-agent-guidance-ownership) — route-based targeting and no extension-side strategy.

---

## Locked outcomes for this phase

1. **`extension/.output/chrome-mv3/` is loadable in Chrome.** The manifest has the required permissions and action popup, but no declarative `content_scripts` and no default `web_accessible_resources`.
2. **Popup pairing works against the real daemon route.** The popup claims a pairing code through `POST /pair/claim`, validates the bootstrap payload, stores `{ extensionToken, wsUrl, protocolVersion, issuedAt, expiresAt, nonce }`, and notifies the background service worker.
3. **Background service worker maintains daemon WebSocket.** It reconnects after close/SW restart, authenticates with `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(token)}`, sends app-level pings, handles daemon replay without re-executing deduped destructive requests, and exposes connection state via action badge text/color.
4. **Programmatic content-script injection is per tab.** The content script is injected only on first command for a tab; reads and `direct`/`paste` writes run in ISOLATED world.
5. **All forwarded actions from the shared `Action` union are handled by the extension:** `navigate`, reads (`text`, `images`, `elements`, `outline`, `dom`), `scroll`, `screenshot`, `fill`, `fill-form`, `select`, `wait`, `require-human`, `eval`, `tab.*`, and `debug.log`. `session.*`, `debug.last`, and `debug.status` remain daemon-local and must not have extension handlers.
6. **The extension remains a sensor+actuator.** It returns honest capability/result data and errors; it does not select fill methods, retry with another method, classify sites, or cache strategy between calls.
7. **Extension ring buffer is queryable.** `debug.log` returns recent trace entries filtered by `id` and/or `limit`, including request id, action, target tab, elapsed time, result/error, replay flag, and extension build/version stamp.
8. **Design-asserted tests/checks exist:**
   - production bundle contains no `MutationObserver` reference;
   - manifest contains no declarative `content_scripts` and no `web_accessible_resources` by default;
   - `paste` fill dispatches `beforeinput`/`input` with `inputType: "insertFromPaste"` and does not synthesize key events;
   - `runtime-api` and `eval` use `chrome.scripting.executeScript` with `world: "MAIN"` only on demand;
   - MAIN-world injected functions catch/normalize errors and contain no identifying literals;
   - duplicate request ids return cached responses rather than executing twice.
9. **Docs and views are updated.** `extension/README.md`, any necessary `docs/solution/*.md` contract updates, and the views integration task below are committed. `pnpm views:regen` produces an updated `docs/views/auto/extension-components.svg`, and the Container/Threat views link/describes the shipped extension surface.
10. **Static gates pass from a clean checkout:** `pnpm check`, `pnpm test`, and `pnpm docs:build`.

---

## Contract seams to close before browser work

Phase 2 intentionally proved the daemon using a mock WS client. Building the real extension exposes two wire-contract seams that must be resolved at the start of Phase 3:

1. **Target tab metadata is not currently on the WS request.** The daemon owns `session → tabId`, but the forwarded `BproxyRequest` contains only `session`. A real extension cannot know which tab to navigate, inject, or capture from that alone. Phase 3 must add an explicit daemon→extension forwarded-request shape, preferably in `@bproxy/shared` (for example `BproxyForwardedRequest = BproxyRequest & { target: { tabId: number } }`), and update service dispatch/pending tests accordingly. The CLI-facing HTTP request should remain `BproxyRequest`.
2. **`HUMAN_REQUIRED` needs daemon pause integration — both halves are currently missing.**
   - **Trigger half:** nothing in `service/src/routes/command.ts` or `service/src/dispatch.ts` calls `sessions.pause()` when a forwarded response is `ok:false && error.code === "HUMAN_REQUIRED"`. `SessionRegistry.pause()` exists (`service/src/sessions.ts:40-44`) but is never invoked.
   - **Gate half:** `dispatch.send` only refuses forwarded actions when `session.tabId === null` (`service/src/dispatch.ts:90-97`). It does not read `session.paused`, so even today a manually paused session is not actually refused. This contradicts `docs/views/04-session-state.md:29,39` and `docs/solution/service.md:159`. The `workflows.test.ts` pause/resume workflow explicitly comments this as a known gap.
   - Both halves must land in Task 1; tests must assert the gate (forwarded action count does not increase while paused) in addition to the state mutation.
3. **Trace entry shape must match docs.** `docs/solution/extension.md` adds `extensionVersion` to ring-buffer entries, while the current shared `TraceEntry` type does not. Align shared types and daemon schemas before implementing `debug.log`.

These are not feature creep; they are required for the extension to implement the architecture as written.

---

## File structure introduced/modified this phase

```
extension/
├── package.json                    # MODIFIED — WXT, build/test scripts, deps
├── tsconfig.json                   # MODIFIED — WXT/browser types
├── wxt.config.ts                   # NEW — manifest, srcDir, permissions, no WAR/content_scripts
├── vitest.config.ts                # NEW — unit test config
├── README.md                       # NEW
└── src/
    ├── entrypoints/
    │   ├── background.ts           # NEW — MV3 service worker entry
    │   ├── content.ts              # NEW — runtime ISOLATED content script
    │   ├── popup.html              # NEW
    │   └── popup.ts                # NEW
    ├── background/
    │   ├── ws-client.ts            # NEW — daemon connection/reconnect/subprotocol auth
    │   ├── dispatcher.ts           # NEW — request routing + dedupe + traces
    │   ├── storage.ts              # NEW — typed local/session storage wrappers
    │   ├── tabs.ts                 # NEW — tab resolution, frame table, tab.* actions
    │   ├── injection.ts            # NEW — programmatic content-script injection
    │   ├── browser-actions.ts      # NEW — navigate/screenshot/require-human/eval glue
    │   ├── main-world.ts           # NEW — one-shot runtime-api/eval execution helpers
    │   └── trace.ts                # NEW — ring buffer
    ├── content/
    │   ├── rpc.ts                  # NEW — background↔content message contract
    │   ├── page-state.ts           # NEW — url/title/state/busy snapshot
    │   ├── targeting.ts            # NEW — ElementTarget/ElementRoute resolver
    │   ├── discovery.ts            # NEW — shadow-aware element discovery
    │   ├── polling.ts              # NEW — jittered DOM stability polling
    │   ├── events.ts               # NEW — native setter + paste-event helpers
    │   └── actions/
    │       ├── reads.ts            # NEW — text/images/elements/outline/dom
    │       ├── scroll-wait.ts      # NEW — scroll + wait
    │       ├── fill.ts             # NEW — direct/paste/fill-form
    │       └── select.ts           # NEW
    └── test/
        ├── fakes/                  # NEW — fakeBrowser/WebSocket/chrome helpers
        └── fixtures/               # NEW — DOM fixtures for content tests
shared/src/protocol.ts              # MODIFIED if forwarded-request metadata is added
shared/src/actions.ts               # MODIFIED if TraceEntry is aligned
service/src/dispatch.ts             # MODIFIED to attach target tab metadata
service/src/pending.ts              # MODIFIED if pending stores forwarded requests
service/src/routes/command.ts        # MODIFIED if HUMAN_REQUIRED pause is missing
docs/solution/*.md                  # MODIFIED for resolved contract seams
docs/views/*.md                     # MODIFIED in views task
docs/views/auto/extension-components.svg
```

WXT should be configured with `srcDir: "src"` so entrypoints live under `extension/src/**` and are visible to dependency-cruiser. If WXT constraints force root-level `entrypoints/`, update `views/scripts/regen.ts`, `.dependency-cruiser.cjs`, and `docs/solution/extension.md` in the same task so the architecture tooling scans the real source tree.

---

## Task 1: Contract alignment with Phase 2 daemon

**Status:** ✅ Complete — commits `abcb339`, `7a2d621`, `cc2e47d`, `f175c96`, `44c019d`.

**Files:** `shared/src/protocol.ts`, `shared/src/actions.ts`, `service/src/dispatch.ts`, `service/src/pending.ts`, `service/src/routes/command.ts`, `service/src/schemas.ts`, related tests, `docs/solution/shared.md`, `docs/solution/service.md`, `docs/solution/extension.md`.

**Purpose:** Make the daemon→extension wire contract executable by a real extension before any browser code depends on ambiguous state.

- [x] Add an explicit forwarded-request type in `@bproxy/shared` (e.g. `BproxyForwardedRequest = BproxyRequest & { target: { tabId: number } }`) carrying daemon-owned target tab metadata. Keep the CLI HTTP input type (`BproxyRequest`) unchanged. The extension-side parser/schema for inbound forwarded requests must consume this shared type, not duplicate it.
- [x] Update `service/src/dispatch.ts` so every forwarded browser/tab/`debug.log` action sent over WS wraps the request with the current `tabId` from daemon session state. The `tabId` is already resolved at the existing tab-lock site; reuse it.
- [x] Keep `session.*`, `debug.last`, and `debug.status` daemon-local (no forwarded envelope, no `target.tabId`).
- [x] Add service tests proving that rebinding a session changes the `target.tabId` on the very next forwarded request.
- [x] **HUMAN_REQUIRED — trigger:** after a forwarded response is `ok:false && error.code === "HUMAN_REQUIRED"`, call `sessions.pause(cmd.session, error.message)` before returning the response to the CLI.
- [x] **HUMAN_REQUIRED — gate:** in `dispatch.send`, refuse forwarded actions on paused sessions with a `HUMAN_REQUIRED` error envelope **before** the `tabId === null` check, so the precedence is paused → unbound → forward.
- [x] Document that precedence in `docs/solution/service.md` (currently silent at the "Error precedence for forwarded actions" bullet around line 153).
- [x] Fix `SessionRegistry.unbind` in `service/src/sessions.ts` to clear `paused`/`pauseReason` so behavior matches `docs/views/04-session-state.md:39` ("`session.unbind` is allowed from `paused` too — it both clears the tab and drops the pause flag"). Alternative: amend the view if the intent is the opposite — but pick one in this task.
- [x] Update the existing pause/resume workflow test in `service/src/__tests__/workflows.test.ts` to remove the "gap" comment and assert that the extension `commandCount` does **not** increase while the session is paused, then resumes correctly after `session.resume`.
- [x] Align `TraceEntry` in `shared/src/actions.ts` with the extension trace requirements (add `extensionVersion: string`), and update schemas/tests. Confirm `DaemonRequestTrace` is left untouched (it is the `debug.last` shape, not the extension ring buffer).
- [x] Reconcile all affected solution docs (`docs/solution/shared.md`, `docs/solution/service.md`, `docs/solution/extension.md`) so Phase 4 CLI does not inherit stale assumptions.

**Done when:**
- a mock WS client receives forwarded requests with `target.tabId` matching the daemon's current `session.tabId`;
- a forwarded `HUMAN_REQUIRED` response mutates daemon session state to `paused = true` with the reason captured;
- subsequent forwarded actions on the paused session return `HUMAN_REQUIRED` from the daemon **without** being sent to the WS client (asserted by `commandCount` not increasing);
- `session.resume` clears the pause and the next forwarded action goes through;
- `session.unbind` from `paused` clears both the tab binding and the pause flag.

---

## Task 2: Bootstrap WXT extension package

**Status:** ✅ Complete — commits `1095960`, `a135935`. Popup uses directory entrypoint (`popup/index.html` + `popup/main.ts`) — WXT 0.20 rejects flat `popup.html` + `popup.ts` due to basename collision. The plan text below still says `popup.html`/`popup.ts`; treat the directory form as canonical.

**Files:** `extension/package.json`, `extension/wxt.config.ts`, `extension/tsconfig.json`, `extension/vitest.config.ts`, `extension/src/entrypoints/*`, `extension/README.md`.

**Purpose:** Replace the stub package with a buildable MV3 extension shell.

- [x] Add WXT, Vitest, WXT/browser test helpers, and browser typings.
- [x] Configure manifest permissions: `tabs`, `scripting`, `webNavigation`, `alarms`, `storage`; include `debugger` only if the optional screenshot escalation is implemented behind its flag.
- [x] Set `host_permissions: ["<all_urls>"]`, action popup, and no default `content_scripts`/`web_accessible_resources`.
- [x] Create empty-but-loadable background, runtime content script, and popup entrypoints.
- [x] Wire scripts: `dev`, `build`, `typecheck`, `test`, and any `test:browser`/smoke command chosen for local Chrome verification.
- [x] Write a short README explaining purpose, public entrypoints, local development, and how to load `.output/chrome-mv3/`.

**Done when:** `pnpm --filter @bproxy/extension build` emits `.output/chrome-mv3/`, Chrome accepts the unpacked extension, and `pnpm check` still sees extension sources through dependency-cruiser/knip.

---

## Task 3: Storage, trace, and response helpers

**Status:** ✅ Complete — commits `4c1b6bd`, `7e1dfcb`, `d61ba8c`, `6e10a47`, `02eb4c7`, `dba4aa0`. Files actually produced: `storage.ts`, `storage-item.ts` (DI seam), `trace.ts`, `dedupe.ts`, `responses.ts` under `extension/src/background/`; in-memory fake at `extension/src/test/fakes/storage.ts`; vitest setup at `extension/src/test/setup-chrome-storage.ts`. Bootstrap is one atomic `local:bootstrap` record (six fields), not multiple keys.

**Files:** `extension/src/background/storage.ts`, `extension/src/background/trace.ts`, shared test fakes.

**Purpose:** Establish the typed local/session storage and response envelope helpers used by every later task.

- [x] Define storage keys for pairing bootstrap, dedupe table, injected tabs, optional domain/config flags, and trace ring buffer.
- [x] Implement bounded trace append/query with `id` filter and `limit`; include extension build/version stamp.
- [x] Implement response/error builders that preserve request id/protocol version and always include page state for successful responses.
- [x] Define dedupe entry shape `{ response, ts }` and TTL/size eviction policy.
- [x] Unit-test ring-buffer bounds, filter semantics, and stale dedupe eviction.

**Done when:** `debug.log` can later be implemented by reading this trace store with no action-specific knowledge.

---

## Task 4: Popup pairing flow

**Status:** ✅ Complete — commits `284724c`, `8e1b876`, `5075ffb`, `e1f7d0e`, `13ae918`, `2003f15`. Pairing logic lives in `extension/src/entrypoints/popup/pairing.ts` (pure, DI'd `fetch`/`storage`/`sendMessage`/`now`). `bootstrapItem` shape from Task 3 already matched the daemon payload — `storage.ts` wasn't touched. Seven distinct error codes (`INVALID_PAYLOAD_SHAPE`, `INVALID_WS_URL`, `UNSUPPORTED_PROTOCOL_VERSION`, `BOOTSTRAP_EXPIRED`, `MISSING_NONCE`, `PAIR_TRANSPORT_ERROR`, `PAIR_NOTIFY_FAILED`) plus the three daemon pass-throughs. 12 popup tests; `STATUS_FRIENDLY` table compile-time exhaustive over `PairingErrorCode`.

**Files:** `extension/src/entrypoints/popup.html`, `extension/src/entrypoints/popup.ts`, `extension/src/background/storage.ts`, popup tests.

**Purpose:** Let the user bootstrap extension auth without a manual token-entry options page.

- [x] Build a minimal form accepting the one-time pairing code.
- [x] POST `{ code }` to `http://127.0.0.1:9615/pair/claim` initially; if the daemon port is later made configurable for extension bootstrap, document and implement that path together.
- [x] Validate payload shape, loopback `wsUrl`, `protocolVersion === 1`, future `expiresAt`, and nonce presence.
- [x] Store the bootstrap payload in `chrome.storage.local` and send `pair.complete` to the background worker.
- [x] Show clear success/failure state in the popup; no interactive prompts outside the popup.
- [x] Test validation failures without a real daemon by mocking `fetch` and storage.

**Done when:** the popup can pair against a running Phase 2 daemon and the background worker receives a reconnect trigger.

---

## Task 5: Background WebSocket client and badge state

**Status:** ✅ Complete — local workspace. Implemented in `extension/src/background/ws-client.ts`, wired in `extension/src/entrypoints/background.ts`, covered by `extension/src/background/__tests__/ws-client.test.ts`.

**Files:** `extension/src/background/ws-client.ts`, `extension/src/entrypoints/background.ts`, storage tests.

**Purpose:** Maintain the daemon connection across normal closes and MV3 service-worker restarts.

- [x] On SW startup, read stored bootstrap payload; connect only when token and loopback WS URL are valid.
- [x] Authenticate with subprotocols `bproxy.v1` and `auth.{base64url(extensionToken)}`.
- [x] Implement exponential backoff with cap and reset-on-open.
- [x] Register `chrome.alarms` keepalive and app-level ping/pong or send-level heartbeat compatible with daemon behaviour.
- [x] React to `pair.complete` by re-reading storage and reconnecting immediately.
- [x] Update badge state for disconnected/connecting/connected/error in a compact, non-noisy way.
- [x] Unit-test URL/token validation, subprotocol construction, reconnect schedule, and pair-complete reconnect.

**Done when:** killing/restarting the daemon or forcing a SW restart results in reconnect without re-pairing when `extension-token` is still valid on the daemon side.

---

## Task 6: Background dispatcher, dedupe, and `debug.log`

**Status:** ✅ Complete — local workspace. Added `dispatcher.ts` plus forwarded-request parsing helpers, wired dispatcher/dedupe/trace into the background entrypoint, and covered duplicate/error/debug-log flows in `extension/src/background/__tests__/dispatcher.test.ts`.

**Files:** `extension/src/background/dispatcher.ts`, `extension/src/background/trace.ts`, `extension/src/entrypoints/background.ts`, dispatcher tests.

**Purpose:** Convert daemon WS messages into exactly-once extension executions and responses.

- [x] Parse forwarded requests, reject malformed messages with normalized protocol errors where possible.
- [x] Check dedupe before dispatch; duplicates return cached responses and mark `replay: true` without re-running destructive actions.
- [x] Route `debug.log` directly to the trace ring buffer.
- [x] Route browser API actions to background modules and DOM actions to the content script.
- [x] Append one trace entry per request with elapsed time and final result.
- [x] Send a response for every accepted request, even when action execution throws.
- [x] Unit-test duplicate destructive requests, duplicate read requests, handler throw normalization, and `debug.log` filtering.

**Done when:** daemon replay-on-reconnect can safely resend an in-flight request and the extension replies from cache if it already executed that request.

---

## Task 7: Tab resolution, frame table, and programmatic injection

**Status:** ✅ Complete — local workspace. Added `tabs.ts`, `injection.ts`, and `content/rpc.ts`; wired tab resolution/injection/content RPC into the background entrypoint; and covered first injection, no reinjection, cleanup, navigation invalidation, timeout, and missing-tab paths in `extension/src/background/__tests__/{injection,tabs}.test.ts`.

**Files:** `extension/src/background/tabs.ts`, `extension/src/background/injection.ts`, `extension/src/entrypoints/background.ts`, tests.

**Purpose:** Make the daemon-owned target tab executable inside Chrome.

- [x] Resolve the target tab from forwarded metadata; return `TAB_NOT_FOUND` when Chrome no longer has it.
- [x] Maintain an injected-tab set in `chrome.storage.session`; clear entries when tabs close or navigation invalidates the content script.
- [x] Inject the runtime content script on first command per tab using `chrome.scripting.executeScript`; never rely on declarative manifest content scripts.
- [x] Track frame/navigation events needed for SPA readiness and future frame targeting; keep this table observational only.
- [x] Implement background↔content RPC with request id correlation and per-request timeout.
- [x] Test first-use injection, no reinjection on second command, tab-close cleanup, and content-RPC timeout.

**Done when:** a forwarded `text` request can target the daemon-specified tab after exactly one programmatic injection.

---

## Task 8: Content script RPC and page-state foundation

**Status:** ✅ Complete — local workspace. Refactored the minimal Task 7 bridge into a reusable content RPC host in `content/rpc.ts`, added `page-state.ts`, kept the runtime content script to one listener, and covered unknown action, thrown handler normalization, page-state snapshots, and id correlation in `extension/src/content/__tests__/*`.

**Files:** `extension/src/entrypoints/content.ts`, `extension/src/content/rpc.ts`, `extension/src/content/page-state.ts`, content tests.

**Purpose:** Build the ISOLATED-world execution host before adding action logic.

- [x] Define the content-message contract separately from the daemon wire contract.
- [x] Register one message listener in the runtime content script; no page-global listeners or MAIN-world state.
- [x] Return page state (`url`, `title`, loading/ready/error, busy) consistently.
- [x] Normalize thrown DOM errors into shared error envelopes.
- [x] Test unknown action, handler throw, page-state snapshot, and message correlation.

**Done when:** background can call a trivial content handler and receive a typed success/error response plus page state.

---

## Task 9: Targeting and shadow-aware discovery primitives

**Status:** ✅ Complete — local workspace. Added `content/targeting.ts`, `content/discovery.ts`, `content/dom-helpers.ts`, fake DOM fixtures under `extension/src/test/fixtures/`, and coverage in `extension/src/content/__tests__/{targeting,discovery}.test.ts`.

**Files:** `extension/src/content/targeting.ts`, `extension/src/content/discovery.ts`, fixtures/tests.

**Purpose:** Implement the route-based targeting substrate shared by reads, writes, and select.

- [x] Resolve `ElementTarget` as exactly one of light-DOM selector or open-shadow-root route.
- [x] Treat closed shadow roots as out of scope and return `ELEMENT_NOT_FOUND`/target error, not a fallback guess.
- [x] Implement stable selector generation for discovered interactive elements.
- [x] Implement progressive, intent-scoped discovery: active element chain, visible dialogs/popovers, viewport hit-test/candidate root, scoped subtree.
- [x] Probe runtime editor handles only inside a candidate root; no whole-page recursive scans.
- [x] Test nested open shadow roots, missing hosts, closed-shadow behaviour, ambiguous selectors, labels/placeholders/options, and runtime-handle markers.

**Done when:** an `elements` result can be fed back directly as an `ElementTarget` to `fill` or `select`.

---

## Task 10: Read action handlers

**Status:** ✅ Complete — local workspace. Landed `content/actions/reads.ts` with shared read-tree helpers in `content/read-tree.ts`, kept reads in ISOLATED world, and covered `text`/`images`/`elements`/`outline`/`dom` against fake-DOM fixtures in `extension/src/content/__tests__/reads.test.ts`.

**Files:** `extension/src/content/actions/reads.ts`, `extension/src/content/read-tree.ts`, `extension/src/content/discovery.ts`, tests.

**Purpose:** Ship the read-mode surface that covers most agent workflows without MAIN-world presence.

- [x] `text`: extract visible-ish `innerText` from selector/route or `body` default.
- [x] `images`: return visible images with `src`, `alt`, natural/rendered dimensions scoped by selector when provided.
- [x] `elements`: return interactive controls and, with `form: true`, form fields only.
- [x] `outline`: return landmarks and heading hierarchy.
- [x] `dom`: serialize a simplified subtree with bounded depth and no script/style noise.
- [x] Keep all reads in ISOLATED world and avoid persistent observers/listeners.
- [x] Test each action against DOM fixtures, including shadow-root targets and bounded output.

**Done when:** the extension can satisfy the daemon action-contract read set without touching MAIN world.

---

## Task 11: DOM polling, wait, and scroll

**Status:** ✅ Complete — local workspace. Added jittered polling hooks in `content/polling.ts`, wired `scroll`/`wait` handlers via `content/actions/scroll-wait.ts` into the runtime content entrypoint, and covered jitter/timeout/hidden-tab/selector-url-navigation waits/scroll math in `extension/src/content/__tests__/{polling,scroll-wait}.test.ts`.

**Files:** `extension/src/content/polling.ts`, `extension/src/content/actions/scroll-wait.ts`, tests.

**Purpose:** Implement page-settle behaviour in the low-signal way specified by ADR-006.

- [x] Implement jittered polling with injected random/clock hooks for deterministic tests.
- [x] Support stability by element-count/subtree signature, bounded timeout, and stable-count threshold.
- [x] Respect visibility: destructive actions bail with `TAB_NOT_VISIBLE` when `document.visibilityState === "hidden"` unless the action is explicitly marked as user-initiated in future protocol metadata.
- [x] `scroll`: compute pixel distance from `by`/`direction`, perform `window.scrollBy`, optionally wait until stable, return before/after/scrolled/stable.
- [x] `wait`: implement selector, URL, and navigation strategies using polling rather than MutationObserver.
- [x] Test jitter range, timeout, hidden-tab bail-out, selector wait, URL wait, and scroll result math.

**Done when:** source and built output remain free of `MutationObserver`, and scroll/wait behave deterministically in tests with injected time.

---

## Task 12: ISOLATED-world writes — `direct`, `paste`, `fill-form`, `select`

**Status:** ✅ Complete — local workspace. Added `content/events.ts`, `content/actions/{fill,select}.ts`, wired them into `entrypoints/content.ts`, extended fake DOM fixtures for focus/click/event capture, and covered direct/paste/fill-form/select flows in `extension/src/content/__tests__/{fill,select}.test.ts`.

**Files:** `extension/src/content/events.ts`, `extension/src/content/actions/fill.ts`, `extension/src/content/actions/select.ts`, tests.

**Purpose:** Execute the explicit write method the agent selected, without extension-side escalation.

- [x] `direct`: set native DOM state for inputs/textareas/contenteditable; dispatch no input/change/key events.
- [x] `paste`: focus, use the native value setter where applicable, dispatch paste-flavoured `beforeinput`, `input`, and `change`; never synthesize keydown/keypress/keyup.
- [x] Validate method/world compatibility: `direct` and `paste` require `world: "isolated"`; `runtime-api` is rejected here and handled by the background MAIN-world path.
- [x] `fill-form`: process fields in one round-trip, guard hidden/non-actionable fields, verify read-back per field. Do not add extension-level method selection.
- [x] `select`: click trigger, poll for menu/listbox/options, click matching option text, verify selection.
- [x] Test native setters, event payloads, no-key-event invariant, hidden-field guard, read-back verification, and shadow-route targets.

**Done when:** framework-friendly paste semantics are asserted by tests and direct writes remain event-free.

---

## Task 13: MAIN-world one-shot actions — `runtime-api` and `eval`

**Status:** ✅ Complete — local workspace. Added `background/main-world.ts` plus `background/browser-actions.ts`, wired runtime-api fill through one-shot `chrome.scripting.executeScript({ world: "MAIN" })` in the SW, default-disabled `eval` behind `local:configFlags["evalEnabled"]`, and covered executeScript shape / hygiene / normalized error / disabled eval in `extension/src/background/__tests__/{main-world,browser-actions,dispatcher}.test.ts`.

**Files:** `extension/src/background/main-world.ts`, `extension/src/background/browser-actions.ts`, tests.

**Purpose:** Provide explicit MAIN-world capability without creating a persistent page fingerprint.

- [x] `fill` with `method: "runtime-api"` must require `world: "main"` and execute exactly one `chrome.scripting.executeScript` call with `world: "MAIN"`.
- [x] The injected runtime-api function resolves only the provided route/handle, calls the editor API, verifies when possible, catches all errors, and returns plain data only.
- [x] The injected function body must contain no identifying literals such as extension id, `chrome-extension`, package names, or bproxy branding.
- [x] `eval` remains disabled unless the daemon/extension config explicitly enables it. If Phase 2 lacks an eval flag, implement default `EVAL_DISABLED` and document the Phase 4 wiring required to turn it on.
- [x] Test executeScript arguments, one-shot/no-listener behaviour, normalized error path, no identifying literals, and disabled eval.

**Done when:** MAIN-world execution is observable in tests only as a single Chrome API call per request and cannot leak raw extension stack/errors into page code.

---

## Task 14: Background browser actions — navigation, screenshot, tabs, human handoff

**Status:** ✅ Complete — local workspace. Landed in `extension/src/background/browser-actions.ts` + `tabs.ts`, wired through `entrypoints/background.ts`, and covered by `extension/src/background/__tests__/{browser-actions,tabs}.test.ts`. `navigate` now waits for top-level load completion and maps interstitials to `HUMAN_REQUIRED`; screenshot uses `captureVisibleTab` and keeps debugger capture gated behind `DEBUGGER_DISABLED` until the explicit opt-in path/permission exists.

**Files:** `extension/src/background/browser-actions.ts`, `extension/src/background/tabs.ts`, tests.

**Purpose:** Implement actions that use Chrome extension APIs rather than content-script DOM logic.

- [x] `navigate`: call `chrome.tabs.update(tabId, { url })`, wait for load/navigation completion, then check interstitial patterns.
- [x] `screenshot`: use `chrome.tabs.captureVisibleTab`; implement debugger capture only behind an explicit opt-in flag, otherwise return `DEBUGGER_DISABLED` for debugger requests.
- [x] `tab.list`: return Chrome tabs with current session binding/injected status where available from forwarded metadata/local injected set.
- [x] `tab.open` / `tab.close`: use Chrome tabs API and return shared results.
- [x] `tab.pin` / `tab.unpin`: resolve/echo target tab state without taking ownership of daemon session state. If one-command session pinning is required, update daemon/service docs rather than mutating extension-only state.
- [x] `require-human`: return a structured `HUMAN_REQUIRED` error/signal with reason and suggested action; rely on daemon pause integration from Task 1.
- [x] Test navigation success/failure, screenshot normal path, debugger-disabled path, tab-not-found paths, and interstitial-to-human-required mapping.

**Done when:** browser-API actions do not require a content script except where explicitly needed for page state.

---

## Task 15: Local integration smoke against daemon + Chrome

**Status:** ✅ Complete — real Chrome/popup smoke was executed against the real daemon. The run also exposed and closed two reconnect gaps: daemon app-level heartbeat now answers `ping` with `pong`, and the extension no longer treats bootstrap `expiresAt` as a hard reconnect cutoff after pairing has already succeeded.

**Files:** extension test harness/scripts, optional local fixture page, docs notes.

**Purpose:** Prove the real extension can talk to the real daemon, not just unit fakes.

- [x] Implement local smoke helpers under `extension/scripts/smoke/` (fixture server, temp-daemon launcher, command helper, workflow runner) and keep them TypeScript-native.
- [x] Start the daemon in a temp `BPROXY_HOME` and issue a pairing code.
- [x] Load `.output/chrome-mv3/` in a local Chrome profile.
- [x] Pair through the popup, verify daemon sees a WS client, and bind a known local tab.
- [x] Run a small fixture workflow: `text`, `elements`, `fill` paste, `scroll`, `debug.log` by id.
- [x] Restart/close the SW or daemon and verify reconnect/replay behaviour manually or with an automated browser harness if stable.
- [x] Document the exact smoke commands in `extension/README.md`.

**Done when:** a developer can reproduce the smoke without external websites or bot-protection surfaces. Do not mark Task 15 complete until the real Chrome popup pairing flow, fixture workflow, and reconnect behaviour have been executed against the real daemon/extension pair.

---

## Task 16: Design assertions and quality gates

**Status:** ✅ Complete — local workspace. Added post-build artifact assertions in `extension/scripts/assert-build.ts`, wired them into `extension/package.json`, and tightened `extension/wxt.config.ts` to keep source maps while disabling Vite's modulepreload polyfill so the shipped bundle stays free of `MutationObserver`.

**Files:** extension tests, package scripts, optional scripts under `extension/scripts/`.

**Purpose:** Turn architectural constraints into automated checks.

- [x] Add a post-build/static test that scans `.output/chrome-mv3/` for forbidden `MutationObserver` references.
- [x] Add a manifest test asserting no declarative `content_scripts` and no `web_accessible_resources` unless a future ADR changes that.
- [x] Add tests for paste event shape, MAIN-world executeScript shape, and dedupe replay.
- [x] Add post-build/debug assertions that make extension failures easier to diagnose from the built bundle/service-worker console (for example preserving usable source maps/build metadata and asserting the production artifact still surfaces actionable crash locations instead of only opaque bundled output).
- [x] Ensure `pnpm --filter @bproxy/extension test`, `build`, and `typecheck` run cleanly.
- [x] Run root `pnpm check` and resolve dependency-cruiser/knip issues without weakening architecture rules.

**Done when:** the phase's design constraints fail fast in CI/local checks, not by manual review only.

---

## Task 17: Views and documentation integration

**Status:** ✅ Complete — commits `5fb629a`, `e1d3211`.

**Files:** `docs/views/02-containers.md`, `docs/views/06-threat-model.md`, `docs/views/auto/extension-components.svg`, `docs/solution/extension.md`, `docs/solution/shared.md`, `docs/solution/service.md`, `extension/README.md`.

**Purpose:** Make the visual architecture describe the implementation that now exists.

- [x] Run `pnpm views:regen` and commit the updated `docs/views/auto/extension-components.svg`.
- [x] Update `docs/views/02-containers.md`:
  - add a `click Ext "../auto/extension-components.svg"` directive;
  - replace “Inside the Extension: coming in Phase 3” with a real link;
  - adjust the caption if target-tab metadata or forwarded-request shape changed.
- [x] Update `docs/views/06-threat-model.md` from “extension-side threats out of scope” to a Phase 3 extension surface section covering storage tokens, WS auth, content-script isolation, MAIN-world hygiene, ring-buffer leakage, screenshot/debugger opt-in, and WAR default-deny.
- [x] If Task 1 changes request shapes or pause semantics, update relevant view `sources` frontmatter so `views:audit` reports the right views when protocol/service/extension files change.
- [x] Update `docs/solution/extension.md` with actual layout/config choices and any deliberate deviations from the original WXT layout.
- [x] Update `docs/solution/shared.md` / `docs/solution/service.md` for forwarded-request metadata, TraceEntry shape, and HUMAN_REQUIRED pause handling if changed.
- [x] Run `pnpm views:audit`, `pnpm docs:build`, and verify the SVG is served from `views/public/views/auto/`.

**Done when:** the Container view drills into the generated extension component graph and the Threat view no longer describes extension risks as future work.

---

## Final verification checklist

- [x] `pnpm --filter @bproxy/extension build` emits a loadable `.output/chrome-mv3/`.
- [x] Popup pairing works against a real daemon and persists a token usable after SW restart.
- [x] WS reconnect and daemon replay are safe due to dedupe.
- [x] Every forwarded action has an extension handler or documented gated error (`EVAL_DISABLED`, `DEBUGGER_DISABLED`).
- [x] Read actions and `direct`/`paste` writes stay in ISOLATED world.
- [x] `runtime-api` writes and gated `eval` use MAIN world one-shot only.
- [x] `debug.log` returns extension trace entries by id/limit.
- [x] Design-assertion tests cover no MutationObserver, no default WAR/content scripts, paste event shape, MAIN-world hygiene, and dedupe.
- [x] `extension/README.md` and affected solution docs are updated.
- [x] Views task is complete: regenerated extension SVG, Container click link, Threat view update.
- [x] `pnpm check`, `pnpm test`, and `pnpm docs:build` pass.

---

## Out of scope for Phase 3

- CLI command UX and argument parsing. Phase 4 owns `bproxy` commands.
- Agent-side fill-method selection guidance beyond keeping `docs/skills/fill-method-selection.md` references accurate. The extension must not implement method selection.
- Real-site scenario validation against Google/authenticated feed sites/application forms. Phase 5 owns external scenario hardening.
- Closed shadow-root support.
- Network shims or stealth patches.
- Public docs deployment.
- Making `chrome.debugger` the default screenshot path; it remains opt-in.
