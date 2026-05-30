# @bproxy/cli

Command-line interface for agents to interact with the bproxy daemon. Built with [citty](https://github.com/unjs/citty).

## Purpose

The CLI translates explicit agent/user intent into protocol actions against the bproxy daemon. It does **not** make strategy decisions — method choice, target selection, and escalation remain agent-owned.

## Local development

```bash
# Install dependencies (from repo root)
pnpm install

# Build
pnpm --filter @bproxy/cli build

# Type-check
pnpm --filter @bproxy/cli typecheck

# Run tests
pnpm --filter @bproxy/cli test

# Run the built binary
node cli/dist/bproxy.mjs --help
```

## Output contract

- **stdout** — exactly one JSON object (single line, trailing newline) for protocol commands. Lifecycle commands (`service start/stop/status`) produce lifecycle JSON.
- **stderr** — human diagnostics on exit `2`, structured verbose logs with `--verbose`, and rare exit `1` warnings for partial-success cases like `session close`. Never polluted with color or progress.
- No positional arguments anywhere. Every value is a named flag.

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Valid protocol response with `ok: true`, or lifecycle success |
| `1`  | Valid protocol response with `ok: false` (action error) |
| `2`  | CLI/config/control-plane failure (bad args, daemon not running, token invalid, non-protocol response) |

## Global flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--session` | `-s` | Session ID for the request |
| `--timeout` | | Protocol deadline in milliseconds |
| `--home` | | Override `BPROXY_HOME` state directory |
| `--verbose` | `-v` | Write structured diagnostics to stderr |

## Command families

### Action commands (protocol POST)

`navigate`, `text`, `links`, `images`, `elements`, `outline`, `dom`, `scroll`, `screenshot`, `fill`, `fill-form`, `select`, `wait`, `require-human`, `eval`

### Service lifecycle (token-free)

`service start`, `service stop`, `service status`, `service restart`

### Session management

`session create`, `session list`, `session bind`, `session unbind`, `session resume`, `session close`

### Tab management

`tab list`, `tab pin`, `tab unpin`, `tab open`, `tab close`

- Browser-control commands require `-s/--session <id>`.
- `tab open --url ...` is the only bootstrap exception and may omit `-s`.
- Tab arguments use logical handles like `--tab t1`, never raw Chrome ids.

### Debug/observability

`debug log`, `debug last`, `debug status`

### Top-level status

`status` — protocol-backed alias for `debug status` (requires token)

## Service lifecycle commands

```bash
# Start daemon (prints pairing code for extension)
bproxy service start --port 9615

# Check if daemon is running (no token needed)
bproxy service status

# Stop daemon
bproxy service stop

# Restart
bproxy service restart
```

## Architecture constraints

- CLI imports only from `@bproxy/shared` — never from `service/src/**` or `extension/src/**`.
- Subcommands are loaded lazily to keep startup fast for tight agent loops.
- Process exit happens only at the outermost boundary; command modules return exit plans.

## Integration smoke test

The CLI includes an integration test that proves a full round trip against a real daemon:

```bash
# Build both service and CLI
pnpm --filter @bproxy/service build
pnpm --filter @bproxy/cli build

# Run the integration smoke test
pnpm --filter @bproxy/cli test -- src/__tests__/smoke.integration.test.ts
```

The smoke test:
1. Starts a real daemon in a temp `BPROXY_HOME` via `bproxy service start`
2. Verifies start output (pairing code, PID, port) and token file permissions
3. Runs `session create`, `session list`, `session close` (daemon-local, no extension)
4. Runs `debug status` and `debug last` for observability
5. Connects a mock WebSocket client (claims pairing code → extension token → WS auth)
6. Creates a session, opens a tab, sends a forwarded `text` command, verifies mock response
7. Stops the daemon and verifies clean shutdown

To reproduce manually:

```bash
export BPROXY_HOME=$(mktemp -d)
node cli/dist/bproxy.mjs service start --home $BPROXY_HOME
node cli/dist/bproxy.mjs session list --home $BPROXY_HOME
node cli/dist/bproxy.mjs status --home $BPROXY_HOME
node cli/dist/bproxy.mjs service stop --home $BPROXY_HOME
rm -rf $BPROXY_HOME
```
