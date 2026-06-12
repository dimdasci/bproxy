---
title: Phase 5 - Integration & hardening
---

> **For implementers:** this phase turns the Phase 4 "initial working CLI" into a workflow-safe tool. The main input is the real-use finding in [`docs/internal/journal/2026-05-24-agent-dx-tab-and-link-extraction.md`](../../journal/2026-05-24-agent-dx-tab-and-link-extraction.md): the browser plumbing works, but fresh tab bootstrap, tab identifiers, link extraction, and selector safety are not agent-friendly enough yet.

**Goal:** Validate bproxy against the documented scenarios end-to-end and harden the rough edges discovered during Phase 4 real-use testing. The result should be a safer first-run workflow: an agent can start from a paired daemon, open a session-owned tab, research a page, extract links, and close the session without fake tab ids, raw Chrome tab ids, implicit shared `default` state, or external HTML parsing.

**Strategy:** Start with the protocol seams that affect every package (`shared` → daemon → extension → CLI), then exercise them through real workflows. Keep documentation truthful: public solution specs and internal architecture docs are updated in the same task as the code they describe, and the final task is an explicit doc/code reconciliation pass.

**Spec inputs:**

- Journal finding: [`2026-05-24-agent-dx-tab-and-link-extraction.md`](../../journal/2026-05-24-agent-dx-tab-and-link-extraction.md)
- Current scenarios: [`docs/internal/scenarios.md`](../../scenarios.md)
- Current implementation specs: `docs/public/solution/{shared,service,extension,cli}.md`
- Current views: `docs/public/views/`

**Roadmap entry:** [Phase 5 in roadmap.md](../roadmap.md#phase-5--integration--hardening).

---

## Locked outcomes for this phase

1. **Sessions are daemon-generated capability handles.** Browser-control sessions are created by the daemon (6-char base32 id, e.g. `m4q8z2`). User-friendly labels may exist, but labels are not accepted as authority-bearing session ids. Accidental use of an implicit shared `default` session is removed from browser-control flows.
2. **Tabs are session-scoped logical handles.** Normal CLI responses and command inputs use handles like `t1`, not raw Chrome tab ids. The daemon owns the mapping `session + logical tab -> Chrome tab id`; the extension may still receive raw ids over the internal daemon↔extension wire.
3. **Fresh tab bootstrap is one command.** `bproxy tab open --url ...` works from a paired daemon without a pre-bound fake tab. It creates or uses a daemon session, opens a real Chrome tab through the extension, binds the session to logical tab `t1`, and returns the generated session id plus logical tab handle. `tab open` is the **only** command that auto-creates a session when `-s` is not supplied.
4. **`tab list` is scoped.** Normal `tab list` returns only tabs opened/adopted inside the supplied session. Operator-opened browser tabs are not exposed through the normal agent surface.
5. **`session bind` binds logical tabs.** `session bind --tab t1` moves the current session binding to a session-owned logical tab. Raw Chrome ids are rejected at the CLI and daemon boundary.
6. **Structured link extraction exists.** A first-class `links` action/CLI command returns visible page links as structured data (`text`, `href`, `target`, optional metadata) so research workflows do not need shell/Node HTML parsing.
7. **Generated selectors are robust.** `elements` never fails an entire command because one generated selector contains a newline, quote, backslash, or other CSS-hostile attribute value. Unsafe selector generation falls back to a safe target representation or omits only the unsafe selector field with traceable metadata.
8. **Documented scenarios run against the real system.** Scenario 1 (Google research) runs autonomously to completion in a fresh paired setup. Scenario 2 (LinkedIn snapshot) validates scroll/pause behaviour and handles `HUMAN_REQUIRED`. Scenario 3 (form fill) fills a real form to the user-review step.
9. **Docs match code.** `docs/public/solution/*.md`, `docs/internal/architecture.md`, `docs/internal/scenarios.md`, package READMEs, and affected public views describe the shipped Phase 5 behaviour - not Phase 4 compatibility and not future wishes.
10. **Fast local guardrails exist.** Pre-commit hooks run a fast, low-friction subset of the existing gates, while CI/root checks remain authoritative.
11. **Static and runtime gates pass:** `pnpm check`, `pnpm test`, `pnpm docs:build`, relevant package builds, `pnpm views:regen`, and the Phase 5 smoke/manual scenario checks.

---

## Contract decisions (locked)

These decisions were locked during plan review. They change the public agent contract based on the journal finding.

1. **Session id shape.** 6 characters, base32 lowercase alphabet (`[a-z2-7]{6}`), no prefix. Example: `m4q8z2`. Passed via `-s` (short) or `--session` (long) flag. Validation regex: `/^[a-z2-7]{6}$/`. 30 bits of entropy — collision-safe for a single-process in-memory daemon. On collision during generation, re-roll (statistically negligible).
2. **Label semantics.** Optional labels are display metadata only (`--label research`). They do not authorize control and cannot be used in place of `-s`.
3. **Session creation paths.** `session create` is explicit. `tab open --url` is the **only** bootstrap command that auto-creates a session when no `-s` is supplied. It must return the generated id; all subsequent commands require explicit `-s <id>`. No other command auto-creates sessions.
4. **Session lifetime and close policy.** Phase 5 ships explicit `session close`. Closing a session **closes all session-owned Chrome tabs automatically** — no orphans, no tab accumulation. Idle TTL is deferred to a future phase; document it as not-yet-implemented.
5. **Logical tab handles.** Handles are scoped to one session (`t1`, `t2`, ...). A handle from another session is invalid even if the underlying Chrome tab still exists.
6. **Internal wire shape (extension-control).** The existing `BproxyRequest` envelope is reused with `target.tabId` set to `null` for actions that do not target an existing tab (e.g., `tab.open`). The extension background SW routes by **action name**: actions in a known background-handled set (`tab.open`, `tab.list`, `tab.close`) are dispatched locally without forwarding to a content script; all other actions require a valid `tabId` and are forwarded to the content script in that tab. No new envelope type or WS message shape is introduced.
7. **Adoption of existing tabs.** Normal Phase 5 flows do not expose existing operator tabs. A future human-approved adoption flow can be designed later; do not accidentally add broad tab enumeration while implementing logical handles.
8. **`links` shadow-DOM traversal.** The `links` action traverses open shadow roots by default, consistent with `elements` behavior. No opt-in flag needed; it is a read-only DOM operation with no extra cost.
9. **Scenario validation.** Scenarios 1–3 are validated manually with a real browser and real accounts. The human handles login, CAPTCHAs, and consent. Results are documented as command transcripts in journal entries. If a site blocks the flow, the bounded result is documented and a follow-up is journaled. No CI automation against third-party sites.

---

## File structure introduced/modified this phase

Likely changes; update the relevant solution docs when implementation discovers better names.

```text
shared/src/actions.ts              # MODIFIED - session create/close, logical tab params/results, links
shared/src/protocol.ts             # MODIFIED if extension-control wire differs from targeted forwarding
shared/src/sessions.ts             # MODIFIED - SessionInfo/TabInfo logical handles, labels, lifecycle
shared/src/errors.ts               # MODIFIED if new session/tab validation errors are needed

service/src/sessions.ts            # MODIFIED - generated sessions, labels, close, logical tab registry
service/src/dispatch.ts            # MODIFIED - logical handle resolution + extension-control actions
service/src/routes/command.ts      # MODIFIED - new daemon-local session actions and tab.open/list mediation
service/src/schemas.ts             # MODIFIED - runtime validation for new protocol shapes
service/src/__tests__/*.test.ts    # MODIFIED/NEW - session/tab capability and privacy tests

extension/src/background/tabs*.ts  # MODIFIED - open/list support for daemon-mediated logical tab registry
extension/src/content/actions/     # MODIFIED/NEW - links extraction + selector hardening tests
extension/src/content/targeting.ts # MODIFIED - safe selector generation/fallback
extension/src/content/discovery.ts # MODIFIED - robust ElementInfo targets

cli/src/commands/session/*         # MODIFIED/NEW - create, close, bind --tab
cli/src/commands/tab/*             # MODIFIED - open bootstrap, scoped list, logical tab inputs
cli/src/commands/links.ts          # NEW - structured link extraction command
cli/src/client.ts                  # MODIFIED - session requirement/default changes
cli/src/command-registry.ts        # MODIFIED - action coverage/destructive classification
cli/src/__tests__/*.test.ts        # MODIFIED/NEW - command parsing, no raw Chrome ids, fresh bootstrap smoke

docs/public/solution/*.md          # MODIFIED - shipped contracts
docs/internal/architecture.md      # MODIFIED - session/tab model + action table
docs/internal/scenarios.md         # MODIFIED - final Phase 5 command flows
docs/internal/decisions.md         # MODIFIED if ADRs are amended/added
docs/public/views/*.md             # MODIFIED if public views are affected
docs/public/views/auto/*.svg       # MODIFIED by pnpm views:regen
```

---

## Task 1: Write ADRs, update scenario transcripts, and finalize error codes

**Files:** `docs/internal/decisions.md`, `docs/internal/scenarios.md` (command transcript sections only), `docs/internal/architecture.md` (only sections explicitly marked as planned).

**Purpose:** Put all locked decisions on paper and rewrite scenario command flows to Phase 5 syntax, so every subsequent task has a concrete reference to build against. This is pure documentation — zero code.

- [X] Amend or add ADRs for: daemon-generated sessions (id format, no prefix, 6-char base32), logical tab handles, `session close` closes tabs, `tab open` as sole bootstrap path, normal tab privacy, extension-control wire shape (`tabId: null` + action-name routing), and first-class `links` extraction with shadow-root traversal.
- [X] Decide new error codes needed beyond the existing taxonomy: `SESSION_NOT_FOUND`, `TAB_HANDLE_NOT_FOUND`, `SESSION_REQUIRED`, `INVALID_SESSION_ID`, `TAB_NOT_IN_SESSION`. Document in decisions.md.
- [X] Rewrite Scenario 1 command transcript using Phase 5 syntax: `tab open -s <generated> --url ...` → `text -s ... --selector main` → `links -s ...` → `session close -s ...`.
- [X] Rewrite Scenario 2 command transcript: `tab open` bootstrap → `scroll` → `text` → `links` → `session close`. Replace all `--tab-id` and user-chosen session names.
- [X] Rewrite Scenario 3 command transcript: `tab open` → `elements --form` → `fill-form` → `elements --form` (verify) → `session close`. Replace all `--tab-id` and user-chosen session names.
- [X] Keep public solution docs unchanged until code lands.

**Done when:** implementers can read the scenario transcripts and ADRs to know exactly what every command should accept and return, without guessing. The scenarios serve as acceptance-test scripts for Task 8.

---

## Task 2: Update shared protocol and type model

**Files:** `shared/src/actions.ts`, `shared/src/sessions.ts`, `shared/src/protocol.ts`, `shared/src/errors.ts`, `shared/README.md`, tests/type assertions.

**Purpose:** Make the desired Phase 5 contract compile-time visible to every package.

- [X] Add session lifecycle actions, likely `session.create` and `session.close`.
- [X] Change `session.bind` params from raw `{ tabId: number }` to logical `{ tab: string, pacing?: PacingMode }`.
- [X] Change `tab.open` result to return `{ session, tab, bound, url }` and avoid exposing Chrome ids.
- [X] Change `tab.list` result to return session-scoped logical tab info.
- [X] Add `links` action params/results with `selector?`, `visibleOnly?`, and `limit?`.
- [X] Update `SessionInfo` and `TabInfo` to use logical handles and labels; raw Chrome ids must not appear in normal shared response types.
- [X] Add any new error codes chosen in Task 1.
- [X] Preserve compile-time exhaustiveness guards so all downstream packages fail until they handle the new model.

**Done when:** `@bproxy/shared` typecheck fails in consumers for every place that still assumes friendly session names, raw tab ids, or no `links` action.

---

## Task 3: Implement daemon session capability handles and logical tab registry

**Files:** `service/src/sessions.ts`, `service/src/routes/command.ts`, `service/src/schemas.ts`, daemon tests.

**Purpose:** Move browser authority from user-chosen names/raw tab ids into daemon-owned in-memory capabilities.

- [X] Add generated session creation with optional display label.
- [X] Reject unknown/invalid session ids for browser-control actions instead of implicitly creating arbitrary names.
- [X] Preserve daemon-local introspection where safe, but do not let a typo create or steal a browser-control session.
- [X] Add `session.close` to remove session state and **close all session-owned Chrome tabs** (locked decision: no orphans).
- [X] Add per-session logical tab registry: `t1`, `t2`, ... mapped to Chrome tab ids internally.
- [X] Store current binding as logical tab handle plus internal Chrome id resolution, not a public `tabId` field.
- [X] Unit-test id format, uniqueness/collision handling, invalid ids, close semantics, cross-session tab-handle rejection, and pause/pacing preservation.

**Done when:** the daemon can represent a session-owned browser workspace without exposing Chrome ids through its normal protocol responses.

---

## Task 4: Rework tab open/list/bind routing around logical handles

**Files:** `service/src/dispatch.ts`, `service/src/routes/command.ts`, `extension/src/background/tabs*.ts`, service/extension integration tests.

**Purpose:** Remove the fake-tab bootstrap problem and make tab operations privacy-preserving.

- [X] Make `tab.open --url` work when no current tab is bound. The daemon sends the request to the extension with `target.tabId: null`; the extension background SW recognizes `tab.open` as a background-handled action and creates the Chrome tab directly. Requires an authenticated CLI and a connected extension, but not an existing target tab.
- [X] If `tab.open` is called without `-s`, create a session and return the generated id. `tab open` is the **only** command with this auto-create behavior. If called with a valid session, add a new logical tab in that session.
- [X] Bind the opened logical tab by default and return `{ session, tab, bound: true, url }`.
- [X] Make `tab.list` return only session-owned logical tabs. Do not expose all Chrome tabs.
- [X] Make `session.bind --tab tN` resolve only inside the current session.
- [X] Keep raw Chrome ids available only in internal logs/debug output where needed for diagnosis, never in normal CLI JSON.
- [X] Add regression tests for the exact Phase 4 failure: fresh daemon + extension + `tab open` succeeds without `session bind --tab-id 1`.

**Done when:** the journal workaround is impossible/obsolete, and an agent can bootstrap a fresh Google tab with one command.

---

## Task 5: Update CLI session/tab UX

**Files:** `cli/src/globals.ts`, `cli/src/client.ts`, `cli/src/commands/session/*`, `cli/src/commands/tab/*`, CLI tests, `cli/README.md`.

**Purpose:** Expose the daemon-owned capability model cleanly and prevent accidental shared state.

- [X] Add `bproxy session create [--label text]` and `bproxy session close -s <id>` (closes session + all owned tabs).
- [X] Change `session bind` to accept `--tab <handle>`.
- [X] Make browser-action commands require an explicit `-s <id>` (or `--session <id>`). `tab open --url` is the **only** bootstrap exception that works without `-s`.
- [X] Remove or quarantine the CLI-side fallback to `session: "default"` for browser-control actions.
- [X] Keep lifecycle commands token-free/token-aware as Phase 4 specified; do not mix lifecycle JSON with protocol JSON.
- [X] Update command registry/action coverage and destructive classification for new/changed actions.
- [X] Test stdout cleanliness and exit-code behaviour for missing session, invalid session, cross-session tab, fresh `tab open`, and `links`.
- [X] Verify `-s` short flag works identically to `--session` in all commands.

- [X] Handle the `session.close` partial-success case: if the daemon returns `ok: false` with an error that originated inside the close loop (e.g., `HUMAN_REQUIRED` returned by the extension for one of the tab.close sub-requests), the session is already gone from the daemon — do not treat the response as retriable. Print a warning such as "session terminated but some Chrome tabs may not have been closed" and exit with a non-zero code to signal partial success. Do not retry `session close` on this error; a retry will return `SESSION_NOT_FOUND`.

**Done when:** command help and tests guide agents into the fresh-flow path rather than the Phase 4 fake-binding workaround.

---

## Task 6: Add first-class `links` extraction

**Files:** `shared/src/actions.ts`, `extension/src/content/actions/links.ts` (or equivalent), `extension/src/content/rpc.ts`, `cli/src/commands/links.ts`, tests, solution docs.

**Purpose:** Make research workflows produce structured URLs without external HTML parsing.

- [X] Define `links` params: optional `selector`, `visibleOnly`, `limit`.
- [X] Define link result entries with text, href, target (`ElementTarget`), and optional title/rel/visible metadata if useful.
- [X] Implement extraction in ISOLATED world using DOM reads only; no MAIN-world script and no event dispatch.
- [X] Resolve relative URLs to absolute `href` values using browser normalization.
- [X] Filter hidden/offscreen links when `visibleOnly` is true.
- [X] Bound result size with a safe default and explicit `--limit`.
- [X] Add CLI command `bproxy links [--selector css] [--visible-only] [--limit N]`.
- [X] Traverse open shadow roots by default (consistent with `elements` behavior — locked decision).
- [X] Add tests using a fixture page with normal links, nested links, hidden links, duplicate URLs, shadow-root links in open roots, and Google-like result markup.

**Done when:** Scenario 1 can extract search result URLs with one `links` command after navigation.

---

## Task 7: Harden selector generation and ElementTarget fallbacks

**Files:** `extension/src/content/targeting.ts`, `extension/src/content/discovery.ts`, `extension/src/content/actions/reads.ts`, tests, docs.

**Purpose:** Fix the Google `elements` failure and make discovery safe on real pages with messy accessible labels.

- [X] Add tests for attribute values containing newline, quotes, backslashes, brackets, unicode, and control characters.
- [X] Use standards-compliant CSS string escaping for generated attribute selectors, not ad-hoc replacement.
- [X] If no safe unique selector can be generated, return a route-based target or omit the selector for that element while keeping the rest of the `elements` response successful.
- [X] Ensure one bad element cannot fail the entire `elements` command.
- [X] Preserve route-based shadow-DOM support and selector ambiguity errors for user-supplied selectors.
- [X] Add a regression fixture matching the journal's Google account `aria-label` newline case: an element with `aria-label="Google Account: Foo\nBar"` where the literal newline in the attribute produces an invalid CSS selector like `a[aria-label="Google Account: ...\n..."]`. The generator must escape it or fall back.

**Done when:** `elements` succeeds on a page containing hostile labels and returns enough target data for later `fill`/`select` calls where possible.

---

## Task 8: Scenario smoke workflows against real system

**Files:** smoke scripts under `cli/` or `extension/scripts/smoke/`, `docs/internal/scenarios.md`, journal notes if manual validation is required.

**Purpose:** Validate that the hardened API solves real workflows, not just unit tests.

- [X] Add or update a local smoke script for fresh paired setup: `service start` → pair extension → `tab open` → `navigate` → `text` → `links` → `session close`.
- [X] Run the Phase 5 scenario transcripts (written in Task 1) as the acceptance scripts. The transcripts define the exact commands and expected response shapes.
  - [X] Scenario 1 transcript was executed against a real Google SERP and completed successfully.
  - [X] Scenario 2 validated through scroll fix, inspect/snapshot diagnostics, and live LinkedIn runs (Task 8a).
  - [X] Scenario 3 transcript was executed to the human-review boundary and completed without any submit action.
- [X] Run Scenario 1 (Google topic research) with a real Chrome profile. The human handles any login/CAPTCHA. Document the command transcript and results.
  - [X] Fresh `tab open` bootstrap returned generated session + logical tab handle.
  - [X] Real Google SERP validated `links` extraction and rendered-text reads.
  - [X] Real run showed the transcript should use `#search`, not `main`, for this page shape.
- [X] Run Scenario 2 (LinkedIn snapshot) far enough to validate scroll pacing, foreground-tab behaviour, and `HUMAN_REQUIRED`/pause handling. If site conditions make full automation inappropriate, document the bounded manual result.
  - [X] Feed loads in a real signed-in Chrome profile and stays usable in the foreground; screenshot confirmed the expected feed view.
  - [X] Reproduced blocker: `scroll -s <session> --by viewport --direction down --until-stable` returned `ok: true`, `stable: true`, and `scrolledPx: 0` twice while the viewport visibly did not move.
  - [X] Reproduced deviation: `eval --allow-eval` existed as a tempting debugging path, but the 2026-06-12 course correction rejects arbitrary eval as a bproxy feature. Use CDP/devtools for page investigation instead.
  - [X] Fixed the LinkedIn scroll false-success class without adding scroll-container inference: `scroll` now supports explicit `ElementTarget` and returns honest `moved`/before/after data. See `docs/internal/journal/2026-05-30-linkedin-scroll-and-eval-gaps.md` and `docs/internal/journal/2026-05-31-scroll-container-investigation.md`.
  - [X] Re-run is obsolete: scroll explicit-target fix (`78cc005`), inspect/snapshot diagnostic commands (`d3e6e73`), and live LinkedIn validation in Task 8a collectively satisfy the Scenario 2 acceptance criteria. No separate re-run needed.
- [X] Run Scenario 3 (form fill) against a real or realistic application form to the user-review step; verify no submit action exists in the flow.
  - [X] Used the LinkedIn post composer modal as a realistic human-review form boundary.
  - [X] `elements --form` discovered a shadow-route textbox target under `#interop-outlet`.
  - [X] `fill --method paste --world isolated` successfully inserted visible draft text into the composer.
  - [X] No submit/publish action was used; validation stopped at human review.
- [X] Record any new real-use findings in `docs/internal/journal/` rather than silently expanding Phase 5. Current findings to preserve: Google false-positive `busy` reporting, LinkedIn `scroll` false-success, the eval course correction, and screenshot file-output UX gap.

**Done when:** the phase's success criteria are demonstrated against the documented workflows or explicitly deferred with a journaled reason and a follow-up plan.

---

## Task 8a: Diagnostic sensor commands (`inspect` + `snapshot`)

**Plan:** [`05a-inspect-snapshot.md`](./05a-inspect-snapshot.md)

**Purpose:** Give agents self-diagnostic capability when existing sensors fail. Discovered during LinkedIn scenario validation (Task 8, Scenario 2) — `text` returned 282 chars due to `display: contents` wrappers; agent had no way to diagnose without dev-browser/CDP.

- [X] Implement `inspect` action — CSS selector → structural metadata (rect, computed styles, descendants, textLength, scroll state). Same fixed-schema sensor pattern as `text`/`dom`.
- [X] Implement `snapshot` action — accessibility tree sensor. Walks DOM + ARIA semantics, immune to CSS layout tricks. Returns indented text optimized for LLM consumption.
- [X] Wire through all 6 layers: shared types → service schemas → extension forwarded-actions → content RPC → content handlers → CLI commands.
- [X] Tests: 17 new tests (7 inspect, 10 snapshot), all existing 329+187+162 tests pass.
- [X] Quality gates: `pnpm check` passes (typecheck, format, lint, arch, deadcode).
- [X] Validated in production against live LinkedIn profile and job search pages.

**Done when:** agents can run `bproxy inspect --selector "section > div"` and immediately see `{display: "contents", rect: 0×0, descendants: 2273, textLength: 15116}` — self-diagnosing layout-transparent wrappers without reaching for a second tool.

---

## Task 9: Observability, deadlines, and error-envelope hardening

**Files:** `service/src/logger.ts`, `service/src/debug-actions.ts`, `service/src/pending.ts`, `cli/src/client.ts`, tests, solution docs.

**Purpose:** Close hardening items from the original Phase 5 roadmap while touching the routing model.

- [X] Verify every new action (`session.create`, `session.close`, `tab.open` without tabId, `links`) emits structured request lifecycle log events with the request `id` — validated by a test asserting log output contains the id for each action.
- [X] Ensure timeout/deadline behaviour is correct for extension-control actions (those sent with `tabId: null`) as well as tab-targeted actions. Test: action with no extension connected times out within the configured deadline and returns `NO_EXTENSION` error; hanging extension returns `TIMEOUT`.
- [X] Ensure every daemon/extension error returned through protocol uses a complete `BproxyError` shape — test: invalid session, invalid tab handle, paused session, no extension, timeout, and malformed extension response all produce well-formed error envelopes.
- [X] Update `debug.status`/`debug.last` to show generated sessions and logical tabs without leaking raw Chrome ids in normal fields. Ring buffer wired in production; verified by test.
- [X] Tighten page `busy` reporting. Real Google Scenario 1 showed `state: "ready"` with `busy: true` even though the page was visually static and both `text`/`links` succeeded; the current heuristic likely treats hidden or stale `[aria-busy]` / `progressbar` DOM as active work. Refine `busy` to require visible/relevant busy indicators and add a regression test for this false-positive shape.
- [X] Tighten `scroll` success semantics. Real LinkedIn Scenario 2 returned `ok: true`, `stable: true`, and `scrolledPx: 0` twice while the viewport visibly did not move. `scroll` now reports `moved`, supports explicit element targets, and avoids generalized container-inference heuristics.
- [X] Keep raw internal ids out of `--verbose` unless explicitly classified as debug-only and documented. CLI `VerboseEntry` confirmed clean; daemon logs documented as operator-only.
- [X] Add tests for timeout, no extension, invalid session, invalid tab handle, paused session, malformed extension responses, false-positive `busy` detection, and false-success `scroll` reporting under the new model.

**Done when:** agents receive actionable protocol errors and operators can correlate failures without exposing broader browser state.

---

## Task 10: Documentation reconciliation with the shipped code

**Files:** `docs/public/solution/{shared,service,extension,cli}.md`, `docs/internal/architecture.md`, `docs/internal/scenarios.md`, `docs/internal/decisions.md`, `README.md`, package READMEs, public views if affected.

**Purpose:** Make documentation match Phase 5 reality after the code lands.

- [X] Update public solution specs for generated sessions, logical tab handles, `links`, selector fallback, and new error semantics.
- [X] Update `docs/internal/architecture.md` action table and session/tab model.
- [X] Update `docs/internal/scenarios.md` command flows to use `tab open` bootstrap, `links`, logical tab handles, and `session close`.
- [X] Update package READMEs and smoke instructions.
- [X] Update public views if the session state, deployment, container, or threat-model diagrams/prose are affected.
- [X] Run `pnpm views:audit`; update frontmatter `sources` if the audit misses affected views.
- [X] Run `pnpm views:regen` and commit changed SVGs.
- [X] Search for stale Phase 4 syntax: `--tab-id`, raw `tabId` in normal docs, `default` session advice, positional command examples, and broad `tab list` language.

**Done when:** a reader following docs from a clean checkout uses the same commands and response shapes that the code actually ships.

---

## Task 11: Pre-commit hooks and final gates

**Files:** root package/tooling config, `docs/internal/quality-gates.md`, README if developer workflow changes.

**Purpose:** Add the fast local guardrail deferred from earlier phases.

- [X] Choose Husky + lint-staged or an equivalent lightweight hook runner.
- [X] Hook a fast subset: format check/fix on changed files, lint on changed TS, and typecheck only if practical without making commits painful.
- [X] Document how to install/skip hooks for emergency commits.
- [X] Ensure CI/root gates remain authoritative; hooks are developer convenience, not a replacement.
- [X] Run final verification: `pnpm check`, `pnpm test`, `pnpm docs:build`, package builds, smoke/manual scenario checks.

**Done when:** local commits catch obvious drift quickly and the full workspace still passes from a clean checkout.

---

## Task 12: Screenshot file-output UX hardening

**Files:** `cli/src/commands/screenshot.ts`, CLI output helpers, screenshot tests, relevant shared types if the public CLI result shape changes, docs, and the validating journal note `docs/internal/journal/2026-05-30-screenshot-output-gap.md`.

**Purpose:** Make screenshots usable in real operator-guided workflows without requiring manual base64 decoding outside bproxy.

- [X] Add a screenshot destination flag (for example `--output-dir <dir>`) to the CLI.
- [X] Materialize screenshot bytes into a real image file in that directory.
- [X] Return file metadata/path in the agent-facing CLI result instead of an inlined base64 blob.
- [X] Keep the daemon↔extension transport free to stay base64 internally if that is still the simplest wire format; the UX requirement is at the CLI boundary.
- [X] Generate deterministic, collision-safe filenames suitable for repeated smoke/manual runs.
- [X] Add tests for directory creation, filename shape, stdout JSON cleanliness, and error handling when the destination is missing/unwritable.
- [X] Update docs/examples so manual scenario validation uses the file-output form.

**Done when:** a real-site validation run can call `bproxy screenshot -s <id> --output-dir <dir>` and immediately inspect the returned file path without any external decode step.

---

## Final verification checklist

- [X] `bproxy tab open --url https://google.com` from a fresh paired setup returns a 6-char base32 session id and logical tab handle `t1`, and binds it by default.
- [X] Normal CLI responses do not expose raw Chrome tab ids.
- [X] `tab list` returns only session-owned tabs.
- [X] `session bind --tab t1` works; `--tab-id` is rejected or absent.
- [X] `-s` short flag works as an alias for `--session` in all browser-action commands.
- [X] Browser-control commands reject missing/invalid sessions instead of silently using `default`.
- [X] `links --selector "#search"` returns structured URLs for a search-results page.
- [X] `elements` succeeds on labels with newlines/quotes/backslashes and does not fail the whole command because of selector generation.
- [X] `screenshot -s <id> --output-dir <dir>` returns a directly inspectable file path, not only base64 payload text.
- [X] `scroll --selector 'main#workspace' --direction down` scrolls an explicit element and reports `moved: true`.
- [X] `scroll --direction down` with no target scrolls viewport only and reports `moved: false` honestly on SPA pages without viewport scroll.
- [X] Scenario 1 runs autonomously to completion; Scenarios 2 and 3 are validated to the documented human-in-loop boundaries.
- [X] Error envelopes are complete for every new error path.
- [X] `debug.status` and `debug.last` show useful logical session/tab state.
- [X] Public and internal docs match shipped behaviour.
- [X] `pnpm views:regen` is current and generated SVGs are committed.
- [X] `pnpm check`, `pnpm test`, and `pnpm docs:build` pass.

---

## Out of scope for Phase 5

- Public npm packaging, release artifacts, extension store packaging, installer/update flows, Homebrew, or GitHub Release automation - Phase 6 owns distribution.
- Human-approved adoption of arbitrary existing browser tabs, unless the implementation proves it is required for the three documented scenarios. Normal Phase 5 `tab list` must not expose the operator's existing tabs.
- Closed shadow-root support.
- New stealth mechanisms, network shims, trusted input simulation, or broad anti-detection bypasses.
- Arbitrary page eval and debugger screenshots through CLI/service control paths.
- Site-specific scrapers or LinkedIn Voyager API access.
- Making scenario validation fully CI-automated against third-party websites. Real-site checks can remain manual/local with documented transcripts because external sites are unstable and account-dependent.
