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

---

## ADR-010: WebSocket auth transport — subprotocol token

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** Service auth spec required `Authorization: Bearer` on all requests including WS upgrade, but extension WebSocket clients cannot reliably set arbitrary `Authorization` headers. We need one concrete WS auth mechanism compatible with browser extension APIs.

**Decision:** Keep bearer token as the shared secret, but use transport-specific carriage:
- **HTTP (`POST /`)**: `Authorization: Bearer {token}`
- **WS (`GET /ws`)**: `Sec-WebSocket-Protocol` with `bproxy.v1` and `auth.{base64url(token)}`

Server validates both subprotocol parts during upgrade and negotiates `bproxy.v1` on success.

**Alternatives considered:**
- Query token (`/ws?token=...`) — simpler, but token hygiene is weaker (URL exposure risk).
- First-message auth after upgrade — flexible, but adds unauthenticated pre-auth socket state and more complexity.

**Consequences:** WS auth is now implementable and unambiguous for Chrome extension clients. Docs must treat HTTP and WS auth separately.

**Superseded note (see ADR-011):** The original single-token lifecycle assumption is superseded. Current model uses two secrets:
- **Daemon token** in `~/.bproxy/token` for CLI→daemon HTTP auth.
- **Extension token** issued via one-time pairing claim for extension WS auth.

---

## ADR-011: Extension token bootstrap via CLI-mediated pairing

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The design had a gap: daemon generated token material, extension expected token in storage, but no explicit pairing/bootstrap flow was specified. Manual token entry is incompatible with no-options-page UX.

**Decision:** Add explicit one-time pairing flow:
- `bproxy service start` creates short-lived one-time pairing code.
- `bproxy extension pair --code <CODE>` claims code via daemon route `POST /pair/claim` authenticated by daemon bearer token.
- Daemon returns bootstrap payload (`extensionToken`, `wsUrl`, `protocolVersion`, `issuedAt`, `expiresAt`, `nonce`).
- CLI delivers payload to extension via external runtime messaging bridge.
- Extension stores token and reconnects WS.

**Alternatives considered:**
- Unauthenticated `/bootstrap` endpoint for extension self-claim (rejected: larger pre-auth surface).
- Manual token paste UI (rejected: not aligned with current extension design).

**Consequences:** Bootstrap is now fully documented, scriptable, and auditable; pairing code is one-time + TTL-bound; daemon and extension tokens are separated by role.

---

## ADR-012: Static analysis stack

**Date:** 2026-05-08  
**Status:** Accepted

**Context:** The "code as documentation" non-functional requirement (`docs/plans/roadmap.md`) needs concrete enforcement. Without static gates, code structure and complexity drift quietly between commits. The project also has a clear architectural shape — four workspace packages with strict directional dependencies — which won't enforce itself.

**Decision:** Adopt a composed five-concern static analysis stack:

- **Type checking:** `tsc --noEmit` per workspace, with `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `isolatedModules`, `verbatimModuleSyntax`.
- **Format:** Biome v2 (format-only; lint disabled to avoid double config).
- **Lint:** ESLint v9 (flat config) with `@typescript-eslint`, `eslint-plugin-sonarjs` (cognitive complexity), and built-in size/depth rules.
- **Architecture rules:** `dependency-cruiser` enforcing cross-package import constraints that mirror `docs/architecture.md`.
- **Dead code & dependency hygiene:** `knip`.

The full surface is exposed via `pnpm check` (umbrella) plus per-step scripts (`pnpm typecheck`, `pnpm format`, `pnpm lint`, `pnpm arch`, `pnpm deadcode`). Concrete configuration, thresholds, and command surface live in [`docs/quality-gates.md`](./quality-gates.md).

**Alternatives considered:**

- **Biome-only.** Single tool covers format and common-case lint. Rejected: Biome v2 lacks plugin parity for cognitive-complexity rules, layer-boundary enforcement, and dead-code analysis. Re-evaluate in 12 months as Biome's plugin ecosystem matures.
- **ESLint + Prettier (no Biome).** The traditional stack. Works, but slower; Biome's format speed is a meaningful local-dev win.
- **oxlint as primary lint.** Fast, but explicitly positioned as a complement to ESLint, not a replacement; no type-aware rules in 2026.
- **Skip dependency-cruiser; rely on convention.** Rejected: a four-package monorepo with directional dependencies will drift without enforcement.

**Consequences:**

- Five tools to keep configured. Mitigated by (a) Biome and ESLint having stable upgrade paths, (b) `pnpm check` as the single umbrella, (c) all configs at the repo root.
- `dependency-cruiser` rules and `docs/architecture.md` must be updated together. Documented as a maintenance rule in `docs/quality-gates.md`.
- CI gates fail builds; auto-fix lives only in developer tooling (Biome `--write`, ESLint `--fix`). Pre-commit hooks deferred to Phase 5 — during active development, gates run on demand and in CI only.
