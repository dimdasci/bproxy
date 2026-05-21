# Task 1 → Task 2 Hand-off

## What was done (Task 1)

The service binary now produces stable lifecycle JSON on stdout, making it scriptable by the CLI without importing service internals.

### Key changes

| File | What |
|------|------|
| `service/src/pairing-file.ts` | New module: `writePairingFile`, `readPairingFile`, `removePairingFile` + type interfaces (`LifecycleStartResult`, `LifecycleStopResult`, `LifecycleStatusResult`, `PairingMetadata`) |
| `service/src/config.ts` | `stateFile()` now accepts `"pairing.json"` |
| `service/src/lifecycle.ts` | `startDetached` returns `LifecycleStartResult`; `stop` returns `LifecycleStopResult`; `status` returns `LifecycleStatusResult`; pairing.json written/cleaned |
| `service/src/index.ts` | `start` prints JSON with `{running, pid, port, pairingCode, pairingExpiresAt}`; `stop` prints `{"running":false}` |
| `docs/solution/cli.md` | Removed `--allow-eval` / `--enable-debugger-mode` from service start |
| `docs/solution/service.md` | Documented pairing.json, lifecycle JSON shapes, extension-token preservation |

### Output contracts the CLI can rely on

```bash
# start → exit 0, stdout:
{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}

# stop → exit 0, stdout:
{"running":false}

# status → exit 0, stdout:
{"running":true,"pid":123,"port":9615}   # or {"running":false}

# failure → exit 1, stderr has message (e.g. "daemon already running (pid 123)")
```

### State files the CLI needs to know about

- `BPROXY_HOME/port` — bound port (read by CLI for HTTP target)
- `BPROXY_HOME/token` — daemon bearer token (mode 0600, read by CLI for auth)
- `BPROXY_HOME/bproxy.pid` — daemon PID (used by `status` for liveness check)
- `BPROXY_HOME/extension-token` — preserved across stop/start (CLI never reads this)
- `BPROXY_HOME/pairing.json` — transient, daemon-owned (CLI doesn't need to read it directly; pairing info comes from start stdout)

### What Task 2 can depend on

1. Service binary is at `service/dist/index.mjs` after `pnpm --filter @bproxy/service build`.
2. It accepts `start | stop | status | daemonize` subcommands.
3. Env vars: `BPROXY_HOME` (state dir), `BPROXY_PORT` (listen port, `0` for random).
4. Start output is parseable JSON with the exact fields above.
5. `pnpm check` passes from a clean state — no lint/format/type/arch regressions.

### Notes for Task 2 implementer

- The CLI package (`cli/`) currently has a stub `src/index.ts`. Replace it with the citty entrypoint.
- Service binary resolution (Task 7) will need to find `service/dist/index.mjs` — but Task 2 only needs to bootstrap the CLI shell, not call service commands yet.
- Global args `--home` should map to `BPROXY_HOME`; this is the single knob that scopes all state.
- The `LifecycleStartResult` type is exported from `service/src/lifecycle.ts` but the CLI **must not import it** (architecture boundary). Define equivalent CLI-side types or parse loosely.
