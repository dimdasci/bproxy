# bproxy — Architecture Decision Records

**Edition: 2026-05-13 (Phase 0.5)** — Authoritative current ADR set.

---

## Unchanged (minor formatting only)

### ADR-001: Default instrumentation strategy — read mode
**Date:** 2026-04-30
**Status:** Accepted

Read mode (Concept B) is the default. No MAIN-world presence, no declarative content scripts, no MutationObserver. Content script injected programmatically on first command per tab. Interact mode is a thin extension (paste-shaped writes), not a separate heavy mode.

---

### ADR-002: Extension framework — WXT
**Date:** 2026-05-08
**Status:** Accepted

Use [WXT](https://wxt.dev) (v0.20+) as the extension build framework. Extension source follows WXT conventions; no WXT runtime in production output. Ejectable.

---

### ADR-003: Service framework — Fastify
**Date:** 2026-05-08
**Status:** Accepted

Use [Fastify](https://fastify.dev) + [`@fastify/websocket`](https://github.com/fastify/fastify-websocket). Single port serves both HTTP and WS with unified lifecycle.

---

### ADR-004: CLI framework — citty
**Date:** 2026-05-08
**Status:** Accepted

Use [citty](https://github.com/unjs/citty) from the UnJS ecosystem. Lazy imports, TypeScript-native, zero runtime deps.

---

### ADR-005: TypeScript as project language
**Date:** 2026-05-08
**Status:** Accepted

TypeScript throughout. Shared types in a `shared/` workspace package consumed by all three components. Protocol correctness enforced by type system.

---

### ADR-008: WebSocket over Native Messaging
**Date:** 2026-04-30
**Status:** Accepted

WebSocket to `ws://127.0.0.1:9615/ws`. Development-friendly, no platform-specific host manifest required.

---

### ADR-009: Observability as a first-class design constraint
**Date:** 2026-05-08
**Status:** Accepted

Every component independently observable. Request `id` is the universal correlation key. Ring buffer in extension (`chrome.storage.session`), structured daemon logs, and `--verbose` CLI output.

---

### ADR-012: Static analysis stack
**Date:** 2026-05-08
**Status:** Accepted

Composed five-concern stack: `tsc` (strict), Biome v2 (format), ESLint v9 (lint + cognitive complexity), `dependency-cruiser` (architecture rules), `knip` (dead code/deps). Exposed via `pnpm check`.

---

## Rewritten

### ADR-006: DOM polling over MutationObserver
**Date:** 2026-05-13 (rewritten)
**Status:** Accepted

**Decision:** Use DOM polling (`setInterval` checking element count/stability) as the default "is page settled" mechanism. No MutationObserver.

**Update from PoC phase:** Polling is now:
- **Jittered** — intervals vary randomly within a bounded range, never fixed cadence
- **Visibility-aware** — destructive actions bail when `document.visibilityState === 'hidden'` unless explicitly user-initiated
- **Bounded** — maximum polling duration with resolution (stable or timeout)

**Rationale:** Lower fingerprint than installed listeners, but fixed-cadence polling is a behavioral tell. Jitter and visibility checks remove that signal.

---

### ADR-007: Three-method write contract
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

### ADR-010: WebSocket auth transport — two-token model
**Date:** 2026-05-13 (rewritten)
**Status:** Accepted

**Decision:** Route-specific auth with two distinct tokens:
- **Daemon token** (`~/.bproxy/token`) — CLI→daemon HTTP auth
- **Extension token** — issued during pairing, extension→daemon WS auth

**Transport specifics:**
- **HTTP (`POST /`, `POST /pair/claim`):** `Authorization: Bearer {daemonToken}`
- **WS (`GET /ws`):** `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(extensionToken)}`

**Note:** `POST /pair/claim` requires pairing code validation flow, not daemon bearer token (see ADR-011).

---

### ADR-011: Extension token bootstrap via popup-driven pairing
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

## New

### ADR-013: MAIN-world runtime-api writes
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

### ADR-014: Shadow-DOM-aware discovery + route-based targeting
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

### ADR-015: MAIN-world hygiene contract
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Every MAIN-world execution follows mandatory hygiene to prevent `chrome-extension://` URL leaks into page-observable state.

**Requirements:**
1. **No identifying literals** in injected function bodies (no `"chrome-extension"`, extension ID, or library names)
2. **Catch and normalize errors inside MAIN-world function** — never let raw throws escape
3. **Prevent stack leakage** — errors caught and wrapped before crossing world boundary; page cannot observe `chrome-extension://<id>/` URLs in stacks
4. **One-shot execution** — no persistent state, no listeners installed

---

### ADR-016: `web_accessible_resources` default-deny
**Date:** 2026-05-13
**Status:** Accepted

**Decision:** Ship with no `web_accessible_resources` declared. WAR is the primary deterministic extension-resource disclosure vector; removing it eliminates scanner-friendly enumeration.

**Carve-out process:** Any future WAR addition requires explicit ADR documenting:
- Why the resource must be web-accessible
- What risk is accepted by the exposure
- Mitigations applied

Default-deny does not eliminate all extension side channels, but it removes the controllable one.

---

### ADR-017: Sensor+actuator boundary
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

### ADR-018: Agent guidance ownership
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

