# @bproxy/service

The localhost proxy daemon. Bridges CLI HTTP requests and the browser extension over WebSocket. Owns auth, pacing, request lifecycle, and observability.

## Public API

Single entry point: [`src/index.ts`](./src/index.ts). The package ships a `bproxy-service` binary with `start | stop | status` subcommands.

## Development

```bash
pnpm --filter @bproxy/service typecheck
pnpm --filter @bproxy/service test
pnpm --filter @bproxy/service build
```

## Configuration

- `BPROXY_HOME` — state directory (default: `~/.bproxy`)
- `BPROXY_PORT` — listen port (default: `9615`)
- `BPROXY_LOG_LEVEL` — pino level (default: `info`)
