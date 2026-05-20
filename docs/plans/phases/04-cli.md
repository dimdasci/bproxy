---
title: Phase 4 — CLI
---

> **For implementers:** this is a work-decomposition plan, not a code transcript. The target reader is expected to know TypeScript, Node process management, and command-line UX. Keep the CLI boring: one invocation, one daemon interaction, one JSON object on stdout.

**Goal:** Ship `@bproxy/cli` — a `bproxy` binary built with citty that agents can call one command at a time. The CLI manages the daemon lifecycle, sends protocol actions to `POST /`, preserves clean machine-readable output, and exposes enough debug/status commands for an agent to diagnose its own failures.

**Strategy:** Close the lifecycle contract seams first, then build the CLI from the boundary inward: state/token resolution, daemon HTTP client, command argument surfaces, lifecycle commands, integration tests, and docs/views. The CLI must not become a strategy layer. It translates explicit user/agent intent into shared `ActionParams`; method choice, target choice, and escalation remain agent-owned.

**Spec:** [`docs/solution/cli.md`](../../solution/cli.md).
**Roadmap entry:** [Phase 4 in roadmap.md](../roadmap.md#phase-4--cli).
**Current system context:** [`docs/views/01-context.md`](../../views/01-context.md), [`docs/views/02-containers.md`](../../views/02-containers.md), [`docs/views/03-deployment.md`](../../views/03-deployment.md), [`docs/views/04-session-state.md`](../../views/04-session-state.md), [`docs/views/06-threat-model.md`](../../views/06-threat-model.md).

**Decisions that constrain this phase:**

- [ADR-004](../../decisions.md#adr-004-cli-framework--citty) — use citty for the command framework.
- [ADR-005](../../decisions.md#adr-005-typescript-as-project-language) — TypeScript throughout; import shared protocol types.
- [ADR-007](../../decisions.md#adr-007-three-method-write-contract) — fill method is explicit; no `auto` or CLI fallback chain.
- [ADR-009](../../decisions.md#adr-009-observability-as-a-first-class-design-constraint) — request `id` is the universal correlation key; `--verbose` writes structured stderr.
- [ADR-010](../../decisions.md#adr-010-websocket-auth-transport--two-token-model) — CLI uses only the daemon bearer token, never the extension token.
- [ADR-011](../../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) — `service start` surfaces the pairing code for the popup flow.
- [ADR-012](../../decisions.md#adr-012-static-analysis-stack) — `pnpm check` remains the phase gate.
- [ADR-017](../../decisions.md#adr-017-sensoractuator-boundary) and [ADR-018](../../decisions.md#adr-018-agent-guidance-ownership) — CLI forwards explicit choices; it does not classify targets or select write methods.
- [ADR-019](../../decisions.md#adr-019-architecture-views-toolchain--astro-starlight--mermaid--advisory-sync-helpers), [ADR-020](../../decisions.md#adr-020-architecture-views-layering--c4-spine-with-diátaxis-ia) — Phase 4 completes the remaining scenario views and regenerates the CLI component graph.

---

## Locked outcomes for this phase

1. **`bproxy` binary exists and is buildable.** `cli/package.json` exposes `bin: { "bproxy": "./dist/bproxy.mjs" }`; `pnpm --filter @bproxy/cli build` emits the binary; `pnpm --filter @bproxy/cli test` covers command/client behavior.
2. **Every action in the shared `Action` union has a CLI surface** unless it is intentionally grouped under a subcommand (`session.*`, `tab.*`, `debug.*`). Command tests assert coverage so adding a shared action breaks the CLI until a decision is made.
3. **One action command = one HTTP POST to the daemon.** Non-lifecycle leaf commands build a `BproxyRequest`, read the daemon token and port from the selected `BPROXY_HOME`, POST to `http://127.0.0.1:{port}/`, and print exactly one JSON object on stdout.
4. **`service` subcommands manage lifecycle without importing service internals.** The CLI may spawn/resolve the service binary, but must not import `service/src/**`; dependency-cruiser’s workspace direction stays `cli -> shared` only.
5. **Exit codes are deterministic.** `0` means a valid protocol response with `ok: true`; `1` means a valid protocol response with `ok: false`; `2` means CLI usage/config/control-plane failure (bad args, daemon not running, missing/insecure token, lifecycle failure, non-protocol daemon response).
6. **Stdout remains machine JSON.** No color, progress bars, pairing instructions, or verbose lines on stdout. Human hints, if any, go to stderr and only for exit `2` or `--verbose`.
7. **Token preflight fails closed.** Before any POST command, the CLI verifies `~/.bproxy/token` (or `$BPROXY_HOME/token`) exists, is owned by the current user when UID is available, and has mode exactly `0600`. It refuses to send auth when this check fails.
8. **`--verbose` is structured stderr.** It records request id, action, session, URL, elapsed time, HTTP status, and protocol error code when present, without leaking bearer token values.
9. **Write commands preserve explicitness.** `fill` and `fill-form` require method/world fields. `eval` requires an explicit CLI opt-in flag in addition to any daemon/extension policy; the CLI must not silently run arbitrary code because a string argument was present.
10. **Docs and views reflect the shipped CLI.** `cli/README.md` and affected solution docs are updated; `docs/views/05-scenarios/*.md` exists and builds; `pnpm views:regen` updates `docs/views/auto/cli-components.svg`; the Container view links to the CLI graph.
11. **Static gates pass from a clean checkout:** `pnpm check`, `pnpm test`, and `pnpm docs:build`.

---

## Resolved implementation decisions before command work

Phase 2 and Phase 3 left a few CLI-facing seams. Treat the following as Phase 4 decisions unless implementation proves them impossible.

1. **Service binary remains the lifecycle authority.**
   - `bproxy service start|stop|status` must spawn the built service binary; CLI production code must not import `service/src/**` or call lifecycle functions directly.
   - Direct service binary behavior stays scriptable too. The service binary should own PID/port/token/pairing files and emit stable lifecycle JSON; the CLI may parse and re-emit that JSON, but must not reconstruct daemon state by scraping logs.
   - `service restart` is a CLI composition: stop, then start.

2. **Detached start must return pairing metadata.**
   - Current service code issues the pairing code inside the foreground daemon and writes it to that process's stdout, while `startDetached` spawns the child with ignored stdio. A real `bproxy service start` therefore cannot fulfill ADR-011 yet.
   - Implement a pairing metadata file in `BPROXY_HOME` (recommended name: `pairing.json`) written by the foreground daemon immediately after issuing the code. File mode must be `0600` because the code is a temporary auth factor.
   - Successful detached start output is a plain lifecycle object, not a protocol envelope:
     - `{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}`
   - The daemon issues and prints a fresh pairing code on every daemon start. A persisted `extension-token` still allows reconnect without re-pairing; the printed code is for first pair, rotation, or recovery.

3. **Lifecycle JSON is separate from protocol JSON.**
   - Lifecycle success uses plain JSON objects on stdout. Lifecycle failures write diagnostics to stderr; when surfaced through `bproxy`, they exit `2`.
   - `service status` is token-free and process-liveness based: `{"running":false}` or `{"running":true,"pid":123,"port":9615}`.
   - `service stop` success should produce `{"running":false}`. `service restart` should produce the same success shape as `service start`.

4. **Token and state-file semantics mirror the daemon.**
   - `BPROXY_HOME` remains the state-directory boundary; `--home` is a global CLI override that maps to `BPROXY_HOME` for child service processes.
   - Daemon token file checks are POSIX-style because the daemon already enforces them: mode exactly `0600`; owner check only when `process.getuid()` is available.
   - `service stop` removes transient daemon state (`bproxy.pid`, `port`, `token`) and preserves `extension-token` for transparent extension reconnect after restart.

5. **Eval/debugger control-plane wiring is deferred.**
   - The shipped extension already reads `local:configFlags.evalEnabled` and `local:configFlags.debuggerScreenshot`, but no daemon/CLI route sets those flags.
   - Phase 4 must not add misleading `service start --allow-eval` or `--enable-debugger-mode` flags.
   - CLI still exposes `eval --allow-eval` as a local user-intent guard and `screenshot --debugger` as a request flag. Unless extension storage was configured out-of-band, the protocol response will be `EVAL_DISABLED` or `DEBUGGER_DISABLED`; pass it through and exit `1`.

6. **`session bind` is the targeting command; `tab pin` is browser chrome state.**
   - The daemon owns `session -> tabId`. Agents should use `bproxy session bind --tab-id N` to choose the tab for a session.
   - `tab.pin` / `tab.unpin` are forwarded Chrome tab actions that visually pin/unpin a tab. They do **not** bind a session, and because they are forwarded they still require a connected extension and an already-bound session.
   - Command help and docs must make this distinction explicit.

7. **Top-level `status` is protocol-backed.**
   - `bproxy status` is an alias for `bproxy debug status`: it requires a secure daemon token and returns the protocol `debug.status` response.
   - `bproxy service status` is the token-free lifecycle check. Do not silently fall back from top-level `status` to service status; a token problem is a config/security failure and exits `2`.

8. **`debug.log` follows current daemon pause semantics.**
   - The daemon currently refuses every forwarded action while a session is paused, including `debug.log`; daemon-local `debug.last`, `debug.status`, and `session.*` remain available.
   - Phase 4 should document this rather than changing service semantics. If extension trace access while paused becomes important, make that a later service/architecture decision.

9. **Service binary resolution is pragmatic and non-invasive.**
   - Resolver order: `BPROXY_SERVICE_BIN` env override, workspace `service/dist/index.mjs` when present, then `bproxy-service` on `PATH`.
   - Phase 4 does not solve public npm packaging. It must avoid source imports and provide clear diagnostics when the service binary is not built or not discoverable.

10. **Response validation stays local to the CLI.**
   - Do not import service schemas. Add a small CLI-side guard that distinguishes “valid enough `BproxyResponse`” from non-JSON/malformed daemon output.
   - Malformed/non-protocol output is a CLI/control-plane failure: stderr + exit `2`.

---

## Command UX decisions

Agents are the primary consumers, so prefer explicit flags and JSON/stdin over clever positional parsing.

- **Target inputs:** write/select commands accept exactly one of `--selector <css>` or `--route-json <json>`. The parsed value becomes the shared `ElementTarget`. Do not accept both.
- **`fill`:** `bproxy fill --selector <css> --value <text> --method direct|paste|runtime-api --world isolated|main`; also support `--value-file <path>` and `--value-stdin` as mutually exclusive alternatives to `--value`.
- **`fill-form`:** accept exactly one of `--json <json>`, `--file <path>`, or `--stdin`. The payload must be the shared params shape `{ "fields": [...] }`; do not accept a friendlier array shorthand in Phase 4.
- **`select`:** `bproxy select --selector <css> --option-text <text>` or the route-json equivalent for the trigger.
- **`require-human`:** `--reason <text>` and optional `--for-attach <selector-string>` matching the current shared type.
- **`eval`:** require `--allow-eval` plus exactly one of `--code <code>`, `--file <path>`, or `--stdin`.
- **Timeouts:** global `--timeout <ms>` sets the protocol `deadline`; the HTTP fetch should also be aborted shortly after that deadline so the one-shot process cannot hang forever.
- **Request ids:** `crypto.randomUUID()` is acceptable. ULID/time-sortable ids are not required for Phase 4.

---

## File structure introduced/modified this phase

```text
cli/
├── package.json                  # MODIFIED — bin, citty, tsup, vitest, scripts
├── tsconfig.json                 # MODIFIED — Node 24 ESM settings
├── tsup.config.ts                # NEW
├── vitest.config.ts              # NEW
├── README.md                     # NEW
└── src/
    ├── bproxy.ts                 # NEW — citty entrypoint + lazy subcommands
    ├── client.ts                 # NEW — daemon POST client + response handling
    ├── command-registry.ts       # NEW — action coverage/destructive classification
    ├── exit.ts                   # NEW — testable exit-code/output boundary
    ├── ids.ts                    # NEW — request id generation
    ├── output.ts                 # NEW — stdout/stderr formatting
    ├── paths.ts                  # NEW — BPROXY_HOME + state files
    ├── service-binary.ts         # NEW — locate/spawn service binary
    ├── token.ts                  # NEW — owner/mode preflight
    ├── targets.ts                # NEW — selector/route JSON parsing helpers
    ├── commands/
    │   ├── *.ts                  # NEW — action leaf commands
    │   ├── service/*.ts          # NEW — lifecycle commands
    │   ├── session.ts            # NEW — session subcommands
    │   ├── tab.ts                # NEW — tab subcommands
    │   └── debug.ts              # NEW — debug subcommands
    └── test/
        ├── fakes/                # NEW — fetch/fs/process fakes
        └── fixtures/             # NEW — JSON target/field fixtures
service/src/lifecycle.ts          # MODIFIED — pairing.json + start/stop output seam
service/src/config.ts             # MODIFIED — stateFile support for pairing.json
service/src/index.ts              # MODIFIED — lifecycle JSON output/args normalized
docs/solution/cli.md              # MODIFIED — actual command surfaces and lifecycle contract
docs/solution/service.md          # MODIFIED if lifecycle/eval-debug contract changes
docs/views/02-containers.md       # MODIFIED — click CLI link
docs/views/05-scenarios/*.md      # NEW — scenario sequence views
docs/views/auto/cli-components.svg
```

If the implementation discovers a better layout, update `docs/solution/cli.md` in the same task. File names should continue to mirror architecture concepts: client, paths, token, service lifecycle, commands.

---

## Task 1: Lifecycle and config contract alignment

**Status:** Not started.

**Files:** `service/src/lifecycle.ts`, `service/src/index.ts`, service lifecycle tests, `docs/solution/service.md`, `docs/solution/cli.md`.

**Purpose:** Make daemon lifecycle scriptable by the future CLI without violating the package dependency boundary.

- [ ] Add a detached-start output contract: service binary `start` prints `{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}` after readiness.
- [ ] Add `BPROXY_HOME/pairing.json` (mode `0600`) written by the foreground daemon after issuing the code and read by the detached parent. Remove or expire it best-effort on shutdown and stale-lock cleanup.
- [ ] Keep `service status` process-liveness based: `running: true` only means PID alive; stale files do not count.
- [ ] Keep eval/debugger control-plane wiring deferred: remove `service start --allow-eval` / `--enable-debugger-mode` from Phase 4 CLI docs and tests; pass extension `EVAL_DISABLED` / `DEBUGGER_DISABLED` responses through.
- [ ] Add service tests for start JSON shape, pairing file mode/contents, duplicate start failure, stale PID recovery, stop JSON, status JSON, and preservation of `extension-token` across stop/start.
- [ ] Reconcile service and CLI solution docs before adding CLI code.

**Done when:** a script can run the service binary's start/status/stop commands in a temp `BPROXY_HOME` and receive stable JSON output, including a pairing code on start, without reading daemon logs or child stdout races.

---

## Task 2: Bootstrap the CLI package

**Status:** Not started.

**Files:** `cli/package.json`, `cli/tsconfig.json`, `cli/tsup.config.ts`, `cli/vitest.config.ts`, `cli/src/bproxy.ts`, `cli/README.md`.

**Purpose:** Replace the stub package with a buildable, testable Node 24 ESM CLI shell.

- [ ] Add citty and `@bproxy/shared` as runtime dependencies; add tsup, Vitest, and Node types as dev dependencies.
- [ ] Configure `bin: { "bproxy": "./dist/bproxy.mjs" }`, `build`, `dev`, `typecheck`, and `test` scripts.
- [ ] Create the top-level citty command with global `--session/-s`, `--timeout`, `--home`, and `--verbose/-v` args. `--home` overrides `BPROXY_HOME` for both token/port lookup and child service processes; the environment variable remains the default path.
- [ ] Register subcommands lazily so tight agent loops do not load every command module.
- [ ] Keep process exit at the outermost boundary. Command/client modules should return an exit plan in tests rather than calling `process.exit` deep inside helpers.
- [ ] Write a short README covering purpose, local development, output contract, exit codes, and service lifecycle commands.

**Done when:** `pnpm --filter @bproxy/cli build`, `typecheck`, and a trivial `bproxy --help` smoke work from the built binary.

---

## Task 3: Paths, token preflight, output, and exit-code primitives

**Status:** Not started.

**Files:** `cli/src/paths.ts`, `cli/src/token.ts`, `cli/src/output.ts`, `cli/src/exit.ts`, tests.

**Purpose:** Establish the boring invariants every command uses.

- [ ] Resolve state directory from `--home`, then `BPROXY_HOME`, then `~/.bproxy`. Keep this consistent with `service/src/config.ts`.
- [ ] Resolve `port`, `token`, `pid`, and `logs` paths from that state directory.
- [ ] Implement token preflight: exists, regular file, current UID owner when available, mode exactly `0600`. Refuse before network I/O if this fails.
- [ ] Implement stdout JSON formatting as a single-line `JSON.stringify` with trailing newline.
- [ ] Implement structured stderr helpers for `--verbose` and exit-2 diagnostics. Never print bearer tokens or full Authorization headers.
- [ ] Define a testable exit-code mapper: protocol success → `0`, protocol error → `1`, usage/config/control-plane error → `2`.
- [ ] Unit-test POSIX mode formatting, wrong owner behavior with injected stat data, missing files, custom home resolution, and stdout/stderr separation.

**Done when:** the HTTP client can depend on these helpers without handling filesystem or process-output edge cases itself.

---

## Task 4: Daemon HTTP client and request builder

**Status:** Not started.

**Files:** `cli/src/client.ts`, `cli/src/ids.ts`, `cli/src/command-registry.ts`, tests.

**Purpose:** Centralize the “one command = one POST” contract.

- [ ] Generate a unique request id per invocation with `crypto.randomUUID()`.
- [ ] Build `BproxyRequest<Action>` envelopes from shared types with `protocol_version: 1`, global session, deadline from `--timeout`, and destructive classification.
- [ ] Maintain the destructive-action set in one module. Include writes, navigation, scroll, eval, and tab mutations; keep reads, `debug.*`, and `session.*` non-destructive.
- [ ] POST to `http://127.0.0.1:{port}/` using Node's built-in `fetch` and `Authorization: Bearer {token}`.
- [ ] Abort the fetch shortly after the protocol deadline. The daemon still owns protocol timeout semantics; the CLI abort only prevents a stuck one-shot process.
- [ ] Add a minimal CLI-side response guard for `BproxyResponse` (`protocol_version`, `id`, `ok`, and success/error branch shape). Do not import service schemas.
- [ ] Treat valid `BproxyResponse` JSON as the stdout payload regardless of `ok`. Treat daemon-unreachable, HTTP auth failure, non-JSON, or malformed response as exit `2` with stderr diagnostics.
- [ ] Add `--verbose` timing around the HTTP call with request id/action/session and response status/elapsed/error code.
- [ ] Add contract tests that mock fetch and assert exact request shape, auth header presence without logging token values, deadline/abort behavior, response parsing, malformed-response handling, and exit-code mapping.

**Done when:** action command modules only need to parse args into `ActionParams[A]` and call one client function.

---

## Task 5: Read/navigation action commands

**Status:** Not started.

**Files:** `cli/src/commands/{navigate,text,images,elements,outline,dom,scroll,screenshot,wait}.ts`, command parsing tests.

**Purpose:** Ship the read-mode command surface that agents will call most often.

- [ ] Implement `navigate <url>`.
- [ ] Implement `text [selector]`, `images [selector]`, `elements [--form]`, `outline`, and `dom [selector] [--depth N]`.
- [ ] Implement `scroll` with `--by`, `--direction up|down`, and `--until-stable` semantics matching shared params.
- [ ] Implement `screenshot --activate --debugger`; document that `--debugger` currently passes through to the extension and normally returns `DEBUGGER_DISABLED` because no Phase 4 control path enables the extension flag.
- [ ] Implement `wait --strategy selector|url|navigation --target <value> [--timeout ms]`.
- [ ] Keep params minimal. Do not add selector heuristics, automatic waits, or domain-specific parsing in the CLI.
- [ ] Test argument parsing and generated `ActionParams` for every command, including defaults.

**Done when:** a mock daemon receives correct request envelopes for all read/navigation actions and the CLI prints the daemon response unchanged.

---

## Task 6: Write, select, human-handoff, and eval commands

**Status:** Not started.

**Files:** `cli/src/targets.ts`, `cli/src/commands/{fill,fill-form,select,require-human,eval}.ts`, fixtures/tests.

**Purpose:** Provide the explicit actuator surface without hiding strategy in CLI code.

- [ ] Implement a shared target parser that accepts exactly one of `--selector <css>` or `--route-json <json>`. Reject ambiguous input with exit `2` before POST.
- [ ] Implement `fill` requiring exactly one value source (`--value`, `--value-file`, or `--value-stdin`), `method: direct|paste|runtime-api`, and `world: isolated|main`.
- [ ] Implement `fill-form` accepting exactly one payload source (`--json`, `--file`, or `--stdin`). The payload must be the shared params object `{ "fields": [...] }`; each field must already contain target, value, method, and world.
- [ ] Implement `select` with explicit trigger target (`--selector` or `--route-json`) and `--option-text`.
- [ ] Implement `require-human --reason [--for-attach selector-string]`.
- [ ] Implement `eval` with required `--allow-eval` plus exactly one code source (`--code`, `--file`, or `--stdin`). If the extension still disables eval, pass through the resulting `EVAL_DISABLED` protocol response.
- [ ] Tests must assert that `fill`/`fill-form` never invent method/world values and never retry with another method after an error.

**Done when:** the CLI can express all write-related shared params, including shadow routes and runtime-api writes, without adding extension-side or CLI-side method selection.

---

## Task 7: Service lifecycle commands

**Status:** Not started.

**Files:** `cli/src/service-binary.ts`, `cli/src/commands/service/*.ts`, lifecycle integration tests.

**Purpose:** Let users and agents start, stop, restart, and inspect the daemon from the `bproxy` binary.

- [ ] Resolve the service binary in this order: `BPROXY_SERVICE_BIN`, workspace `service/dist/index.mjs`, then `bproxy-service` on `PATH`. Do not import service source.
- [ ] Implement `bproxy service start [--port N] [--home DIR]` by spawning the service `start` command with matching environment (`BPROXY_PORT`, `BPROXY_HOME`). Print the service's normalized success JSON containing PID, port, and pairing code fields from Task 1.
- [ ] Implement `service stop` and `service status`. `status` must not require the daemon token; it is process-liveness, not protocol status. `stop` prints `{"running":false}` on success.
- [ ] Implement `service restart` as stop followed by start, producing the new start JSON.
- [ ] Test duplicate-start behavior: it fails clearly with exit `2`, not hang or start a second daemon in the same `BPROXY_HOME`.
- [ ] Add integration tests using a temp `BPROXY_HOME` and built service binary. Assert JSON stdout, stderr on failure, stale PID cleanup, token file mode, and `extension-token` preservation.

**Done when:** a developer can run `pnpm --filter @bproxy/cli build` then use the built `bproxy service start/status/stop` against a temp home without manual service commands.

---

## Task 8: Session, tab, debug, and top-level status commands

**Status:** Not started.

**Files:** `cli/src/commands/{session,tab,debug,status}.ts`, tests.

**Purpose:** Expose the daemon-owned control plane and observability surface.

- [ ] Implement `session list`, `session bind --tab-id N [--pacing human|fast]`, `session unbind`, and `session resume` as protocol actions.
- [ ] Implement `tab list`, `tab pin [--tab-id N]`, `tab unpin`, `tab open <url>`, and `tab close [--tab-id N]`.
- [ ] Implement `debug log [--id ID] [--limit N]`, `debug last [--count N]`, and `debug status`.
- [ ] Implement top-level `status` as an exact protocol-backed alias for `debug.status`. It requires token preflight; `service status` is the token-free lifecycle view.
- [ ] Preserve paused-session semantics: if daemon returns `HUMAN_REQUIRED`, print it as protocol JSON and exit `1`; do not convert it to exit `2`. Document that current daemon semantics refuse forwarded `debug.log` while paused.
- [ ] Add tests that local daemon actions (`session.*`, `debug.last`, `debug.status`) do not require a connected extension, while forwarded debug/tab actions surface daemon protocol errors normally.

**Done when:** all non-lifecycle action families in `docs/architecture.md#actions` are reachable from the CLI.

---

## Task 9: Command coverage and design assertions

**Status:** Not started.

**Files:** `cli/src/command-registry.ts`, CLI tests, root quality configs if needed.

**Purpose:** Turn CLI architectural constraints into automated checks rather than review comments.

- [ ] Maintain a typed registry mapping every shared `Action` to either a leaf command path or an intentional subcommand grouping.
- [ ] Add a compile-time or test-time exhaustiveness assertion so adding a shared action requires updating the CLI registry.
- [ ] Assert all POST commands go through the shared client module; command modules should not call `fetch` directly.
- [ ] Assert no CLI production source imports `service/src/**` or `extension/src/**`. Prefer dependency-cruiser enforcement already present at root.
- [ ] Test stdout cleanliness for success, protocol error, usage error, and verbose modes.
- [ ] Run `pnpm --filter @bproxy/cli typecheck`, `test`, `build`, then root `pnpm check` and fix issues without weakening static rules.

**Done when:** the CLI fails fast when it drifts from the shared action contract, output contract, or architecture import boundary.

---

## Task 10: CLI integration smoke against daemon + mock extension

**Status:** Not started.

**Files:** `cli/src/test/integration/*` or `cli/scripts/smoke/*`, `cli/README.md`.

**Purpose:** Prove the built CLI talks to the real daemon process, not just mocked fetch.

- [ ] Start a real daemon in a temp `BPROXY_HOME` through `bproxy service start`.
- [ ] Verify start output includes a pairing code, token file is `0600`, and `service status` reports the live PID/port.
- [ ] Use CLI `session.*` commands against the running daemon; these need no extension and are good lifecycle smoke coverage.
- [ ] For forwarded action smoke, either connect a small authenticated mock WS client using the pairing/extension-token flow or reuse an existing service test helper. Bind a tab id, run a read command, and assert the mock sees the request with `target.tabId`.
- [ ] Run `debug.status` and `debug.last` from the CLI and assert valid JSON output.
- [ ] Stop the daemon through the CLI and verify status becomes `running: false`.
- [ ] Document the smoke workflow in `cli/README.md`.

**Done when:** a developer can reproduce a daemon round trip using only the built `bproxy` binary and local test helpers.

---

## Task 11: Views and documentation integration

**Status:** Not started.

**Files:** `docs/views/02-containers.md`, `docs/views/05-scenarios/*.md`, `docs/views/auto/cli-components.svg`, `docs/solution/cli.md`, `docs/solution/service.md`, `cli/README.md`.

**Purpose:** Make the visual and prose docs describe the CLI that actually shipped.

- [ ] Update `docs/solution/cli.md` with actual command names, argument shapes, lifecycle behavior, exit-code rules, and any deliberate deviations from the original spec.
- [ ] Update `docs/solution/service.md` if Task 1 changed pairing metadata, lifecycle output, or eval/debugger configuration.
- [ ] Author `docs/views/05-scenarios/google-research.md`, `linkedin-snapshot.md`, and `form-fill.md` as Mermaid sequence views. They should be faithful to `docs/scenarios.md` and to the real command surfaces implemented in this phase.
- [ ] Add accurate frontmatter `sources` to each scenario view so `pnpm views:audit` reports them when CLI/service/extension/scenario docs change.
- [ ] Run `pnpm views:regen` and commit the updated `docs/views/auto/cli-components.svg`.
- [ ] Update `docs/views/02-containers.md` with a `click CLI "../auto/cli-components.svg"` directive and a “See also” link to the CLI component graph.
- [ ] Run `pnpm views:audit` and `pnpm docs:build`.

**Done when:** the architecture site contains the full curated scenario-view set and the Container diagram drills into the generated CLI component graph.

---

## Final verification checklist

- [ ] `pnpm --filter @bproxy/cli build` emits `dist/bproxy.mjs` with executable bin metadata.
- [ ] `bproxy service start/status/stop` works in a temp `BPROXY_HOME` and `start` prints pairing code JSON.
- [ ] Token preflight refuses missing, wrong-owner, and non-`0600` token files before making HTTP requests.
- [ ] Every shared action is reachable through the CLI or intentionally grouped under service/session/tab/debug command families.
- [ ] Non-lifecycle commands produce one POST and one JSON stdout object.
- [ ] Protocol `ok:false` responses exit `1`; usage/config/control-plane failures exit `2` without polluted stdout.
- [ ] `--verbose` writes structured stderr with request id/action/session/elapsed and no token material.
- [ ] `fill`/`fill-form` require explicit method/world and support route-based targets.
- [ ] `eval` requires an explicit local CLI opt-in and respects daemon/extension policy errors.
- [ ] CLI tests cover request shape, command parsing, lifecycle, output cleanliness, and action coverage.
- [ ] `cli/README.md` and affected solution docs are updated.
- [ ] Scenario views exist and build; CLI component SVG is regenerated and linked from Container view.
- [ ] `pnpm check`, `pnpm test`, and `pnpm docs:build` pass.

---

## Out of scope for Phase 4

- Real-site scenario hardening against Google, LinkedIn, or application forms. Phase 5 owns external validation.
- New browser capabilities or extension action handlers. Phase 4 may expose existing actions; it should not add page-side behavior.
- Agent-side fill-method selection guidance beyond keeping links/docs accurate. The CLI must not implement method selection.
- Closed shadow-root support, network shims, stealth patches, or trusted input simulation.
- Public npm publishing and installer polish beyond keeping bin/package structure compatible with a future publish.
- Pre-commit hooks. Phase 5 owns that hardening step per `docs/quality-gates.md`.
