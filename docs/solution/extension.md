# Solution: Browser Extension

Implementation spec for the Chrome Manifest V3 extension. Built with [WXT](https://wxt.dev).

**Decisions that constrain this:** [ADR-001](../decisions.md#adr-001-default-instrumentation-strategy--read-mode) (read mode default), [ADR-002](../decisions.md#adr-002-extension-framework--wxt) (WXT), [ADR-006](../decisions.md#adr-006-dom-polling-over-mutationobserver) (DOM polling), [ADR-007](../decisions.md#adr-007-paste-flavored-writes-as-default) (paste default).

## Project Layout

```
extension/
├── package.json              # devDeps: wxt, typescript, vitest
├── wxt.config.ts             # manifest overrides, host_permissions, no content_scripts
├── tsconfig.json
├── entrypoints/
│   ├── background.ts         # service worker
│   └── content.ts            # isolated world, registration: 'runtime'
├── utils/
│   ├── ws-client.ts          # WebSocket connection + reconnect logic
│   ├── storage.ts            # typed storage items (session pins, token, domain config)
│   └── actions/              # per-action handler modules
│       ├── navigate.ts
│       ├── text.ts
│       ├── elements.ts
│       ├── fill.ts
│       ├── scroll.ts
│       ├── screenshot.ts
│       └── ...
└── tests/                    # unit tests (vitest + fakeBrowser)
    ├── background.test.ts
    └── actions/
```

Output: `extension/.output/chrome-mv3/` — loaded into Chrome, pointed at by E2E tests.

## WXT Configuration

```typescript
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'bproxy',
    permissions: ['tabs', 'scripting', 'webNavigation', 'alarms', 'storage', 'debugger'],
    host_permissions: ['<all_urls>'],
    // No content_scripts — programmatic injection only
  },
});
```

WXT refs: [Manifest config](https://wxt.dev/guide/essentials/config/guide/essentials/config/manifest.md), [Browser Startup](https://wxt.dev/guide/essentials/config/guide/essentials/config/browser-startup.md)

## Background Service Worker

**File:** `entrypoints/background.ts`

WXT ref: [Entrypoints](https://wxt.dev/guide/essentials/entrypoints.md)

### Responsibilities

1. **WebSocket client** — persistent connection to `ws://127.0.0.1:{port}/ws`. Reconnects on drop. Authenticates during handshake via `Sec-WebSocket-Protocol` using `bproxy.v1` plus `auth.{base64url(token)}` from storage.
2. **Pairing bridge** — listens for `chrome.runtime.onMessageExternal` from CLI helper and accepts signed bootstrap payload (`extensionToken`, `wsUrl`, `protocolVersion`).
3. **Request dispatch** — receives protocol messages from daemon, routes to appropriate handler (tab-level actions → content script, extension-level actions → direct API calls).
4. **Dedupe table** — `chrome.storage.session` map of `{id → result}`. Prevents re-execution on replay-after-reconnect. Bounded size, TTL-based eviction.
5. **Session/tab pin map** — `chrome.storage.session` keyed by session name → tab ID. Sticky targeting.
6. **Frame table** — populated from `chrome.webNavigation.onCompleted` / `onHistoryStateUpdated`. Used for SPA detection and frame targeting.
7. **Keepalive** — `chrome.alarms` every 30s + app-level WS ping every 20s.
8. **Content script injection** — on first command targeting a tab, inject `content.ts` via `browser.scripting.executeScript`. Track injected tabs to avoid re-injection.
9. **Interstitial detection** — after `navigate` completes, check page title/content against known patterns (CAPTCHA, sign-in walls). Emit `HUMAN_REQUIRED` error.

### SW Lifecycle

```
SW starts → read token from storage (if present)
         → register external message handler for pairing
         → if token exists: open WS with (`bproxy.v1`, `auth.{base64url(token)}`)
         → register chrome.alarms keepalive
         → register chrome.webNavigation listeners (frame table)

On `pair.bootstrap` message from trusted sender
             → validate sender id + payload shape
             → persist token/wsUrl/protocol
             → reconnect WS immediately
             → ack `{ ok: true }`

On WS message → parse → check dedupe table
             → if duplicate: return cached result
             → if new: resolve target tab → inject content script if needed
                     → dispatch to handler → store result in dedupe → send response

On WS close → exponential backoff reconnect (1s, 2s, 4s, max 30s)

On SW suspend → WS closes naturally → alarms fire → SW revives → reconnect
```

### Storage Schema

Using WXT's typed storage (`wxt/utils/storage`):

```typescript
// utils/storage.ts
import { storage } from 'wxt/utils/storage';

export const tokenItem = storage.defineItem<string>('local:token');
export const sessionPins = storage.defineItem<Record<string, number>>('session:pins', { defaultValue: {} });
export const dedupeTable = storage.defineItem<Record<string, { result: unknown; ts: number }>>('session:dedupe', { defaultValue: {} });
export const injectedTabs = storage.defineItem<number[]>('session:injectedTabs', { defaultValue: [] });
```

WXT ref: [Storage](https://wxt.dev/guide/essentials/storage.md)

## Content Script

**File:** `entrypoints/content.ts`

WXT refs: [Content Scripts](https://wxt.dev/guide/essentials/content-scripts.md), [Scripting](https://wxt.dev/guide/essentials/scripting.md)

```typescript
// entrypoints/content.ts
export default defineContentScript({
  registration: 'runtime',  // NOT declarative — injected by background on demand
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  world: 'ISOLATED',

  main(ctx) {
    // Listen for messages from background SW
    // Dispatch to action handlers
    // Use ctx for lifecycle (ctx.isValid, ctx.setTimeout, etc.)
  },
});
```

### Action Handlers

Each action is a module in `utils/actions/`. Receives typed params, returns typed result. Runs in ISOLATED world.

**Read actions:**

| Action | Implementation |
|---|---|
| `text` | `document.querySelector(selector).innerText` |
| `elements` | Walk interactive elements, generate stable selectors, extract labels/types/values |
| `elements --form` | Filter to form fields, include `{label, type, currentValue, options, required, pattern, name}` |
| `outline` | Extract landmarks (`<main>`, `<nav>`, `<header>`) + heading hierarchy |
| `dom` | Recursive DOM walk at controlled depth, simplified output |
| `images` | Visible `<img>` elements with src/alt/dimensions, filter by visibility |

**Scroll:**

| Action | Implementation |
|---|---|
| `scroll` | `window.scrollBy({ top: distance, behavior: 'smooth' })` + DOM polling for stability (element count stable for 2 intervals at 200ms) |

**Write actions:**

| Action | Implementation |
|---|---|
| `fill` | Focus → native value setter → `InputEvent('beforeinput', {inputType: 'insertFromPaste'})` → `InputEvent('input', {inputType: 'insertFromPaste'})` → `Event('change')` |
| `fill-form` | Iterate fields with inter-field delay. Hidden-field guard (never write to invisible/honeypot fields). Read-back verify after fill. |
| `select` | Click trigger → poll for menu appearance → find option by text → click option |

**Screenshot:**

| Action | Implementation |
|---|---|
| `screenshot` | Handled in background SW via `chrome.tabs.captureVisibleTab`. `--debugger` variant uses `chrome.debugger` → `Page.captureScreenshot`. |

### Actionability Check

Before any write action, verify the target element is:
- Visible (`display` not `none`, `visibility` not `hidden`, not `aria-hidden`)
- Has non-zero dimensions
- Not off-screen
- Not covered by another element (optional, expensive)

Reject silently if honeypot-shaped. Return structured error if genuinely not found.

### DOM Polling for Stability

Used by `scroll --until-stable` and `wait`:

```typescript
function pollUntilStable(selector: string, opts: { interval: number; stableCount: number; timeout: number }): Promise<{ stable: boolean; count: number }> {
  // setInterval at opts.interval (default 200ms)
  // Count elements matching selector
  // If count unchanged for opts.stableCount consecutive checks → resolve stable
  // If timeout reached → resolve with stable: false
}
```

No MutationObserver. No installed listeners. Poll runs, resolves, disappears.

### Context Invalidation

WXT's `ContentScriptContext` tracks whether the extension was updated/disabled. All async operations use `ctx.setTimeout`, `ctx.setInterval` to auto-cancel on invalidation. Message listeners check `ctx.isValid` before responding.

WXT ref: [Content Scripts — Context](https://wxt.dev/guide/essentials/content-scripts.md)

## Pairing (No Options Page)

The extension does not expose manual token UI. Bootstrap happens via CLI-mediated pairing.

### External message contract

Background SW accepts one external message type:

```ts
{
  type: 'pair.bootstrap',
  payload: {
    extensionToken: string,
    wsUrl: string,
    protocolVersion: 1,
    issuedAt: number,
    expiresAt: number,
    nonce: string
  }
}
```

Validation rules:
- `sender.id` must match trusted companion extension/app id configured at build time.
- `expiresAt` must be in the future.
- `nonce` must be unseen in local replay cache (one-time accept).
- `wsUrl` host must be loopback (`127.0.0.1` or `localhost`).

On success:
1. Store `extensionToken` (and optional `wsUrl`) in `storage.local`.
2. Trigger immediate WS reconnect.
3. Return `{ ok: true }`.

On failure: return `{ ok: false, code: 'PAIR_REJECTED', reason: ... }` and keep current token unchanged.

## Optional: chrome.debugger

Lazy-attached only when:
- `--trusted` flag is used (produces `isTrusted === true` events)
- `--debugger` screenshot requested (`Page.captureScreenshot` for full-page)

Attachment shows yellow "debugging" banner. Acceptable as user-opted-in escalation.

Not attached by default. Not attached on extension load. Only on explicit command.

## Observability

The extension has no persistent log file — the SW console is ephemeral and lost on restart. Instead, the extension maintains a **ring buffer** in `chrome.storage.session`.

### Ring Buffer

```typescript
// utils/storage.ts
export const traceBuffer = storage.defineItem<TraceEntry[]>('session:trace', { defaultValue: [] });

interface TraceEntry {
  id: string;
  action: string;
  tab: number;
  timestamp: number;
  elapsed: number;
  result: 'ok' | 'error';
  errorCode?: string;
  replay: boolean;
}
```

- **Capacity:** 50 entries (circular — oldest evicted on overflow).
- **Written:** after every request completes (success or error).
- **Survives:** SW restart (stored in `chrome.storage.session`, which persists until browser closes).
- **Lost on:** browser restart (session storage is cleared). Acceptable — the daemon log has the durable record.

### Queryable via CLI

```bash
bproxy debug log              # last 50 entries from extension ring buffer
bproxy debug log --id 01HZX…  # single request trace
```

The `debug.log` action is handled by the background SW — reads from `traceBuffer` and returns as JSON.

### Console Logging (dev mode)

In `wxt dev`, the background SW logs to the SW console with structured format:

```typescript
console.log(`[bproxy] ${action} id=${id} tab=${tabId}`, params);
// ... after execution:
console.log(`[bproxy] ${action} id=${id} ${ok ? 'ok' : 'ERR:' + errorCode} ${elapsed}ms`);
```

This is visible in `chrome://extensions` → service worker → "Inspect". Useful during development, not relied upon for production debugging (use ring buffer + daemon log instead).

### Badge as Status Indicator

The extension icon badge reflects connection state:

```typescript
// In background SW, after WS state changes:
function updateBadge(state: 'connected' | 'disconnected' | 'paused') {
  const config = {
    connected:    { text: '', color: '#22c55e' },      // green (no text, just color)
    disconnected: { text: '!', color: '#ef4444' },     // red
    paused:       { text: '❙❙', color: '#f59e0b' },    // yellow
  }[state];
  chrome.action.setBadgeText({ text: config.text });
  chrome.action.setBadgeBackgroundColor({ color: config.color });
}
```

At a glance: no badge = healthy. Red "!" = daemon disconnected. Yellow "❙❙" = HUMAN_REQUIRED, agent waiting.

## Testing

### Unit Tests

Vitest + WXT's `fakeBrowser`:
- Background SW dispatch logic
- Dedupe table (dedup, eviction, TTL)
- Session pin resolution
- Individual action handlers (with mocked DOM for content script actions)

WXT ref: [Unit Testing](https://wxt.dev/guide/essentials/unit-testing.md)

### E2E Tests

Playwright loads `.output/chrome-mv3/`. Full path: CLI → daemon → extension → real page.

WXT ref: [E2E Testing](https://wxt.dev/guide/essentials/e2e-testing.md)

## Development

```bash
cd extension
pnpm dev        # opens Chrome with extension, HMR on save
pnpm build      # production build → .output/chrome-mv3/
pnpm test       # vitest unit tests
```
