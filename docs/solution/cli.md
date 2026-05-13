---
title: CLI
---

Implementation spec for the command-line interface. Built with [citty](https://github.com/unjs/citty).

**Decisions that constrain this:** [ADR-004](../decisions.md#adr-004-cli-framework--citty) (citty), [ADR-005](../decisions.md#adr-005-typescript-as-project-language) (TypeScript).

## Project Layout

```
cli/
├── package.json              # bin: { "bproxy": "./dist/bproxy.mjs" }, deps: citty
├── tsconfig.json
└── src/
    ├── bproxy.ts             # entry: defineCommand + top-level args + lazy subCommands
    ├── client.ts             # HTTP POST to daemon, JSON parse, exit code logic
    ├── paths.ts              # cross-platform state directory resolver (~/.bproxy/)
    ├── output.ts             # JSON stdout formatting
    └── commands/
        ├── service.ts        # subCommands: start, stop, restart, status
        ├── service/
        │   ├── start.ts
        │   ├── stop.ts
        │   ├── restart.ts
        │   └── status.ts
        ├── status.ts         # top-level quick status
        ├── navigate.ts
        ├── text.ts
        ├── images.ts
        ├── elements.ts
        ├── outline.ts
        ├── dom.ts
        ├── scroll.ts
        ├── screenshot.ts
        ├── fill.ts
        ├── fill-form.ts
        ├── select.ts
        ├── wait.ts
        ├── require-human.ts
        ├── eval.ts
        ├── tab.ts            # subCommands: list, pin, unpin, open, close
        ├── session.ts        # subCommands: list, bind, unbind, resume
        └── debug.ts          # subCommands: log, last, status
```

Bundled with `tsup` → `dist/bproxy.mjs`. Installed globally via npm (`npm i -g bproxy`).

## Entry Point

```typescript
// src/bproxy.ts
import { defineCommand, runMain } from 'citty';

const main = defineCommand({
  meta: {
    name: 'bproxy',
    version: '0.1.0',
    description: 'Browser proxy for code agents',
  },
  args: {
    session: {
      type: 'string',
      description: 'Session name',
      default: 'default',
      alias: ['s'],
    },
  },
  subCommands: {
    service:        () => import('./commands/service').then(m => m.default),
    status:         () => import('./commands/status').then(m => m.default),
    navigate:       () => import('./commands/navigate').then(m => m.default),
    text:           () => import('./commands/text').then(m => m.default),
    images:         () => import('./commands/images').then(m => m.default),
    elements:       () => import('./commands/elements').then(m => m.default),
    outline:        () => import('./commands/outline').then(m => m.default),
    dom:            () => import('./commands/dom').then(m => m.default),
    scroll:         () => import('./commands/scroll').then(m => m.default),
    screenshot:     () => import('./commands/screenshot').then(m => m.default),
    fill:           () => import('./commands/fill').then(m => m.default),
    'fill-form':    () => import('./commands/fill-form').then(m => m.default),
    select:         () => import('./commands/select').then(m => m.default),
    wait:           () => import('./commands/wait').then(m => m.default),
    'require-human': () => import('./commands/require-human').then(m => m.default),
    eval:           () => import('./commands/eval').then(m => m.default),
    tab:            () => import('./commands/tab').then(m => m.default),
    session:        () => import('./commands/session').then(m => m.default),
    debug:          () => import('./commands/debug').then(m => m.default),
  },
});

runMain(main);
```

Lazy imports ensure only the invoked command is loaded. Startup is fast for agents calling bproxy in tight loops.

## Command Structure

Every leaf command follows the same pattern:

```typescript
// src/commands/scroll.ts
import { defineCommand } from 'citty';
import { sendCommand } from '../client';

export default defineCommand({
  meta: { name: 'scroll', description: 'Scroll the page' },
  args: {
    by: {
      type: 'string',
      description: 'Distance: pixels or "viewport"',
      default: 'viewport',
      valueHint: 'px|viewport',
    },
    direction: {
      type: 'enum',
      options: ['up', 'down'],
      default: 'down',
    },
    'until-stable': {
      type: 'boolean',
      description: 'Wait for DOM to settle after scroll',
      default: true,
    },
  },
  async run({ args }) {
    await sendCommand('scroll', {
      by: args.by,
      direction: args.direction,
      untilStable: args.untilStable,
    }, { session: args.session });
  },
});
```

## Client Module

**File:** `src/client.ts`

The core logic shared by all commands: resolve daemon, POST, handle response.

```typescript
import { resolve as resolvePaths } from './paths';
import { formatOutput } from './output';

interface SendOptions {
  session: string;
  timeout?: number;
}

export async function sendCommand(action: string, params: Record<string, unknown>, opts: SendOptions): Promise<void> {
  const { port, token } = await resolveDaemon();

  const request: BproxyRequest = {
    protocol_version: 1,
    id: generateId(),    // ULID or similar
    action,
    params,
    session: opts.session,
    deadline: Date.now() + (opts.timeout ?? 30_000),
    destructive: isDestructive(action),
  };

  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  const result: BproxyResponse = await response.json();

  // Output
  process.stdout.write(formatOutput(result) + '\n');

  // Exit code
  if (result.ok) process.exit(0);
  else process.exit(1);
}

async function resolveDaemon(): Promise<{ port: number; token: string }> {
  const paths = resolvePaths();
  // Read port from ~/.bproxy/port
  // Read token from ~/.bproxy/token
  // Preflight token file security before use:
  // - must exist
  // - owner must be current user
  // - mode must be 0600 (owner read/write only)
  // If preflight fails → exit 2 with explicit fix command
  // If port/token missing → exit 2 with "daemon not running" message
}
```

Uses Node.js built-in `fetch` (available since Node 18). No HTTP library dependency.

## Path Resolution

**File:** `src/paths.ts`

Single state directory on all platforms:

```typescript
export function resolvePaths() {
  const base = path.join(os.homedir(), '.bproxy');

  return {
    base,
    pid: path.join(base, 'bproxy.pid'),
    port: path.join(base, 'port'),
    token: path.join(base, 'token'),
    logs: path.join(base, 'logs'),
  };
}
```

## Output Formatting

**File:** `src/output.ts`

All output is JSON. One object per invocation on stdout. No color, no progress bars, no interactive prompts — this is consumed by agents.

```typescript
export function formatOutput(result: BproxyResponse): string {
  return JSON.stringify(result);
}
```

Errors go to stderr only for usage errors (exit code 2). All protocol errors are part of the JSON response on stdout (exit code 1).

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | `ok: true` — command succeeded |
| 1 | `ok: false` — command failed (error in JSON on stdout) |
| 2 | Usage/config error (bad args, daemon not running, missing/insecure token, config missing) |

## `service` Subcommands

These are special — they don't POST to the daemon. They manage the daemon lifecycle directly.

### `bproxy service start`

```typescript
// src/commands/service/start.ts
export default defineCommand({
  meta: { name: 'start', description: 'Start the proxy daemon' },
  args: {
    port: { type: 'string', description: 'Port number', default: '9615' },
    'allow-eval': { type: 'boolean', description: 'Enable eval command', default: false },
    'enable-debugger-mode': { type: 'boolean', description: 'Allow chrome.debugger attachment', default: false },
  },
  async run({ args }) {
    // 1. Check if already running (read PID file, check process)
    // 2. Spawn service/dist/index.mjs as detached child
    //    Pass config via env vars: BPROXY_PORT, BPROXY_ALLOW_EVAL, BPROXY_ENABLE_DEBUGGER
    // 3. Daemon startup generates token and writes ~/.bproxy/token (mode 0600)
    // 4. Write PID to ~/.bproxy/bproxy.pid
    // 5. Wait for port file to appear (daemon is listening)
    // 6. Output { ok: true, data: { pid, port, pairingCode, pairingExpiresAt } }
    //    pairingCode is one-time, short TTL (5 min), single-use
    //    Copy displayed for user to paste into extension popup—no CLI call to /pair/claim
  },
});
```

### `bproxy service stop`

Read PID → send SIGTERM → wait for exit → clean up lockfile.

### `bproxy service status`

Read PID → check if alive → read port → report.

## Pairing workflow

Pairing is popup-driven—see [ADR-011](../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing).

1. CLI prints pairing code in `bproxy service start` output.
2. User opens extension popup and enters code.
3. Popup calls `POST /pair/claim`.
4. Daemon returns bootstrap payload to popup.
5. Extension stores token.
6. CLI reads pairing state via `bproxy service status`.

## Token preflight (fail closed)

Before any command that reads `~/.bproxy/token`, CLI enforces:

- file exists
- owner is current user
- permissions are exactly `0600`

If any check fails, CLI must not attempt daemon auth and must exit `2` with clear remediation text.

Example messages:

- Missing token:
  - `Token not found: ~/.bproxy/token. Run: bproxy service start`
- Insecure mode:
  - `Insecure token permissions (found 0644, expected 0600). Run: chmod 600 ~/.bproxy/token`
- Wrong owner:
  - `Token owner mismatch. Run: chown $USER ~/.bproxy/token`

## ID Generation

Each command gets a unique ID for idempotency. Use ULID (time-sortable, no deps needed — implement in ~20 lines) or `crypto.randomUUID()`.

## Destructive Action Classification

```typescript
const DESTRUCTIVE_ACTIONS = new Set([
  'navigate', 'fill', 'fill-form', 'select', 'scroll', 'eval',
  'tab.open', 'tab.close', 'tab.pin', 'tab.unpin',
]);

function isDestructive(action: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}
```

Read-only actions (`text`, `elements`, `outline`, `dom`, `images`, `screenshot`, `wait`) are not destructive — safe to replay.

## Observability

The CLI is a one-shot process — it doesn't maintain state between invocations. Its observability role is:

1. **Pass through the `id`** so the user/agent can correlate with daemon log and extension buffer.
2. **`--verbose` flag** for real-time debugging of a single command.
3. **`debug` subcommand** for querying the system after the fact.

### `--verbose` flag

Top-level flag inherited by all commands. Prints to **stderr** (stdout stays clean JSON for agents).

```bash
bproxy --verbose scroll --by viewport
```

Stderr output:
```
[bproxy] POST http://127.0.0.1:9615/ id=01HZX9C2K8 action=scroll session=default
[bproxy] Response 200 elapsed=2814ms ok=true
```

On error:
```
[bproxy] POST http://127.0.0.1:9615/ id=01HZX9C2K8 action=scroll session=default
[bproxy] Response 200 elapsed=5002ms ok=false code=TIMEOUT
[bproxy] Hint: grep '01HZX9C2K8' ~/.bproxy/logs/2026-05-08.log
```

The hint line tells the developer exactly how to dig deeper.

### `debug` subcommand

`debug` is protocol-backed (Option 1): CLI sends explicit actions through the daemon.

```bash
bproxy debug log                # action: debug.log
bproxy debug log --id 01HZX…    # action: debug.log { id }
bproxy debug log --limit 20     # action: debug.log { limit }
bproxy debug last [--count N]   # action: debug.last { count }
bproxy debug status             # action: debug.status
```

All return JSON on stdout. An agent debugging its own failures can call these programmatically.

### Error responses include `id`

Every error JSON already includes the `id` field (protocol spec). An agent that receives an error can immediately query:

```bash
# Agent's self-debugging flow:
bproxy debug log --id $FAILED_ID
```

### Adding `--verbose` to citty

```typescript
// src/bproxy.ts
const main = defineCommand({
  args: {
    session: { type: 'string', default: 'default', alias: ['s'] },
    verbose: { type: 'boolean', default: false, alias: ['v'] },
  },
  // ...
});
```

The `client.ts` module checks `args.verbose` and emits stderr lines before/after the HTTP call.

## Testing

Unit tests with Vitest:
- Path resolution (per-platform)
- Client module (mock fetch, verify request shape, verify exit codes)
- ID generation (uniqueness, format)
- Individual command arg parsing (citty provides `parseArgs` for testing)

Integration tests:
- Start real daemon → run CLI commands → verify JSON output + exit codes.

## Development

```bash
cd cli
pnpm dev        # tsup --watch
pnpm build      # tsup → dist/bproxy.mjs
pnpm test       # vitest
```
