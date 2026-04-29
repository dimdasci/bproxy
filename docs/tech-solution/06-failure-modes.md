# 6. Failure Modes

[← Index](./README.md) · Prev: [Page State Detection](./05-page-state.md) · Next: [Timeouts →](./07-timeouts.md)

---

## Extension not connected

Trigger: browser closed, extension disabled, or page on `chrome://` URL.

Proxy detects: no WebSocket client in the connection slot.

Response: `NO_CONNECTION`, `retry: true`, hint to open browser.

## Content script not injected

Trigger: new tab opened via bookmark, or navigation to a new origin before content script auto-injects.

Background detects: `chrome.tabs.sendMessage` returns error.

Recovery: background calls `chrome.scripting.executeScript` to inject `content.js`, then retries the command once. If second attempt fails → `TAB_NOT_AVAILABLE`.

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
