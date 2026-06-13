---
title: Phase 6 — Element target aliases
---

> **For implementers:** this phase designs and implements the accepted feature request from [`docs/internal/journal/2026-06-13-element-handles-agent-dx.md`](../../journal/2026-06-13-element-handles-agent-dx.md). The feature is intentionally framed as **daemon-owned element target aliases**, not native DOM handles.

**Goal:** Make read→act workflows ergonomic without weakening bproxy's sensor/actuator boundary. After a read command returns actionable items, an agent should be able to use a short-lived handle such as `el5` in a later action instead of copying a brittle selector or full route JSON.

**Strategy:** Architecture-first implementation. The hard part is not minting strings; it is stale-page safety, bounded memory, type separation between agent input and daemon→extension forwarding, and observability. The extension changes are minimal (one WS push of navigation events).

**Spec inputs:**

- Feature request: [`2026-06-13-element-handles-agent-dx.md`](../../journal/2026-06-13-element-handles-agent-dx.md)
- Governing ADR: [`ADR-027`](../../decisions.md#adr-027-daemon-owned-element-target-aliases-for-readact-workflows)
- Sensor/actuator boundary: [`ADR-017`](../../decisions.md#adr-017-sensoractuator-boundary)
- Shadow-DOM targeting: [`ADR-014`](../../decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting)
- Click/hover actuator scope: [`ADR-026`](../../decisions.md#adr-026-explicit-clickhover-actuator-primitives)
- Current solution specs: `docs/public/solution/{shared,service,extension,cli}.md`

**Roadmap entry:** [Phase 6 in roadmap.md](../roadmap.md#phase-6--element-target-aliases).

---

## Prerequisite: read architectural context in full

Before writing any code, the implementing agent **must** read the following documents completely. These are not optional references — they contain constraints, type contracts, and security invariants that govern every implementation choice in this phase. Skipping them leads to rework.

| Document | Why it matters |
|---|---|
| [`docs/internal/decisions.md`](../../decisions.md) | All ADRs. Especially ADR-007 (write contract), ADR-014 (shadow-DOM targeting), ADR-015 (MAIN-world hygiene), ADR-017 (sensor/actuator boundary), ADR-021 (session authority), ADR-024 (no eval), ADR-026 (click/hover), ADR-027 (element handle aliases — the governing decision). |
| [`docs/public/index.md`](../../../public/index.md) | Design principles, project motivation, and the "narrow explicit interface" philosophy. |
| [`docs/public/solution/shared.md`](../../../public/solution/shared.md) | Protocol envelope, action params/results, `ElementTarget` type, `ElementInfo`, `LinkInfo`, error taxonomy — the exact types being extended. |
| [`docs/public/solution/service.md`](../../../public/solution/service.md) | Daemon internals: dispatch, pacing, pending map, WS route, command route, session registry, observability contract — the integration points for the handle cache. |
| [`docs/public/solution/extension.md`](../../../public/solution/extension.md) | Extension runtime shape, background SW responsibilities, content-script targeting, wire contract, navigation tracking in `tabs.ts` — the code being minimally modified. |
| [`docs/public/solution/cli.md`](../../../public/solution/cli.md) | CLI target parsing (`targets.ts`), command pattern, exit codes, output contract — the surface receiving `--element`. |
| [`docs/internal/architecture.md`](../../architecture.md) | System shape, component responsibilities, protocol examples, action table. |
| [`docs/internal/journal/2026-06-13-element-handles-agent-dx.md`](../../journal/2026-06-13-element-handles-agent-dx.md) | The original feature request with acceptance constraints. |

Do not begin Task 1 until all documents above have been read. Implementation decisions that contradict these documents are bugs.

---

## Locked design decisions

All decisions below are final for implementation. Do not invent alternatives inside code review.

### D1. Handle naming

Handles are **action-prefixed positional identifiers**, 1-based, sequential within a single response.

| Source action | Prefix | Examples |
|---|---|---|
| `elements` | `el` | `el1`, `el2`, `el47` |
| `links` | `ln` | `ln1`, `ln2`, `ln120` |

Format regex: `/^(el|ln)\d+$/`.

Numbering resets to 1 for each response. The Nth actionable entry in a response gets handle number N. Non-actionable entries (those without a resolvable `ElementTarget`) do not receive handles and do not consume a position.

### D2. Page identity mechanism — hybrid daemon epoch + URL

Page identity uses two signals together:

1. **Navigation epoch** — monotonic per-tab integer, incremented on every top-level `webNavigation.onCommitted` and `webNavigation.onHistoryStateUpdated` event. Maintained by the daemon from extension WS push messages.

2. **URL snapshot** — the page URL at the moment handles were minted (from `PageState.url` in the response).

A handle is valid only when both conditions hold:
- The daemon's current epoch for that tab equals the epoch stored in the handle entry.
- The daemon's current URL for that tab equals the URL stored in the handle entry.

If either check fails → `ELEMENT_HANDLE_STALE`.

If the daemon has no epoch data (WS disconnected, tab not tracked) → fail closed for any handle resolution attempt (`ELEMENT_HANDLE_STALE`).

**Known V1 limitation:** Pure client-side re-renders that do not call `pushState`/`replaceState` and do not trigger `webNavigation` events will not invalidate handles. The 120-second TTL is the safety net. This is documented, not fixed in V1.

### D3. Extension navigation push messages

The extension background SW sends an unsolicited WS message to the daemon on every top-level frame navigation event. This is the sole extension-side change for Phase 6.

Message shape (extension → daemon, over the existing WS connection):

- `type`: literal string `"navigation"`
- `tabId`: Chrome tab id (number)
- `url`: new URL (string)
- `cause`: one of `"committed"` | `"history_state"`

The daemon ignores messages where `tabId` does not map to any known session-tab. The daemon must not error or disconnect on unrecognized tab ids — the extension may have tabs outside any session.

Implementation location: add the `ws.send()` call inside the existing `committed` and `history` handlers in `extension/src/background/tabs.ts`. Only emit for `frameId === 0`. The WS client's `send()` method already handles the "not connected" case (returns `false`).

### D4. Daemon page-epoch tracking

The daemon maintains a `Map<number, PageEpoch>` keyed by Chrome tab id:

- `epoch`: number, starts at 0, incremented on each navigation message received
- `url`: string, updated on each navigation message

This map is populated by processing `type: "navigation"` WS messages from the extension. It is cleared for a tab when the tab is removed from all sessions.

Integration point: inside the WS route message handler (`service/src/routes/ws.ts`), before the existing `pending.resolveById` check, add a branch for `msg.type === "navigation"`.

### D5. Cache model

**Data structure:** A single `Map<string, HandleEntry>` in the daemon, keyed by handle composite key `{session}:{tab}:{handle}`.

**HandleEntry fields:**

- `handle`: the string identifier (e.g. `el5`)
- `session`: SessionId
- `tab`: TabHandle (logical)
- `chromeTabId`: number (for epoch lookup)
- `sourceAction`: `"elements"` | `"links"`
- `target`: ElementTarget (the resolved selector or route)
- `pageUrl`: string (URL at mint time)
- `pageEpoch`: number (epoch at mint time)
- `createdAt`: number (unix ms)
- `hints`: optional `{ tag?: string; role?: string; textSnippet?: string; href?: string }`

**Bounds:**

| Parameter | Value |
|---|---|
| Default TTL | 120 000 ms (2 minutes) |
| Per session-tab-action cap | 200 entries |
| Global daemon cap | 1000 entries |
| Eviction strategy | LRU by `createdAt` (oldest first) under pressure |

**Eviction triggers:**

- TTL exceeded (lazy check on access, no background sweeper)
- Per session-tab-action cap exceeded when minting new handles (evict oldest from same scope)
- Global cap exceeded when minting (evict oldest globally)

### D6. Replace-on-re-read semantics

When a new read action (`elements` or `links`) succeeds for a given `{session, tab, sourceAction}`, all previously minted handles for that exact scope are invalidated (deleted from the map) before the new handles are stored.

This means: after `bproxy elements -s X`, all prior `elN` handles for session X's bound tab are gone. The agent always works with the freshest read. This is correct behavior — stale handles from a previous read should not be usable after the page state has been re-observed.

### D7. Error codes

| Code | Category | Retry | Meaning | Agent recovery |
|---|---|---|---|---|
| `ELEMENT_HANDLE_NOT_FOUND` | `target` | `conditional` | Handle is unknown, evicted, or TTL-expired | Re-run the read action |
| `ELEMENT_HANDLE_STALE` | `target` | `conditional` | Page navigated since handle was minted (epoch or URL mismatch), or epoch data unavailable | Re-run the read action |
| `ELEMENT_HANDLE_SCOPE_MISMATCH` | `target` | `never` | Handle belongs to a different session or tab | Use handles from the correct session/tab |

Add these to `shared/src/errors.ts` in the `ErrorCode` union and to the error metadata table.

### D8. Type model

New file: `shared/src/handles.ts` (re-exported from `shared/src/index.ts`).

Types to define:

- `ElementHandle` — branded string type matching `/^(el|ln)\d+$/`
- `ElementHandleRef` — object with a single `handle` field of type `ElementHandle`
- `ClientElementTarget` — union: `ElementTarget | ElementHandleRef`

**Boundary rule (enforced at compile time):**

- CLI commands and daemon HTTP input may accept `ClientElementTarget`.
- `BproxyForwardedRequest` params must contain only `ElementTarget` — never `ElementHandleRef`.
- The daemon resolves `ElementHandleRef → ElementTarget` before constructing the forwarded request.

The extension never imports `ElementHandle`, `ElementHandleRef`, or `ClientElementTarget`. Use a `dependency-cruiser` rule to enforce this.

### D9. Response decoration

When the daemon receives a successful response for `elements` or `links`, it decorates the result entries before returning to the CLI:

- For `elements`: each `ElementInfo` in `data.elements` that has an actionable `ElementTarget` (either `selector` or `route` present) gets an additional `handle` field.
- For `links`: each `LinkInfo` in `data.links` that has an actionable `target` field gets an additional `handle` field.

The decorated response types extend the base types with an optional `handle: string` field. The `ActionResult` types in shared should add `handle?: string` to `ElementInfo` and `LinkInfo`.

### D10. CLI target parsing

Modify `cli/src/targets.ts` to accept a third targeting strategy: `--element <handle>`.

**Mutual exclusion:** exactly one of `--selector`, `--route-json`, or `--element` must be provided. Providing multiple or none (for commands that require a target) is exit code 2.

**Validation:** CLI validates handle format (`/^(el|ln)\d+$/`) locally. Invalid format → exit 2 with a clear message. Valid format → send as `{ handle: "el5" }` in the request params (as `ClientElementTarget`).

**Commands that accept `--element`:** `click`, `hover`, `fill`, `fill-form` (per-field), `select`, `scroll` (when targeting an element).

### D11. Daemon resolution flow

Located in new file `service/src/element-handles.ts`.

Resolution steps (in order):

1. Parse handle from request params (already validated by schema as matching handle format).
2. Look up entry by composite key `{session}:{tab}:{handle}`.
3. If not found → `ELEMENT_HANDLE_NOT_FOUND`.
4. If `Date.now() - entry.createdAt > TTL` → delete entry, return `ELEMENT_HANDLE_NOT_FOUND`.
5. If `entry.session !== request.session` or `entry.tab !== currentBoundTab` → `ELEMENT_HANDLE_SCOPE_MISMATCH`.
6. Look up current page epoch for `entry.chromeTabId`.
7. If epoch data unavailable (tab not tracked or WS disconnected) → `ELEMENT_HANDLE_STALE`.
8. If `currentEpoch !== entry.pageEpoch` or `currentUrl !== entry.pageUrl` → `ELEMENT_HANDLE_STALE`.
9. Return `entry.target` (the stored `ElementTarget`).

The resolved `ElementTarget` replaces the `ElementHandleRef` in the request params before the request enters the normal dispatch path.

### D12. Invalidation events

| Event | Invalidation scope |
|---|---|
| Navigation epoch increment (WS push received) | All handles for that `chromeTabId` |
| New read of same action type for same session-tab | All handles for that `{session, tab, sourceAction}` |
| Session close | All handles for that session |
| Tab close (via `tab.close` or tab removed event) | All handles referencing that `chromeTabId` |
| WS disconnect | Do NOT bulk-delete handles; instead fail closed on resolution (epoch unavailable) |
| TTL expiry | Lazy on access; no sweeper |
| Global cap pressure | Evict oldest entries globally until under cap |

### D13. Observability

**Log events (info level):**

- `handle_mint` — emitted per batch: `{ event, id, session, tab, sourceAction, count, firstHandle, lastHandle }`
- `handle_resolve` — emitted per resolution attempt: `{ event, id, handle, session, tab, outcome }` where outcome is one of `ok`, `not_found`, `expired`, `stale_epoch`, `stale_url`, `scope_mismatch`, `no_epoch_data`
- `handle_invalidate` — emitted per bulk invalidation: `{ event, session, tab, cause, count }`

**Debug level adds:** `tag`, `role`, first 30 characters of `textSnippet` (truncated). Never log full URLs with query strings, form values, or Chrome tab ids at info level.

**CLI `--verbose` stderr:** shows handle resolution step: `resolving el5 → selector "button.submit"` (or route summary). No page content.

---

## Runtime responsibility split

| Component | Responsibility | Changes |
|---|---|---|
| **shared** | Define `ElementHandle`, `ElementHandleRef`, `ClientElementTarget` types. Add `handle?: string` to `ElementInfo` and `LinkInfo`. Add 3 error codes. | New `handles.ts` file. Modified `actions.ts`, `errors.ts`, `index.ts`. |
| **CLI** | Parse `--element` flag. Validate handle format. Send `ClientElementTarget` in params. | Modified `targets.ts`. Modified commands: `click`, `hover`, `fill`, `fill-form`, `select`, `scroll`. |
| **Daemon** | Mint handles from read responses. Store bounded cache. Track page epochs from WS navigation pushes. Resolve handles before dispatch. Invalidate on lifecycle events. Log resolution outcomes. | New `element-handles.ts`. Modified `routes/ws.ts`, `routes/command.ts`, `dispatch.ts`, `sessions.ts`, `schemas.ts`. |
| **Extension** | Push top-level navigation events over WS. No other changes. | Modified `background/tabs.ts` (add `ws.send` in committed/history handlers). |

---

## Locked outcomes

1. **Read outputs include handles where useful.** `elements` and `links` return handles for entries with actionable `ElementTarget`s.
2. **Actuator commands accept handles.** `click`, `hover`, `fill`, `select`, and explicit-target `scroll` accept `--element elN/lnN`.
3. **Extension execution remains explicit-target only.** No handle reaches content-script targeting code.
4. **Handles are short-lived and scoped.** A handle minted in one `{session, tab, page}` cannot be used elsewhere.
5. **Stale use fails closed.** Navigation, reload, SPA pushState, expiry, cache eviction, tab close, session close, and WS disconnect do not lead to accidental actions on the wrong element.
6. **Memory is bounded.** 200 per scope, 1000 global, 120s TTL. Tested.
7. **No page-visible identity.** No marker attributes, no persistent page state, no DOM mutation.
8. **Replace-on-re-read.** Fresh reads invalidate prior handles from the same scope.
9. **Extension change is minimal.** Only navigation event push over existing WS. No content-script changes.

---

## Out of scope

- Native DOM node handles or remote object references.
- Page mutation for identity tagging.
- Extension-owned cross-command element identity.
- Selector repair, click-by-text, fallback chains, modal/cookie-banner solvers, or strategy automation.
- Method auto-selection for `fill`.
- Arbitrary eval, debugger-backed page investigation, persistent MAIN-world listeners, or `MutationObserver`.
- Long-lived persisted handle stores (handles are in-memory only, lost on daemon restart).
- Handles for `snapshot`, `inspect`, `dom`, or other read actions (deferred to later phases if needed).
- Background sweeper for expired handles (lazy eviction is sufficient).

---

## File structure

### New files

```
shared/src/handles.ts              — ElementHandle, ElementHandleRef, ClientElementTarget, HANDLE_PATTERN
service/src/element-handles.ts     — HandleCache class: mint, resolve, invalidate, epoch tracking
service/src/__tests__/element-handles.test.ts — cache, TTL, eviction, scope, stale, epoch
```

### Modified files

```
shared/src/actions.ts              — add handle?: string to ElementInfo and LinkInfo
shared/src/errors.ts               — add 3 error codes
shared/src/index.ts                — re-export handles.ts

service/src/routes/ws.ts           — handle "navigation" messages, update epoch map
service/src/routes/command.ts      — decorate read responses with handles after success
service/src/dispatch.ts            — resolve handle refs before forwarding (or pre-dispatch hook)
service/src/sessions.ts            — hook session.close and tab removal to invalidate handles
service/src/schemas.ts             — validate ClientElementTarget in action params

cli/src/targets.ts                 — add parseElement(), mutual exclusion with selector/route
cli/src/commands/click.ts          — add --element arg
cli/src/commands/hover.ts          — add --element arg
cli/src/commands/fill.ts           — add --element arg
cli/src/commands/fill-form.ts      — support handle refs per field
cli/src/commands/select.ts         — add --element arg
cli/src/commands/scroll.ts         — add --element arg

extension/src/background/tabs.ts   — send navigation push in committed/history handlers
```

---

## Implementation tasks

### Task 1: Shared types

Add `shared/src/handles.ts` with the types and pattern constant. Add `handle?: string` to `ElementInfo` and `LinkInfo` in `actions.ts`. Add error codes to `errors.ts`. Re-export from index.

**Done when:** `pnpm --filter @bproxy/shared typecheck` passes. Consumers that use `ElementInfo` or `LinkInfo` see the optional `handle` field. New error codes are available.

### Task 2: Extension navigation push

In `extension/src/background/tabs.ts`, inside the existing `committed` and `history` handlers (which already fire for `frameId === 0` events), add a WS send of the navigation message. The WS client reference should be accessible from the background dispatcher context — follow the same pattern used for sending responses.

**Done when:** Extension unit tests verify that top-level navigation events produce WS messages. Sub-frame events do not. Send failures (WS not connected) are silent.

### Task 3: Daemon handle cache

Implement `service/src/element-handles.ts` as a standalone module with a clean interface:

- `mint(session, tab, chromeTabId, sourceAction, entries, pageUrl, pageEpoch)` → returns decorated entries with handles assigned
- `resolve(session, tab, handle)` → returns `ElementTarget` or a structured error
- `invalidateForTab(chromeTabId)` — called on navigation epoch change
- `invalidateForSession(session)` — called on session close
- `invalidateForScope(session, tab, sourceAction)` — called before minting new handles from a fresh read
- `handleNavigation(chromeTabId, url)` — processes navigation push, increments epoch, triggers tab invalidation
- `getPageEpoch(chromeTabId)` — returns current epoch/url or null (for resolution checks)

Expose bounds as constructor parameters for testability (TTL, per-scope cap, global cap).

**Done when:** Unit tests cover: minting, resolution, TTL expiry, eviction under pressure, scope mismatch, epoch mismatch, URL mismatch, replace-on-re-read, session close invalidation, tab close invalidation, epoch unavailable fails closed.

### Task 4: Daemon integration

Wire the handle cache into the daemon request lifecycle:

1. **WS route** (`routes/ws.ts`): parse `type: "navigation"` messages and call `handleNavigation()`.
2. **Command route** (`routes/command.ts`): after a successful `elements` or `links` response, call `mint()` to decorate the response before returning to CLI.
3. **Dispatch** (`dispatch.ts` or a pre-dispatch hook): if request params contain an `ElementHandleRef`, call `resolve()` and rewrite params. If resolution fails, return the error response without forwarding.
4. **Sessions** (`sessions.ts`): on session close and tab removal, call the corresponding invalidation method.
5. **Schemas** (`schemas.ts`): update Zod schemas to accept `ClientElementTarget` (handle ref OR explicit target) in relevant action params.

**Done when:** Integration tests demonstrate a full round-trip: read → handles in response → actuator with handle → resolution → forwarded with explicit target. Error paths tested.

### Task 5: CLI target UX

Extend `cli/src/targets.ts`:

- Add `--element` as a new targeting strategy alongside `--selector` and `--route-json`.
- Enforce mutual exclusion (exactly one of three).
- Validate handle format locally (regex match → exit 2 on invalid).
- Produce `{ handle: "el5" }` in the request body for daemon consumption.

Update all target-taking commands to include the `--element` arg definition.

**Done when:** CLI unit tests verify parsing, mutual exclusion errors, format validation, and correct request body shape.

### Task 6: Schema validation

Update `service/src/schemas.ts` to accept the `ClientElementTarget` shape in action params that support element targeting. The schema must accept either `{ selector: string }`, `{ route: ElementRoute }`, or `{ handle: string }` — but never combinations.

**Done when:** Invalid handle formats are rejected at schema validation (400). Valid handles pass through to the resolution step.

### Task 7: Extension invariants check

Verify:
- Content-script `targeting.ts` still only accepts `ElementTarget` (no handle type imported).
- No marker attributes written to the DOM.
- `dependency-cruiser` rule enforced: `extension/` cannot import from `shared/src/handles.ts` (except the extension background for type-awareness of the navigation message shape, which does not use handle types).
- Production artifact check: no `MutationObserver`, no declarative content scripts, no WAR.

**Done when:** `pnpm check` passes including architecture rules. Test explicitly asserts extension bundle does not contain handle-resolution logic.

### Task 8: Architecture and documentation update

This task reconciles all documentation with shipped behavior. Each file below has a specific reason for change — do not skip any.

#### Public solution specs (reference docs, must match implementation)

| File | Required changes |
|---|---|
| `docs/public/solution/shared.md` | Add `shared/src/handles.ts` to project layout. Document `ElementHandle`, `ElementHandleRef`, `ClientElementTarget` types. Add `handle?: string` to the `ElementInfo` and `LinkInfo` type listings. Add 3 new error codes to the Error Taxonomy table. |
| `docs/public/solution/service.md` | Add `element-handles.ts` to project layout. Add a new section "Element Handle Cache" documenting: minting flow, resolution flow, bounds/TTL, eviction, page-epoch tracking. Update the WS route section to document `type: "navigation"` inbound messages. Update the command route section to mention response decoration for `elements`/`links`. Add handle error codes to the error responses table. Add `handle_mint`, `handle_resolve`, `handle_invalidate` to the observability lifecycle events table. |
| `docs/public/solution/cli.md` | Document `--element` flag in the Global Flags or Write Commands section (it applies to all target-taking commands). Update the command pattern description for `click`, `hover`, `fill`, `select`, `scroll` to mention the third targeting strategy. Update `targets.ts` description in the project layout. |
| `docs/public/solution/extension.md` | Add one line to the "Wire contract with the daemon" section documenting the outbound `type: "navigation"` push message shape. Mention in the background SW responsibilities that it pushes navigation events. No content-script or popup changes needed. |

#### Public views (architectural diagrams)

| File | Required changes |
|---|---|
| `docs/public/views/02-containers.md` | No structural change to the Mermaid diagram (no new containers). Update the prose paragraph about daemon responsibilities to mention "element handle cache" alongside existing session/pacing/pending responsibilities. |
| `docs/public/views/04-session-state.md` | Add a brief paragraph or note after "Logical tab handles" explaining that element handles are scoped to a session-tab-page and invalidated on navigation, session close, and tab close. No state diagram change (handles are not a session state — they're daemon cache). |
| `docs/public/views/06-threat-model.md` | Add one row to the "Extension surface" table documenting that navigation push messages over WS carry Chrome tab ids but these are already internal to the daemon boundary and not exposed to CLI/agent. Add one row to the STRIDE daemon table for DoS consideration: handle cache is bounded (1000 global cap) preventing memory exhaustion from repeated reads. |
| `docs/public/views/auto/service-components.svg` | Will be auto-regenerated by `pnpm views:regen` after the new `element-handles.ts` module is added. Run the command; do not manually edit SVGs. |

#### Internal architecture docs

| File | Required changes |
|---|---|
| `docs/internal/architecture.md` | Add "Element target aliases" subsection under the Daemon component description, covering: daemon-owned handle cache, page-epoch tracking from extension WS push, resolution before dispatch, bounded in-memory store. Update the Protocol section's sample request to show that `params.target` may now be a `ClientElementTarget` at the CLI/daemon boundary. Update the Actions table to note that `elements` and `links` results include optional handles. |
| `docs/internal/scenarios.md` | Update Scenario 1 (Google research) command transcript to demonstrate handle usage: after `bproxy links ...` show that results include `handle: "ln3"` etc., and add a follow-up `bproxy click -s m4q7z2 --element ln3` demonstrating the read→act flow. Keep existing selector-based examples alongside for comparison. |
| `docs/internal/decisions.md` | No changes unless ADR-027 text needs correction after implementation. If the handle prefix scheme (`el`/`ln`) or the specific error codes differ from what ADR-027 states, amend ADR-027's "Accepted shape" section accordingly. |
| `docs/internal/plans/roadmap.md` | Update the Phase 6 output description to reflect the final handle naming scheme (`el`/`ln` prefixes instead of generic `e17`). Mark Phase 6 status as complete. |

#### Validation

After all documentation changes:

1. `pnpm docs:build` passes (Astro Starlight compiles without broken links).
2. `pnpm views:audit` reports no drift between source and generated views.
3. `pnpm views:regen` regenerates component SVGs reflecting new daemon module.
4. Grep all docs for stale references to the generic `e17`/`eN` handle format and update to `el`/`ln` prefix scheme where appropriate.
5. Cross-check: every error code added to `shared/src/errors.ts` appears in at least one docs table.

**Done when:** all files above are updated, validation passes, and a reader of any single doc page gets an accurate and self-consistent picture of the handle feature without needing to cross-reference the phase plan.

---

## Task dependency order

```
Task 1 (shared types)
  ├─→ Task 2 (extension nav push) — independent of daemon work
  ├─→ Task 3 (daemon cache) — depends on shared types only
  │     └─→ Task 4 (daemon integration) — depends on cache + nav push being defined
  ├─→ Task 5 (CLI targets) — depends on shared types only
  └─→ Task 6 (schema validation) — depends on shared types only

Task 4 depends on: Task 1, Task 2, Task 3
Task 7 depends on: Task 2, Task 4
Task 8 depends on: Task 1–7 all complete (docs must describe final shipped behavior)
```

Tasks 2, 3, 5, 6 can proceed in parallel after Task 1 is complete.

Task 8 is intentionally last — documentation must describe the implemented reality, not a plan. Run it only after all code tasks pass `pnpm check` and `pnpm test`.
