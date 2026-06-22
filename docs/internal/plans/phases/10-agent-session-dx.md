---
title: "Phase 10: Agent session DX improvements"
status: in-progress
date: 2026-06-22
issue: "#21"
---

## Phase 10: Agent session DX improvements

**Motivation:** Issue #21 reports friction points observed during ~100 bproxy commands in a real agentic LinkedIn capture session. Four accepted requests reduce boilerplate in automation workflows without violating the sensor/actuator boundary.

**Source decisions:**

- [ADR-017](../../decisions.md#adr-017-sensoractuator-boundary) — extension is sensor+actuator only
- [ADR-022](../../decisions.md#adr-022-extension-control-routing-for-background-tab-actions) — background-handled tab actions
- [ADR-023](../../decisions.md#adr-023-first-class-links-extraction-and-phase-5-sessiontab-errors) — first-class `links` read action
- [ADR-024](../../decisions.md#adr-024-no-arbitrary-page-eval-and-no-scroll-target-inference) — no strategy in extension
- [ADR-027](../../decisions.md#adr-027-daemon-owned-element-target-aliases-for-readact-workflows) — element handle aliases
- [ADR-028](../../decisions.md#adr-028-temporary-files-confined-to-bproxy_home) — temp files stay under BPROXY_HOME

---

## Scope

| # | Feature | Layer | Risk |
|---|---------|-------|------|
| 1 | `tab activate` command | shared + CLI + service + extension | Low — follows `tab.pin` pattern exactly |
| 2 | `links --href-contains` filter | shared + CLI + extension | Low — content-script read-time predicate |
| 3 | Response truncation fix + `links --offset` | CLI investigation + shared + CLI + extension | Medium — requires root-cause analysis |
| 5 | `text --after` marker extraction | CLI-local post-processing | Low — no protocol change |

**Rejected (see issue review):**
- `scroll --until-end` — violates ADR-017 and ADR-024 (agent owns loop strategy)
- `--activate-if-needed` on destructive actions — violates ADR-017 (hidden recovery strategy)

---

## Feature 1: `tab activate` command

### Intent

Give agents an explicit, one-shot way to foreground a tab before issuing destructive actions. Eliminates the `TAB_NOT_VISIBLE` → `screenshot --activate` → retry workaround.

### Design

`tab.activate` is a background-handled browser action (same tier as `tab.pin`, `tab.close`). It uses `chrome.tabs.update(tabId, { active: true })` and optionally focuses the window with `chrome.windows.update(windowId, { focused: true })`.

**Wire shape:**

- Action name: `tab.activate`
- Params: `{ tab?: TabHandle }` — same pattern as `tab.pin`. Omitted = session's bound tab.
- Result: `{ tab: TabHandle; activated: true }`
- Destructive: yes (changes browser visual state)
- Forwarded to extension background SW (not content script)

**No auto-activation side-effect.** The existing `screenshot --activate` flag remains unchanged. No other action gains implicit activate behavior.

### Implementation touchpoints

**shared/**
- `actions.ts` — add `'tab.activate'` to `Action` union. Add params and result entries. Add to `ForwardedActionParams`.
- `protocol-shape.assertions.ts` — add compile-time assertion for `tab.activate` shape.

**cli/**
- `commands/tab/activate.ts` — new leaf command. Accepts `--tab tN` (optional). Follows `tab/pin.ts` structure exactly.
- `command-registry.ts` — classify `tab.activate` as destructive.
- `bproxy.ts` — register `tab activate` subcommand under the `tab` group.

**service/**
- `routes/tab-actions.ts` — add `tab.activate` to `isTabMediated`. Add an explicit `if (cmd.action === "tab.activate")` branch in `handleBoundTabAction` **before** the fallback `return await handleTabClose(...)` — the current code uses an implicit else for close, so any new branch must precede it.
- `schemas.ts` — add `tab.activate` to forwarded action set and params schema.

**extension/**
- `background/forwarded-actions.ts` — add `'tab.activate'` to `BrowserAction` type and both action arrays.
- `background/browser-actions.ts` — implement `handleTabActivate`: call `tabs.update(tabId, { active: true })`, then `windows.update(windowId, { focused: true })`. Return `{ activated: true }` with current page state.
- `background/browser-actions.ts` — add a new `BrowserWindowsSeam` interface (separate from `BrowserTabsSeam`) with a single method: `update(windowId: number, updateInfo: Record<string, unknown>): Promise<unknown>`. Inject it into `BrowserActionHandlerDeps`. This keeps tab and window concerns in separate seams and makes test faking straightforward.

### Edge cases

- Tab already active → succeed immediately (idempotent).
- Tab does not exist (closed externally) → propagate Chrome API error as `TAB_NOT_FOUND`.
- Window focus: always attempt window focus alongside tab activation. This ensures cross-window scenarios work.
- Element handle invalidation: `tab.activate` does NOT invalidate element handles — the page identity has not changed, only the tab's foreground status.

---

## Feature 2: `links --href-contains`

### Intent

Allow agents to filter links at extraction time, eliminating post-processing pipelines for every link-based workflow.

### Design

Add an optional `hrefContains` string param to the `links` action. The content script applies it as a case-sensitive substring match on the resolved absolute `href` before adding a link to the result array.

**Wire shape change:**

- `ActionParams['links']` gains: `hrefContains?: string`
- `ForwardedActionParams['links']` gains the same field (pass-through)
- No new result fields. Filtered links simply have fewer entries.

The filter applies **after** href normalization (so the agent matches against absolute URLs) and **before** the limit cap (so `--limit 5 --href-contains "/in/"` returns at most 5 matching links, not 5 links from which matches are then extracted).

### Implementation touchpoints

**shared/**
- `actions.ts` — add `hrefContains?: string` to `ActionParams['links']`. Note: `ForwardedActionParams['links']` is defined as a type alias (`ActionParams["links"]`) so the change propagates automatically — there is only one source edit.

**cli/**
- `commands/links.ts` — add `--href-contains` flag (type: string, optional). Wire into params.

**service/**
- `schemas.ts` — add `hrefContains` as optional string in the `links` params Zod schema.

**extension/**
- `content/actions/links.ts` — in `handleLinks`, after `toLinkInfo` produces a valid link, check `request.params.hrefContains`. If set and `link.href` does not include the substring, skip the entry.

### Constraints

- Case-sensitive match. Agents control casing in their filter string.
- Empty string `""` matches everything (no-op). `undefined` means no filter.
- No regex. This is a substring predicate, not a query language. Regex would expand the attack surface in the content script.
- Handle numbering: when `hrefContains` reduces the returned set, daemon mints handles `ln1..lnN` for the N returned links only. Handles are always 1-based within the response, not correlated to any page-global link index. A subsequent read (with or without filter) invalidates all previously minted link handles for that page — this is standard ADR-027 re-read invalidation.

---

## Feature 3: Response truncation fix + `links --offset` pagination

### Intent

Guarantee valid JSON output regardless of response size (fix the truncation bug), and add offset-based pagination for large link extractions.

### Part A: Truncation investigation and fix

The reported symptom is "unterminated string at char 65200" when parsing `bproxy links --limit 200` output. Potential root causes:

1. **Daemon response serialization** — Fastify body serialization hitting a buffer boundary. Unlikely given Fastify's streaming JSON serializer, but verify.
2. **CLI stdout pipe buffering** — `process.stdout.write` with large payloads may fail silently if the consuming pipe closes early or buffers fill. The CLI must handle write backpressure or verify full write completion.
3. **Shell pipe truncation** — if the agent pipes through `python3 -c ...` and the python process exits early or the pipe buffer fills, the shell may truncate stdout.

**Investigation steps (ordered by likelihood):**
1. Write a test in `cli/__tests__/` that generates a links response with 200+ entries (synthetic large JSON, >64KB), passes it through the CLI output path, and asserts the result parses as valid JSON.
2. Write a service-level integration test: daemon returns a large `links` payload; CLI receives and outputs complete valid JSON.
3. If the issue is CLI-side: ensure `writeJson` in `output.ts` handles backpressure correctly (await drain if `write` returns false, or use synchronous `writeFileSync` on fd 1).
4. If the issue is not reproducible in controlled tests: document the finding and recommended `--limit` ceiling in CLI help text for `links`.

**Fix principle:** The CLI output contract requires exactly one valid JSON object on stdout. If the write pipeline can produce truncated output under any condition, that is a bug.

**Important:** The actual stdout write for protocol commands happens through `executeExitPlan` in `cli/src/exit.ts` (`stdout.write(...)`) — not through `writeJson` in `output.ts`. Investigation must cover **both** code paths. The `writeJson` function is used in limited contexts; the primary protocol output path is `executeExitPlan`.

### Part B: `links --offset` pagination

Add offset-based pagination so agents can retrieve large link sets in bounded chunks.

**Wire shape change:**

- `ActionParams['links']` gains: `offset?: number`
- `ForwardedActionParams['links']` gains the same field.
- `ActionResult['links']` gains: `total: number` — the count of all matching links (before offset/limit slicing), enabling agents to know whether more pages remain.

Semantics:
- `offset` defaults to `0`.
- The content script collects all matching links (applying `hrefContains` and `visibleOnly` filters, up to `MAX_COLLECTION_CAP`), records `total`, then slices `[offset, offset + limit)` for the response.
- If `offset >= total`, return `{ links: [], total }`.
- If collection hit the cap, include `capped: true` in the result so agents know the total is approximate.

Result type becomes: `{ links: Array<LinkInfo>; total: number; capped?: boolean }`.

**Implementation touchpoints:**

**shared/**
- `actions.ts` — add `offset?: number` to `ActionParams['links']` (propagates to `ForwardedActionParams['links']` automatically via the type alias). Add `total: number` to `ActionResult['links']`.

**⚠️ Protocol result shape change:** Adding required `total: number` to `ActionResult['links']` (currently `{ links: Array<LinkInfo> }`) is a breaking change to the result type. All tests asserting `links` response shape across all packages must be updated. The compile-time `_AssertResults` guard will surface this. The daemon's `decorateReadHandles` spreads response data, which preserves `total` from the extension response — no logic change needed there.

**cli/**
- `commands/links.ts` — add `--offset` flag (type: string, parsed as non-negative integer).

**service/**
- `schemas.ts` — add `offset` as optional non-negative integer in the `links` params Zod schema.

**extension/**
- `content/actions/links.ts` — refactor `handleLinks`:
  1. Collect all matching links into a full array (respecting `hrefContains` and `visibleOnly`).
  2. Record `total = fullArray.length`.
  3. Slice: `fullArray.slice(offset, offset + limit)`.
  4. Return `{ links: sliced, total }`.
  
  Note: the current implementation breaks on first `limit` hit during iteration. Refactor to separate collection from slicing. The `MAX_LINK_LIMIT` (500) remains as a hard cap on the returned slice size, not on total collection.

  **Collection safety cap:** Add a `MAX_COLLECTION_CAP` (2000) that limits how many matching links are collected before slicing. On pages with thousands of links, the content script must not build an unbounded array. If collection hits the cap, stop iteration, set `total` to the cap value, and include `capped: true` in the result. This prevents content-script OOM on adversarial pages.

### Performance consideration

Collecting all links before slicing means the content script walks the entire DOM regardless of offset. For most pages this is negligible (few hundred links). The `MAX_COLLECTION_CAP` (2000) provides a hard safety boundary. If pages with thousands of links become a real concern, a future optimization can short-circuit after `offset + limit` entries when no `total` is needed — but that changes semantics (no accurate total). Defer this optimization.

### Handle numbering with offset

When `--offset 50 --limit 50` returns 50 links, the daemon mints handles `ln1`–`ln50` for that response slice (not `ln51`–`ln100`). A subsequent call with different offset **invalidates** all previously minted link handles for that page (standard re-read invalidation per ADR-027). Agents must use handles from the most recent `links` response only.

---

## Feature 5: `text --after` marker extraction

### Intent

Allow agents to extract text starting from a known marker string, reducing post-processing for structured page content.

### Design

This is a **CLI-local post-processing step**. The protocol and extension remain unchanged — the content script still returns full text for the scoped selector. The CLI slices the result before emitting to stdout.

**Rationale for CLI-local:**
- Keeps the extension thin (ADR-017 sensor boundary).
- The text action already returns full `innerText`. Adding string manipulation to the content script adds no value — the same bytes travel over the wire regardless.
- CLI-local slicing is consistent with how `screenshot` does file materialization locally.

**CLI interface:**

- `--after <marker>` — find first occurrence of the marker string in the returned text, emit only the text starting from that position (inclusive of the marker).
- `--limit-chars <N>` — when combined with `--after`, truncate the result to at most N characters. Without `--after`, `--limit-chars` applies to the full text from the beginning.

**Behavior:**
- If `--after` marker is not found in the text: emit the full text unchanged. Include a `markerFound: false` field in the output data so the agent can detect this.
- If found: emit `{ text: <sliced>, markerFound: true, markerOffset: <position> }`.
- The output `data` shape remains `{ text: string }` augmented with the optional marker metadata. This is a CLI-level transformation — the protocol `ActionResult['text']` type does not change.

**Implementation touchpoints:**

**cli/ only** — no shared/service/extension changes.

- `commands/text.ts` — add `--after` (type: string, optional) and `--limit-chars` (type: string, parsed as positive integer, optional) flags.
- Post-processing logic: after receiving the successful response from `sendAction`, apply transformation **only when `plan.code === 0 && plan.stdout`** (same guard pattern as `screenshot`). If `--after` is set:
  1. Extract `text` from `response.data`.
  2. Find `text.indexOf(afterMarker)`.
  3. If found: slice from that index, apply `--limit-chars` if set, augment data with `markerFound: true` and `markerOffset`.
  4. If not found: pass through unchanged, add `markerFound: false`.
- On error responses (`ok: false`), do not attempt any post-processing.
- The modified data is emitted as the stdout JSON. The response `ok: true` status and `page` fields pass through unchanged.

**Output contract preservation:** stdout is still exactly one JSON object. The `data` object gains optional `markerFound` and `markerOffset` fields that are present only when `--after` is used.

### Why this does not violate the protocol

The `text` action's protocol result type (`ActionResult['text']`) is `{ text: string }`. The CLI is free to transform the output before emission — it already does this for `screenshot` (base64 → file). The additional fields (`markerFound`, `markerOffset`) are CLI-output metadata, not protocol fields. An agent calling the daemon directly (without CLI) gets the full text and must do its own slicing.

---

## Implementation order

Tasks are ordered by dependency and value:

1. **Feature 1 (tab.activate)** ✅ — Done. Unblocks all other features by eliminating the `TAB_NOT_VISIBLE` error class in agent workflows.
2. **Feature 2 (links --href-contains)** ✅ — Done. Substring filter on absolute href, applied before limit cap.
3. **Feature 3A (truncation fix)** ✅ — Done. `executeExitPlan` uses synchronous `writeFileSync(1, ...)` for stdout, preventing pipe-buffer truncation on large payloads (>64KB).
4. **Feature 3B (links --offset)** ✅ — Done. Collect-then-slice refactoring with `MAX_COLLECTION_CAP` (2000), `total`, `capped`, and offset-based pagination. Protocol version bumped 1→2 (breaking wire change: required `total` field in links result). All `protocol_version` literals replaced with named `PROTOCOL_VERSION` constant for cohesion-of-name.
5. **Feature 5 (text --after)** — CLI-only, zero dependencies on other features. Can be done last or in parallel.

---

## Documentation updates

After implementation, update:

- `docs/public/solution/shared.md` — new action, new params fields (`hrefContains`, `offset`), new result fields (`total`, `capped`), new `tab.activate` action
- `docs/public/solution/cli.md` — new `tab activate` command entry, updated `links` flag table (`--href-contains`, `--offset`), updated `text` flag table (`--after`, `--limit-chars`), recommended `--limit` ceiling note in `links` command description
- `docs/public/solution/extension.md` — `tab.activate` in browser-handled action list, `BrowserWindowsSeam` in deps
- `docs/public/solution/service.md` — `tab.activate` routing note
- `docs/internal/architecture.md` — add `tab.activate` to action table
- `docs/public/views/02-containers.md` — no change needed (tab.activate doesn't alter container boundaries, confirm only)

---

## Validation

All features must pass before the phase is considered complete:

- `pnpm check` passes (typecheck + format + lint + arch + deadcode)
- `pnpm test` passes across all packages
- Feature 1: unit test for `tab.activate` in extension (background-actions), service (tab-actions routing), CLI (command wiring). Integration: activate a background tab, subsequent destructive action succeeds without `TAB_NOT_VISIBLE`.
- Feature 2: unit test in extension `links.ts` — verify `hrefContains` filters correctly (match, no-match, empty string, undefined). CLI test for arg parsing.
- Feature 3A: integration test with >64KB JSON payload through CLI output path — verify valid JSON on stdout.
- Feature 3B: unit test in extension `links.ts` — verify offset/limit slicing and `total` accuracy. CLI test for `--offset` arg parsing.
- Feature 5: unit test in CLI `text.ts` — verify `--after` slicing (marker found, not found, combined with `--limit-chars`).
- Command registry exhaustiveness: adding `tab.activate` to the Action union must trigger a compile error if the registry is not updated.

---

## Deferred

| Item | Reason |
|---|---|
| `--activate` flag on all destructive commands | Syntactic sugar over `tab activate` + command. Defer until usage shows whether the two-command pattern creates real friction. |
| `text --before` marker | No evidence of need. Trivial to add later with same pattern as `--after`. |
| `links --href-regex` | Regex in content script is a complexity/security surface expansion. Substring matching covers stated use cases. |
| `links --text-contains` | Not requested. Add when real use case appears. |
| Response streaming / chunked transfer | Overkill for current payload sizes if truncation bug is fixed. |
| Raise `MAX_COLLECTION_CAP` above 2000 | No evidence needed yet. 2000 covers all stated use cases. Revisit on real demand. |
