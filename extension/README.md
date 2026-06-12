# @bproxy/extension

Chrome Manifest V3 extension that pairs with the bproxy daemon and executes
forwarded browser actions on behalf of a CLI agent. Built with [WXT](https://wxt.dev).

## Public entrypoints

- `src/entrypoints/background.ts` — MV3 service worker. Owns the daemon
  WebSocket, request dispatch, dedupe, and programmatic content-script
  injection.
- `src/entrypoints/content.ts` — runtime ISOLATED-world content script.
  Registered at runtime (not declaratively); the background SW injects it
  on first command per tab.
- `src/entrypoints/popup/index.html` + `popup/main.ts` — pairing popup.
  Bootstraps the extension token via `POST /pair/claim` against the local
  daemon. WXT requires a single entrypoint name per file/dir, so the popup
  uses the directory form (`index.html` is the entrypoint; `main.ts` is its
  companion module).

## Architecture references

- Solution spec: [`docs/public/solution/extension.md`](../docs/public/solution/extension.md)
- Container view: [`docs/public/views/02-containers.md`](../docs/public/views/02-containers.md)
- Threat model: [`docs/public/views/06-threat-model.md`](../docs/public/views/06-threat-model.md)
- Generated component graph: [`docs/public/views/auto/extension-components.svg`](../docs/public/views/auto/extension-components.svg)

Build-time assertions also lock the shipped MV3 surface: no declarative
`content_scripts`, no default `web_accessible_resources`, no forbidden
`MutationObserver` in the production bundle, and usable source maps/startup
labels for debugging.

## Local development

```bash
# From the repo root
pnpm install

# Dev build with HMR (opens a Chrome instance with the extension loaded)
pnpm --filter @bproxy/extension dev

# Production build → extension/.output/chrome-mv3/
pnpm --filter @bproxy/extension build

# Type-check (runs `wxt prepare` first to regenerate WXT's virtual types)
pnpm --filter @bproxy/extension typecheck

# Unit tests
pnpm --filter @bproxy/extension test
```

## Local smoke workflow (real daemon + real Chrome)

This smoke stays on localhost: one fixture server, one temp `BPROXY_HOME`, one
real Chrome profile with the unpacked extension. It mirrors the Phase 5
acceptance shape: fresh pairing → `tab.open` bootstrap → `text` → `links` →
`navigate` → `text` → `session.close`.

### 0. Build the service and extension

```bash
pnpm --filter @bproxy/service build
pnpm --filter @bproxy/extension build
```

### 1. Start the local fixture server

```bash
pnpm --filter @bproxy/extension smoke:fixture
```

The helper prints a `Base URL`, `Search URL`, and `Detail URL`.

### 2. Start a smoke daemon in a temp `BPROXY_HOME`

```bash
pnpm --filter @bproxy/extension smoke:daemon
```

The helper prints:

- `BPROXY_HOME=...`
- the daemon port (`9615` by default; the popup currently expects this)
- a one-time pairing code

Leave this terminal running.

### 3. Load and pair the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → `extension/.output/chrome-mv3/`
4. Open the toolbar popup and paste the pairing code from step 2
5. Wait for the popup success message

You can verify the daemon sees the extension with:

```bash
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> debug.status
```

Expect `response.data.wsClients.length > 0`.

### 4. Run the Phase 5 local workflow

```bash
pnpm --filter @bproxy/extension smoke:workflow -- --home <BPROXY_HOME> --baseUrl http://127.0.0.1:<fixture-port>
```

The workflow waits for the paired extension and then performs:

- `tab.open --url <baseUrl>/search?q=bproxy+smoke`
- `text -s <generated> --selector main`
- `links -s <generated> --selector #search --visible-only --limit 10`
- `navigate -s <generated> --url <baseUrl>/detail/alpha`
- `text -s <generated> --selector main`
- `session close -s <generated>`

It exits non-zero if any step fails and prints a JSON transcript including the
generated session id, logical tab handle, request ids, and responses.

### 5. Reconnect smoke

#### Daemon restart

1. Stop the smoke daemon terminal with `Ctrl-C`
2. Restart it with the same state dir:

```bash
pnpm --filter @bproxy/extension smoke:daemon -- --home <BPROXY_HOME>
```

3. Run `debug.status` again and confirm `wsClients.length > 0` without
   re-pairing
4. Re-run `smoke:workflow`

Note: daemon restart clears daemon session state by design, so a new generated
session id is expected; re-pairing is not.

#### Service-worker restart

1. In `chrome://extensions`, open **Inspect views** for the service worker
2. Click **Reload** for the extension or stop/start the worker there
3. Re-run:

```bash
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> debug.status
```

Expect `wsClients.length > 0` again after the worker reconnects.

## Loading the built extension into Chrome

1. Run `pnpm --filter @bproxy/extension build`.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/.output/chrome-mv3/`.

The extension toolbar action opens the pairing popup.

## Pairing the extension to a running daemon

1. Start the daemon with the built CLI:

   ```bash
   node cli/dist/bproxy.mjs service start --home <BPROXY_HOME>
   ```

   The daemon listens on `127.0.0.1:9615` by default and prints lifecycle JSON
   containing `pairingCode` and `pairingExpiresAt`.
2. Open the extension popup and paste the code into **Pairing code**, then
   click **Pair**. On success the popup shows `Paired. You can close this
   popup.` and the background worker reconnects to the daemon WebSocket.
3. On failure the popup shows a status line in red with a machine-readable
   error code (e.g. `PAIRING_CODE_EXPIRED`, `INVALID_WS_URL`,
   `PAIR_TRANSPORT_ERROR`) plus a hint; the popup is the only place the
   user is prompted (no options page — see ADR-011).

## Architecture notes

- TypeScript: browser API typings come from `@types/chrome`; WXT-generated
  ambient types (`defineBackground`, `defineContentScript`, etc.) are
  picked up via the `./.wxt/tsconfig.json` extends.
- Manifest hygiene: no declarative `content_scripts`, no
  `web_accessible_resources`, and no `debugger` permission (the latter is
  opt-in only behind a future flag — see ADR-016 and ADR-001).
- Source layout: `srcDir: "src"` so all extension code stays under
  `extension/src/**` where dependency-cruiser and knip can see it.

See [`docs/public/solution/extension.md`](../docs/public/solution/extension.md) for the
full spec and [`docs/internal/plans/phases/03-extension.md`](../docs/internal/plans/phases/03-extension.md)
for the phase plan.
