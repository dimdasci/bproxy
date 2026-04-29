# 4. Extension Internals

[← Index](./README.md) · Prev: [Proxy Service](./03-proxy-service.md) · Next: [Page State Detection →](./05-page-state.md)

---

## Background service worker (`background.js`)

Responsibilities:
- Open and maintain WebSocket to `ws://localhost:9615/ws`.
- Reconnect on disconnect with exponential backoff (1s, 2s, 4s, … max 30s).
- Route incoming commands to the correct handler.
- Commands handled directly in background: `screenshot`, `tabs`, `tab`, `status`, `navigate`.
- Commands forwarded to content script: `click`, `type`, `text`, `images`, `elements`, `outline`, `dom`, `wait`, `eval`.

### Navigate flow

`navigate` uses `chrome.tabs.update(tabId, { url })` + waits for `chrome.tabs.onUpdated` with `status: 'complete'`. This is more reliable than telling the content script to set `window.location` (which kills the content script).

### Screenshot flow

`chrome.tabs.captureVisibleTab(null, { format: 'png' })` → returns base64 data URL → strip prefix → send back.

### Content script communication

`chrome.tabs.sendMessage(tabId, command)` → content script processes → responds via `sendResponse`. If content script is not injected (new tab, navigated away), use `chrome.scripting.executeScript` to inject on demand, then retry.

## Content script (`content.js`)

Listens for messages from the background worker via `chrome.runtime.onMessage`.

Each action is a function:

| Action     | Implementation                                                                 |
|------------|--------------------------------------------------------------------------------|
| `click`    | `querySelector(sel)` → check visibility → `.click()`. Fail if 0 or >1 match. |
| `type`     | `querySelector(sel)` → `.focus()` → clear → dispatch `input` events per char. |
| `text`     | `querySelector(sel)` → `.innerText`. Default selector: `body`.                |
| `images`   | Scan for `img` tags → filter visible → return src, alt, dimensions.           |
| `elements` | Scan for interactive tags → filter visible → generate selectors → return list.|
| `outline`  | Collect semantic landmarks + ARIA roles + headings → build region list.       |
| `dom`      | Walk subtree from selector to depth N → return pruned tree with metadata.     |
| `wait`     | Block using strategy (settle/network/selector/hidden) until condition met.     |
| `eval`     | Inject `<script>` into page main world, collect result via custom event.       |

### Selector matching

`querySelector` is used, not `querySelectorAll`. If the selector matches nothing → `SELECTOR_NOT_FOUND`. For `click`, if multiple matches are possible and intent is ambiguous, the agent should use `elements` first to discover the right selector.

### `eval` in the main world

Content scripts run in an isolated world. To execute arbitrary JS in the page's actual context (access page variables, call page functions), inject a `<script>` element:

```js
function evalInPage(code) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const script = document.createElement('script');
    script.textContent = `
      try {
        const result = (function() { ${code} })();
        document.dispatchEvent(new CustomEvent('bproxy-eval', {
          detail: { id: '${id}', result: JSON.stringify(result) }
        }));
      } catch(e) {
        document.dispatchEvent(new CustomEvent('bproxy-eval', {
          detail: { id: '${id}', error: e.message }
        }));
      }
    `;
    document.addEventListener('bproxy-eval', function handler(e) {
      if (e.detail.id === id) {
        document.removeEventListener('bproxy-eval', handler);
        resolve(e.detail);
      }
    });
    document.documentElement.appendChild(script);
    script.remove();
  });
}
```

## Manifest

```json
{
  "manifest_version": 3,
  "name": "bproxy",
  "version": "0.1.0",
  "description": "Browser control for coding agents",
  "permissions": [
    "activeTab",
    "tabs",
    "scripting"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }]
}
```
