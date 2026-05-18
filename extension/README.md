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

## Loading the built extension into Chrome

1. Run `pnpm --filter @bproxy/extension build`.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/.output/chrome-mv3/`.

The extension toolbar action opens the pairing popup. The popup pairing
flow itself lands in Task 4 of the Phase 3 plan.

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
