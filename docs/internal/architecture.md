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
- **Session authority lives in the daemon** — session ids are daemon-generated capability handles, labels are display-only, logical tabs (`t1`, `t2`, ...) are session-scoped, raw Chrome tab ids stay internal, and pacing / pause state remains daemon-owned in-memory state.
- **Auth is transport-boundary first-fail (header-auth routes)** — `POST /` and `GET /ws` are rejected at request ingress (before body parsing/validation and before any route logic). `POST /pair/claim` keeps Host/Origin checks at ingress and validates pairing code after body parse.
- **Lifecycle is single-instance per `BPROXY_HOME`** — daemon startup must fail cleanly when the lockfile PID is alive; stale PID files are recoverable; `status` truth is process-liveness based.
- **Three explicit write methods** — `direct` | `paste` | `runtime-api`, no `auto` [ADR-007](./decisions.md#adr-007-three-method-write-contract). Method and world choice are agent-owned per call.
- **World model** — ISOLATED by default; MAIN only for `runtime-api` writes (on-demand one-shot, no persistent scripts) [ADR-013](./decisions.md#adr-013-main-world-runtime-api-writes).
- **Sensor+actuator boundary** — extension exposes primitives honestly; agent owns all strategy (selector, method, world, scroll target, escalation, caching) [ADR-017](./decisions.md#adr-017-sensoractuator-boundary).
- **Shadow-DOM-aware targeting** — element routes encode shadow-host chains; open shadow roots only [ADR-014](./decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting).
- **Interstitial detection + `HUMAN_REQUIRED`** — agent stops, user resolves CAPTCHAs/logins.
- **"Don't submit" handoff** — agent prepares, user reviews and submits.
- **Escape hatches stay on the shelf** until real usage signals need.
- **No arbitrary page eval or scroll-target inference** — runtime/page investigation uses normal browser debugging tools such as CDP; bproxy does not expose an `eval` action and does not guess the correct scroll container [ADR-024](./decisions.md#adr-024-no-arbitrary-page-eval-and-no-scroll-target-inference).
- **Observability is structural** — every component is independently debuggable via the request `id` as universal correlation key. Logging is not an afterthought; it's part of the spec.

## Components

### Proxy Daemon

A long-running localhost process that bridges the CLI (HTTP) and the extension (WebSocket). Owns auth, pacing enforcement, request lifecycle (pending map, timeout, replay-on-reconnect), session state, the logical-tab registry, and per-tab serialized dispatch. Session rebinding is immediate: after `session.bind --tab tN` changes the logical binding, the next forwarded command resolves that handle to the new internal Chrome tab target. Supports multiple WS clients (one per Chrome profile). Lifecycle ownership is per state directory (`BPROXY_HOME`): one daemon per directory, deterministic `start/stop/status` semantics.

Implementation: `docs/public/solution/service.md`

### Browser Extension

Chrome Manifest V3 extension. Three runtime layers:

- **Background service worker** — WebSocket client to the daemon, request routing, tab/runtime context management, frame table, keepalive, popup message handler.
- **Content script** (ISOLATED world, injected programmatically on first command per tab) — DOM reads, `direct`/`paste` writes, scroll, stability polling.
- **Popup** — pairing code entry, token storage. No options page.

**Dual execution model:**
- ISOLATED world for reads and `direct`/`paste` writes
- MAIN world (on-demand via `chrome.scripting.executeScript`) only for `runtime-api` writes

**Shadow-aware discovery** — targeting supports element routes beyond plain selectors, traversing open shadow roots scoped to active modal/intent.

Implementation: `docs/public/solution/extension.md`

### CLI

One invocation = one command = one HTTP POST to the daemon = one JSON response on stdout. Browser-control commands accept `-s, --session <id>` where `<id>` is a daemon-generated 6-character handle matching `/^[a-z2-7]{6}$/`. `tab open --url ...` is the sole bootstrap exception that may omit `-s`; it returns the generated `session` id plus logical `tab` handle. Exits 0/1/2.

Implementation: `docs/public/solution/cli.md`

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
  "session": "m4q7z2",
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

### Browser-control contract (Phase 5)

- **Generated sessions:** daemon-created only, 6-character base32 lowercase ids (`SessionId` branded type); no implicit shared `default` session for browser-control flows.
- **Logical tabs:** normal CLI/protocol responses expose session-scoped handles such as `t1` (`TabHandle` branded type); raw Chrome tab ids remain daemon/extension internals.
- **Fresh bootstrap:** `tab open --url ...` is the only command that may auto-create a session when `-s` is omitted. It returns `{ session, tab, bound: true, url }`.
- **Scoped privacy:** `tab list` returns only tabs owned by the supplied session. Operator-opened tabs are not exposed through the normal agent surface.
- **Bind/close rules:** `session bind --tab tN` accepts logical tab handles only; `session close -s <id>` closes all session-owned Chrome tabs.
- **Extension-control wire shape:** the daemon reuses the existing `BproxyRequest` envelope and sets `target.tabId` to `null` for actions that do not target an existing tab. The background service worker routes `tab.open`, `tab.list`, and `tab.close` by action name without forwarding them to a content script.
- **Structured links:** `links` is a first-class read action for structured visible-link extraction, traversing open shadow roots by default.
- **Diagnostic commands:** `inspect` returns computed styles, layout rects, and scroll info for specific selectors; `snapshot` returns an accessible DOM tree serialization.
- **Capability errors:** `SESSION_REQUIRED`, `INVALID_SESSION_ID`, `SESSION_NOT_FOUND`, `TAB_HANDLE_NOT_FOUND`, and `TAB_NOT_IN_SESSION` are part of the shared error contract for the generated-session/logical-tab model.
- **Screenshot file output:** `screenshot --output-dir <dir>` materializes the captured image to disk and returns `{ format, file, size }` instead of a base64 blob.

## Actions

| Action       | Notes                                                                                 |
|--------------|---------------------------------------------------------------------------------------|
| `navigate`   | `chrome.tabs.update`. Waits for load. URL-driven.                                    |
| `text`       | ISOLATED-world innerText extraction. Default selector: `body`.                       |
| `links`      | Structured visible-link extraction with optional selector scope and limit.            |
| `images`     | Visible images with src/alt/dimensions.                                              |
| `elements`   | Interactive elements with stable selectors. `--form` variant for form fields.        |
| `outline`    | Landmarks + heading hierarchy.                                                        |
| `dom`        | Simplified subtree at controlled depth.                                               |
| `inspect`    | Computed style, layout rect, and scroll info for specific selectors.                 |
| `snapshot`   | Accessible DOM tree serialization (text-based, depth-limited).                       |
| `scroll`     | Explicit viewport or element-target scroll actuator with honest movement/no-op reporting; agent owns target choice. |
| `screenshot` | `captureVisibleTab`. `--activate` / `--debugger` / `--output-dir` opt-ins.           |
| `fill`       | Three explicit methods: `direct` (DOM), `paste` (events), `runtime-api` (editor).      |
| `fill-form`  | Bulk fill in one round-trip with internal pacing.                                    |
| `select`     | Custom-dropdown helper: click trigger, wait for menu, click option.                  |
| `wait`       | Strategies: `selector` / `url` / `navigation`. DOM polling.                          |
| `require-human` | Surfaces interstitial to user. Blocks until `session resume`.                     |
| `tab` / `session` | Lifecycle and configuration verbs (`session.*` daemon-local; `tab.*` forwarded). |
| `debug.log`  | Extension ring buffer (last N requests, queryable by `id`).                      |
| `debug.last` | Daemon trace ring buffer (capacity 200, in-memory).                              |
| `debug.status` | Full system state (daemon, WS clients, sessions, tab ownership, paused).       |

Routing details and contract: `docs/public/solution/service.md` § Action routing and session contract.

## Reliability

- **At-most-once** for destructive actions (client-supplied `id`, proxy pending map, extension dedupe table).
- **Pacing** - daemon-enforced human-pace delays. Agent cannot bypass.
- **`HUMAN_REQUIRED`** - structured stop signal on interstitials. No retry through bot detection.

## Related Documents

- [decisions.md](./decisions.md) - Architecture Decision Records (why we chose X over Y)
- [scenarios.md](./scenarios.md) - Driving use cases and bot-signal accounting
- [journal/](./journal/) - Raw design thinking and pivot notes
- Implementation specs (public tier): `docs/public/solution/`
