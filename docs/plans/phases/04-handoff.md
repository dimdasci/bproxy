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
