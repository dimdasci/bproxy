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
  attributes: true,
  characterData: true
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
  // ARIA standard
  if (document.querySelector('[aria-busy="true"]')) return true;

  // Common loading patterns
  const busySelectors = [
    '.loading', '.spinner', '.loader',
    '[class*="skeleton"]', '[class*="shimmer"]',
    '[class*="loading"]', '[class*="spinner"]',
    '.progress-bar:not([aria-valuenow="100"])',
    'dialog[open] .loading', '.overlay.loading'
  ];

  for (const sel of busySelectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return true;
  }

  return false;
}
```

This is heuristic, not exhaustive. It catches the 80% case. The agent can always fall back to `wait --selector` for app-specific loading states.

## Network idle detection

Used by `wait --network`. Requires injecting into the page's main world (same technique as `eval`) to intercept `fetch` and `XMLHttpRequest`:

```js
// Injected into page main world
(function() {
  let pendingRequests = 0;

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    pendingRequests++;
    return origFetch.apply(this, args).finally(() => {
      pendingRequests--;
      notify();
    });
  };

  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(...args) {
    this._bproxy = true;
    return origXHROpen.apply(this, args);
  };
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

This interception is **only injected when `wait --network` is first called** — not on every page load. It patches globals, so it's opt-in to avoid interfering with page behavior.

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

## Navigate command — SPA-aware

The `navigate` command handles both cases:

- **Full page navigation** (different origin, or forced): `chrome.tabs.update(tabId, { url })` → wait for `tabs.onUpdated` status `complete` → then wait for settle (DOM mutations stop for 500ms). Returns when page is `ready`.
- **Same-origin SPA navigation**: If the target URL is same-origin as current, `navigate` uses `eval` to call `history.pushState` or set `location.href`, then waits for settle.

In both cases, `navigate` **returns only when the page is ready**, not just when the network load finishes. This is the key difference from a raw browser load event.

Response includes timing:

```json
{
  "ok": true,
  "data": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "waited": 2340 },
  "page": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "state": "ready", "busy": false }
}
```
