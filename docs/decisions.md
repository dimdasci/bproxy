# bproxy — Architecture Decision Records

Append-only. Each decision is immutable once accepted. To reverse a decision, add a new entry that supersedes it.

---

## ADR-001: Default instrumentation strategy — read mode

**Date:** 2026-04-30  
**Status:** Accepted

**Context:** The original tech-solution docs described a heavy default (MAIN-world network shim, MutationObserver, history patches on every page). The team questioned whether this matched the actual use case: user is in front of the browser, agent does data reads and bounded batch work.

**Decision:** Read mode (Concept B) is the default. No MAIN-world presence, no declarative content scripts, no MutationObserver. Content script injected programmatically on first command per tab. Interact mode is a thin extension (paste-shaped writes), not a separate heavy mode.

**Alternatives considered:**
- Concept A (heavy default) — full instrumentation on every page. Rejected: unnecessary fingerprint surface for the primary use case, performance cost on untouched tabs, privacy-adjacent.
- Hybrid with `--mode` flag — user picks at session start. Rejected: interact mode collapsed into "read mode + write primitives that turn on when used." No separate identity.

**Consequences:** URL-first navigation patterns become the primary design target. Scroll is a read-mode primitive. Network shim, MutationObserver, and `--trusted` mode are escape hatches, not defaults.

**Full context:** [journal/2026-04-30-default-instrumentation-strategy.md](./journal/2026-04-30-default-instrumentation-strategy.md)

---

## ADR-002: Extension framework — WXT

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** Building a Chrome MV3 extension with TypeScript requires: manifest generation, SW bundling with MV3 module constraints, entrypoint discovery, dev-mode hot reload, and test infrastructure. Doing this by hand is significant scaffolding work.

**Decision:** Use [WXT](https://wxt.dev) (v0.20+) as the extension build framework.

**Alternatives considered:**
- Raw Vite/Rollup + manual manifest — full control, but high boilerplate for SW bundling, content script reload, manifest maintenance.
- Plasmo — React-centric, less control over manifest, in maintenance mode.
- CRXJS — Vite plugin, but stalled development, MV3 support incomplete.

**Consequences:** Extension source follows WXT conventions (`entrypoints/`, `utils/`, `wxt.config.ts`). Manifest is generated, not hand-written. Build-time only — no WXT runtime in production output. Ejectable: keep built output if we ever drop WXT.

**Key references:**
- [Project Structure](https://wxt.dev/guide/essentials/project-structure.md)
- [Entrypoints](https://wxt.dev/guide/essentials/entrypoints.md)
- [Content Scripts](https://wxt.dev/guide/essentials/content-scripts.md)
- [Scripting](https://wxt.dev/guide/essentials/scripting.md)
- [Storage](https://wxt.dev/guide/essentials/storage.md)
- [Messaging](https://wxt.dev/guide/essentials/messaging.md)
- [Unit Testing](https://wxt.dev/guide/essentials/unit-testing.md)
- [E2E Testing](https://wxt.dev/guide/essentials/e2e-testing.md)
- [Manifest config](https://wxt.dev/guide/essentials/config/guide/essentials/config/manifest.md)
- [Auto-imports](https://wxt.dev/guide/essentials/config/guide/essentials/config/auto-imports.md)
- [Environment Variables](https://wxt.dev/guide/essentials/config/guide/essentials/config/environment-variables.md)
- [Browser Startup](https://wxt.dev/guide/essentials/config/guide/essentials/config/browser-startup.md)

---

## ADR-003: Service framework — Fastify

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The proxy daemon needs HTTP (one POST route for CLI commands) and WebSocket (persistent connection to extension) on the same port, with unified auth, graceful shutdown, and typed request handling.

**Decision:** Use [Fastify](https://fastify.dev) + [`@fastify/websocket`](https://github.com/fastify/fastify-websocket).

**Alternatives considered:**
- `node:http` + `ws` (thin typed glue) — minimal deps, full control. Viable but requires manual graceful shutdown, manual body parsing, manual auth middleware. ~150 lines of glue that Fastify gives for free.
- Hono + `ws` — clean HTTP types but no built-in WS; still manually wiring `ws` to the server. Two mental models stitched together.
- h3 (UnJS) + `ws` — same ecosystem as citty but same WS gap as Hono. No real advantage over raw `node:http` if you're adding `ws` separately anyway.
- uWebSockets.js — native binary, platform-specific, poor TS types. Overkill for localhost single-client.

**Consequences:** Single port serves both HTTP and WS with unified lifecycle. `onRequest` hook implements auth gate for both. Typed routes with JSON Schema validation on the protocol envelope. Decorators attach pending map and pacing engine. ~15 transitive deps (all pure JS, no native bindings).

---

## ADR-004: CLI framework — citty

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The CLI has ~20 commands with nested subcommands (`bproxy service start`, `bproxy tab list`). Each invocation is one-shot: parse args → POST to daemon → print JSON → exit. Need typed args and fast startup.

**Decision:** Use [citty](https://github.com/unjs/citty) from the UnJS ecosystem.

**Alternatives considered:**
- Commander.js — most popular, mature, good subcommand support. More verbose, less TypeScript-native.
- cac — tiny, by Vite's author. Subcommand nesting is basic; `bproxy service start` style requires manual routing.
- clipanion — type-safe, class-based. More opinionated than needed.
- yargs — feature-rich but callback-heavy, TypeScript bolted on.
- Raw `node:util.parseArgs` — zero deps but no subcommand routing, no auto-generated help. ~200 lines of dispatch for 20 commands.

**Consequences:** Zero runtime dependencies (citty uses `node:util.parseArgs` internally). Lazy `() => import(...)` subcommands — only the invoked command is loaded. TypeScript-native typed args with inference. Each command is a self-contained `defineCommand()` file.

---

## ADR-005: TypeScript as project language

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The project has three components (CLI, daemon, extension) that share a protocol contract. Type safety across this boundary prevents a class of bugs where request/response shapes drift between components.

**Decision:** TypeScript throughout. Shared types in a `shared/` workspace package consumed by all three components. Bundled with `tsup` for CLI and daemon; WXT handles extension bundling.

**Alternatives considered:**
- JavaScript + JSDoc types — no build step, but weaker enforcement, no discriminated unions, no exhaustiveness checks.
- JavaScript with runtime validation only (Zod/AJK) — catches at runtime, not at write time.

**Consequences:** Monorepo with workspaces. Shared type package. Build step required for daemon and CLI (tsup). Type system enforces protocol correctness — adding a new action requires updating the discriminated union, which forces updates in all consumers.

---

## ADR-006: DOM polling over MutationObserver

**Date:** 2026-04-30  
**Status:** Accepted

**Context:** The extension needs to detect when a page has "settled" after navigation or scroll (e.g., lazy-loaded content appeared). MutationObserver is the standard approach but installs a listener on the document, which is detectable.

**Decision:** Use DOM polling (`setInterval` checking element count/stability) as the default "is page settled" mechanism. No MutationObserver.

**Alternatives considered:**
- MutationObserver on `documentElement` — standard, efficient, but detectable (listener is visible to the page's JS, fingerprint surface).
- `chrome.debugger` DOM events — reliable but requires yellow banner.

**Consequences:** Lower fingerprint (no installed listeners). Simpler mental model (poll until stable). Slightly higher CPU during polling intervals (200ms, bounded by timeout). Acceptable for the use case — polling runs for a few seconds after navigation/scroll, not continuously.

---

## ADR-007: Paste-flavored writes as default

**Date:** 2026-04-30  
**Status:** Accepted

**Context:** Form-fill needs to dispatch input events that frameworks (React, Vue, Angular) accept. The naive approach is per-character typing with keystroke cadence, but real humans paste from saved info docs — they never type their CV.

**Decision:** `bproxy fill` defaults to paste-flavored input events (`inputType: "insertFromPaste"`). Per-character typing is opt-in (`--method type`).

**Alternatives considered:**
- Per-character typing with paced keystroke cadence — realistic for composition, but wrong model for form-fill. Anti-fraud keystroke scoring becomes a problem.
- Direct `input.value =` assignment — doesn't update React/Vue/Angular controlled state.

**Consequences:** No keystroke fingerprint to score. Frameworks accept paste. Session pacing governs delay between fields, not within fields. Total fill time 30–90s for 20 fields is realistic.

---

## ADR-009: Observability as a first-class design constraint

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The system spans four execution contexts (CLI, daemon, extension SW, content script) across three communication boundaries. When something breaks, the developer — human or agent — sees a symptom at the CLI (error or timeout) with no visibility into where in the chain it failed. Debugging requires correlating events across processes that have no shared memory, no shared log, and different lifecycles (the SW can restart mid-request).

**Decision:** Every component must be independently observable. The request `id` is the universal correlation key — it appears in every log line, every stored entry, every error response. Debugging must not require reproducing the issue: the system retains enough trace data to reconstruct what happened after the fact.

**Concrete requirements:**

1. **Daemon** — logs the full request lifecycle (received, pacing wait, forwarded, response received, returned) with structured fields including `id`, `action`, `session`, `elapsed`. Default verbosity shows this; not hidden behind a debug flag.
2. **Extension** — maintains a ring buffer (last N requests) in `chrome.storage.session` with `{ id, action, tab, timestamp, result, errorCode, elapsed }`. Queryable via `bproxy debug log`.
3. **CLI** — `--verbose` flag prints to stderr: request JSON, timing, raw response. Stdout remains clean JSON for agent consumption.
4. **End-to-end tracing** — one `id` → grep daemon log + query extension buffer + read CLI output. No separate tracing infrastructure needed.
5. **Agent-friendly** — `bproxy debug log` and `bproxy debug last` return structured JSON. An agent debugging its own failure can inspect what happened without human interpretation.

**Alternatives considered:**
- "Add logging later when bugs appear" — rejected. Logging added retroactively never covers the cases you need because you didn't know to log them. Observability is cheaper to build in than to retrofit.
- Full distributed tracing (OpenTelemetry) — overkill for a localhost system. The `id`-based correlation gives 90% of the value at 1% of the complexity.

**Consequences:** Every solution doc includes an observability section. The daemon log format is part of the spec (not an implementation detail). The extension ring buffer is a storage schema commitment. The CLI gets a `debug` subcommand. The `id` field — already in the protocol for idempotency — becomes the tracing primitive too.

---

## ADR-008: WebSocket over Native Messaging

**Date:** 2026-04-30  
**Status:** Accepted

**Context:** The extension needs to communicate with the proxy daemon. Two options: Chrome Native Messaging (stdin/stdout to a host process) or WebSocket to a localhost server.

**Decision:** WebSocket to `ws://127.0.0.1:9615/ws`.

**Alternatives considered:**
- Native Messaging — tighter Chrome integration, no network surface. But: requires platform-specific host manifest installation, harder to develop/debug, one-message-at-a-time semantics, no easy way to test outside Chrome.

**Consequences:** Easier development (test WS with any client). No platform-specific install step for the host. Network surface limited to localhost (auth gate mitigates). Extension must handle WS reconnection on SW restart.
