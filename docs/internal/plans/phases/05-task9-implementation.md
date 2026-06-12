---
title: Task 9 Implementation Plan — Observability, Deadlines, Error-Envelope Hardening
parent: 05-integration-hardening.md
---

## Objective

Close the remaining Task 9 items: structured log lifecycle coverage, deadline correctness for background-handled actions, complete `BproxyError` envelopes everywhere, `debug.status`/`debug.last` cleanup, `busy` false-positive tightening, raw-id quarantine in verbose output, and regression tests for all of the above.

---

## Current state

**Already working:**
- `received` → `forwarded` → `response` log lifecycle for dispatched actions (tested in `observability-contract.test.ts`)
- `pacing_wait`, `pacing_config`, `timeout`, `replay`, `ws_connect`, `ws_disconnect` events all exist and are tested
- `pending.ts` has deadline/timeout machinery with `TIMEOUT` error responses
- `dispatch.ts` returns `NO_EXTENSION` when no WS client is connected
- `session-actions.ts` returns `SESSION_REQUIRED`, `INVALID_SESSION_ID`, `SESSION_NOT_FOUND` for validation failures
- `tab-actions.ts` returns `TAB_NOT_FOUND`, `TAB_NOT_IN_SESSION`, `TAB_HANDLE_NOT_FOUND`
- `debug.status` shows sessions, tabs, paused state
- `debug.last` shows `DaemonRequestTrace[]` from a ring buffer (but ring buffer is not wired in `lifecycle.ts` — traces is `() => []` unless injected)

**Gaps:**
1. **Log lifecycle for session-local and tab-mediated actions.** `session.create`, `session.close`, `session.bind`, `tab.open`, `tab.list` go through `executeCommand` → the `received`/`response` events fire from `commandRoute`, but `forwarded` is only emitted by `dispatch.ts`. Session-local actions never emit `forwarded` because they don't use the WS — this is correct. But `tab.open` does dispatch and the `forwarded` event fires. **Verification needed:** confirm `session.create` and `session.close` produce `received` + `response` logs with `id`. Write tests.
2. **Deadline for `tabId: null` (background-handled) actions.** The `pending.ts` timeout is based on `cmd.deadline`. `tab.open` is dispatched with `targetTabId: null`, which skips the tab-lock but still enters `pending.register`. Deadline expiry should produce `TIMEOUT`. **Verification needed:** test that `tab.open` with a short deadline and a hanging extension returns `TIMEOUT`.
3. **`NO_EXTENSION` → `EXTENSION_NOT_CONNECTED` error code.** The plan says `EXTENSION_NOT_CONNECTED` but dispatch currently uses `NO_EXTENSION`. Check shared error taxonomy — if `NO_EXTENSION` is already the canonical code, keep it. If the plan's `EXTENSION_NOT_CONNECTED` was aspirational, use the existing code and document.
4. **Malformed extension response.** When a WS client sends back garbage, `pending.resolveById` is never called (the response parser in `ws.ts` likely silently drops it). The request times out. Verify this path produces `TIMEOUT` (not a crash). Add a test.
5. **`debug.status` leaks.** `sessionTabs` includes `TabInfo[]` from `listTabs` which does NOT include `chromeTabId` (the `toTabInfo` function strips it). Confirmed safe. `debug.last` traces use `DaemonRequestTrace` which only has `id`, `action`, `session`, etc. — no raw ids. **Gap:** the traces ring buffer is never populated in production (`lifecycle.ts` does not wire it). Need to wire or document as deferred.
6. **`busy` false-positive.** `page-state.ts` uses `BUSY_SELECTOR = '[aria-busy="true"], [role="progressbar"], progress:not([value])'`. Google's SERP has hidden `[aria-busy="true"]` elements or invisible progressbars left in the DOM. Fix: require visibility (e.g., check computed display/visibility or use `checkVisibility()`).
7. **Raw ids in `--verbose`.** The CLI `VerboseEntry` has `requestId`, `action`, `session`, `url`, `elapsed`, `httpStatus`, `errorCode`. No raw Chrome ids. The daemon log events include `tab: 42` in the `forwarded` event — this is server-side log only, not CLI `--verbose` output. **Assessment:** already clean at the CLI boundary. Document that daemon logs may contain internal tab ids for debugging.

---

## Subtasks (implementation order)

### 9.1 — Wire traces ring buffer in production lifecycle

**Files:** `service/src/lifecycle.ts`

The `buildServer` option `traces` defaults to `() => []`. The lifecycle start script (`lifecycle.ts`) needs to maintain a fixed-size ring buffer and pass it as `traces` to `buildServer`.

**Steps:**
1. Create a simple ring buffer utility (or inline): fixed capacity (e.g., 200), push appends, when full overwrites oldest.
2. In `lifecycle.ts`, after each command response, push a `DaemonRequestTrace` into the buffer.
3. Pass `() => ringBuffer.items()` to `buildServer({ traces: ... })`.

**Alternative:** If `lifecycle.ts` doesn't have access to the command hook, add an `onResponse` callback to `commandRoute` or use the existing `logResponse` to also push to the ring buffer. Simplest: add a `deps.trace` callback to `CommandRouteDeps`, call it from `logResponse`.

### 9.2 — Add lifecycle log tests for session-local and tab-mediated actions

**Files:** `service/src/__tests__/observability-contract.test.ts` (extend)

**Tests to add:**
- `session.create` emits `received` + `response` with the request `id`, no `forwarded` event.
- `session.close` with tabs emits `received` + sub-request `forwarded` events (from the close loop) + final `response`.
- `tab.open` emits `received` + `forwarded` (with `tab: null`) + `response`.
- `tab.list` emits `received` + `response` (no `forwarded` — daemon-local).

### 9.3 — Test deadline/timeout for extension-control actions (`tabId: null`)

**Files:** `service/src/__tests__/observability-contract.test.ts` or new file `service/src/__tests__/deadline.test.ts`

**Test:**
- Connect a WS extension client that never responds.
- Send `tab.open` with `deadline: Date.now() + 300`.
- Assert response is `{ ok: false, error: { code: "TIMEOUT" } }`.
- Assert a `timeout` log event is emitted with the request `id`.

### 9.4 — Test `NO_EXTENSION` when no WS client

**Files:** same test file as 9.3

**Test:**
- Do NOT connect any extension WS client.
- Send any dispatched action (e.g., `text` with a bound session).
- Assert response is `{ ok: false, error: { code: "NO_EXTENSION", category: "transport" } }`.

### 9.5 — Test malformed extension response → timeout

**Files:** same test file as 9.3

**Test:**
- Connect WS client that sends back invalid JSON (or valid JSON that doesn't match `BproxyResponse`).
- Send action with short deadline.
- Assert response eventually returns `TIMEOUT` (not a crash or hang beyond deadline).

Requires checking how `ws.ts` handles parse failures — if it silently drops, the pending entry times out naturally. Confirm.

### 9.6 — BproxyError envelope completeness audit

**Purpose:** Ensure every error path returns well-formed `{ code, category, retry, message }`.

**Approach:** Grep all `errorResponse(...)` and `failure(...)` calls. Verify each has all four required fields. This is likely already satisfied since `BproxyError` is typed, but confirm there's no `as any` or partial construction.

**Test (single integration test):** Send requests that trigger each error path and assert response shape:
- Missing session → `SESSION_REQUIRED`
- Invalid session format → `INVALID_SESSION_ID`
- Non-existent session → `SESSION_NOT_FOUND`
- No bound tab → `TAB_NOT_FOUND`
- Tab from another session → `TAB_NOT_IN_SESSION`
- Paused session → `HUMAN_REQUIRED`
- No extension connected → `NO_EXTENSION`
- Deadline exceeded → `TIMEOUT`

Each must have `{ code, category, retry, message }` as non-empty strings.

### 9.7 — Tighten `busy` false-positive heuristic

**Files:** `extension/src/content/page-state.ts`, `extension/src/content/__tests__/page-state.test.ts`

**Problem:** `BUSY_SELECTOR` matches any `[aria-busy="true"]` even if the element is hidden (e.g., `display: none`, `visibility: hidden`, zero-size). Google SERP leaves hidden busy markers in the DOM.

**Fix:** Change `hasBusyHint` to require the matched element to be visible. Use `element.checkVisibility()` (supported in Chrome 105+, our only target) or fallback to checking `offsetParent !== null` / computed styles.

**Implementation:**
```typescript
function hasBusyHint(doc: DomSnapshotDeps["document"]): boolean {
  const el = doc.querySelector(BUSY_SELECTOR);
  if (!el) return false;
  // Only count visible busy indicators
  if (typeof (el as HTMLElement).checkVisibility === 'function') {
    return (el as HTMLElement).checkVisibility();
  }
  return (el as HTMLElement).offsetParent !== null;
}
```

**Tests:**
- Hidden `[aria-busy="true"]` element (display:none) → `busy: false`
- Visible `[aria-busy="true"]` element → `busy: true`
- Hidden `progress` element → `busy: false`
- No busy elements → `busy: false`

**Challenge:** Unit tests use JSDOM-like mocks. `checkVisibility()` is not available in JSDOM. Options:
- Mock `checkVisibility` on the element prototype in tests.
- Use a shim: if `checkVisibility` is unavailable (test env), fall back to `offsetParent`.
- Refactor `hasBusyHint` to accept a visibility checker dependency.

Prefer: refactor `DomSnapshotDeps` to include a `isVisible(el: Element): boolean` dependency, default to `checkVisibility` in production, injectable in tests.

### 9.8 — Update `debug.status` to show logical tab state without raw ids

**Files:** `service/src/debug-actions.ts`

**Current state:** `debug.status` already uses `deps.sessions.list()` (returns `SessionInfo[]`) and `deps.sessions.listTabs(id)` (returns `TabInfo[]`). `TabInfo` does NOT include `chromeTabId` — already clean.

**Action:** Verify the response shape in a test: assert `debug.status` response data does not contain any numeric `tabId` or `chromeTabId` field at any nesting level. Add a test.

### 9.9 — Document raw-id policy for daemon logs vs CLI `--verbose`

**Files:** Update inline comments in `service/src/dispatch.ts` (the `forwarded` event includes `tab: number | null`) and in `cli/src/output.ts`.

**Approach:** This is documentation-only:
- Daemon log `forwarded` events include `tab` (internal Chrome tab id) for operator diagnostics — this is acceptable because daemon logs are not agent-facing.
- CLI `--verbose` output (`VerboseEntry`) never includes raw Chrome tab ids — confirmed by type structure.
- Add a brief comment in `output.ts` documenting this invariant.

### 9.10 — Add regression test for false-success scroll reporting

**Files:** `service/src/__tests__/observability-contract.test.ts` or extension-level test

**Current state:** Scroll was fixed in commit `78cc005`. The extension now reports `moved: boolean`. The plan says "Add tests for ... false-success scroll reporting under the new model."

**Test:** A unit test for the scroll content handler that returns `moved: false` when the scroll position did not change. Likely already covered in extension tests — verify. If not, add.

---

## Implementation order and dependencies

```
9.7 (busy fix)          — independent, extension-only
9.8 (debug.status)      — independent, quick verification test
9.9 (raw-id docs)       — independent, comments only
9.10 (scroll test)      — independent, verify existing coverage

9.1 (traces ring buf)   — independent, service only
9.2 (lifecycle logs)    — depends on 9.1 if we want traces in tests; otherwise independent
9.3 (deadline test)     — independent
9.4 (no extension)      — independent
9.5 (malformed resp)    — independent
9.6 (envelope audit)    — independent, can be done last as a sweep
```

**Recommended batch order:**
1. **Batch A (extension):** 9.7 — busy heuristic fix + tests
2. **Batch B (service tests):** 9.2, 9.3, 9.4, 9.5, 9.6 — all in one session, extend existing test files
3. **Batch C (traces):** 9.1 — wire ring buffer; then verify 9.2 traces work end-to-end
4. **Batch D (verification):** 9.8, 9.9, 9.10 — lightweight checks and docs

---

## Estimated scope

| Subtask | New/modified files | LOC estimate | Risk |
|---------|-------------------|--------------|------|
| 9.1 | lifecycle.ts, routes/types.ts or command.ts | ~30 | Low |
| 9.2 | observability-contract.test.ts | ~60 | Low |
| 9.3 | deadline.test.ts or observability-contract.test.ts | ~30 | Low |
| 9.4 | same | ~15 | Low |
| 9.5 | same + ws.ts verification | ~25 | Low |
| 9.6 | new or existing test file | ~50 | Low |
| 9.7 | page-state.ts + page-state.test.ts | ~40 | Medium (test env shim) |
| 9.8 | debug-actions.test.ts | ~15 | Low |
| 9.9 | comments only | ~5 | None |
| 9.10 | verify existing tests | ~0-15 | Low |

**Total:** ~285 LOC of new code/tests. No architectural changes. Medium risk only in 9.7 due to test-environment visibility API differences.

---

## Exit criteria

- `pnpm test` passes with new tests covering each subtask
- `pnpm check` passes (typecheck, format, lint, arch)
- No raw Chrome tab ids appear in: CLI stdout, CLI `--verbose` stderr, `debug.status` response, or `debug.last` response
- `busy: true` is not reported for pages with only hidden `[aria-busy]` elements
- Every error code path returns a complete `BproxyError` envelope (verified by test)
- `tab.open` with no extension connected times out correctly
- Traces ring buffer populates `debug.last` in real daemon runs
