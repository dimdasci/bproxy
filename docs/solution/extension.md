---
title: Browser Extension
---

Implementation spec for the Chrome Manifest V3 extension. Built with [WXT](https://wxt.dev).

**Decisions that constrain this:** [ADR-001](../decisions.md#adr-001-default-instrumentation-strategy--read-mode) (read mode), [ADR-002](../decisions.md#adr-002-extension-framework--wxt) (WXT), [ADR-006](../decisions.md#adr-006-dom-polling-over-mutationobserver) (jittered polling), [ADR-007](../decisions.md#adr-007-three-method-write-contract) (three methods), [ADR-013](../decisions.md#adr-013-main-world-runtime-api-writes) (MAIN world on-demand), [ADR-014](../decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting) (shadow-DOM targeting), [ADR-015](../decisions.md#adr-015-main-world-hygiene-contract) (hygiene), [ADR-016](../decisions.md#adr-016-web_accessible_resources-default-deny) (WAR default-deny).

---

## Project Layout

```
extension/
├── package.json              # devDeps: wxt, typescript, vitest
├── wxt.config.ts             # manifest overrides, host_permissions, no content_scripts, no WAR
├── tsconfig.json
├── entrypoints/
│   ├── background.ts         # service worker
│   ├── content.ts            # isolated world, registration: 'runtime'
│   └── popup.html            # popup UI for pairing code entry
├── utils/
│   ├── ws-client.ts          # WebSocket connection + reconnect logic
│   ├── storage.ts            # typed storage items (session pins, token, domain config)
│   ├── discovery.ts          # shadow-DOM-aware element discovery (intent-scoped)
│   ├── targeting.ts          # route resolution beyond plain selectors
│   └── actions/              # per-action handler modules
│       ├── navigate.ts
│       ├── text.ts
│       ├── elements.ts
│       ├── fill.ts
│       ├── fill-form.ts
│       ├── scroll.ts
│       ├── screenshot.ts
│       └── ...
└── tests/                    # unit tests (vitest + fakeBrowser)
    ├── background.test.ts
    ├── discovery.test.ts
    └── actions/
```

Output: `extension/.output/chrome-mv3/` — loaded into Chrome, pointed at by E2E tests.

---

## WXT Configuration

```typescript
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'bproxy',
    permissions: ['tabs', 'scripting', 'webNavigation', 'alarms', 'storage', 'debugger'],
    host_permissions: ['<all_urls>'],
    // No web_accessible_resources — default deny per ADR-016
    // No declarative content_scripts — programmatic injection only per ADR-001
    action: {
      default_popup: 'popup.html',
    },
  },
});
```

WXT refs: [Manifest config](https://wxt.dev/guide/essentials/config/guide/essentials/config/manifest.md), [Browser Startup](https://wxt.dev/guide/essentials/config/guide/essentials/config/browser-startup.md), [Content Scripts](https://wxt.dev/guide/essentials/content-scripts.md), [Scripting](https://wxt.dev/guide/essentials/scripting.md)

---

## Background Service Worker

**File:** `entrypoints/background.ts`

WXT ref: [Entrypoints](https://wxt.dev/guide/essentials/entrypoints.md)

### Responsibilities

1. **WebSocket client** — persistent connection to `ws://127.0.0.1:{port}/ws`. Reconnects on drop. Authenticates via `Sec-WebSocket-Protocol` with `bproxy.v1, auth.{base64url(token)}`.
2. **Popup message handler** — receives `pair.complete` from popup after successful token storage.
3. **Request dispatch** — receives protocol messages from daemon, routes to appropriate handler (tab-level actions → content script, extension-level actions → direct API calls).
4. **Dedupe table** — `chrome.storage.session` map of `{id → result}`. Prevents re-execution on replay-after-reconnect. Bounded size, TTL-based eviction.
5. **Session/tab pin map** — `chrome.storage.session` keyed by session name → tab ID. Sticky targeting.
6. **Frame table** — populated from `chrome.webNavigation.onCompleted` / `onHistoryStateUpdated`. SPA detection and frame targeting.
7. **Keepalive** — `chrome.alarms` every 30s + app-level WS ping every 20s.
8. **Content script injection** — on first command targeting a tab, inject `content.ts` via `browser.scripting.executeScript`. Track injected tabs to avoid re-injection.
9. **Content script execution** — on-demand `chrome.scripting.executeScript` for MAIN-world calls (only for `runtime-api` method).
10. **Interstitial detection** — after `navigate`, check against known patterns. Emit `HUMAN_REQUIRED`.

### SW Lifecycle

```
SW starts → read token from storage (if present)
         → if token exists: open WS with (`bproxy.v1`, `auth.{base64url(token)}`)
         → register chrome.alarms keepalive
         → register chrome.webNavigation listeners (frame table)

On popup 'pair.complete' message
         → validate token shape + wsUrl loopback + expiresAt future
         → trigger immediate WS reconnect
         → ack popup with `{ ok: true }`

On WS message → parse → check dedupe table
             → if duplicate: return cached result
             → if new: resolve target tab → inject content script if needed
                     → dispatch to handler → store result in dedupe → send response

On `fill` with method='runtime-api'
             → execute MAIN-world helper via chrome.scripting.executeScript
             → world: 'MAIN', one-shot, no persistent scripts

On WS close → exponential backoff reconnect (1s, 2s, 4s, max 30s)

On SW suspend → WS closes naturally → alarms fire → SW revives → reconnect
```

### Storage Schema

Using WXT's typed storage (`wxt/utils/storage`):

```typescript
// utils/storage.ts
import { storage } from 'wxt/utils/storage';

export const tokenItem = storage.defineItem<string>('local:token');
export const wsUrlItem = storage.defineItem<string>('local:wsUrl');
export const sessionPins = storage.defineItem<Record<string, number>>('session:pins', { defaultValue: {} });
export const dedupeTable = storage.defineItem<Record<string, { result: unknown; ts: number }>>('session:dedupe', { defaultValue: {} });
export const injectedTabs = storage.defineItem<number[]>('session:injectedTabs', { defaultValue: [] });
```

WXT ref: [Storage](https://wxt.dev/guide/essentials/storage.md)

---

## Popup Entrypoint

**File:** `entrypoints/popup.html` + companion JS/TS

Simple pairing code entry form. No options page per ADR-011.

```typescript
// Popup flow
async function onSubmit(pairingCode: string) {
  // 1. Call daemon POST /pair/claim
  const res = await fetch('http://127.0.0.1:9615/pair/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pairingCode }),
  });
  
  if (!res.ok) {
    showError(await res.json());
    return;
  }
  
  const payload = await res.json();
  
  // 2. Validate payload shape
  if (!payload.extensionToken || !payload.wsUrl) {
    showError({ code: 'PAIR_REJECTED', reason: 'invalid_payload' });
    return;
  }
  
  // 3. Store in chrome.storage.local
  await chrome.storage.local.set({
    token: payload.extensionToken,
    wsUrl: payload.wsUrl,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  });
  
  // 4. Notify background SW
  await chrome.runtime.sendMessage({ type: 'pair.complete' });
  
  // 5. Show success, close popup
  showSuccess();
  setTimeout(() => window.close(), 1000);
}
```

Popup validation:
- `wsUrl` host must be loopback (`127.0.0.1` or `localhost`)
- `expiresAt` must be in the future
- `nonce` is stored but not validated here (background validates on first use)

---

## Content Script (ISOLATED World)

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
    // ISOLATED world only — no MAIN world code here
  },
});
```

---

## Action Handlers

Each action is a module in `utils/actions/`. Receives typed params, returns typed result. Runs in ISOLATED world for reads and `direct`/`paste` writes.

### Read actions

| Action | Implementation |
|---|---|
| `text` | `document.querySelector(selector).innerText` |
| `elements` | Walk interactive elements with shadow-DOM awareness, generate stable selectors, extract labels/types/values |
| `elements --form` | Filter to form fields, shadow-aware targeting |
| `outline` | Extract landmarks + heading hierarchy |
| `dom` | Recursive DOM walk at controlled depth, shadow-aware, simplified output |
| `images` | Visible `<img>` elements, shadow-aware traversal |

### Scroll

| Action | Implementation |
|---|---|
| `scroll` | `window.scrollBy({ top: distance, behavior: 'smooth' })` + **jittered** DOM polling for stability. Bails on `document.hidden` unless explicitly user-initiated [ADR-006](../decisions.md#adr-006-dom-polling-over-mutationobserver). |

### Write actions (ISOLATED world)

| Action | Implementation |
|---|---|
| `fill` (method: `direct`) | Native setter: `el.value = v` / `el.textContent = v`. No events dispatched. |
| `fill` (method: `paste`) | Native setter + `InputEvent('beforeinput', {inputType: 'insertFromPaste'})` + `InputEvent('input', {inputType: 'insertFromPaste'})` + `Event('change')`. ISOLATED world. |
| `fill-form` | Iterate fields with inter-field pacing. Hidden-field guard. Read-back verify. |
| `select` | Click trigger → poll for menu → find option → click. |

### Write actions (MAIN world, on-demand)

| Action | Implementation |
|---|---|
| `fill` (method: `runtime-api`) | One-shot `chrome.scripting.executeScript({ world: 'MAIN', func: ... })`. Target has `route` selecting editor handle in page scope. See MAIN-World Hygiene section. |

### Screenshot

| Action | Implementation |
|---|---|
| `screenshot` | Handled in background SW via `chrome.tabs.captureVisibleTab`. `--debugger` variant uses `chrome.debugger` → `Page.captureScreenshot`. |

---

## Write Model

Three explicit methods per [ADR-007](../decisions.md#adr-007-three-method-write-contract). No `auto`. No extension-side escalation.

### Method: `direct`

For plain HTML forms, bare `[contenteditable]` where DOM state is authority.

```typescript
// ISOLATED world
const el = document.querySelector(selector);
if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
  el.value = value;
} else if (el.isContentEditable) {
  el.textContent = value;
}
// No events dispatched
```

### Method: `paste`

For React/Vue/Angular controlled inputs that submit via framework state.

```typescript
// ISOLATED world
const el = document.querySelector(selector);
el.focus();

// Native setter via prototype
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)?.set;
nativeSetter?.call(el, value);

// Paste-flavored events (no fake keydown/keyup chain)
el.dispatchEvent(new InputEvent('beforeinput', {
  inputType: 'insertFromPaste',
  data: value,
  bubbles: true,
}));
el.dispatchEvent(new InputEvent('input', {
  inputType: 'insertFromPaste',
  data: value,
  bubbles: true,
}));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### Method: `runtime-api`

For page-owned editor instances (Quill, Lexical, ProseMirror, etc.). Requires MAIN world.

```typescript
// Called via chrome.scripting.executeScript({ world: 'MAIN', ... })
// func is defined inline at call site to avoid identifying literals

// Target has route indicating editor handle location
// Example route: root.querySelector('#editor').__quill

function mainWorldInjected(route: string, value: string) {
  try {
    // Resolve editor handle from route
    const editor = resolveRoute(route);
    if (!editor || typeof editor.setText !== 'function') {
      return { ok: false, error: 'EDITOR_NOT_FOUND' };
    }
    
    editor.setText(value, 'api');
    const verified = editor.getText();
    
    return { ok: true, verified };
  } catch (e) {
    // Error normalized, no stack leak
    return { ok: false, error: 'RUNTIME_ERROR' };
  }
}
```

See MAIN-World Hygiene section for route resolution and error handling.

---

## MAIN-World Hygiene

Per [ADR-015](../decisions.md#adr-015-main-world-hygiene-contract). Every MAIN-world execution follows:

### 1. No identifying literals

Injected function contains no `"chrome-extension"`, extension ID, or library names.

```typescript
// BAD: contains identifying strings
const func = () => {
  console.log('bproxy: injecting...');  // LEAK
};

// GOOD: string-free or generic
const func = () => {
  const t = (w: any, r: string) => { /* ... */ };
  return t(window, route);
};
```

### 2. Catch and normalize errors inside function

```typescript
const injected = (route: string, value: string) => {
  try {
    // ... resolve and write ...
    return { s: true, v: verified };  // s = success, v = value
  } catch (e) {
    // Return normalized error, no throw
    return { s: false, c: 'E' };  // c = error code
  }
};
```

### 3. Prevent chrome-extension URL leaks

- Errors caught before crossing world boundary
- No `Error` objects returned to ISOLATED world (strings only)
- If page has `Error.prepareStackTrace` hook, our function returns before any throw

### 4. One-shot execution

```typescript
// Background SW
await browser.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  func: injected,
  args: [route, value],
});
```

No persistent scripts. No listeners installed. World is fresh per call.

---

## Shadow-DOM Discovery

Per [ADR-014](../decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting). Targeting supports element routes encoding shadow-host chains.

### Route representation

```typescript
interface ElementRoute {
  // Chain of shadow hosts leading to the target
  hosts: Array<{ selector: string; index?: number }>;
  // Final selector within the deepest shadow root (or document if no hosts)
  target: string;
}

// Example: modal inside #interop-outlet shadow root
{
  hosts: [{ selector: '#interop-outlet' }],
  target: '[contenteditable="true"]'
}

// Example: plain light-DOM (no shadow)
{
  hosts: [],
  target: 'input[name="email"]'
}
```

### Progressive intent-scoped traversal

```typescript
// utils/discovery.ts
export function findWithRoute(route: ElementRoute): Element | null {
  let root: Document | ShadowRoot = document;
  
  // Traverse shadow hosts
  for (const host of route.hosts) {
    const hostEl = root.querySelector(host.selector);
    if (!hostEl) return null;
    if (!hostEl.shadowRoot) return null;  // Closed shadow = out of scope
    root = hostEl.shadowRoot;
  }
  
  // Final query within shadow root
  return root.querySelector(route.target);
}

// Probing order (fastest to slowest)
export function progressiveDiscovery(intent: 'click' | 'fill', hint?: Point) {
  // 1. Active element chain
  const active = getActiveElementChain();
  
  // 2. Visible dialogs/popovers
  const dialogs = getVisibleDialogs();
  
  // 3. Hit-test around interaction point (center, cursor, target rect)
  if (hint) {
    const hit = document.elementsFromPoint(hint.x, hint.y);
    // Check for shadow hosts
  }
  
  // 4. Scoped subtree search (if candidate root identified)
  // 5. Runtime-handle probe (only within scoped root, not full-page)
}
```

### Closed shadow roots

Explicitly out of scope. Discovery returns `null` for these targets; agent must use alternative strategy (different selector, click-to-focus, or handoff).

### Runtime-handle probing (scoped)

```typescript
// Probe for __quill, __lexicalEditor, etc. — only within candidate root
function probeRuntimeHandlers(root: Element): EditorHandle | null {
  // Check known properties on root and immediate children
  // Return typed handle or null
}
```

Never full-page recursive scan. Always scoped to active modal/intent root [ADR-017](../decisions.md#adr-017-sensoractuator-boundary).

---

## DOM Polling for Stability

Used by `scroll --until-stable`, `wait`, and after destructive actions.

```typescript
function pollUntilStable(opts: {
  selector?: string;
  intervalMin: number;      // jitter min (e.g., 180ms)
  intervalMax: number;      // jitter max (e.g., 250ms)
  stableCount: number;      // consecutive stable checks required (default: 2)
  timeout: number;          // max total time (e.g., 5000ms)
  respectVisibility: boolean; // bail if tab hidden (default: true for destructive)
}): Promise<{ stable: boolean; count: number }> {
  // Jitter: random interval between min and max
  // Check document.visibilityState before destructive actions
  // Count elements matching selector; stable = unchanged for stableCount checks
}
```

- **Jittered intervals** — no fixed cadence [ADR-006](../decisions.md#adr-006-dom-polling-over-mutationobserver)
- **Visibility-aware** — bails on hidden tabs for destructive actions
- **Bounded** — resolves with `{stable: false}` on timeout

---

## Pairing (No Options Page)

Popup-driven claim per [ADR-011](../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing).

Flow:
1. `bproxy service start` generates pairing code
2. CLI prints code; user opens popup, enters code
3. Popup calls `POST /pair/claim`
4. On success: popup stores token, notifies SW, SW reconnects WS

Pairing bootstrap uses only popup claim (`POST /pair/claim`) and background `pair.complete` signaling.

---

## web_accessible_resources

Default deny per [ADR-016](../decisions.md#adr-016-web_accessible_resources-default-deny).

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    // Intentionally absent: web_accessible_resources
  },
});
```

No scanner-friendly resource enumeration. Any future WAR addition requires explicit ADR.

---

## Optional: chrome.debugger

Lazy-attached only when `--trusted` or `--debugger` flags used. Yellow banner acceptable as user-opted-in escalation.

---

## Observability

Ring buffer in `chrome.storage.session` with version stamps to eliminate stale-build confusion.

```typescript
interface TraceEntry {
  id: string;
  action: string;
  tab: number;
  timestamp: number;
  elapsed: number;
  result: 'ok' | 'error';
  errorCode?: string;
  replay: boolean;
  extensionVersion: string;  // NEW: for stale-build detection
}
```

---

## Testing

### Unit Tests

Vitest + WXT's `fakeBrowser`:
- Background SW dispatch logic
- Dedupe table (dedup, eviction, TTL)
- Session pin resolution
- Discovery module (shadow-DOM traversal)
- Individual action handlers

WXT ref: [Unit Testing](https://wxt.dev/guide/essentials/unit-testing.md)

### E2E Tests

Playwright loads `.output/chrome-mv3/`. Full path: CLI → daemon → extension → real page.

WXT ref: [E2E Testing](https://wxt.dev/guide/essentials/e2e-testing.md)

---

## Development

```bash
cd extension
pnpm dev        # opens Chrome with extension, HMR on save
pnpm build      # production build → .output/chrome-mv3/
pnpm test       # vitest unit tests
```
