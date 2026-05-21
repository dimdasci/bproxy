# Phase 4 — Task Hand-off Notes

Single living document. Each completed task appends its section; the next implementer reads the latest entry.

---

## Task 1 → Task 2

### What was done (Task 1)

The service binary now produces stable lifecycle JSON on stdout, making it scriptable by the CLI without importing service internals.

| File | What |
|------|------|
| `service/src/pairing-file.ts` | `writePairingFile`, `readPairingFile`, `removePairingFile` + types (`LifecycleStartResult`, `LifecycleStopResult`, `LifecycleStatusResult`, `PairingMetadata`) |
| `service/src/config.ts` | `stateFile()` accepts `"pairing.json"` |
| `service/src/lifecycle.ts` | `startDetached` returns `LifecycleStartResult`; `stop` returns `LifecycleStopResult`; `status` returns `LifecycleStatusResult`; pairing.json written/cleaned |
| `service/src/index.ts` | `start` prints JSON with `{running, pid, port, pairingCode, pairingExpiresAt}`; `stop` prints `{"running":false}` |
| `docs/solution/cli.md` | Removed `--allow-eval` / `--enable-debugger-mode` from service start |
| `docs/solution/service.md` | Documented pairing.json, lifecycle JSON shapes, extension-token preservation |

### Output contracts

```bash
# start → exit 0, stdout:
{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}

# stop → exit 0, stdout:
{"running":false}

# status → exit 0, stdout:
{"running":true,"pid":123,"port":9615}   # or {"running":false}

# failure → exit 1, stderr has message
```

### State files

- `BPROXY_HOME/port` — bound port
- `BPROXY_HOME/token` — daemon bearer token (mode 0600)
- `BPROXY_HOME/bproxy.pid` — daemon PID
- `BPROXY_HOME/extension-token` — preserved across stop/start (CLI never reads)
- `BPROXY_HOME/pairing.json` — transient, daemon-owned

---

## Task 2 → Task 3

### What was done (Task 2)

The CLI package (`@bproxy/cli`) is now a buildable, testable Node 24 ESM binary with the full command structure registered.

| File | What |
|------|------|
| `cli/package.json` | `bin`, citty + shared deps, tsup/vitest devDeps, build/dev/typecheck/test scripts |
| `cli/tsconfig.json` | Node 24 ESM, `types: ["node"]` |
| `cli/tsup.config.ts` | ESM bundle with shebang, bundles citty + shared, outputs `dist/bproxy.mjs` |
| `cli/vitest.config.ts` | Tests in `src/**/__tests__/**/*.test.ts` |
| `cli/src/bproxy.ts` | citty entrypoint with global args + all lazy subcommands |
| `cli/src/types.ts` | Re-exports shared protocol types for CLI modules |
| `cli/src/commands/**` | 30 stub commands organized into families (service/, session/, tab/, debug/) |
| `cli/src/__tests__/bproxy.test.ts` | Smoke tests for binary, --help, all subcommand families |
| `cli/README.md` | Purpose, development, output contract, exit codes, command families |

### Global args available to all commands

| Flag | Alias | Type | Description |
|------|-------|------|-------------|
| `--session` | `-s` | string | Session ID for the request |
| `--timeout` | | string | Protocol deadline in milliseconds |
| `--home` | | string | Override `BPROXY_HOME` state directory |
| `--verbose` | `-v` | boolean | Write structured diagnostics to stderr |

### Command structure

```
bproxy
├── navigate, text, images, elements, outline, dom, scroll, screenshot
├── fill, fill-form, select, wait, require-human, eval
├── status (top-level, protocol-backed)
├── service/ (start, stop, status, restart)
├── session/ (list, bind, unbind, resume)
├── tab/ (list, pin, unpin, open, close)
└── debug/ (log, last, status)
```

### What Task 3 can depend on

1. `pnpm --filter @bproxy/cli build` emits `dist/bproxy.mjs` with shebang and bin metadata.
2. `pnpm --filter @bproxy/cli typecheck` and `test` pass.
3. `pnpm check` passes from a clean state.
4. All subcommand stubs import from `citty` and export a `defineCommand` result.
5. `cli/src/types.ts` re-exports `Action`, `ActionParams`, `BproxyRequest`, `BproxyResponse` from shared.
6. Global args (`session`, `timeout`, `home`, `verbose`) are on the root command and available to subcommands via citty context inheritance.

### Testing note

Citty uses `consola` internally, which suppresses output when `TEST=true` or `NODE_ENV=test` is in the environment. When testing the built binary via child process, strip these env vars:

```ts
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["TEST"];
  delete env["VITEST"];
  delete env["NODE_ENV"];
  return env;
}
```

### Notes for Task 3 implementer

- Create `cli/src/paths.ts` — resolve `BPROXY_HOME` from `--home` flag → `BPROXY_HOME` env → `~/.bproxy`. Must match `service/src/config.ts` conventions. Derive `port`, `token`, `pid`, `logs` file paths from the state directory.
- Create `cli/src/token.ts` — preflight check: file exists, regular file, mode `0600`, owner matches current UID (when `process.getuid()` is available). Return a clear error message on failure without leaking file contents.
- Create `cli/src/output.ts` — `writeJson(data)` for stdout (single-line JSON + newline), `writeVerbose(...)` for structured stderr, `writeDiagnostic(...)` for exit-2 stderr messages.
- Create `cli/src/exit.ts` — testable exit-code mapper: `{ code: 0|1|2, stdout?: object, stderr?: string }`. Commands return this plan; the outermost boundary calls `process.exit`.
- The `--home` override from global args threads through to `paths.ts`. In citty, parent args are accessible to subcommands — use `context.args.home` at call sites.
- Token values must never appear in verbose or diagnostic output.
- Unit-test with injected stat data (mode, uid) rather than creating real files where possible.

---

## Task 3 → Task 4

### What was done (Task 3)

Core CLI primitives that every command depends on are implemented and tested.

| File | What |
|------|------|
| `cli/src/paths.ts` | `resolveStateDir(homeFlag, env)`, `stateFile(dir, name)`, `logDir(dir)`, `resolveStatePaths(homeFlag, env)` |
| `cli/src/token.ts` | `preflightToken(tokenPath, deps)` with injectable stat/read/getuid; `formatMode(n)` |
| `cli/src/output.ts` | `writeJson(data, stream)`, `writeVerbose(entry, stream)`, `writeDiagnostic(msg, stream)` |
| `cli/src/exit.ts` | `ExitPlan` type, `exitFromResponse`, `exitSuccess`, `exitProtocolError`, `exitUsageError`, `executeExitPlan` |
| `cli/src/__tests__/paths.test.ts` | 15 tests |
| `cli/src/__tests__/token.test.ts` | 18 tests |
| `cli/src/__tests__/output.test.ts` | 11 tests |
| `cli/src/__tests__/exit.test.ts` | 11 tests |

### API contracts for Task 4

**Path resolution:**
```ts
import { resolveStatePaths } from "./paths.js";
const paths = resolveStatePaths(args.home, process.env);
// paths.stateDir, paths.token, paths.port, paths.pid, paths.logs
```

**Token preflight (call before any POST):**
```ts
import { preflightToken } from "./token.js";
const result = preflightToken(paths.token);
if (!result.ok) return exitUsageError(result.reason); // exit 2
// result.token is the bearer value
```

**Output (stdout is JSON only):**
```ts
import { writeJson, writeVerbose, writeDiagnostic } from "./output.js";
writeJson(responseData);                      // stdout: single-line JSON + \n
writeVerbose({ requestId, action, elapsed }); // stderr: structured JSON (--verbose)
writeDiagnostic("daemon not running");        // stderr: plain text (exit 2)
```

**Exit plan (commands return, boundary executes):**
```ts
import { exitFromResponse, exitUsageError, executeExitPlan } from "./exit.js";
// In command: return exitFromResponse(response);  // 0 or 1
// In command: return exitUsageError("bad args");  // 2
// At boundary: executeExitPlan(plan);
```

### Design notes for Task 4 implementer

- The HTTP client should call `preflightToken` early, before constructing the request or opening a connection.
- `exitFromResponse` maps the full `BproxyResponse` to stdout JSON + exit code. The client should use this for all valid protocol responses regardless of `ok`.
- Non-protocol failures (fetch error, non-JSON response, auth rejection) are `exitUsageError` (exit 2) with a diagnostic on stderr.
- `writeVerbose` accepts a `VerboseEntry` object: `{ requestId, action, session, url, elapsed, httpStatus, errorCode }`. Emit one before the request (without elapsed/status) and one after.
- All stream parameters default to `process.stdout`/`process.stderr` but accept injection for testing.
- The `port` state file contains just the port number as text. Read it with `readFileSync` and parseInt. Missing/unparseable port → exit 2 ("daemon not running").
- Request IDs: `crypto.randomUUID()` is fine per the plan. No ULID needed.
- Abort controller: set timeout to `deadline + small buffer` (e.g., 2000ms). The daemon owns protocol timeout; CLI abort just prevents a hung process.

---

## Task 4 → Task 5

### What was done (Task 4)

Centralized HTTP client and request builder — the "one command = one POST" contract is now a single function call.

| File | What |
|------|------|
| `cli/src/ids.ts` | `generateRequestId()` — `crypto.randomUUID()` wrapper |
| `cli/src/command-registry.ts` | `isDestructive(action)`, `allRegisteredActions()` + compile-time exhaustiveness assertion |
| `cli/src/client.ts` | `sendAction(action, params, globals, opts)` — full pipeline from preflight to exit plan |
| `cli/src/__tests__/ids.test.ts` | 2 tests (UUID shape, uniqueness) |
| `cli/src/__tests__/command-registry.test.ts` | 20 tests (classification per action, full coverage assertion) |
| `cli/src/__tests__/client.test.ts` | 29 tests (preflight failures, request shape, auth, verbose, response handling) |

### API for command implementers

Every action command only needs to:
1. Parse CLI args into `ActionParams[A]`
2. Call `sendAction` and return the result

```ts
import { sendAction, type ClientGlobalArgs } from "../client.js";
import type { ExitPlan } from "../exit.js";

export async function runNavigate(globals: ClientGlobalArgs, url: string): Promise<ExitPlan> {
  return sendAction("navigate", { url }, globals);
}
```

### `sendAction` pipeline

1. Resolves `BPROXY_HOME` → state paths (port, token)
2. Token preflight (exists, mode 0600, owner) → exit 2 on failure
3. Reads port file → exit 2 if daemon not running
4. Parses `--timeout` → exit 2 if invalid
5. Builds `BproxyRequest<A>` with `protocol_version: 1`, session, deadline, `destructive` flag
6. Verbose pre-request stderr entry (no token leaked)
7. POSTs to `http://127.0.0.1:{port}/` with Bearer auth + abort timeout (deadline + 2s buffer)
8. Fetch failure → exit 2 (connection refused, abort timeout)
9. HTTP 401/403 → exit 2
10. Non-JSON body → exit 2
11. Validates response shape (`protocol_version`, `id` match, `ok`, branch fields)
12. Malformed response → exit 2
13. Valid `ok: true` → exit 0, valid `ok: false` → exit 1
14. Verbose post-request stderr entry with elapsed/status/error code

### Command registry

```ts
import { isDestructive } from "./command-registry.js";

isDestructive("navigate");  // true
isDestructive("text");      // false
```

Destructive: `navigate`, `scroll`, `fill`, `fill-form`, `select`, `eval`, `tab.pin`, `tab.unpin`, `tab.open`, `tab.close`, `session.bind`, `session.unbind`, `session.resume`, `require-human`.

Non-destructive: `text`, `images`, `elements`, `outline`, `dom`, `screenshot`, `wait`, `tab.list`, `session.list`, `debug.log`, `debug.last`, `debug.status`.

Adding a new `Action` to shared without updating the registry causes a **compile-time error**.

### `SendOptions` for testing

```ts
interface SendOptions {
  fetch?: typeof globalThis.fetch;  // mock HTTP
  stderr?: NodeJS.WritableStream;   // capture verbose
  env?: NodeJS.ProcessEnv;          // override BPROXY_HOME
  requestId?: string;               // deterministic IDs
  readPort?: (path: string) => number | null;  // skip fs
}
```

### Notes for Task 5 implementer

- Each command stub in `cli/src/commands/*.ts` currently has an empty `run()`. Replace it with arg parsing → `sendAction` call → `executeExitPlan`.
- Access parent (global) args via citty's context. The `run({ args })` callback receives merged parent + local args.
- For commands with no params (e.g., `outline`), pass `{}` as params.
- Optional params (e.g., `text --selector`) should be omitted from the params object when not provided, not sent as `undefined`.
- `--timeout` and `--session` are on the global args — pass them through `ClientGlobalArgs`.
- The `executeExitPlan` call should be at the command boundary (inside `run()`), not deeper.
- `validateResponse` is exported for direct use in tests but commands should not call it directly — `sendAction` handles it.

---

## Task 5 → Task 6

### What was done (Task 5)

All read/navigation action commands are now wired: args → params → `sendAction` → `executeExitPlan`.

| File | What |
|------|------|
| `cli/src/globals.ts` | `globalArgs` definitions + `extractGlobals(args)` helper |
| `cli/src/commands/navigate.ts` | `navigate --url <url>` (destructive) |
| `cli/src/commands/text.ts` | `text [--selector]` |
| `cli/src/commands/images.ts` | `images [--selector]` |
| `cli/src/commands/elements.ts` | `elements [--form]` |
| `cli/src/commands/outline.ts` | `outline` (empty params) |
| `cli/src/commands/dom.ts` | `dom [--selector] [--depth N]` with depth validation |
| `cli/src/commands/scroll.ts` | `scroll [--by] [--direction up|down] [--until-stable]` (destructive) |
| `cli/src/commands/screenshot.ts` | `screenshot [--activate] [--debugger]` |
| `cli/src/commands/wait.ts` | `wait --strategy --target [--timeout ms]` with strategy/timeout validation |
| `cli/src/__tests__/commands-read.test.ts` | 34 tests (request envelopes, param shapes, destructive flags, response pass-through) |
| `cli/src/__tests__/commands-read-parsing.test.ts` | 23 tests (globals extraction, validation logic, optional param omission) |

### Key design decision: global args on subcommands

Citty does not pass parent args to subcommands — `runCommand(subCommand, { rawArgs: rawArgs.slice(i+1) })` only forwards the remaining raw argv. Each leaf command must define the global flags it needs.

**Solution:** `cli/src/globals.ts` exports a `globalArgs` object that commands spread into their `args` definition, plus `extractGlobals(args)` to pull `ClientGlobalArgs` from the parsed result.

```ts
import { extractGlobals, globalArgs } from "../globals.js";

export default defineCommand({
  args: { ...globalArgs, url: { type: "string", required: true } },
  async run({ args }) {
    const globals = extractGlobals(args);
    const plan = await sendAction("navigate", { url: args.url }, globals);
    executeExitPlan(plan);
  },
});
```

### Command implementation pattern

1. Spread `globalArgs` into command `args`
2. Define command-specific args
3. In `run()`: `extractGlobals(args)` → parse/validate local args → build params → `sendAction` → `executeExitPlan`
4. Optional params: conditionally add to params object (never send `undefined`)
5. Validation failures: `executeExitPlan(exitUsageError(...)); return;`

### Param omission convention

Optional params are only set on the params object when provided:

```ts
const params: ActionParams["text"] = {};
if (typeof args.selector === "string") {
  params.selector = args.selector;
}
```

This keeps the wire format minimal and avoids sending `"selector": undefined`.

### Notes for Task 6 implementer

- Use the same pattern: `globalArgs` spread + `extractGlobals` + `sendAction` + `executeExitPlan`.
- Create `cli/src/targets.ts` for the shared target parser (`--selector` XOR `--route-json` → `ElementTarget`).
- `fill` and `fill-form` must validate method/world values before calling `sendAction` — exit `2` for invalid values.
- `fill --value-file <path>` and `--value-stdin` need filesystem/stdin reading before the `sendAction` call.
- `fill-form --stdin` / `--file` similarly need pre-read + JSON parse + shape validation.
- `eval --allow-eval` is a boolean gate: if not provided, exit `2` before POST (it's a local intent guard, not server policy).
- The `select` command uses the target parser for its trigger element.
- The `--route-json` flag accepts a JSON string that must parse to an `ElementRoute` shape.
- Keep the same test pattern: mock fetch via `SendOptions`, assert request body shape, verify exit codes.
- `wait` command's `--timeout` flag intentionally shadows the global `--timeout` — this is correct because the wait-specific timeout is the meaningful value for that command, and both the CLI deadline and the param timeout use the same user-provided value.

---

## Task 6 → Task 7

### What was done (Task 6)

All write, select, human-handoff, and eval commands are now wired with full argument validation.

| File | What |
|------|------|
| `cli/src/targets.ts` | `parseTarget(selector, routeJson)` — exactly-one-of validator producing `ElementTarget` |
| `cli/src/commands/fill.ts` | `fill --selector/--route-json --value/--value-file/--value-stdin --method --world` |
| `cli/src/commands/fill-form.ts` | `fill-form --json/--file/--stdin` with full payload validation |
| `cli/src/commands/select.ts` | `select --selector/--route-json --option-text` |
| `cli/src/commands/require-human.ts` | `require-human --reason [--for-attach]` |
| `cli/src/commands/eval.ts` | `eval --allow-eval --code/--file/--stdin` with safety guard |
| `cli/src/types.ts` | Added `ElementRoute`, `ElementTarget`, `ExecutionWorld`, `FillMethod` re-exports |
| `cli/src/__tests__/targets.test.ts` | 13 tests (selector/route exclusivity, route shape validation) |
| `cli/src/__tests__/commands-write.test.ts` | 21 tests (request params, destructive flags, no method invention) |
| `cli/src/__tests__/commands-write-validation.test.ts` | 30 tests (source exclusivity, method/world enum, payload shape, eval guard) |

### Key design patterns introduced

**Target parsing (`targets.ts`):**
```ts
import { parseTarget } from "../targets.js";

const result = parseTarget(args.selector, args["route-json"]);
if (!result.ok) { executeExitPlan(exitUsageError(result.reason)); return; }
// result.target is ElementTarget
```

**Value source resolution (fill, eval):**
- Exactly one of `--value`/`--value-file`/`--value-stdin` (fill) or `--code`/`--file`/`--stdin` (eval)
- Count sources, reject 0 or >1 before any I/O
- File read via `readFileSync(path, "utf8")`; stdin via `readFileSync(0, "utf8")`

**fill-form payload validation:**
- Accepts raw JSON string from `--json`, `--file`, or `--stdin`
- Validates: is JSON object, has `fields` array, each field has valid `target`, `value`, `method`, `world`
- Route targets in fields get minimal shape validation (has `hosts` array and `target` string)

**Eval safety guard:**
- `--allow-eval` must be explicitly `true`; exit `2` before POST otherwise
- Extension-side `EVAL_DISABLED` responses pass through as exit `1`

### Notes for Task 7 implementer

- Task 7 is service lifecycle commands: `service start|stop|status|restart`.
- These commands do NOT use `sendAction` — they spawn/interact with the service binary directly.
- Create `cli/src/service-binary.ts` for binary resolution: `BPROXY_SERVICE_BIN` → workspace `service/dist/index.mjs` → `bproxy-service` on PATH.
- `service start` spawns the binary, captures its stdout JSON, prints it to CLI stdout, exits 0.
- `service stop` sends SIGTERM to PID from state file, waits, prints `{"running":false}`.
- `service status` reads PID file, checks process liveness (signal 0), prints JSON. Token-free.
- `service restart` = stop then start (composition in CLI).
- Use `exitSuccess(json)` / `exitUsageError(msg)` from exit.ts — same pattern as action commands.
- DO NOT import from `service/src/**` — dependency-cruiser enforces `cli -> shared` only.
- Integration tests should use a real temp `BPROXY_HOME` with the built service binary.
