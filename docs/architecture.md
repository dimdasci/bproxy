---
title: Architecture
---

## Problem

Coding agents need browser access to automate web tasks. Playwright-based solutions get blocked by Cloudflare, Datadome, HUMAN, and Akamai because they run in detectable automated browser contexts.

## Solution

A Chrome extension running in a real user browser, controlled by agents through a CLI via a localhost proxy daemon.

```
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

The extension is a thin sensor+actuator layer. It exposes capabilities honestly (shadow-aware reads, MAIN-world capability, three write methods) and never strategizes internally.

The extension operates in the real page context — real cookies, real session, real user fingerprint — which closes the easy detection paths. The default mode (**read mode**) has no MAIN-world presence: no wrapped globals, no MutationObserver, no history patches. The agent reads pages via ISOLATED-world DOM access and navigates via URLs.

**Write operations** use one of three explicit methods selected by the agent per call ([ADR-007](./decisions.md#adr-007-three-method-write-contract)):
- `direct` — DOM state (`.value` / `.textContent`), ISOLATED world
- `paste` — Framework events with `inputType: "insertFromPaste"`, ISOLATED world
- `runtime-api` — Page-owned editor APIs (`__quill`, Lexical, ProseMirror, etc.), MAIN world (on-demand one-shot)

Escape hatches (`--trusted`, network shim, chrome.debugger) are opt-in when real usage shows they're needed.

## Design Principles

- **Read mode covers most work** — URL-driven navigation + ISOLATED-world text extraction + scroll.
- **DOM polling beats MutationObserver** as the default "is page settled" mechanism. Polling is **jittered** (randomized intervals) and **visibility-aware** (destructive actions bail on hidden tabs unless user-initiated) [ADR-006](./decisions.md#adr-006-dom-polling-over-mutationobserver).
- **Pacing is daemon-enforced** — per-session, applied to navigations, scrolls, and per-field fill delay.
- **Session authority lives in the daemon** — `tabId`, `pacing`, `paused`, and `pauseReason` are daemon-owned in-memory state; extension executes forwarded browser actions but does not own session lifecycle.
- **Auth is transport-boundary first-fail** — unauthenticated requests are rejected at request ingress (before body parsing/validation and before any route logic).
- **Three explicit write methods** — `direct` | `paste` | `runtime-api`, no `auto` [ADR-007](./decisions.md#adr-007-three-method-write-contract). Method and world choice are agent-owned per call.
- **World model** — ISOLATED by default; MAIN only for `runtime-api` writes (on-demand one-shot, no persistent scripts) [ADR-013](./decisions.md#adr-013-main-world-runtime-api-writes).
- **Sensor+actuator boundary** — extension exposes primitives honestly; agent owns all strategy (selector, method, world, escalation, caching) [ADR-017](./decisions.md#adr-017-sensoractuator-boundary).
- **Shadow-DOM-aware targeting** — element routes encode shadow-host chains; open shadow roots only [ADR-014](./decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting).
- **Interstitial detection + `HUMAN_REQUIRED`** — agent stops, user resolves CAPTCHAs/logins.
- **"Don't submit" handoff** — agent prepares, user reviews and submits.
- **Escape hatches stay on the shelf** until real usage signals need.
- **Observability is structural** — every component is independently debuggable via the request `id` as universal correlation key. Logging is not an afterthought; it's part of the spec.

## Components

### Proxy Daemon

A long-running localhost process that bridges the CLI (HTTP) and the extension (WebSocket). Owns auth, pacing enforcement, request lifecycle (pending map, timeout, replay-on-reconnect), session state, and per-tab serialized dispatch. Session rebinding is immediate: after `session.bind` changes `tabId`, the next forwarded command uses the new tab target. Supports multiple WS clients (one per Chrome profile).

Implementation: [solution/service.md](./solution/service.md)

### Browser Extension

Chrome Manifest V3 extension. Three runtime layers:

- **Background service worker** — WebSocket client to the daemon, request routing, tab/runtime context management, frame table, keepalive, popup message handler.
- **Content script** (ISOLATED world, injected programmatically on first command per tab) — DOM reads, `direct`/`paste` writes, scroll, stability polling.
- **Popup** — pairing code entry, token storage. No options page.

**Dual execution model:**
- ISOLATED world for reads and `direct`/`paste` writes
- MAIN world (on-demand via `chrome.scripting.executeScript`) only for `runtime-api` writes

**Shadow-aware discovery** — targeting supports element routes beyond plain selectors, traversing open shadow roots scoped to active modal/intent.

Implementation: [solution/extension.md](./solution/extension.md)

### CLI

One invocation = one command = one HTTP POST to the daemon = one JSON response on stdout. Accepts `--session <name>` on every command. Exits 0/1/2.

Implementation: [solution/cli.md](./solution/cli.md)

## Extension Token Bootstrap (Pairing)

The extension has no manual token-entry UI. Pairing is explicit and popup-driven ([ADR-011](./decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing)).

1. `bproxy service start` starts daemon and creates:
   - daemon bearer token in `~/.bproxy/token` (CLI → daemon HTTP auth)
   - one-time pairing code (short TTL, single-use)
   - loads existing extension WS token from `~/.bproxy/extension-token` when present
2. CLI prints pairing code in machine-readable output (`{pairingCode, expiresAt}`)
3. User opens extension popup, enters pairing code
4. Popup calls `POST /pair/claim` with the code, receives bootstrap payload
5. Popup stores `{extensionToken, wsUrl, protocol}` in `chrome.storage.local`
6. Popup notifies background SW; SW reconnects WS using `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(extensionToken)}`
7. The claimed token is active immediately for WS auth; daemon accepts only the latest claimed extension token (single-active-token policy).
8. Daemon persists active extension token to `~/.bproxy/extension-token` (0600), so restart is transparent for a single-user setup (extension reconnects without re-pairing).

Security properties:
- Pairing code is one-time and expires quickly (TTL 5 minutes).
- Claim route validates pairing code only; no daemon bearer token required.
- Daemon never exposes long-lived token over unauthenticated endpoint.
- Bootstrap payload includes cryptographic nonce; extension enforces single accept.
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
| `fill`       | Three explicit methods: `direct` (DOM), `paste` (events), `runtime-api` (editor).      |
| `fill-form`  | Bulk fill in one round-trip with internal pacing.                                    |
| `select`     | Custom-dropdown helper: click trigger, wait for menu, click option.                  |
| `wait`       | Strategies: `selector` / `url` / `navigation`. DOM polling.                          |
| `require-human` | Surfaces interstitial to user. Blocks until `session resume`.                     |
| `eval`       | MAIN-world script execution. Gated by `--allow-eval`.                                |
| `tab` / `session` | Lifecycle and configuration verbs (`session.*` daemon-local; `tab.*` forwarded). |

Routing details and contract: [solution/service.md#action-routing-and-session-contract](./solution/service.md#action-routing-and-session-contract).
| `debug.log`  | Extension ring buffer (last N requests, queryable by `id`).                      |
| `debug.last` | Daemon log view (last N request lifecycles).                                     |
| `debug.status` | Full system state (daemon, WS clients, sessions, paused).                      |

## Reliability

- **At-most-once** for destructive actions (client-supplied `id`, proxy pending map, extension dedupe table).
- **Pacing** - daemon-enforced human-pace delays. Agent cannot bypass.
- **`HUMAN_REQUIRED`** - structured stop signal on interstitials. No retry through bot detection.

## Related Documents

- [decisions.md](./decisions.md) - Architecture Decision Records (why we chose X over Y)
- [scenarios.md](./scenarios.md) - Driving use cases and bot-signal accounting
- [solution/](./solution/) - Implementation specs (how to build each component)
- [journal/](./journal/) - Raw design thinking and pivot notes
