# bproxy — Technical Solution

Parent document: [architecture.md](./architecture.md)

This document covers implementation details: output contracts, error handling, component internals, failure modes, and build/test strategy.

---

## 1. Agent Output Contract

Every CLI command writes exactly one JSON object to stdout and exits. No extra text, no stderr mixing, no human formatting. Agents parse one line and move on.

### Success shape

```json
{
  "ok": true,
  "data": { ... }
}
```

`data` varies per action. Fields are kept minimal — no filler, no echo of the request.

### Error shape

```json
{
  "ok": false,
  "error": "SELECTOR_NOT_FOUND",
  "message": "No element matches '#submit-btn'",
  "retry": false
}
```

| Field     | Type    | Purpose                                          |
|-----------|---------|--------------------------------------------------|
| `ok`      | bool    | Single branch point for the agent                |
| `error`   | string  | Machine-readable error code (see §1.2)           |
| `message` | string  | One-line human/agent explanation                  |
| `retry`   | bool    | `true` = transient, try again. `false` = don't.  |
| `hint`    | string? | Optional. Actionable suggestion for the agent.   |

### 1.1 Token budget

Agent output is consumed by LLMs. Every extra token costs money and context window.

Rules:
- No redundant fields. Don't echo the command back.
- `text` action: return `{ "ok": true, "data": { "text": "..." } }` — not wrapped in metadata the agent didn't ask for.
- `screenshot` action: return `{ "ok": true, "data": { "image": "<base64>" } }` — just the payload.
- `elements` action: flat list, numbered, one line per element. No nesting, no full attribute dumps.
- Text content is truncated at 10,000 chars with a `"truncated": true` flag. The agent can use `eval` for full extraction if needed.

### 1.2 Error codes

Fixed vocabulary. Agents can `switch` on these.

| Code                   | Retry | Meaning                                              |
|------------------------|-------|------------------------------------------------------|
| `NO_CONNECTION`        | true  | Proxy can't reach the extension. Browser not open?   |
| `EXTENSION_TIMEOUT`    | true  | Extension didn't respond within the deadline.        |
| `TAB_NOT_AVAILABLE`    | true  | No active tab, or tab is a chrome:// page.           |
| `SELECTOR_NOT_FOUND`   | false | CSS selector matched zero elements.                  |
| `SELECTOR_AMBIGUOUS`   | false | CSS selector matched multiple elements (for click).  |
| `NAVIGATION_FAILED`    | false | URL couldn't be loaded (ERR_NAME_NOT_RESOLVED etc).  |
| `EVAL_ERROR`           | false | JS execution threw an exception.                     |
| `PROXY_NOT_RUNNING`    | true  | CLI couldn't connect to the proxy service.           |
| `INVALID_COMMAND`      | false | Unknown action or missing required params.           |

When `retry` is `true`, the `hint` field tells the agent what to check:

```json
{
  "ok": false,
  "error": "NO_CONNECTION",
  "message": "No browser extension connected",
  "retry": true,
  "hint": "Ensure the browser is open and the bproxy extension is loaded. Then retry."
}
```

When `retry` is `false`, the error is the agent's to fix (wrong selector, bad JS, etc).

### 1.3 Exit codes

- `0` — success (`ok: true`)
- `1` — command error (`ok: false`, infrastructure or action failure)
- `2` — CLI usage error (wrong args, printed before any JSON)

Exit code `2` is the only case where output is not JSON — it prints a usage line to stderr. This only happens if the agent calls `bproxy` with malformed syntax.

---

## 2. CLI Design

### 2.1 Commands

```
bproxy status                        # connection health check
bproxy navigate <url>                # go to URL, wait for load
bproxy click <selector>              # click element
bproxy type <selector> <text>        # clear field, type text
bproxy text [selector]               # read text (default: body)
bproxy elements                      # list interactive elements
bproxy screenshot                    # capture visible viewport
bproxy eval <code>                   # run JS in page context
bproxy tabs                          # list open tabs
bproxy tab <id>                      # switch target tab
```

### 2.2 `bproxy status`

Returns system health. Agent should call this first if unsure.

```json
{
  "ok": true,
  "data": {
    "proxy": true,
    "extension": true,
    "tab": { "id": 42, "url": "https://example.com", "title": "Example" }
  }
}
```

If extension is disconnected:

```json
{
  "ok": true,
  "data": {
    "proxy": true,
    "extension": false,
    "tab": null
  }
}
```

This is `ok: true` because the command itself succeeded — the proxy answered. The agent reads `extension: false` and knows to wait.

### 2.3 `bproxy elements`

Returns a flat numbered list of interactive elements visible on the page. This is the primary discovery mechanism for agents that don't know the DOM.

```json
{
  "ok": true,
  "data": {
    "elements": [
      { "index": 1, "tag": "a",      "text": "Sign In",       "selector": "#nav-signin" },
      { "index": 2, "tag": "input",  "text": "",              "selector": "input[name='email']", "placeholder": "Email address" },
      { "index": 3, "tag": "button", "text": "Subscribe",     "selector": ".subscribe-btn" },
      { "index": 4, "tag": "a",      "text": "Documentation", "selector": "a[href='/docs']" }
    ]
  }
}
```

Rules for element collection:
- Only visible, non-hidden elements.
- Tags: `a`, `button`, `input`, `select`, `textarea`, and any element with `role="button"` or `onclick`.
- `selector` is auto-generated: prefer `#id`, then `[name=...]`, then a positional CSS path. Must be unique on the page.
- `text` is trimmed, max 80 chars.
- Cap at 200 elements. If more, return `"truncated": true` and suggest the agent narrow scope with `bproxy elements <selector>` (scoped to a container).

### 2.4 `bproxy help`

```
bproxy — browser control for coding agents

Commands:
  status                 Check proxy and extension connection
  navigate <url>         Navigate to URL
  click <selector>       Click an element
  type <selector> <text> Type into an input field
  text [selector]        Extract text content (default: body)
  elements [selector]    List interactive elements
  screenshot             Capture visible viewport as base64 PNG
  eval <code>            Execute JavaScript in page context
  tabs                   List open tabs
  tab <id>               Switch active target tab

All commands return JSON to stdout.
Errors include an "error" code and "retry" boolean.
```

Printed to stdout, exit 0. Short enough that an agent can consume it in one shot.

### 2.5 Implementation

The CLI is a single executable Node.js script. It:

1. Parses `process.argv` into `action` + `params`.
2. Sends `POST http://localhost:<PORT>/command` with JSON body `{ id, action, params }`.
3. Prints the response JSON to stdout.
4. Exits with code 0 or 1.

Connection errors (proxy not running) are caught and formatted as JSON with `PROXY_NOT_RUNNING` error code, not as stack traces.

Timeout: the CLI sets a 30s HTTP timeout (60s for `navigate`). If exceeded, it prints `EXTENSION_TIMEOUT` error and exits 1.

---

## 3. Proxy Service Internals

### 3.1 Startup

```
node service/index.js [--port 9615]
```

Default port: `9615`. Binds to `127.0.0.1` only.

Logs to stderr (human-readable, not consumed by agents):
```
bproxy service listening on http://127.0.0.1:9615
```

### 3.2 HTTP endpoint

Single route: `POST /command`

- Accepts JSON body: `{ id, action, params }`.
- If no WebSocket client connected → respond immediately with HTTP 200 + `NO_CONNECTION` error JSON.
- Otherwise, forwards the message over WebSocket and waits.
- When WS response arrives (matched by `id`) → send as HTTP response.
- If WS response doesn't arrive within 30s → respond with `EXTENSION_TIMEOUT` error JSON.

Always HTTP 200. The `ok` field inside JSON is the real status. This keeps agent-side HTTP parsing trivial — no status code branching.

### 3.3 WebSocket server

- Runs on the same port, upgrade path `/ws`.
- Accepts exactly one connection at a time. If a second extension connects, the old connection is dropped (new one wins). This handles extension reloads gracefully.
- Ping/pong every 10s to detect dead connections.

### 3.4 Pending request map

```
Map<string, { resolve, reject, timer }>
```

Keyed by command `id`. When a WS message arrives, look up `id`, call `resolve`, clear the timer. Simple.

### 3.5 Request log

Every command is appended to an in-memory ring buffer (last 100 entries):

```json
{ "id": "...", "action": "click", "params": {...}, "at": "ISO", "ms": 142, "ok": true }
```

Exposed via `GET /log` for debugging. Not consumed by agents.

---

## 4. Extension Internals

### 4.1 Background service worker (`background.js`)

Responsibilities:
- Open and maintain WebSocket to `ws://localhost:9615/ws`.
- Reconnect on disconnect with exponential backoff (1s, 2s, 4s, … max 30s).
- Route incoming commands to the correct handler.
- Commands handled directly in background: `screenshot`, `tabs`, `tab`, `status`, `navigate`.
- Commands forwarded to content script: `click`, `type`, `text`, `elements`, `eval`.

#### Navigate flow

`navigate` uses `chrome.tabs.update(tabId, { url })` + waits for `chrome.tabs.onUpdated` with `status: 'complete'`. This is more reliable than telling the content script to set `window.location` (which kills the content script).

#### Screenshot flow

`chrome.tabs.captureVisibleTab(null, { format: 'png' })` → returns base64 data URL → strip prefix → send back.

#### Content script communication

`chrome.tabs.sendMessage(tabId, command)` → content script processes → responds via `sendResponse`. If content script is not injected (new tab, navigated away), use `chrome.scripting.executeScript` to inject on demand, then retry.

### 4.2 Content script (`content.js`)

Listens for messages from the background worker via `chrome.runtime.onMessage`.

Each action is a function:

| Action     | Implementation                                                                 |
|------------|--------------------------------------------------------------------------------|
| `click`    | `querySelector(sel)` → check visibility → `.click()`. Fail if 0 or >1 match. |
| `type`     | `querySelector(sel)` → `.focus()` → clear → dispatch `input` events per char. |
| `text`     | `querySelector(sel)` → `.innerText`. Default selector: `body`.                |
| `elements` | Scan for interactive tags → filter visible → generate selectors → return list.|
| `eval`     | Inject `<script>` into page main world, collect result via custom event.      |

#### Selector matching

`querySelector` is used, not `querySelectorAll`. If the selector matches nothing → `SELECTOR_NOT_FOUND`. For `click`, if multiple matches are possible and intent is ambiguous, the agent should use `elements` first to discover the right selector.

#### `eval` in the main world

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

### 4.3 Manifest

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

---

## 5. Failure Modes

### 5.1 Extension not connected

Trigger: browser closed, extension disabled, or page on `chrome://` URL.

Proxy detects: no WebSocket client in the connection slot.

Response: `NO_CONNECTION`, `retry: true`, hint to open browser.

### 5.2 Content script not injected

Trigger: new tab opened via bookmark, or navigation to a new origin before content script auto-injects.

Background detects: `chrome.tabs.sendMessage` returns error.

Recovery: background calls `chrome.scripting.executeScript` to inject `content.js`, then retries the command once. If second attempt fails → `TAB_NOT_AVAILABLE`.

### 5.3 Page navigation during command

Trigger: agent sends `type`, but a redirect or SPA navigation fires mid-execution.

Content script: dies silently (for cross-origin nav) or stays alive (SPA).

Background: if the message callback never fires, the proxy-side timer (30s) expires → `EXTENSION_TIMEOUT`, `retry: true`.

### 5.4 Selector on wrong page

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

### 5.5 Proxy not running

Trigger: agent calls CLI but service isn't started.

CLI detects: HTTP connection refused.

Response: `PROXY_NOT_RUNNING`, `retry: true`, hint to run `bproxy start` or `node service/index.js`.

---

## 6. Timeouts

| Boundary                  | Default | Configurable via |
|---------------------------|---------|------------------|
| CLI → Proxy HTTP          | 30s     | `--timeout <ms>` CLI flag |
| Proxy → Extension WS      | 30s     | hardcoded initially       |
| Navigate action           | 60s     | extended timeout for nav  |
| WS ping/pong              | 10s     | hardcoded                 |
| Content script injection  | 5s      | hardcoded                 |

All timeouts produce `EXTENSION_TIMEOUT` error with `retry: true`.

---

## 7. Tab Management

### Default: active tab

All commands target the currently active tab in the last focused Chrome window. This matches user intuition — "the tab I'm looking at."

### Explicit tab targeting

```
bproxy tabs
```

```json
{
  "ok": true,
  "data": {
    "tabs": [
      { "id": 42, "url": "https://example.com", "title": "Example", "active": true },
      { "id": 87, "url": "https://github.com", "title": "GitHub", "active": false }
    ]
  }
}
```

```
bproxy tab 87
```

Pins all subsequent commands to tab 87 until the next `bproxy tab` call or until that tab closes. Stored in the proxy service as in-memory state (not persisted).

---

## 8. Build & Distribution

### Service

```
cd service && npm install
node index.js
```

Single dependency: `ws`. No build step. No transpilation.

### Extension

No build step. Load unpacked in Chrome via `chrome://extensions` → "Load unpacked" → select `extension/` directory.

For distribution: `zip -r bproxy-extension.zip extension/`.

### CLI

Single file: `cli/bproxy`. Made executable with `chmod +x`.

Install globally via symlink or add to PATH:

```
ln -s $(pwd)/cli/bproxy /usr/local/bin/bproxy
```

### Root orchestration

A root `package.json` with scripts:

```json
{
  "scripts": {
    "start": "node service/index.js",
    "test": "node test/run.js"
  }
}
```

No monorepo tooling. No workspaces. Three directories, one repo.

---

## 9. Testing Strategy

### Unit: proxy service

Spin up the proxy, connect a mock WebSocket client (simulates extension), send HTTP requests, assert responses. Test: command forwarding, timeout handling, disconnect errors.

### Unit: content script actions

Load `content.js` in a jsdom or real browser context against local HTML fixture files. Test each action: click, type, text, elements, eval.

### Integration: end-to-end

1. Start proxy service.
2. Launch Chrome with `--load-extension=extension/`.
3. Run CLI commands against a local test page served by a static HTTP server.
4. Assert CLI JSON output.

This is the test that matters most. Run it manually during development. Automate later if the project grows.

### Test fixtures

```
test/
├── fixtures/
│   ├── basic.html        # links, buttons, inputs, text
│   ├── spa.html           # client-side navigation
│   └── shadow.html        # shadow DOM elements
├── test-proxy.js
├── test-content.js
└── run.js                 # orchestrates all tests
```

---

## 10. Implementation Order

**Phase 1 — Vertical slice** (prove the loop works)

1. Proxy service: HTTP + WS relay with timeout handling.
2. Extension: background.js (WS client + navigate + screenshot) + content.js (click, type, text).
3. CLI: single script, all commands, JSON output with error codes.
4. Manual test: navigate → text → click → screenshot.

**Phase 2 — Agent ergonomics**

5. `elements` command.
6. `status` command.
7. `eval` with main-world injection.
8. Content script auto-re-injection on navigation.

**Phase 3 — Robustness**

9. Tab management (`tabs`, `tab`).
10. Proxy request log.
11. End-to-end test suite.
12. `bproxy start` daemon mode (auto-start proxy from CLI).
