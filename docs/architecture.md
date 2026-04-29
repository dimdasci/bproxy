# bproxy — Architecture

## Problem

Coding agents need browser access to automate web tasks. Playwright-based solutions get blocked by Cloudflare and other anti-bot systems because they run in detectable automated browser contexts.

## Solution

A browser extension running in a real user browser, controlled by agents through a CLI via a local proxy service.

```
Code Agent ──CLI──▶ Proxy Service ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

The extension operates in the real page context — real cookies, real session, real user fingerprint. Anti-bot systems can't distinguish it from normal user activity.

## Components

### 1. Proxy Service (`service/`)

A single Node.js process that bridges HTTP and WebSocket:

- **HTTP server** — accepts commands from the CLI as `POST /command` requests
- **WebSocket server** — maintains a persistent connection to the browser extension
- Acts as a **dumb relay**: receives HTTP request → forwards over WebSocket → waits for response → returns to HTTP caller

The proxy is localhost-only. No auth, no database, no queue.

Single dependency: `ws` npm package.

Later this layer may be extended with pre/post-processing (logging, command validation, response transformation), but for now it is a pass-through.

### 2. Browser Extension (`extension/`)

Chrome Manifest V3 extension with two parts:

- **Background service worker** (`background.js`) — opens a WebSocket to `ws://localhost:<PORT>`, receives commands from the proxy, routes them to the active tab's content script via `chrome.tabs.sendMessage`. Handles `captureVisibleTab` for screenshots.
- **Content script** (`content.js`) — injected into pages, executes DOM actions: click, type, read text, navigate, run arbitrary JS. Sends results back to the background worker.

### 3. CLI (`cli/`)

A thin wrapper that sends HTTP requests to the proxy service. The agent calls it like:

```
bproxy navigate "https://example.com"
bproxy click "#submit-button"
bproxy type "input[name=email]" "user@example.com"
bproxy screenshot
bproxy text ".main-content"
bproxy eval "document.title"
```

Returns JSON to stdout so the agent can parse results.

## Command Protocol

All communication uses a simple JSON envelope:

```json
// Request (CLI → Proxy → Extension)
{
  "id": "uuid",
  "action": "click",
  "params": { "selector": "#btn" }
}

// Response (Extension → Proxy → CLI)
{
  "id": "uuid",
  "success": true,
  "data": { ... }
}
```

### Supported Actions

| Action       | Params                          | Returns                    |
|--------------|---------------------------------|----------------------------|
| `navigate`   | `{ url }`                       | `{ url, title }`          |
| `click`      | `{ selector }`                  | `{ clicked: true }`       |
| `type`       | `{ selector, text }`           | `{ typed: true }`         |
| `text`       | `{ selector }`                  | `{ text: "..." }`         |
| `screenshot` | `{}`                            | `{ image: "base64..." }`  |
| `eval`       | `{ code }`                      | `{ result: ... }`         |

## File Structure

```
bproxy/
├── service/
│   ├── index.js          # HTTP + WebSocket server
│   └── package.json
├── extension/
│   ├── manifest.json
│   ├── background.js     # WS client, command router, screenshots
│   └── content.js        # DOM actions in page context
├── cli/
│   └── bproxy            # CLI entry point
└── docs/
    ├── architecture.md   # This file
    └── browser-proxy-idea.png
```

## Design Decisions

- **WebSocket over Native Messaging** — easier to develop, debug, and test. No OS-level manifest registration needed.
- **No framework** — raw `http.createServer` + `ws`. Zero build step for the service.
- **Content script does the work** — runs in the real page context, bypassing bot detection.
- **`captureVisibleTab`** for screenshots — built into Chrome API, returns base64 PNG, no extra dependencies.
- **`eval` as escape hatch** — when predefined actions aren't enough, the agent can run arbitrary JS in page context.
- **Proxy as dumb relay** — keeps the system simple. Intelligence lives in the extension. Proxy can grow later.
