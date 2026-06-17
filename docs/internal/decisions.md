---
title: Architecture Decision Records
---

**Edition: 2026-06-14 (temp file confinement)** — Authoritative current ADR set.

---

## ADR-001: Default instrumentation strategy — read mode
**Date:** 2026-04-30
**Status:** Accepted

Read mode (Concept B) is the default. No MAIN-world presence, no declarative content scripts, no MutationObserver. Content script injected programmatically on first command per tab. Interact mode is a thin extension (paste-shaped writes), not a separate heavy mode.

---

## ADR-002: Extension framework — WXT
**Date:** 2026-05-08
**Status:** Accepted

Use [WXT](https://wxt.dev) (v0.20+) as the extension build framework. Extension source follows WXT conventions; no WXT runtime in production output. Ejectable.

---

## ADR-003: Service framework — Fastify
**Date:** 2026-05-08
**Status:** Accepted

Use [Fastify](https://fastify.dev) + [`@fastify/websocket`](https://github.com/fastify/fastify-websocket). Single port serves both HTTP and WS with unified lifecycle.

---

## ADR-004: CLI framework — citty
**Date:** 2026-05-08
**Status:** Accepted

Use [citty](https://github.com/unjs/citty) from the UnJS ecosystem. Lazy imports, TypeScript-native, zero runtime deps.

---

## ADR-005: TypeScript as project language
**Date:** 2026-05-08
**Status:** Accepted

TypeScript throughout. Shared types in a `shared/` workspace package consumed by all three components. Protocol correctness enforced by type system.

---

## ADR-008: WebSocket over Native Messaging
**Date:** 2026-04-30
**Status:** Accepted

WebSocket to `ws://127.0.0.1:9615/ws`. Development-friendly, no platform-specific host manifest required.

---

## ADR-009: Observability as a first-class design constraint
**Date:** 2026-05-08
**Status:** Accepted

Every component independently observable. Request `id` is the universal correlation key. Ring buffer in extension (`chrome.storage.session`), structured daemon logs, and `--verbose` CLI output.

---

## ADR-012: Static analysis stack
**Date:** 2026-05-08
**Status:** Accepted

Composed five-concern stack: `tsc` (strict), Biome v2 (format), ESLint v9 (lint + cognitive complexity), `dependency-cruiser` (architecture rules), `knip` (dead code/deps). Exposed via `pnpm check`.

---

## ADR-006: DOM polling over MutationObserver
**Date:** 2026-05-13 (rewritten)
**Status:** Accepted

**Decision:** Use DOM polling (`setInterval` checking element count/stability) as the default "is page settled" mechanism. No MutationObserver.

**Update from PoC phase:** Polling is now:
- **Jittered** — intervals vary randomly within a bounded range, never fixed cadence
- **Visibility-aware** — destructive actions bail when `document.visibilityState === 'hidden'` unless explicitly user-initiated
- **Bounded** — maximum polling duration with resolution (stable or timeout)

**Rationale:** Lower fingerprint than installed listeners, but fixed-cadence polling is a behavioral tell. Jitter and visibility checks remove that signal.

---

## ADR-007: Three-method write contract
**Date:** 2026-05-13 (rewritten)
**Status:** Accepted

**Decision:** The `fill` action exposes **three explicit methods**, one per state-location bucket. No `auto` value, no internal escalation.

| Method | State Location | Write Technique | World | DOM Events |
|--------|---------------|-----------------|-------|------------|
| `direct` | In the DOM — `element.value` / `element.textContent` *is* the state | `el.value = v` / `el.textContent = v` | ISOLATED | None |
| `paste` | In framework reacting to events — React/Vue/Angular controlled inputs | Native setter + `dispatchEvent('input', {inputType:'insertFromPaste'})` | ISOLATED | `input` with `isTrusted=false` |
| `runtime-api` | In documented editor API — `__quill`, `__lexicalEditor`, ProseMirror, TipTap, Slate, Monaco, CodeMirror | `editor.setText(v)` / `editor.update(...)` | MAIN | None from our code; editor internals only |

**Key constraints:**
- No `auto` — agent must explicitly select method per call
- No fake typing chain alongside paste — synthetic `keydown`/`keypress`/`keyup` with paste is *more* detectable, not less
- Extension executes the method it is told; method-selection logic lives in agent guidance (see ADR-018)

**Context:** Replaces paste-as-default framing after PoC 3 validated runtime-API writes for hostile editors.

---

## ADR-010: WebSocket auth transport — two-token model
**Date:** 2026-05-13 (rewritten 2026-06-14)
**Status:** Accepted

**Decision:** Route-specific auth with two distinct long-lived tokens and one short-lived pairing code:
- **Daemon token** (`~/.bproxy/token`) — CLI→daemon HTTP auth
- **Extension token** — issued during pairing, extension→daemon WS auth
- **Pairing code** — one-time, short-TTL, body-transmitted auth factor for the claim route

**Transport specifics (per route):**
- **`POST /`** — `Authorization: Bearer {daemonToken}` (header-auth, validated at `onRequest` before body parse)
- **`GET /ws`** — `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(extensionToken)}` (header-auth, validated at `onRequest` before upgrade)
- **`POST /pair/claim`** — pairing code in request body `{ "code": "ABCD-EFGH" }` (body-auth, validated after body parse); no daemon Bearer token required; `chrome-extension://` Origin required at ingress

**Ingress gate (all routes):** Host, Origin, and Sec-Fetch-Site checks run at `onRequest` for every route — unauthenticated cross-site or proxy-forwarded requests are rejected before body parsing regardless of route.

**Why `/pair/claim` uses body-auth:** The auth hook runs at `onRequest` (before Fastify parses the body) so that header-auth routes reject attackers before triggering any route logic. Since the pairing code is transmitted in the body, it cannot be validated at that stage — validation is deferred to the route handler. The ingress gate still protects the route with Host + Origin + Sec-Fetch-Site checks.

---

## ADR-011: Extension token bootstrap via popup-driven pairing
**Date:** 2026-05-13 (rewritten)
**Status:** Accepted

**Decision:** Pairing is popup-driven claim. CLI prints pairing code; user pastes code in extension popup; popup calls `POST /pair/claim` and stores returned bootstrap payload.

**Flow:**
1. `bproxy service start` creates one-time pairing code (TTL 5min, single-use)
2. CLI prints pairing code in machine-readable output
3. User opens extension popup, enters pairing code
4. Popup calls `POST /pair/claim` with `{code}`
5. Daemon returns `{extensionToken, wsUrl, protocolVersion, issuedAt, expiresAt, nonce}`
6. Popup stores token in `chrome.storage.local`, notifies background SW
7. Background SW reconnects WS with subprotocol auth

---

## ADR-013: MAIN-world runtime-api writes
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** `runtime-api` method writes require MAIN world execution. Implemented as on-demand one-shot via `chrome.scripting.executeScript(..., { world: 'MAIN' })` — no persistent MAIN-world content script.

**Rationale:** Page-owned editor instances (`__quill`, lexical handles, etc.) are only accessible from MAIN world. ISOLATED world produces false negatives.

**Hygiene requirements:** See ADR-015. Execution is always one-shot per call — no installed listeners, no persistent scripts.

**World matrix:**
| Method | World |
|--------|-------|
| `direct` | ISOLATED |
| `paste` | ISOLATED |
| `runtime-api` | MAIN (on-demand one-shot) |

---

## ADR-014: Shadow-DOM-aware discovery + route-based targeting
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Discovery and targeting must support element routes beyond plain light-DOM selectors. Shared types include route representation that encodes shadow-host chain.

**Scope:** Open shadow roots only. Closed shadow roots explicitly out of scope.

**Traversal strategy:** Progressive intent-scoped traversal:
1. Active element chain (`document.activeElement` + `shadowRoot.activeElement`)
2. Visible dialogs/popovers
3. Clickable controls in viewport (`elementsFromPoint`)
4. Scoped subtree search within candidate root only

No deep global scans. Runtime-handle probing stays scoped to candidate editor root.

---

## ADR-015: MAIN-world hygiene contract
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Every MAIN-world execution follows mandatory hygiene to prevent `chrome-extension://` URL leaks into page-observable state.

**Requirements:**
1. **No identifying literals** in injected function bodies (no `"chrome-extension"`, extension ID, or library names)
2. **Catch and normalize errors inside MAIN-world function** — never let raw throws escape
3. **Prevent stack leakage** — errors caught and wrapped before crossing world boundary; page cannot observe `chrome-extension://<id>/` URLs in stacks
4. **One-shot execution** — no persistent state, no listeners installed

---

## ADR-016: `web_accessible_resources` default-deny
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Ship with no `web_accessible_resources` declared. WAR is the primary deterministic extension-resource disclosure vector; removing it eliminates scanner-friendly enumeration.

**Carve-out process:** Any future WAR addition requires explicit ADR documenting:
- Why the resource must be web-accessible
- What risk is accepted by the exposure
- Mitigations applied

Default-deny does not eliminate all extension side channels, but it removes the controllable one.

---

## ADR-017: Sensor+actuator boundary
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** The extension is a thin sensor+actuator layer. It exposes capabilities honestly (shadow-aware reads, MAIN-world capability, three write methods) and never strategizes internally.

**Agent ownership:**
- Selector selection per call
- Method choice (`direct`/`paste`/`runtime-api`)
- World choice when applicable
- Escalation decisions
- Route caching strategy

**Extension constraints:**
- No discovery state maintained between calls
- No classification heuristics (no "hostile editor" detector)
- No method auto-selection or fallback chains
- No caching beyond per-request dedupe

Caching of successful routes belongs at the proxy layer, keyed by request shape.

---

## ADR-018: Agent guidance ownership
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Method-selection guidance lives outside extension code as a documented skill/spec. The decision tree — "which method for this target?" — is not in the extension.

**Location:** `docs/skills/fill-method-selection.md` (agent-facing skill)

**Content:** How to read `dom`/`elements` probe output and choose:
- Framework markers on ancestors
- Parent-form shape
- Runtime-handle presence
- Shadow-root boundaries
- Retry guidance per method

The skill is what agents load and apply; the extension contract is the three methods plus read primitives that inform the choice.

---

## ADR-019: Architecture views toolchain — Astro Starlight + Mermaid + advisory sync helpers
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** The architecture views artifact is rendered by [Astro Starlight](https://starlight.astro.build) reading the public documentation tier plus a curated set of [Mermaid](https://mermaid.js.org) diagrams under `docs/public/views/`. Two advisory pnpm scripts (`views:audit`, `views:regen`) surface drift; neither blocks CI.

**Rationale:**
- Starlight is TS-native, fits the project's TypeScript-only stance ([ADR-005](#adr-005-typescript-as-project-language)), and ships Zod-validated content collections — the schema doubles as the contract for the sync audit script.
- Mermaid renders with one CDN import or one SSG plugin; sources stay as text in markdown, so coding agents reading the raw files see the same content the site renders. Diagram-as-code preserved.
- Likec4 (DSL-driven, multi-view) was evaluated and rejected: no native SVG renderer (PNG export goes through headless Chromium via Playwright); embed path requires React + PandaCSS as peer dependencies; runs its own viewer instead of acting as a renderer-embedded library. The agent-queryable benefit is mostly achievable by parsing Mermaid sources or a small manifest.
- Drift detection is advisory at this stage of the project lifecycle ([Phase 0.7](./plans/roadmap.md#phase-07--architecture-viewer-v1)) — manual updates before merge are sufficient; helpers report what changed without gating.

**Notation constraint:** Mermaid's experimental `C4Container` syntax is not used — render fails inconsistently. Container/Context/Deployment views are authored as `flowchart` with named subgraphs; C4 vocabulary lives in node labels and arrow captions.

**Scope:** Five curated diagrams (Context, Container, Deployment, Session State, Threat Model) plus auto-derived component graphs via `dependency-cruiser` ([ADR-012](#adr-012-static-analysis-stack)). Slot 05 is intentionally absent: the earlier scenario-sequence view duplicated prose and was dropped during the public/internal documentation split. See [`docs/internal/solution/views.md`](./solution/views.md) for the implementation spec.

---

## ADR-020: Architecture views layering — C4 spine with Diátaxis IA
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** The architecture views site uses the [C4 model](https://c4model.com) as the layering spine (Context → Container → Component → Code) and [Diátaxis](https://diataxis.fr) as the broader information-architecture frame for surrounding prose (explanation / reference / how-to / tutorial).

**Mapping for bproxy:**
- **C1 Context** — Code Agent, Developer, bproxy, Web Page
- **C2 Container** — CLI, Daemon, Extension (Background SW / Content Script / Popup)
- **C3 Component** — Daemon internals (auth, pacing, ws-hub, pending-map, sessions); Extension internals (tab-router, frame-table, read primitives, write methods)
- **C4 Code** — file-level dependency graphs per workspace, auto-generated by `dependency-cruiser`

**Cross-cutting indexes (not layers):** Protocol envelope, Actions catalog, ADRs, Scenarios — linked from each view's footer.

**Diátaxis mapping for existing docs:**
- `docs/public/views/` + `docs/public/index.md` → explanation
- `docs/public/solution/*.md` → reference
- _(how-to)_ — deferred until concrete walkthroughs exist; internal scenarios remain maintainer inputs under `docs/internal/scenarios.md`
- _(tutorial)_ — added when an end-to-end walkthrough is real

**Alternatives rejected:** Role-based layering (Scenarios → Capabilities → Components → Files) was considered but rejected because bproxy's structural decomposition is already clean C4 territory; flat topic-based IA matches today's docs but offers no layered ascent. ArchiMate, full UML, and DDD context maps were considered and rejected as inappropriate-for-scale.

---

## ADR-021: Browser-control authority model — generated sessions and logical tabs
**Date:** 2026-05-29
**Status:** Accepted

**Decision:** Browser-control authority is scoped to daemon-generated session capability handles and session-scoped logical tab handles.

**Rules:**
- Session ids are generated by the daemon only. Format: 6 characters, base32 lowercase, no prefix, regex `/^[a-z2-7]{6}$/`.
- Optional labels (for example `--label research`) are display metadata only and are never accepted in place of `-s` / `--session`.
- Browser-control commands do not silently create or reuse `default`. Missing `-s` is an error except on `tab open --url`, which is the sole bootstrap path that may auto-create a session.
- Logical tab handles are session-local ordinals `t1`, `t2`, ... . The daemon maps `{session, tab}` to the underlying Chrome tab id internally.
- `tab list` exposes only tabs opened inside the supplied session. Operator-opened tabs stay out of the normal agent surface until a future explicit adoption flow exists.
- `session bind --tab tN` accepts only logical tab handles from the same session. Raw Chrome tab ids are rejected at both CLI and daemon boundaries.
- `session close` removes the session and closes every session-owned Chrome tab. Phase 5 ships no idle TTL; document TTL as future work.

**Rationale:** Sessions are the authority boundary. Generated ids prevent accidental shared state, logical tabs prevent Chrome-id leakage, and close-on-session-close keeps cleanup deterministic.

---

## ADR-022: Extension-control routing for background tab actions
**Date:** 2026-05-29 (rewritten 2026-06-14)
**Status:** Accepted

**Decision:** Phase 5 keeps one request envelope across daemon↔extension traffic and splits tab-management actions into two tiers based on authority:

- **Daemon-local** — `tab.list` is resolved entirely within the daemon from its session tab registry. It never reaches the extension. This enforces the session-scoped visibility boundary: the daemon is the authority for which tabs an agent may see, and exposing the Chrome tabs API to this query would leak operator-opened tabs.
- **Extension-background-handled** — `tab.open` and `tab.close` are forwarded to the extension background service worker (not to a content script) because they require the Chrome `tabs.create` / `tabs.remove` APIs.

**Rules:**
- The existing `BproxyRequest` envelope is reused; no Phase 5 wire fork is introduced.
- Actions that do not target an existing tab may set `target.tabId` to `null` on the daemon↔extension wire.
- The extension background SW owns a fixed background-handled action set: `tab.open` and `tab.close`. These are executed locally in the SW and are not forwarded to a content script.
- `tab.list` is handled by the daemon without a WS client connection; it succeeds even when no extension is connected.
- All other forwarded browser actions (`tab.pin`, `tab.unpin`, `navigate`, `screenshot`, `require-human`) require a resolved Chrome tab id and continue through the existing tab-targeted path.

**Rationale:** The daemon is the security boundary for tab visibility. `tab.list` returning only session-owned tabs is a policy decision — not a browser-API query — so it belongs in the daemon. `tab.open` must work in a fresh session with no pre-bound tab; `tab.close` requires Chrome API access. Reusing the existing envelope keeps shared protocol churn low while making the bootstrap path and the visibility boundary explicit.

---

## ADR-023: First-class links extraction and Phase 5 session/tab errors
**Date:** 2026-05-29
**Status:** Accepted

**Decision:** Phase 5 adds a first-class `links` read action and extends the error taxonomy for the new session/tab capability model.

**`links` contract:**
- `links` is a read-only DOM action available through both protocol and CLI.
- It returns structured page links as `{ text, href, target, ...optionalMetadata }` so research flows do not need external HTML parsing.
- Relative URLs are normalized to absolute `href` values by the browser.
- Open shadow roots are traversed by default, consistent with `elements`.

**New error codes:**

| Code | Category | Retry | Meaning |
|---|---|---|---|
| `SESSION_REQUIRED` | `policy` | `conditional` | Browser-control command needs `-s <id>`; bootstrap with `tab open --url ...` or create a session first. |
| `INVALID_SESSION_ID` | `target` | `never` | Session handle is malformed and does not match `/^[a-z2-7]{6}$/`. |
| `SESSION_NOT_FOUND` | `target` | `conditional` | Session id is well-formed but not present in daemon memory. |
| `TAB_HANDLE_NOT_FOUND` | `target` | `conditional` | Logical tab handle (for example `t3`) does not exist in the supplied session. |
| `TAB_NOT_IN_SESSION` | `target` | `conditional` | A logical tab handle was used outside its owning session; raw Chrome ids do not satisfy this contract. |

**Rationale:** Research workflows need structured URLs as a primitive, and the generated-session/logical-tab model needs explicit machine-readable failures rather than overloading `TAB_NOT_FOUND`.

---

## ADR-024: No arbitrary page eval and no scroll-target inference
**Date:** 2026-06-12
**Status:** Accepted

**Decision:** bproxy does not expose arbitrary page evaluation as a product action, and it does not infer page-specific scroll containers. Arbitrary runtime/page investigation belongs to normal browser debugging tools such as Chrome DevTools Protocol. Scroll target choice belongs to the agent.

**Rules:**
- Remove the `eval` protocol action, CLI command, popup Eval mode, and extension eval execution path.
- Do not replace `eval` with a debugger-backed wrapper around `Runtime.evaluate`.
- Keep MAIN-world execution only for narrow, explicit product actions such as `fill(method="runtime-api", world="main")`.
- The `scroll` action is an actuator, not a page-structure strategist. It may support explicit targets (for example viewport/document or an agent-supplied element target), but it must not guess the correct container with generalized layout heuristics.
- `scroll` must report honest before/after movement data and avoid false success when no scroll occurred.

**Rationale:** bproxy's value is a thin, honest sensor/actuator bridge into a real user browser. Arbitrary eval would turn it into a weaker DevTools frontend with a larger security surface. Scroll heuristics would move agent-owned strategy into the extension and fail unpredictably across real pages with multiple scrollable regions.

**Implications:** Page-structure investigation, computed styles, framework/runtime introspection, and exploratory JavaScript execution should be performed through CDP/devtools outside bproxy. The May 31 eval and scroll journal notes are retained as evidence for this course correction, not as implementation plans.

---

## ADR-025: Security scanner findings are remediated in code
**Date:** 2026-06-12
**Status:** Accepted

**Decision:** SonarQube/SonarCloud security findings, including Security Hotspots, must be resolved by changing code or tests. Marking a hotspot as "safe", accepting it in the scanner UI, or otherwise suppressing the finding without code remediation is not allowed.

**Scope:** This restriction applies to production code and its associated tests (packages under `cli/`, `service/`, `extension/`, `shared/`, `views/`). Proof-of-concept code under `poc/` is exempt — findings there may be resolved directly in the scanner UI (marked as "Won't Fix" or "Safe") since POCs are throwaway explorations not shipped to users.

**Rules:**
- Treat security findings as implementation feedback, not as scanner bookkeeping.
- Prefer removing the risky pattern entirely over documenting why it is harmless.
- Test-only code follows the same rule: replace flagged constructs with deterministic or safer alternatives instead of marking them accepted.
- Suppressions or scanner-side status changes are not an approved path for security issues/hotspots in production code.

**Rationale:** bproxy controls a real user browser, so security review outcomes must leave the repository safer and auditable from source code alone. Code remediation keeps future local and CI scans aligned and avoids hidden policy state in external tools. POC code is excluded because it is never deployed and exists only to validate design hypotheses.

---

## ADR-026: Explicit click/hover actuator primitives
**Date:** 2026-06-13
**Status:** Accepted

**Decision:** Add two explicit DOM actuator primitives — `click` and `hover` — to the shared bproxy action catalog.

**Accepted scope:**
- `click` resolves one agent-supplied `ElementTarget`, asserts the target is visible/actionable, activates it honestly, and reports whether the target disappeared plus whether the page settled within a short bounded wait.
- `hover` resolves one agent-supplied `ElementTarget`, asserts the target is visible/actionable, dispatches hover-shaped synthetic events honestly, waits briefly with existing bounded jittered polling, and reports completion.
- Both actions stay in the ISOLATED-world DOM-action path and inherit open-shadow-root targeting from ADR-014.

**Rejected in this increment:**
- No `type` action. Expanding the write surface to synthetic key-event semantics would weaken ADR-007's explicit three-method write contract.
- No click-by-text strategy, cookie-banner solver, modal detector, retry chain, or fallback from `click` to another method.
- No arbitrary eval, no persistent MAIN-world presence, and no `MutationObserver`.

**Constraints:**
- The agent must supply an explicit target (`selector` or `route`) per call.
- Synthetic events are honest: `isTrusted=false`, no fake typing/key-event chain.
- Post-dispatch instability is reported in-band (`stable: false`), not upgraded to a protocol error.
- A target that disappears after `click` is a successful activation outcome, not an error.

**Rationale:** Clicking and hovering are narrow actuator primitives that fit the sensor+actuator boundary from ADR-017. They expose a small, auditable capability surface without moving page-specific strategy into the extension.

---

## ADR-027: Daemon-owned element target aliases for read→act workflows
**Date:** 2026-06-13
**Status:** Accepted

**Decision:** Add short-lived, page-scoped **element target aliases** for read→act workflows. Agents may use opaque handles such as `el17` or `ln3` returned by read actions, but those handles are daemon-owned aliases for existing `ElementTarget` values — not DOM node ids, not native object references, and not page-visible instrumentation.

**Accepted shape:**
- Agent-facing read results that already contain actionable targets (`elements`, `links`, and later compatible sensors) may include an optional handle alongside the normal `ElementTarget`.
- CLI commands may accept `--element elN|lnN` as a convenience target reference for actions that already accept explicit element targets (`click`, `hover`, `fill`, `select`, and explicit-target `scroll`).
- The daemon resolves `--element elN|lnN` to a normal `ElementTarget` before forwarding to the extension.
- The extension receives only the existing explicit target shape and remains unaware of handle storage.

**Ownership and lifetime:**
- The daemon mints handles and stores the mapping in memory only.
- Handles are scoped to `{session, logical tab, page identity}` and have a short TTL.
- Handles are invalidated on TTL expiry, session close, tab close, navigation/page-identity change, and cache pressure.
- Cache size is bounded per page and globally; repeated reads must not grow daemon memory without bound.

**Safety constraints:**
- No page mutation: no `data-bproxy-*`, marker attributes, marker nodes, or other DOM-visible identity tags.
- No extension cross-command element cache and no persistent MAIN-world state.
- No strategy is introduced in the daemon or extension: no click-by-text, selector repair, fallback chains, modal solvers, or method auto-selection.
- Destructive handle use must fail closed when the handle is expired, missing, stale, bound to another session/tab/page, or cannot satisfy the stored page precondition.
- The forwarded daemon→extension contract stays explicit-target based; handle references are accepted only at the CLI/daemon boundary.

**Page-staleness rule:** A handle is valid only for the page state from which it was minted. Phase 6 must design a concrete page identity/precondition mechanism before implementation. Acceptable directions include daemon-maintained page epochs from extension navigation events, an extension-checked expected page snapshot on each destructive forwarded action, or a combination. URL string alone is not sufficient for destructive safety.

**Observability:** Handle resolution is logged with the universal request `id` and outcome (`ok`, `expired`, `stale`, `scope_mismatch`, `not_found`) without exposing sensitive element text at normal log level. Debug output may include bounded hints such as tag/role/text snippets only when explicitly classified as diagnostic.

**Rationale:** Real use after `click`/`hover` showed that the remaining friction is target handoff, not missing primitives. Daemon-owned aliases improve agent ergonomics while preserving the thin extension, honest sensor/actuator boundary, session authority model, and page non-instrumentation guarantees.

---

## ADR-028: Temporary files confined to BPROXY_HOME
**Date:** 2026-06-14
**Status:** Accepted

**Decision:** All temporary files created by bproxy — in production and in tests — must reside within the application state directory (`BPROXY_HOME`, defaulting to `~/.bproxy/`). System-level temporary directories such as `/tmp` or the platform value returned by `os.tmpdir()` must not be used, neither as actual I/O targets nor as literal path strings in test assertions.

**State directory layout (additions):**

| Path | Purpose | Lifecycle |
|------|---------|----------|
| `BPROXY_HOME/tmp/` | Internal daemon scratch (temp scripts, intermediate buffers) | Wiped by daemon on startup; individual entries removed after use |
| `BPROXY_HOME/tmp/sessions/<id>/` | Per-session agent-facing artifact directory | Created on session bootstrap; wiped on `session close` or daemon stop |
| `BPROXY_HOME/<file>.{pid}.tmp` | Atomic-write staging (existing pattern in `pairing-file.ts`) | Renamed to target on success; orphans removed by daemon on startup |

**Rules for production code:**
1. Short-lived atomic writes use the sibling-temp pattern: write to `${targetPath}.${process.pid}.tmp`, then `rename()` to the target. The temp file inherits the parent directory's ownership and permissions — no world-readable intermediates.
2. Operations requiring a temp directory (spawning helper scripts, buffering large payloads) use `BPROXY_HOME/tmp/`. The daemon creates this directory on startup with mode `0o700` and removes stale contents (any entry older than the current daemon PID file's mtime).
3. No code path may call `os.tmpdir()`, reference `/tmp` directly, or rely on platform temp directory semantics. The state directory is the only sanctioned location for ephemeral files.
4. CLI commands that produce file artifacts (e.g., `screenshot`) write to the session temp directory by default when `--output-dir` is omitted. When `--output-dir` is explicitly provided, the user-specified path takes precedence.

**Session-scoped temp directory:**

Every session receives a dedicated artifact directory at `BPROXY_HOME/tmp/sessions/<session-id>/`. This directory is:
- **Created** by the daemon when the session is bootstrapped (`tab open --url ...` or `session create`).
- **Returned** to the agent in the bootstrap response as `tmpDir` — an absolute path the agent may use immediately without any setup.
- **Cleaned up** on `session close` (recursive removal) or daemon shutdown.

The `tmpDir` field is part of the session bootstrap contract:
```json
{
  "session": "m4q7z2",
  "tab": "t1",
  "bound": true,
  "url": "https://example.com",
  "tmpDir": "/home/user/.bproxy/tmp/sessions/m4q7z2"
}
```

`session.create` also returns `tmpDir`:
```json
{
  "session": "m4q7z2",
  "label": "research",
  "tmpDir": "/home/user/.bproxy/tmp/sessions/m4q7z2"
}
```

**Agent contract:**
- Agents may write to `tmpDir` directly (it is pre-created with mode `0o700`).
- Agents must not assume artifacts survive beyond `session close` — copy/move before closing if persistence is needed.
- The `screenshot` command defaults to writing into the session `tmpDir` when `--output-dir` is omitted (instead of returning raw base64). This eliminates the need for agents to manage output directories.
- The daemon never deletes individual files within `tmpDir` during the session lifetime — only the agent or `session close` may remove contents.

**Rules for test code:**
1. Tests that perform actual filesystem I/O must create an isolated per-test state directory via `mkdtempSync(join(projectRoot, '.tmp', 'test-'))` where `projectRoot` is the workspace root of the package under test. The `.tmp/` directory is gitignored and is not publicly writable.
2. Tests that pass path strings as fixture data to pure functions (argument parsing, config loading, validation) must use paths rooted in a user-private location — for example `join(homedir(), '.bproxy-test', ...)` or a deterministic non-`/tmp` literal such as `/home/testuser/.bproxy`. The literal string `/tmp` must not appear.
3. Test cleanup (`afterEach`/`afterAll`) removes per-test directories. Even when cleanup is skipped (crash, SIGKILL), leaked artifacts remain within the project tree (`.tmp/`) or the user's home — never in a shared system directory.

**Cleanup guarantees:**

| Scenario | Cleanup mechanism |
|----------|------------------|
| `session close` | `rm -rf BPROXY_HOME/tmp/sessions/<id>/` |
| Normal daemon stop | `lifecycle.shutdown()` removes all `BPROXY_HOME/tmp/` contents |
| Daemon crash → next startup | Startup wipes `BPROXY_HOME/tmp/` and removes orphaned `.*.tmp` siblings |
| Test run (normal) | `afterEach` / `afterAll` removes per-test dirs |
| Test run (crash) | Stale dirs accumulate in `<package>/.tmp/`; removed by `pnpm clean` or next CI run |
| Installed CLI (no daemon) | CLI scratch writes go to `BPROXY_HOME/tmp/`; no separate cleanup daemon needed — TTL-based removal on next CLI invocation |

**Rejected alternatives:**

| Alternative | Why rejected |
|-------------|-------------|
| `os.tmpdir()` / `mkdtemp` in system temp | On Linux resolves to `/tmp` (publicly writable, triggers S5443). No application-level cleanup guarantee — orphans accumulate across reboots on macOS. Not discoverable by the user. |
| `tmp` library (`setGracefulCleanup`) | Relies on process exit handlers that do not fire on SIGKILL/OOM. Still uses `os.tmpdir()` as base. Adds a runtime dependency for a solved problem. |
| Project-local `.tmp/` for production | Does not exist after installation — bproxy is distributed as a package, not run from a git checkout. |
| Suppressing Sonar S5443 via scanner UI | Violates [ADR-025](#adr-025-security-scanner-findings-are-remediated-in-code). |

**Security properties:**
- `BPROXY_HOME` is created with mode `0o700` (user-only access), inherited by `tmp/` and all contents.
- Atomic-write staging files are created with mode `0o600` before rename, preventing read races.
- No temporary file is placed in a world-writable directory, eliminating symlink-attack and information-disclosure vectors flagged by CWE-377 and CWE-379.

**Rationale:** bproxy is a security-sensitive tool that controls a real user's browser session. Temporary files may contain tokens, pairing codes, or session state. Confining all ephemeral I/O to the application's own directory — which the user owns, can inspect, and can wipe — provides defense-in-depth without relying on platform temp semantics, process exit handlers, or external cleanup daemons. The approach also satisfies static analysis (Sonar S5443) by construction rather than by exception.

---

## ADR-029: Public docs hosting — GitHub Pages with project-site subpath URL
**Date:** 2026-06-17
**Status:** Accepted

**Decision:** The public documentation tier (the Astro Starlight artifact built by `pnpm docs:build` from `docs/public/` plus `views/`) is published to [GitHub Pages](https://pages.github.com) from `main` as a project site at `https://dimdasci.github.io/bproxy/`. No custom domain. The Pages deploy is wired into the existing `Docs` workflow ([`.github/workflows/docs.yml`](../../.github/workflows/docs.yml)): PR runs remain build-only; pushes to `main` upload the built site as a Pages artifact and deploy it via [`actions/deploy-pages`](https://github.com/actions/deploy-pages).

**Rationale:**
- The repository is already on GitHub and the maintainer is admin — zero new accounts, no new vendor, no recurring bill.
- The output is fully static (`views/dist/`), so no host-specific platform features are in play; the artifact is portable across Pages, Cloudflare Pages, Netlify, Vercel, or plain object storage.
- Astro Starlight has no deploy-time coupling to the host once `site` and `base` are set in `views/astro.config.mjs` ([ADR-019](#adr-019-architecture-views-toolchain--astro-starlight--mermaid--advisory-sync-helpers)); switching to a different host or to a custom domain later is a workflow change, not a docs change.
- The project is small, single-maintainer, OSS — Cloudflare Pages' unmetered-bandwidth advantage is currently theoretical; deferring it removes a vendor relationship without closing the option.

**Alternatives considered and rejected (for now):**
- *Cloudflare Pages.* Better CDN, unmetered bandwidth, native PR previews. Rejected as premature given current traffic and the cost of a second vendor account.
- *Netlify / Vercel.* Comparable DX to Cloudflare. Vercel's free tier is non-commercial only, awkward for an OSS project that may accept sponsorship; Netlify's bandwidth meter has tightened in 2025. No clear advantage over Pages today.
- *Custom domain (e.g. `bproxy.dev`, ~$13/yr at Porkbun).* Available and the cleanest TLD fit, but commits to a recurring cost and a public name before the project warrants it. Deferred, not rejected — see below.
- *User-site repo (`dimdasci.github.io`).* Would avoid the subpath, but conflates project docs with the maintainer's personal namespace. Rejected.
- *No hosting; rely on rendered Markdown in the repo.* Rejected because non-trivial cross-page navigation, full-text search (Pagefind), Mermaid rendering, and the Diátaxis layering ([ADR-020](#adr-020-architecture-views-layering--c4-spine-with-diátaxis-ia)) only function in the built site.

**Consequences:**
- **Subpath URL is part of the contract.** All production URLs live under `/bproxy/`. Any code that emits absolute internal links (Markdown remark plugins, Astro components, sitemap, future redirects) must respect Astro's `base`. Today this affects `remarkRewriteMdLinks` in `views/astro.config.mjs`; new link generators must be audited the same way. The `assert-no-md-links.sh` check protects against `.md` link leakage but does not validate base-path correctness — verify with a `grep` over `views/dist` after non-trivial routing changes.
- **Deploy is gated on docs build.** The `Docs` workflow now publishes on every push to `main`. A failing docs build blocks publication but does not block CI, release, or other workflows; they remain independent.
- **HTTPS is enforced** by Pages; no plaintext fallback.
- **Rollback** is `gh api -X DELETE repos/dimdasci/bproxy/pages` plus a revert of the publishing change; the site goes 404 within ~1 minute and the repository is otherwise unaffected.

**Deferred:**
- *Custom domain.* Revisit when the project has a public name or launch event. Migration is a DNS record plus a Pages setting (or `CNAME` file); no code change beyond updating `site` in `views/astro.config.mjs`.
- *PR preview deployments.* GitHub Pages does not natively support per-PR previews on the same repository without significant workflow gymnastics. If previews become valuable, that becomes the trigger to migrate hosting to Cloudflare Pages or Netlify.
