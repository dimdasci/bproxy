# bproxy — Architecture

## Problem

Coding agents need browser access to automate web tasks. Playwright-based solutions get blocked by Cloudflare, Datadome, HUMAN, and Akamai because they run in detectable automated browser contexts.

## Solution

A Chrome extension running in a real user browser, controlled by agents through a CLI via a localhost proxy daemon.

```
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

The extension operates in the real page context — real cookies, real session, real user fingerprint — which closes the easy detection paths. The default mode (**read mode**) has no MAIN-world presence: no wrapped globals, no MutationObserver, no history patches. The agent reads pages via ISOLATED-world DOM access and navigates via URLs. Write operations use paste-flavored events. Escape hatches (`--trusted`, network shim, chrome.debugger) are opt-in when real usage shows they're needed.

## Design Principles

- **Read mode covers most work** — URL-driven navigation + ISOLATED-world text extraction + scroll.
- **DOM polling beats MutationObserver** as the default "is page settled" mechanism.
- **Pacing is daemon-enforced** — per-session, applied to navigations, scrolls, and per-field fill delay.
- **Paste, not typing** — `fill` defaults to paste-flavored input events.
- **Interact mode is a thin extension of read mode** — paste-shaped writes, form-shaped reads, file-upload handoff. No MAIN-world shim, no MutationObserver, no `--trusted` by default.
- **Interstitial detection + `HUMAN_REQUIRED`** — agent stops, user resolves CAPTCHAs/logins.
- **"Don't submit" handoff** — agent prepares, user reviews and submits.
- **Escape hatches stay on the shelf** until real usage signals need.
- **Observability is structural** — every component is independently debuggable via the request `id` as universal correlation key. Logging is not an afterthought; it’s part of the spec.

## Components

### Proxy Daemon

A long-running localhost process that bridges the CLI (HTTP) and the extension (WebSocket). Owns auth, pacing enforcement, request lifecycle (pending map, timeout, replay-on-reconnect), session state, and per-tab serialized dispatch. Supports multiple WS clients (one per Chrome profile).

Implementation: [solution/service.md](./solution/service.md)

### Browser Extension

Chrome Manifest V3 extension. Two runtime layers:

- **Background service worker** — WebSocket client to the daemon, request routing, tab/session management, frame table, keepalive.
- **Content script** (isolated world, injected programmatically on first command per tab) — DOM reads, form fills, scroll, stability polling.

No MAIN-world presence by default. Optional `chrome.debugger` attachment for trusted events.

Implementation: [solution/extension.md](./solution/extension.md)

### CLI

One invocation = one command = one HTTP POST to the daemon = one JSON response on stdout. Accepts `--session <name>` on every command. Exits 0/1/2.

Implementation: [solution/cli.md](./solution/cli.md)

## Extension Token Bootstrap (Pairing)

The extension has no manual token-entry UI. Pairing is explicit and CLI-mediated.

1. `bproxy service start` starts daemon and creates:
   - daemon bearer token in `~/.bproxy/token` (CLI → daemon HTTP auth)
   - one-time pairing code (short TTL, single-use)
2. User/agent calls `bproxy extension pair --code XXXX-XXXX`.
3. CLI authenticates to daemon with `Authorization: Bearer {daemon-token}` and calls bootstrap claim route.
4. Daemon validates pairing code and returns bootstrap payload (`extensionToken`, `wsUrl`, `protocol`).
5. CLI sends payload to installed extension via runtime messaging bridge.
6. Extension stores token in `storage.local`, reconnects WS using `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(extensionToken)}`.

Security properties:
- Pairing code is one-time and expires quickly.
- Claim route requires daemon bearer token (local-file gated).
- Daemon never exposes long-lived token over unauthenticated endpoint.
- Pairing events are logged and auditable.

## Protocol

The shared contract between all three components. Every message uses the same JSON envelope:

```json
{
  "protocol_version": 1,
  "id": "01HZX9C2K8R7Q3VG9MNPYJVZ4D",
  "action": "fill",
  "params": { "selector": "input[name='email']", "value": "user@example.com" },
  "session": "default",
  "deadline": 1714000030000,
  "destructive": true
}
```

Responses:

```json
{
  "protocol_version": 1,
  "id": "01HZX9C2K8R7Q3VG9MNPYJVZ4D",
  "ok": true,
  "data": { "filled": true },
  "page": { "url": "...", "title": "...", "state": "ready", "busy": false },
  "replay": false
}
```

Errors use a single RFC 9457-aligned envelope:

```json
{
  "ok": false,
  "error": {
    "code": "HUMAN_REQUIRED",
    "category": "policy",
    "retry": "conditional",
    "suggestedAction": "resolve the interstitial in the browser, then `bproxy session resume`",
    "message": "CAPTCHA detected on google.com",
    "details": { "reason": "captcha", "url": "https://google.com/sorry/..." }
  }
}
```

## Actions

| Action       | Notes                                                                                 |
|--------------|---------------------------------------------------------------------------------------|
| `navigate`   | `chrome.tabs.update`. Waits for load. URL-driven.                                    |
| `text`       | ISOLATED-world innerText extraction. Default selector: `body`.                       |
| `images`     | Visible images with src/alt/dimensions.                                              |
| `elements`   | Interactive elements with stable selectors. `--form` variant for form fields.        |
| `outline`    | Landmarks + heading hierarchy.                                                        |
| `dom`        | Simplified subtree at controlled depth.                                               |
| `scroll`     | ISOLATED-world `window.scrollBy` + DOM polling for stability.                        |
| `screenshot` | `captureVisibleTab`. `--activate` / `--debugger` opt-ins.                            |
| `fill`       | Paste-flavored input: native setter + `insertFromPaste` events.                      |
| `fill-form`  | Bulk fill in one round-trip with internal pacing.                                    |
| `select`     | Custom-dropdown helper: click trigger, wait for menu, click option.                  |
| `wait`       | Strategies: `selector` / `url` / `navigation`. DOM polling.                          |
| `require-human` | Surfaces interstitial to user. Blocks until `session resume`.                     |
| `eval`       | MAIN-world script execution. Gated by `--allow-eval`.                                |
| `tab` / `session` | Lifecycle and configuration verbs.                                              |
| `debug.log`  | Extension ring buffer (last N requests, queryable by `id`).                      |
| `debug.last` | Daemon log view (last N request lifecycles).                                     |
| `debug.status` | Full system state (daemon, WS clients, sessions, paused).                      |

## Reliability

- **At-most-once** for destructive actions (client-supplied `id`, proxy pending map, extension dedupe table).
- **Pacing** — daemon-enforced human-pace delays. Agent cannot bypass.
- **`HUMAN_REQUIRED`** — structured stop signal on interstitials. No retry through bot detection.

## Related Documents

- [decisions.md](./decisions.md) — Architecture Decision Records (why we chose X over Y)
- [scenarios.md](./scenarios.md) — Driving use cases and bot-signal accounting
- [solution/](./solution/) — Implementation specs (how to build each component)
- [journal/](./journal/) — Raw design thinking and pivot notes
