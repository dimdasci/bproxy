---
title: CLI
---

Implementation spec for the command-line interface. Built with [citty](https://github.com/unjs/citty).

**Decisions that constrain this:** ADR-004 (citty), ADR-005 (TypeScript), ADR-007 (explicit fill method), ADR-009 (request id correlation), ADR-010 (CLI uses daemon token only), ADR-017 (CLI forwards explicit choices), ADR-018 (no CLI method selection).

## Project Layout

```
cli/
├── package.json              # bin: { "bproxy": "./dist/bproxy.mjs" }
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
└── src/
    ├── bproxy.ts             # citty entrypoint, global args, lazy subcommands
    ├── client.ts             # daemon POST client, response validation, exit-code mapping
    ├── command-registry.ts   # action coverage + destructive classification
    ├── exit.ts               # ExitPlan type, exit-code mapper, executeExitPlan
    ├── globals.ts            # shared global arg definitions + extractGlobals()
    ├── ids.ts                # crypto.randomUUID() request id generation
    ├── output.ts             # writeJson (stdout), writeVerbose/writeDiagnostic (stderr)
    ├── paths.ts              # BPROXY_HOME resolution + state file paths
    ├── response-validation.ts # BproxyResponse shape check
    ├── screenshot-file.ts    # screenshot file materialization (--output-dir)
    ├── service-binary.ts     # locate + spawn service binary (no source imports)
    ├── targets.ts            # --selector / --route-json → ElementTarget parser
    ├── token.ts              # owner/mode preflight (fail closed)
    ├── types.ts              # re-exports from @bproxy/shared
    ├── commands/
    │   ├── navigate.ts       # navigate --url
    │   ├── text.ts           # text [--selector]
    │   ├── links.ts          # links [--selector] [--visible-only] [--limit N]
    │   ├── images.ts         # images [--selector]
    │   ├── elements.ts       # elements [--form]
    │   ├── outline.ts        # outline
    │   ├── dom.ts            # dom [--selector] [--depth N]
    │   ├── inspect.ts        # inspect --selector [--properties] [--limit]
    │   ├── snapshot.ts       # snapshot [--selector] [--max-depth] [--interactive-only]
    │   ├── scroll.ts         # scroll [--selector/--route-json] [--by] [--direction]
    │   ├── screenshot.ts     # screenshot [--activate] [--debugger] [--output-dir]
    │   ├── fill.ts           # fill --selector/--route-json --value --method --world
    │   ├── fill-form.ts      # fill-form --json/--file/--stdin
    │   ├── select.ts         # select --selector/--route-json --option-text
    │   ├── wait.ts           # wait --strategy --target [--timeout]
    │   ├── require-human.ts  # require-human --reason [--for-attach]
    │   ├── status.ts         # top-level status (alias for debug.status)
    │   ├── service/
    │   │   ├── index.ts      # subCommands: start, stop, status, restart
    │   │   ├── start.ts      # service start [--port] [--home]
    │   │   ├── stop.ts       # service stop [--home]
    │   │   ├── status.ts     # service status [--home] (token-free)
    │   │   └── restart.ts    # service restart [--port] [--home]
    │   ├── session/
    │   │   ├── create.ts     # session create [--label]
    │   │   ├── list.ts       # session list
    │   │   ├── bind.ts       # session bind --tab tN [--pacing human|fast]
    │   │   ├── unbind.ts     # session unbind
    │   │   ├── resume.ts     # session resume
    │   │   └── close.ts      # session close
    │   ├── tab/
    │   │   ├── list.ts       # tab list
    │   │   ├── pin.ts        # tab pin [--tab tN]
    │   │   ├── unpin.ts      # tab unpin
    │   │   ├── open.ts       # tab open --url
    │   │   └── close.ts      # tab close [--tab tN]
    │   └── debug/
    │       ├── log.ts        # debug log [--id] [--limit]
    │       ├── last.ts       # debug last [--count]
    │       └── status.ts     # debug status
    └── __tests__/            # unit + integration tests
```

Bundled with `tsup` → `dist/bproxy.mjs`. Run from workspace or built binary; public distribution is deferred to Phase 6.

## Global Flags

Every leaf command defines these via `globalArgs` spread:

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--session` | `-s` | string | *(required for browser commands)* | Session ID for the request |
| `--timeout` | | string (ms) | `30000` | Protocol deadline in milliseconds |
| `--home` | | string | `~/.bproxy` | Override `BPROXY_HOME` state directory |
| `--verbose` | `-v` | boolean | `false` | Write structured diagnostics to stderr |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Valid protocol response with `ok: true`, or lifecycle success |
| `1` | Valid protocol response with `ok: false` (protocol error on stdout) |
| `2` | CLI/config/control-plane failure (bad args, daemon not running, token invalid) |

Commands return an `ExitPlan` object; only the outermost boundary calls `process.exit`.

## Output Contract

- **stdout** — exactly one JSON object (single-line `JSON.stringify` + `\n`). Protocol commands emit the full `BproxyResponse`. Lifecycle commands emit their own JSON shape.
- **stderr** — only for exit `2` diagnostics or `--verbose` structured logs. Never on stdout.
- No color, progress bars, or interactive prompts anywhere.
- Token values never appear in any output.

## Command Pattern

Every protocol-action leaf command follows the same structure:

```typescript
import { defineCommand } from "citty";
import { sendAction } from "../client.js";
import { executeExitPlan } from "../exit.js";
import { extractGlobals, globalArgs } from "../globals.js";

export default defineCommand({
  args: { ...globalArgs, /* command-specific args */ },
  async run({ args }) {
    const globals = extractGlobals(args);
    const params = { /* build from args */ };
    const plan = await sendAction("action.name", params, globals);
    executeExitPlan(plan);
  },
});
```

## Client Module (`client.ts`)

`sendAction` is the single function all protocol commands call. Its pipeline:

1. Resolve `BPROXY_HOME` → state paths (port, token)
2. Token preflight (exists, mode `0600`, owner) → exit `2` on failure
3. Read port file → exit `2` if daemon not running
4. Parse `--timeout` → exit `2` if invalid
5. Build `BproxyRequest<A>` with `protocol_version: 1`, session, deadline, destructive flag
6. Verbose pre-request stderr entry (no token leaked)
7. POST to `http://127.0.0.1:{port}/` with Bearer auth + abort timeout (deadline + 2s)
8. Fetch failure → exit `2` (connection refused, abort timeout)
9. HTTP 401/403 → exit `2`
10. Non-JSON body → exit `2`
11. Validate response shape (protocol_version, id match, ok, branch fields)
12. Malformed response → exit `2`
13. Valid `ok: true` → exit `0`; valid `ok: false` → exit `1`
14. Verbose post-request stderr entry with elapsed/status/error code

## Token Preflight (Fail Closed)

Before any POST, the CLI verifies `BPROXY_HOME/token`:
- File exists and is a regular file
- Mode is exactly `0600`
- Owner matches current UID (when `process.getuid()` is available)

On platforms where POSIX APIs are unavailable (Windows), permission/owner checks are skipped.

## Service Lifecycle Commands

These do **not** use `sendAction`. They spawn the service binary as a child process.

### Binary Resolution

Order: `BPROXY_SERVICE_BIN` env → workspace `service/dist/index.mjs` → `bproxy-service` on PATH.

The CLI never imports service source code. Dependency-cruiser enforces `cli -> shared` only.

### `bproxy service start [--port N] [--home DIR]`

Spawns the service binary's `start` command. Prints lifecycle JSON:
```json
{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}
```

### `bproxy service stop [--home DIR]`

Spawns the service binary's `stop` command. Prints:
```json
{"running":false}
```

### `bproxy service status [--home DIR]`

Token-free, process-liveness based. Prints:
```json
{"running":true,"pid":123,"port":9615}
```
or `{"running":false}`.

### `bproxy service restart [--port N] [--home DIR]`

Composition: stop then start. Produces the same JSON as start.

## Session Commands

Daemon-local (no extension required):

- `session create [--label TEXT]` — creates a new session, returns generated id
- `session list` — returns all active sessions
- `session bind --tab tN [--pacing human|fast]` — binds session to logical tab
- `session unbind` — unbinds session from tab (destructive)
- `session resume` — clears paused state (destructive)
- `session close` — closes all session tabs and destroys session (destructive)

## Tab Commands

Forwarded to extension (require connected WS client + bound session):

- `tab list` — list session-owned tabs (non-destructive)
- `tab pin [--tab tN]` — pin a tab (destructive)
- `tab unpin` — unpin current tab (destructive)
- `tab open --url <url>` — open new tab, auto-create session if `-s` omitted (destructive)
- `tab close [--tab tN]` — close tab (destructive)

## Debug Commands

- `debug log [--id ID] [--limit N]` — forwarded to extension (ring buffer)
- `debug last [--count N]` — daemon-local request history
- `debug status` — daemon-local full status

## Top-level `status`

`bproxy status` is a protocol-backed alias for `debug.status`. It requires token preflight. It does **not** fall back to `service status` on auth failure — that's a config/security failure (exit `2`).

## Write Commands

### `fill --selector/--route-json --value/--value-file/--value-stdin --method --world`

- Target: exactly one of `--selector <css>` or `--route-json <json>`
- Value: exactly one of `--value`, `--value-file <path>`, `--value-stdin`
- Method: required, one of `direct|paste|runtime-api`
- World: required, one of `isolated|main`

### `fill-form --json/--file/--stdin`

Payload must be `{ "fields": [...] }` where each field has `target`, `value`, `method`, `world`.

### `select --selector/--route-json --option-text`

### `scroll [--selector/--route-json] [--by] [--direction]`

- Target omitted: scroll the viewport/document only.
- `--selector` / `--route-json`: scroll exactly that resolved element. bproxy does not infer or fall back to other scroll containers.
- Result includes `moved`, `before`, `after`, and `scrolledPx` so agents can tell whether anything actually moved.

There is intentionally no `eval` command. Arbitrary page/runtime investigation belongs to browser debugging tools such as CDP/devtools, not bproxy.

## Command Registry

`command-registry.ts` classifies every shared `Action` as destructive or non-destructive. A compile-time exhaustiveness assertion ensures adding a new shared action without updating the registry causes a build failure.

**Destructive:** navigate, scroll, fill, fill-form, select, tab.pin, tab.unpin, tab.open, tab.close, session.create, session.bind, session.unbind, session.resume, session.close, require-human.

**Non-destructive:** text, links, images, elements, outline, dom, inspect, snapshot, screenshot, wait, tab.list, session.list, debug.log, debug.last, debug.status.

## Verbose Mode (`--verbose`)

Writes structured JSON to stderr. Each entry includes: `requestId`, `action`, `session`, `url`, `elapsed`, `httpStatus`, `errorCode`. Token values are never included.

## Debugger Policy

The CLI does not add `--enable-debugger-mode` flags to `service start`. Extension `DEBUGGER_DISABLED` policy responses pass through as protocol errors (exit `1`). Arbitrary page eval is out of scope.

## Testing

- **Unit tests:** paths, token, output, exit, client, command-registry, targets, individual commands
- **Integration tests:** real daemon lifecycle (start/stop/status), forwarded action via mock WS client
- **Design assertions:** action coverage, no direct fetch in commands, import boundaries, stdout cleanliness, exit-code determinism

## Development

```bash
pnpm --filter @bproxy/cli build      # tsup → dist/bproxy.mjs
pnpm --filter @bproxy/cli typecheck  # tsc --noEmit
pnpm --filter @bproxy/cli test       # vitest run
pnpm check                           # full workspace quality gate
```
