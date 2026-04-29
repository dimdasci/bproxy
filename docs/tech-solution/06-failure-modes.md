# 6. Failure Modes

[← Index](./README.md) · Prev: [Page State Detection](./05-page-state.md) · Next: [Timeouts →](./07-timeouts.md)

---

## Extension not connected

Trigger: browser closed, extension disabled, or page on `chrome://` URL.

Proxy detects: no WebSocket client in the connection slot.

Behavior: the proxy **holds the command** and waits for an extension to connect (up to the command's timeout). If the MV3 service worker was simply asleep, it will wake up and reconnect within ~200–600ms, and the command proceeds transparently. If no connection is established before timeout → `NO_CONNECTION`, `retry: true`, hint to open browser.

See [Proxy Service → Why queue instead of fail-fast](./03-proxy-service.md#why-queue-instead-of-fail-fast) for the rationale.

## Service worker termination

Trigger: Chrome terminates the MV3 background service worker after ~30s of inactivity.

Impact: WebSocket connection to proxy drops. The proxy enters a "no client" state.

Recovery: when the next command arrives at the proxy, the proxy holds it (see above). Meanwhile, the CLI's HTTP request or the content script's `chrome.runtime.sendMessage` wakes the service worker. The SW reconnects to the proxy via WebSocket. The proxy sees the new connection, drains any held commands, and processing continues.

Key timing: SW wakeup (~50–500ms) + WS handshake (~10–50ms) = ~200–600ms total. Well within the 30s command timeout.

## Content script not injected

Trigger: new tab opened via bookmark, or navigation to a new origin before content script auto-injects.

Background detects: `chrome.tabs.sendMessage` returns error.

Recovery sequence:
1. Background calls `chrome.scripting.executeScript` to inject `content.js`.
2. Background **waits for a ready acknowledgment**: the content script sends `chrome.runtime.sendMessage({ type: 'bproxy-ready' })` on load.
3. Background retries the original command via `sendMessage`.
4. If second attempt fails → `TAB_NOT_AVAILABLE`.

The ready-ack eliminates a race condition: without it, the retry `sendMessage` can fire before the freshly injected content script has registered its `onMessage` listener, causing a silent failure.

## Page navigation during command

Trigger: agent sends `type`, but a redirect or SPA navigation fires mid-execution.

Content script: dies silently (for cross-origin nav) or stays alive (SPA).

Background: if the message callback never fires, the proxy-side timer (30s) expires → `EXTENSION_TIMEOUT`, `retry: true`.

## Selector on wrong page

Trigger: agent clicks `#login-btn` but the page already navigated to the dashboard.

Content script: `SELECTOR_NOT_FOUND`, `retry: false`.

The `hint` includes the current page URL and title so the agent can realize it's on the wrong page:

```json
{
  "ok": false,
  "error": "SELECTOR_NOT_FOUND",
  "message": "No element matches '#login-btn'",
  "retry": false,
  "hint": "Current page: https://app.example.com/dashboard — 'Dashboard'"
}
```

## Proxy not running

Trigger: agent calls CLI but service isn't started.

CLI detects: HTTP connection refused.

Response: `PROXY_NOT_RUNNING`, `retry: true`, hint to run `bproxy start` or `node service/index.js`.
