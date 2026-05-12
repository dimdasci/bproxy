# bproxy — Implementation Roadmap

> **Status:** Active. Owns the day-to-day shape of how bproxy gets built.
> **Companion docs:** [`docs/architecture.md`](../architecture.md) (system shape), [`docs/decisions.md`](../decisions.md) (ADRs), [`docs/solution/`](../solution/) (per-component specs), [`docs/scenarios.md`](../scenarios.md) (driving use cases).

## Strategy

Layered bottom-up, with a preliminary PoC phase. Domain model first, then each consumer layer in dependency order. Three load-bearing PoCs precede production work and produce updated documentation; a doc-reconciliation gate sits between PoC phase and Layer 1 so we never build on stale assumptions. Each layer's "done" definition includes both functional completeness and design-constraint assertions, so checkpoints validate adherence to the design — not just to a feature list. Code-as-documentation is treated as a non-functional requirement enforced through a small set of practical rules.

The team is solo execution by a single mid-level developer; tasks are sized to one day or less so progress stays visible and reviewable.

## Phase order

| # | Phase | Purpose | Detail |
|---|---|---|---|
| 0 | PoC | De-risk three load-bearing technical assumptions | [phases/00-poc.md](./phases/00-poc.md) |
| 0.5 | Doc reconciliation | Update docs to match PoC verdicts before any production code | _plan written when Phase 0 closes_ |
| 1 | Shared types | The domain model | _plan written when Phase 0.5 closes_ |
| 2 | Daemon | Routing, auth, pacing, lifecycle | _plan written when Phase 1 closes_ |
| 3 | Extension | Browser-side execution | _plan written when Phase 2 closes_ |
| 4 | CLI | One-shot agent interface | _plan written when Phase 3 closes_ |
| 5 | Integration & hardening | End-to-end against documented scenarios | _plan written when Phase 4 closes_ |

Per-phase detail files live under [`docs/plans/phases/`](./phases/) as each phase begins. Each captures day-or-less work units, dependencies, and deliverables. The roadmap stays the index; phase files own the granular plan.

**Just-in-time planning is intentional.** Each phase's plan is written at the start of that phase, informed by what its predecessor actually shipped (PoC verdicts, refactors revealed in earlier layers, surprises in the docs after reconciliation). Writing all seven plans up front would lock in assumptions before they've been tested.

## Per-phase summary

### Phase 0 — PoC

**Purpose:** validate three load-bearing technical assumptions before they're baked into production code.

**Three PoCs:**

1. **MV3 SW + WebSocket + protocol envelope round-trip** (~1 day) — smallest viable Fastify WS server plus minimal MV3 extension. Validates subprotocol auth, SW lifecycle under forced suspend, reconnect+replay pattern, and envelope shape.
2. **CLI → extension pairing transport** (~½–1 day) — confirms whether `chrome.runtime.onMessageExternal` accepts native processes; if not, evaluates alternatives (CLI-opened companion page, in-band pairing through the daemon WS).
3. **Paste-flavored writes on real frameworks** (~½ day) — manual test against a real React/Vue application form (Welcome to the Jungle or similar; final pick at PoC time). Validates [ADR-007](../decisions.md#adr-007-paste-flavored-writes-as-default).

**Done when:** all three PoCs have committed code under `poc/<name>/`, journal memos under `docs/journal/`, and any ADR amendments under `docs/decisions.md`. Each PoC closes with a verdict (*confirms / modifies / invalidates the design*).

### Phase 0.5 — Doc reconciliation gate

**Purpose:** propagate PoC verdicts into the design docs before Layer 1 starts.

**Done when:** every PoC verdict that modifies or invalidates a design choice has produced a corresponding edit to `docs/architecture.md`, `docs/decisions.md`, or `docs/solution/*.md`, committed. Layer 1 cannot start until docs reflect validated reality.

### Phase 1 — Shared types (and workspace scaffold)

**Purpose:** the domain model, plus the workspace skeleton and tooling that hosts every later layer. Per [docs/solution/shared.md](../solution/shared.md) and [docs/quality-gates.md](../quality-gates.md).

**Output:** pnpm workspace configured (`shared/`, `service/`, `extension/`, `cli/`); root tooling installed and wired (`tsc`, Biome, ESLint v9, dependency-cruiser, knip); CI running `pnpm check` on every push; `@bproxy/shared` package compiling with the full `Action` discriminated union, `BproxyRequest` / `BproxyResponse` envelope, error taxonomy, and pacing config types.

**Done when:** `pnpm check` passes from a clean checkout; every action in the [actions table](../architecture.md#actions) appears in the union with `ActionParams` and `ActionResult` entries; tests assert that the discriminated union is exhaustive.

### Phase 2 — Daemon

**Purpose:** routing, auth, pacing, and lifecycle. Per [docs/solution/service.md](../solution/service.md).

**Output:** `service` binary running on `127.0.0.1:9615`, scriptable end-to-end via a mock WS client driven by the protocol's actions.

**Done when:** all routes (`POST /`, `POST /pair/claim`, `GET /ws`) implemented with the four-layer auth gate; pacing engine enforces per-session delays; pending map handles timeout, replay-on-reconnect, dedupe; lifecycle scripts (start, stop, status) work; daemon log is structured with the request `id` per [ADR-009](../decisions.md#adr-009-observability-as-a-first-class-design-constraint).

### Phase 3 — Extension

**Purpose:** browser-side execution. Per [docs/solution/extension.md](../solution/extension.md).

**Output:** `extension/.output/chrome-mv3/` loadable in Chrome, with all action handlers, ring buffer, pairing receiver, and connection-state badge.

**Done when:** background SW maintains WS connection across SW restart with replay; content script injection is programmatic per-tab; all action handlers from the [actions table](../architecture.md#actions) execute correctly; ring buffer queryable via `debug.log`; design-constraint assertions hold (no `MutationObserver` in bundle, `fill` dispatches `insertFromPaste`, no MAIN-world script registered by default).

### Phase 4 — CLI

**Purpose:** one-shot agent interface. Per [docs/solution/cli.md](../solution/cli.md).

**Output:** `bproxy` binary with all commands listed in the [actions table](../architecture.md#actions), plus `service`, `extension`, `session`, `tab`, and `debug` subcommands.

**Done when:** every command POSTs the correct action to the daemon; output is clean JSON on stdout; exit codes follow the 0/1/2 convention; `--verbose` writes structured stderr; token preflight refuses insecure tokens.

### Phase 5 — Integration & hardening

**Purpose:** validate the system against documented scenarios end-to-end and harden the rough edges.

**Output:** Scenarios 1–3 from [docs/scenarios.md](../scenarios.md) pass against real sites; deadline timeouts behave correctly; error envelope is complete across all error codes; observability covers all lifecycle events; pre-commit hooks (Husky + lint-staged or equivalent) installed and wired to a fast subset of `pnpm check` per [docs/quality-gates.md](../quality-gates.md).

**Done when:** Scenario 1 (Google research) runs autonomously to completion; Scenario 2 (LinkedIn snapshot) handles `HUMAN_REQUIRED` correctly; Scenario 3 (form fill) fills a real application form to the user-review step; pre-commit hooks block commits that fail format, lint, or per-file type-check on changed files.

## Cross-cutting rules

### PoC structure

Every PoC has:

- **One question** — yes/no or a measurement.
- **Hard timebox** — ½ or 1 day. If the timebox is hit without an answer, the PoC reports "inconclusive" and we decide what to do next; PoCs never silently grow. If a PoC reveals a deeper problem, it spawns a follow-up PoC rather than expanding in place.
- **Three outputs:**
  1. Working-but-throwaway code under `poc/<short-name>/` — committed (not gitignored), so it remains referenceable, but never imported by production packages.
  2. A 1-page memo at `docs/journal/YYYY-MM-DD-poc-<topic>.md` capturing: question, method, finding, implication.
  3. ADR amendment in `docs/decisions.md` if the finding modifies or invalidates a decision.
- **A verdict** — each PoC closes with one of: *confirms the design / modifies it / invalidates it.*

### Layer pattern (definition of done)

Every layer (1–5) follows the same structure:

1. **Decomposed into ≤1-day work units** — each unit is a named task with clear input and output. Captured in the phase detail file.
2. **Definition of done = the checkpoint.** Four criteria, all required:
   - **Functional** — every interface consumed by later layers is implemented.
   - **Design-asserted** — at least one test or static check confirms a design constraint. Examples: extension bundle contains no `MutationObserver` reference; daemon's `onRequest` auth hook runs before any route handler; `fill` action handler dispatches `InputEvent` with `inputType: "insertFromPaste"`.
   - **Documented** — package `README.md` and any updates to `docs/solution/*.md` are committed.
   - **Static gates pass** — `pnpm check` succeeds (type checking, format, lint with complexity and size limits, architecture rules, dead-code and dependency hygiene). Per [docs/quality-gates.md](../quality-gates.md).
3. **Layer scope is locked at start** — the phase detail file enumerates what's in scope; anything else is out of scope for that phase.

### Scope discipline

A layer builds only what later layers consume — nothing more. Concrete check at layer review: walk the protocol's `Action` union and confirm each action is supported only as far as that layer's job demands. Features that look "obviously needed" but have no consumer in this codebase are out.

This rule counters bottom-up's natural tendency to over-engineer the foundation.

### Code-as-documentation

Treated as a non-functional requirement. Practical rules, enforced during review:

- **Public API is explicit.** Each package has a single entry point exposing its public surface; internals stay unexported. A consumer can read the entry point alone and know how to use the package.
- **File names mirror architecture.** Layout in each package matches what's described in `docs/solution/*.md`. If reality diverges, the doc gets updated, not the other way round.
- **Names carry meaning; comments are rare.** No comments explaining *what* the code does — names are the explanation. Comments only where the *why* is non-obvious (constraint, invariant, workaround). No TODOs or commented-out code in committed work.
- **Tests read as specifications.** Test names describe behaviour in domain terms. A reader scanning test files should understand what the package does without reading the implementation.
- **Per-package `README.md`** — purpose (1 paragraph), public API (link to entry point), how to develop locally, how to test. One file per package, kept short.

## Decisions log

- **2026-05-08** — Approach approved: layered bottom-up + preliminary PoC phase. Daemon-first ordering after Layer 1.
- **2026-05-08** — PoC list locked: (1) MV3 SW + WebSocket + protocol envelope, (2) CLI → extension pairing transport, (3) paste-flavored writes on real frameworks (target page deferred to PoC time).
- **2026-05-08** — Static analysis stack adopted ([ADR-012](../decisions.md#adr-012-static-analysis-stack)): `tsc` + Biome (format) + ESLint v9 (with `eslint-plugin-sonarjs`) + dependency-cruiser + knip, exposed via `pnpm check` and per-step scripts. Pre-commit hooks deferred to Phase 5; during active development, gates run on demand and in CI only. Concrete policy in [docs/quality-gates.md](../quality-gates.md).
- **2026-05-08** — PoC 1 (MV3 SW + WebSocket + protocol envelope) completed with ✅ confirms-design verdict. Artifacts: `poc/mv3-ws-reconnect/` and `docs/journal/2026-05-08-poc-mv3-ws-reconnect.md`. No ADR/doc changes required.
- **2026-05-08** — PoC 2 (CLI → extension pairing transport) completed with ⚠️ modifies-design verdict. Plan A (`chrome.runtime.onMessageExternal` from Node) confirmed unviable; Plan D (popup-driven claim via `POST /pair/claim`) adopted. ADR-011 amended with superseded note. Artifacts: `poc/cli-extension-pairing/` and `docs/journal/2026-05-08-poc-cli-extension-pairing.md`.
- **2026-05-09** — PoC 3 (write technique for hostile rich-text editors) completed with ⚠️ modifies-design verdict. Pivoted from Lexical/React-fiber hypothesis to Quill runtime handle resolution (`__quill` via shadow-root scoping in `MAIN` world). Runtime API mutation confirmed on live LinkedIn composer. ADR amendments deferred to Phase 0.5. Artifacts: `poc/paste-fill/` and `docs/journal/2026-05-08-poc-paste-fill.md`.

## Relationship to other docs

| Doc | Role |
|---|---|
| [`docs/architecture.md`](../architecture.md) | What the system is and how its components connect |
| [`docs/decisions.md`](../decisions.md) | Why we chose what we chose (ADRs) |
| [`docs/solution/`](../solution/) | Per-component implementation specs |
| [`docs/scenarios.md`](../scenarios.md) | Driving use cases the system must support |
| [`docs/quality-gates.md`](../quality-gates.md) | Static analysis policy: tools, thresholds, commands |
| [`docs/journal/`](../journal/) | Raw design thinking; PoC findings land here |
| **this doc** | **How and in what order we build it** |
