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

This smoke stays on localhost: one fixture page, one temp `BPROXY_HOME`, one real
Chrome profile with the unpacked extension.

### 0. Build the service and extension

```bash
pnpm --filter @bproxy/service build
pnpm --filter @bproxy/extension build
```

### 1. Start the local fixture page

```bash
pnpm --filter @bproxy/extension smoke:fixture
```

Keep the printed `http://127.0.0.1:<port>/` open in Chrome and keep that tab
active while running the workflow.

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

### 4. Find the fixture tab id

Open the extension service-worker console from `chrome://extensions`, then run:

```js
chrome.tabs
	.query({ active: true, lastFocusedWindow: true })
	.then((tabs) => tabs.map(({ id, url, title }) => ({ id, url, title })));
```

Use the `id` for the active fixture tab.

### 5. Run the end-to-end smoke

```bash
pnpm --filter @bproxy/extension smoke:workflow -- --home <BPROXY_HOME> --tabId <TAB_ID>
```

The workflow performs:

- `session.bind`
- `wait` for `#smoke-text`
- `text`
- `elements --form`
- `fill` with `method: "paste"`
- `text` against the paste echo
- `scroll --until-stable`
- `debug.log --id <fill-request-id>`

It exits non-zero if any step fails and prints the request ids plus a compact
result summary on success.

### 6. Reconnect smoke

#### Daemon restart

1. Stop the smoke daemon terminal with `Ctrl-C`
2. Restart it with the same state dir:

```bash
pnpm --filter @bproxy/extension smoke:daemon -- --home <BPROXY_HOME>
```

3. Run `debug.status` again and confirm `wsClients.length > 0` without
   re-pairing
4. Re-run `smoke:workflow` with the same `--tabId`

Note: daemon restart clears daemon session state by design, so rebinding the tab
is expected; re-pairing is not.

#### Service-worker restart

1. In `chrome://extensions`, open **Inspect views** for the service worker
2. Click **Reload** for the extension or stop/start the worker there
3. Re-run:

```bash
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> debug.status
```

Expect `wsClients.length > 0` again after the worker reconnects.

### 7. Optional dedupe/replay spot-check

Send the same destructive request twice with the same id, then inspect
`debug.log`:

```bash
REQ_ID=smoke-fill-replay-1
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> --session smoke --id "$REQ_ID" fill '{"target":{"selector":"#smoke-name"},"value":"Replay check","method":"paste","world":"isolated"}'
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> --session smoke --id "$REQ_ID" fill '{"target":{"selector":"#smoke-name"},"value":"Replay check","method":"paste","world":"isolated"}'
pnpm --filter @bproxy/extension smoke:command -- --home <BPROXY_HOME> debug.log '{"id":"smoke-fill-replay-1","limit":5}'
```

The second `fill` should come back from extension dedupe (`replay: true`).

## Loading the built extension into Chrome

1. Run `pnpm --filter @bproxy/extension build`.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/.output/chrome-mv3/`.

The extension toolbar action opens the pairing popup.

## Pairing the extension to a running daemon

1. Start the daemon (`pnpm --filter @bproxy/service start` or your normal
   workflow). The daemon listens on `127.0.0.1:9615` by default.
2. Issue a one-time pairing code by starting the daemon in foreground
   (`pnpm --filter @bproxy/extension smoke:daemon` for the local smoke flow,
   or `BPROXY_HOME=... pnpm --filter @bproxy/service exec bproxy-service daemonize`
   and copy the printed `pairingCode`). Phase 4 will replace this with a real
   CLI command.
3. Open the extension popup and paste the code into **Pairing code**, then
   click **Pair**. On success the popup shows `Paired. You can close this
   popup.` and the background worker reconnects to the daemon WebSocket.
4. On failure the popup shows a status line in red with a machine-readable
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

See [`docs/solution/extension.md`](../docs/solution/extension.md) for the
full spec and [`docs/plans/phases/03-extension.md`](../docs/plans/phases/03-extension.md)
for the phase plan.
