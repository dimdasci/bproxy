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
- **stderr** — human diagnostics on exit `2`, structured verbose logs with `--verbose`. Never polluted with color or progress.
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

`navigate`, `text`, `images`, `elements`, `outline`, `dom`, `scroll`, `screenshot`, `fill`, `fill-form`, `select`, `wait`, `require-human`, `eval`

### Service lifecycle (token-free)

`service start`, `service stop`, `service status`, `service restart`

### Session management

`session list`, `session bind`, `session unbind`, `session resume`

### Tab management

`tab list`, `tab pin`, `tab unpin`, `tab open`, `tab close`

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
