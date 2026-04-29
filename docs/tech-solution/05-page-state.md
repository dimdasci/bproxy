# 5. Page State Detection & SPA Handling

[← Index](./README.md) · Prev: [Extension Internals](./04-extension.md) · Next: [Failure Modes →](./06-failure-modes.md)

---

The content script maintains a continuous awareness of the page's readiness. This powers the `page` context block on every response (see [Output Contract](./01-output-contract.md)) and the `wait` command (see [CLI Design](./02-cli-design.md)).

## State machine

The content script tracks page state as one of three values:

```
loading ───▶ settling ───▶ ready
   ▲                        │
   └────────────────────────┘  (on SPA navigation or major DOM change)
```

- **`loading`**: `document.readyState` is not `"complete"`. Only occurs on initial full-page load.
- **`settling`**: Document is loaded but DOM mutations are still occurring. The page is hydrating, fetching data, or rendering dynamic content.
- **`ready`**: No DOM mutations for 500ms and no busy signals detected.

Transitions:
- `loading` → `settling`: `document.readyState` becomes `"complete"`.
- `settling` → `ready`: MutationObserver reports no changes for 500ms AND no busy indicators detected.
- `ready` → `settling`: New DOM mutations detected (SPA navigation, dynamic content load, user action triggered re-render).

## Settle detection (MutationObserver)

The content script starts a `MutationObserver` on `document.body` at injection time:

```js
let lastMutationTime = Date.now();
let state = document.readyState === 'complete' ? 'settling' : 'loading';

const observer = new MutationObserver((mutations) => {
  lastMutationTime = Date.now();
  if (state === 'ready') state = 'settling';
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
  // NOTE: `attributes` is intentionally excluded. Attribute changes from CSS
  // animations, transition states, and framework-managed classes (React, Angular)
  // generate constant noise that prevents pages from ever reaching "ready".
  // Meaningful content changes almost always involve childList or characterData.
});

// Periodic check: if no mutations for 500ms → ready
setInterval(() => {
  if (state === 'settling' && Date.now() - lastMutationTime > 500) {
    if (!detectBusyIndicators()) {
      state = 'ready';
    }
  }
}, 100);

// Listen for document readyState change
if (state === 'loading') {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') state = 'settling';
  });
}
```

This is lightweight — the observer callback just timestamps, no heavy processing per mutation.

## Busy indicator detection

The `busy` flag is `true` when common loading patterns are detected on the page:

```js
function detectBusyIndicators() {
  // ARIA standard — the most reliable signal
  if (document.querySelector('[aria-busy="true"]')) return true;

  // Targeted loading patterns (visibility-checked to avoid false positives)
  const busySelectors = [
    '.spinner',
    '.loader',
    '[class*="skeleton"]',
    '[class*="shimmer"]',
    '.progress-bar:not([aria-valuenow="100"])',
  ];

  for (const sel of busySelectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el) && isSizedLikeIndicator(el)) return true;
  }

  return false;
}

function isSizedLikeIndicator(el) {
  const rect = el.getBoundingClientRect();
  // Loading indicators are typically small overlays, not full content regions.
  // Skip elements larger than 600x600 — likely content, not a spinner.
  return rect.width <= 600 && rect.height <= 600;
}
```

Deliberate omissions vs. the naive approach:
- **No `[class*="loading"]` or `[class*="spinner"]`** — substring matching on class names produces false positives on pages about loading (documentation), shipping (loading dock), etc.
- **No `.loading` class match** — too generic, commonly used for styling states unrelated to async loading.
- **Size check** — a real spinner is small (icon-sized). A `div.skeleton` that's 1200×800px is likely a page layout element, not a loading indicator.

This is intentionally conservative. The agent can always fall back to `wait --selector` or `wait --hidden` for app-specific loading states. False negatives (missing a spinner) are much better than false positives (reporting "busy" on a fully loaded page).

## Network idle detection

Used by `wait --network`. Uses `chrome.scripting.executeScript` with `world: 'MAIN'` to intercept `fetch` and `XMLHttpRequest` in the page's actual context:

```js
// Executed via chrome.scripting.executeScript({ world: 'MAIN' }) from background.js
(function() {
  if (window.__bproxyNetworkPatched) return; // idempotent
  window.__bproxyNetworkPatched = true;

  let pendingRequests = 0;

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    pendingRequests++;
    return origFetch.apply(this, args).finally(() => {
      pendingRequests--;
      notify();
    });
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    pendingRequests++;
    this.addEventListener('loadend', () => {
      pendingRequests--;
      notify();
    }, { once: true });
    return origXHRSend.apply(this, args);
  };

  function notify() {
    document.dispatchEvent(new CustomEvent('bproxy-network', {
      detail: { pending: pendingRequests }
    }));
  }
})();
```

The content script listens for `bproxy-network` events. Network is "idle" when `pending === 0` for 500ms.

**Why `chrome.scripting.executeScript` instead of `<script>` tag injection**: Same reason as `eval` — page CSP can block inline scripts. `chrome.scripting.executeScript({ world: 'MAIN' })` bypasses CSP entirely. See [Extension Internals → eval](./04-extension.md#eval-in-the-main-world) for details.

This interception is **only injected when `wait --network` is first called** — not on every page load. The `__bproxyNetworkPatched` guard makes it idempotent if called multiple times.

## SPA navigation detection

The content script detects client-side navigations by monitoring URL changes:

```js
let lastUrl = location.href;

const urlCheck = setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    state = 'settling';  // SPA navigated → new content incoming
    lastMutationTime = Date.now();
  }
}, 200);
```

Also listens for `popstate` (back/forward navigation) and `hashchange`:

```js
window.addEventListener('popstate', () => {
  state = 'settling';
  lastMutationTime = Date.now();
});
```

This means after an agent clicks a SPA link:
1. The `click` response comes back with `page.state: "settling"` and the new URL.
2. The agent sees the URL changed and state is settling.
3. The agent calls `bproxy wait` to let the page finish rendering.
4. Then reads the new content.

## Navigate command

`navigate` always uses `chrome.tabs.update(tabId, { url })` regardless of whether the target URL is same-origin or cross-origin. This triggers a full page navigation, the content script re-injects, and the result is predictable.

**Why not SPA-aware navigation**: An earlier design attempted to detect same-origin URLs and use `history.pushState` or `location.href` to avoid a full reload. This was removed because:
- `history.pushState()` changes the URL bar but **does not trigger the app's router**. React Router, Vue Router, etc. listen for `popstate` (back/forward) but not `pushState` calls. The URL changes but the page content stays the same.
- `location.href = sameOriginUrl` triggers a full reload anyway, so there's no SPA benefit.
- The only reliable way to trigger SPA-internal navigation is to click actual links on the page (`bproxy click "a[href='/dashboard']"`) — which is what agents should do when they want to navigate within a SPA.

### Two-tier wait

`navigate` uses a two-tier wait strategy:

1. **Hard wait**: `chrome.tabs.onUpdated` with `status: 'complete'` (document loaded). This must succeed or it's a `NAVIGATION_FAILED` error.
2. **Soft wait**: After load, wait for DOM settle (no mutations for 500ms) **with a 3-second cap**. If settle doesn't happen within 3s, return anyway with `state: "settling"`.

The soft cap prevents `navigate` from timing out on pages that never settle (animated pages, live dashboards, chat apps). The agent gets the page back in a usable state and can decide whether to `bproxy wait` for more specific conditions.

Response includes timing:

```json
{
  "ok": true,
  "data": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "waited": 2340 },
  "page": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "state": "ready", "busy": false }
}
```
