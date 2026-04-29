# 4. Extension Internals

[← Index](./README.md) · Prev: [Proxy Service](./03-proxy-service.md) · Next: [Page State Detection →](./05-page-state.md)

---

## Background service worker (`background.js`)

Responsibilities:
- Open and maintain WebSocket to `ws://localhost:9615/ws`.
- Reconnect on disconnect with exponential backoff (1s, 2s, 4s, … max 30s).
- Route incoming commands to the correct handler.
- Commands handled directly in background: `screenshot`, `tabs`, `tab`, `status`, `navigate`, `eval`.
- Commands forwarded to content script: `click`, `type`, `text`, `images`, `elements`, `outline`, `dom`, `wait`.

### MV3 service worker lifecycle

Chrome terminates MV3 service workers after ~30 seconds of inactivity. This kills the WebSocket connection. The proxy absorbs this by queuing commands until the extension reconnects (see [Proxy Service](./03-proxy-service.md)).

The background script should reconnect immediately on wakeup. Chrome wakes the SW on events like `chrome.runtime.onMessage` (from content scripts) or `chrome.alarms`. The WS `onclose` handler sets a flag so the next wakeup knows to reconnect before processing.

No keepalive hacks (offscreen documents, alarm loops) are used. The proxy-side queuing makes them unnecessary — if the SW is asleep, the proxy waits for it to wake up and reconnect.

### Navigate flow

`navigate` uses `chrome.tabs.update(tabId, { url })` + waits for `chrome.tabs.onUpdated` with `status: 'complete'`. This is more reliable than telling the content script to set `window.location` (which kills the content script).

### Screenshot flow

`chrome.tabs.captureVisibleTab(null, { format: 'png' })` → returns base64 data URL → strip prefix → send back.

**Tab focus requirement**: `captureVisibleTab` captures whatever is visible, not a specific tab. If the agent has pinned a target tab via `bproxy tab <id>` and that tab is in the background, the background script must first call `chrome.tabs.update(tabId, { active: true })` to bring it to the foreground, wait for the tab to be active, then capture. The response should note that the tab was focused.

### Content script communication

`chrome.tabs.sendMessage(tabId, command)` → content script processes → responds via `sendResponse`.

If `sendMessage` fails (content script not injected), the background uses this recovery sequence:

1. Inject `content.js` via `chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })`.
2. **Wait for a ready acknowledgment**: the content script sends `chrome.runtime.sendMessage({ type: 'bproxy-ready' })` on load. The background listens for this before proceeding.
3. Retry the original command via `sendMessage`.
4. If the second attempt fails → `TAB_NOT_AVAILABLE`.

The ready-ack eliminates the race condition where `sendMessage` fires before the content script has registered its `onMessage` listener. Without it, the retry silently fails because the message arrives at a script that isn't listening yet.

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

`eval` is **not** handled by the content script — it runs directly in the background via `chrome.scripting.executeScript`. See [eval in the main world](#eval-in-the-main-world) below.

### Selector matching

`querySelector` is used, not `querySelectorAll`. If the selector matches nothing → `SELECTOR_NOT_FOUND`. For `click`, if multiple matches are possible and intent is ambiguous, the agent should use `elements` first to discover the right selector.

### `eval` in the main world

Content scripts run in an isolated world. To execute arbitrary JS in the page's actual context (access page variables, call page functions), use the Chrome API:

```js
// In background.js — NOT in the content script
async function evalInPage(tabId, code) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code) => {
      try {
        const result = new Function(code)();
        return { result: JSON.stringify(result) };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [code]
  });
  return results[0].result;
}
```

**Why `chrome.scripting.executeScript` instead of `<script>` tag injection:**

- **CSP-proof**: Many modern sites (GitHub, banking sites, Google properties) set Content Security Policy headers that block inline `<script>` execution. `chrome.scripting.executeScript` with `world: 'MAIN'` bypasses page CSP entirely because it runs through the Chrome extension API, not through the page's script loading path.
- **Simpler**: No need for CustomEvent-based communication between injected script and content script. The result is returned directly to the background script.
- **Synchronous result**: Returns a promise that resolves with the execution result. No event listener cleanup.

Note: `eval` is handled by the **background script** directly (like `screenshot` and `navigate`), not forwarded to the content script. This is because `chrome.scripting.executeScript` is a background API.

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
