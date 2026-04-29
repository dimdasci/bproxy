# bproxy — Architecture

Implementation details: [tech-solution/](./tech-solution/) (twelve chapters; this doc is the navigation overview).

## Problem

Coding agents need browser access to automate web tasks. Playwright-based solutions get blocked by Cloudflare, Datadome, HUMAN, and Akamai because they run in detectable automated browser contexts.

## Solution

A Chrome extension running in a real user browser, controlled by agents through a CLI via a localhost proxy daemon.

```
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

The extension operates in the real page context — real cookies, real session, real user fingerprint — which closes the easy detection paths. It does **not** automatically close `event.isTrusted` checks or MAIN-world wrapper fingerprints; those are addressed with opt-in modes documented below and discussed honestly in [tech-solution/12-risks.md](./tech-solution/12-risks.md).

## Components

### 1. Proxy Daemon (`service/`)

A single Node.js process bridging HTTP and WebSocket on `127.0.0.1`, started via `bproxy service start` as a detached child (`child_process.spawn(detached: true)` + `unref`). It owns a per-user PID/lockfile, day-rotated logs in a platform-appropriate state directory, and a freshly generated bearer token written `0600` on every start. The daemon is **not** a dumb relay anymore: it enforces a four-layer auth gate (`Host` allowlist, `Origin` allowlist, `Sec-Fetch-Site` check, bearer token via `Authorization` header on HTTP and `Sec-WebSocket-Protocol` on the WS upgrade), maintains a bounded pending-request map with replay-on-reconnect, serializes per-tab dispatch, and supports multiple WS clients (one per Chrome profile). Single runtime dependency: `ws`.

Details: [tech-solution/03-proxy-service.md](./tech-solution/03-proxy-service.md).

### 2. Browser Extension (`extension/`)

Chrome Manifest V3 extension with three injected layers and an options page:

- **Background service worker** (`background.js`) — owns the WS to `ws://127.0.0.1:9615/ws` (auth via the user-pasted bearer token), the per-session sticky tab pin in `chrome.storage.session`, the request lifecycle (pending + dedupe tables for at-most-once destructive replay), and the frame table built from `chrome.webNavigation`. Kept alive across MV3 idle ticks by a `chrome.alarms` 30-second keepalive plus a 20-second app-level WS heartbeat.
- **Content script** (`content.js`, isolated world, `document_start`, `all_frames`) — runs the actionability checks that back auto-wait, executes DOM actions, and listens for the network shim's events.
- **MAIN-world network shim** (`network-shim.js`, `document_start`, `all_frames`, `match_origin_as_fallback`) — wraps `fetch` / `XHR` / `sendBeacon` / `EventSource` / `WebSocket` and patches `history.pushState`/`replaceState` *before* page scripts capture references. Wrappers preserve `Function.prototype.toString` native form to defeat the cheapest fingerprint check.
- **Optional `chrome.debugger` attachment** — lazy-attached on the first `--trusted` action or `--debugger` screenshot per tab, idle-detached after 60 s. Used only when the user has opted in at service start with `--enable-debugger-mode`. Deliberately skips `Runtime.enable` to sidestep the documented CDP-detection signal.
- **Options page** — single text field where the user pastes the bearer token printed by `bproxy service start`.

Details: [tech-solution/04-extension.md](./tech-solution/04-extension.md). Page-state and SPA handling in [tech-solution/05-page-state.md](./tech-solution/05-page-state.md).

### 3. CLI (`cli/`)

A single ESM Node script (`#!/usr/bin/env node`, Node ≥ 20.10), shipped through npm's `bin` field so `npm i -g bproxy` works on macOS, Linux, and Windows without `sudo` or PATH manipulation. The CLI resolves the daemon port from a PID file, reads the bearer token from a per-platform location, and POSTs one HTTP request per invocation.

```
bproxy service start [--port N] [--allow-eval] [--enable-debugger-mode]
bproxy service stop | restart | status
bproxy status
bproxy navigate <url> [--trusted]
bproxy click <selector> [--trusted] [--frame <ref>]
bproxy type <selector> <text> [--trusted] [--frame <ref>]
bproxy text | images | elements | outline | dom [...] [--frame <ref>]
bproxy screenshot [--activate] [--debugger]
bproxy wait <selector|url|function|response|navigation|settle> ...
bproxy eval <code>
bproxy tab list | pin | unpin | open | close
bproxy session list | bind | unbind
bproxy domain list | set | unset
```

Every command accepts `--session <name>` (default `"default"` or `BPROXY_SESSION`) to address one of multiple cooperating agents. Returns one JSON object on stdout per invocation; exits 0 on `ok: true`, 1 on `ok: false`, 2 on usage error.

Details: [tech-solution/02-cli-design.md](./tech-solution/02-cli-design.md). Distribution and install story: [tech-solution/09-build.md](./tech-solution/09-build.md).

## Command Protocol

Every message that crosses a boundary uses the same JSON envelope. The proxy forwards it unchanged.

```json
// Request
{
  "protocol_version": 1,
  "id": "01HZX9C2K8R7Q3VG9MNPYJVZ4D",
  "action": "click",
  "params": { "selector": "#submit", "frame": { "selector": "iframe[name='checkout']" } },
  "session": "default",
  "deadline": 1714000030000,
  "destructive": true
}

// Success response
{
  "protocol_version": 1,
  "id": "01HZX9C2K8R7Q3VG9MNPYJVZ4D",
  "ok": true,
  "data": { "clicked": true },
  "page": { "url": "...", "title": "...", "state": "ready", "busy": false },
  "replay": false
}
```

`id` is the **idempotency key**. Destructive actions (`click`, `type`, `navigate`, `eval`, `tab pin`/`open`/`close`) are at-most-once per id, enforced by a dedupe table in the extension; read-only actions are at-least-once. `protocol_version` is checked on every hop; mismatches surface as `PROTOCOL_VERSION_MISMATCH`. The optional `frame` qualifier scopes DOM-touching actions to a specific iframe (selector / index / URL pattern). The `page` block on every page-touching response gives the agent advisory state without a separate call.

Errors use a single RFC 9457-aligned envelope:

```json
{
  "ok": false,
  "error": {
    "code": "SELECTOR_NOT_FOUND",
    "category": "target",
    "retry": false,
    "suggestedAction": "fix the selector or wait for the element",
    "message": "No element matches '#submit-btn'",
    "details": { "selector": "#submit-btn", "matchCount": 0 }
  }
}
```

`category` is one of `connection` · `auth` · `protocol` · `target` · `timing` · `policy` · `internal`. `retry` is `true` (transient — retry verbatim), `false` (the agent must change something), or `"conditional"` (retry iff the precondition in `suggestedAction` becomes true). The full code table — including the seven categories, the disambiguation rules, the `details` schema per code, and the deprecated codes that must not appear on the wire — lives in [tech-solution/06-failure-modes.md](./tech-solution/06-failure-modes.md). Wire envelope and field semantics: [tech-solution/01-output-contract.md](./tech-solution/01-output-contract.md).

### Supported Actions

| Action       | Notes                                                                                 |
|--------------|---------------------------------------------------------------------------------------|
| `navigate`   | `chrome.tabs.update`. Auto-waits for load + bounded settle. `--trusted` uses `Page.navigate` via CDP. |
| `click`      | Auto-wait actionability (visible / stable / enabled / receives events). `--frame`, `--trusted`. |
| `type`       | Auto-wait + clear + per-character dispatch. `--frame`, `--trusted`.                   |
| `text`       | Innertext extraction, truncated at 10k chars. `--frame`.                              |
| `images`     | Visible images with src/alt/dimensions. Optional scope selector.                      |
| `elements`   | Numbered list of interactive elements with stable selectors.                          |
| `outline`    | Landmarks + heading hierarchy.                                                        |
| `dom`        | Simplified subtree at controlled depth.                                               |
| `screenshot` | `captureVisibleTab(windowId)` — fails with `TAB_NOT_VISIBLE` rather than steal focus. `--activate` opt-in; `--debugger` for CDP capture. |
| `wait`       | Strategies: `selector` / `url` / `function` / `response` / `navigation` / `settle [--network]`. |
| `eval`       | `chrome.scripting.executeScript({ world: 'MAIN' })`. Gated by `--allow-eval` at service start. |
| `tab` / `session` / `domain` | Lifecycle and configuration verbs (see CLI design).                       |

Auto-wait is the default for destructive actions: agents only reach for `bproxy wait` when the next target is not yet on the page or the gate is non-DOM (URL, network response, custom predicate). Page state and waiter strategies: [tech-solution/05-page-state.md](./tech-solution/05-page-state.md). Tab and screenshot semantics: [tech-solution/08-tab-management.md](./tech-solution/08-tab-management.md). Timeouts: [tech-solution/07-timeouts.md](./tech-solution/07-timeouts.md).

## Reliability posture

Reliability is the project's stated goal, and it has a specific meaning here: **at-most-once for destructive actions, sticky targeting, and structured errors with retry guidance**. Concretely:

- The idempotency layer (client-supplied `id`, proxy pending map, extension dedupe table in `chrome.storage.session`) guarantees a destructive action runs at most once even across MV3 service-worker termination, WebSocket drops, and reconnect-driven replay.
- The session pin (`chrome.storage.session.tabs`) is the single source of truth for "which tab am I on" — replacing the previous "active tab in last-focused window" heuristic that silently followed user window-switching.
- Every error carries a `category`, a `retry` value, and a `suggestedAction` so an agent can branch deterministically without parsing free text.
- Auto-wait inside actions, plus the explicit `bproxy wait` strategies for non-DOM gates, means the agent does not have to model "is the page ready" as a separate concern.

The honest residuals — anti-bot detectability in default mode, the user-visible Chrome banner under `--trusted` / `--debugger`, the inherent first-command-after-long-idle latency from MV3 SW lifecycle, and what happens when `storage.session` is cleared by a browser restart — are catalogued in [tech-solution/12-risks.md](./tech-solution/12-risks.md). Anti-bot stealth is best-effort, not solved.

## File Structure

```
bproxy/
├── package.json              # bin: { "bproxy": "./cli/bproxy.js" }, single dep: ws
├── cli/
│   ├── bproxy.js             # CLI entry point
│   └── paths.js              # cross-platform state directory resolver
├── service/
│   └── index.js              # daemon (HTTP + WS, auth, dispatch, replay, log)
├── extension/
│   ├── manifest.json         # MV3, alarms+storage+webNavigation+scripting permissions
│   ├── background.js         # SW: WS, lifecycle, dedupe, frame table, debugger
│   ├── content.js            # isolated world, document_start, all_frames
│   ├── network-shim.js       # MAIN world, document_start, native-toString preservation
│   ├── options.html          # token paste UI
│   └── options.js
├── test/                     # Layer 1 unit tests (node --test)
├── test-e2e/                 # Layer 2 Playwright-as-test-harness
│   └── fixtures/             # SPA pages, iframe matrix, never-settle chat, etc.
└── docs/
    ├── architecture.md       # this file
    ├── browser-proxy-idea.png
    └── tech-solution/        # 01–12 plus README
```

Illustrative, not exhaustive. Distribution and the daemon contract: [tech-solution/09-build.md](./tech-solution/09-build.md). Test layout: [tech-solution/10-testing.md](./tech-solution/10-testing.md).

## Design Decisions

- **WebSocket over Native Messaging** — easier to develop, debug, and test. No OS-level manifest registration. Auth is the bearer-token gate at the upgrade, not OS process attestation.
- **Bearer token + four-layer gate** — `Host` allowlist defeats DNS rebinding; `Origin` allowlist + `Sec-Fetch-Site` reject any browser-origin caller; bearer token via `Sec-WebSocket-Protocol` on the WS upgrade keeps the secret out of URLs and access logs. Eval lives behind a second gate (`--allow-eval` at service start). See [tech-solution/03-proxy-service.md → Authentication](./tech-solution/03-proxy-service.md#authentication).
- **`chrome.alarms` keepalive over offscreen documents** — 30 s alarm + 20 s app-level WS heartbeat keep the SW alive without a second context to synchronize. Reconnect backoff is capped strictly under the 30 s SW idle window.
- **Idempotency by client-supplied `id`** — the same ULID/UUID is reused across retries of the same logical operation. Dedupe table in `chrome.storage.session` returns the cached terminal response for destructive actions; replay on reconnect is therefore safe without proxy-side action-class logic.
- **Auto-wait on actions, explicit waiters for cross-cutting conditions** — Playwright's model. The previous global "page ready" gate is replaced; `page.state` is advisory only.
- **Sticky session tab pin** — `chrome.storage.session.tabs` keyed by `--session` name. Two cooperating agents pass different session names; the SW dispatcher reads the session field before resolving the target.
- **Trusted events as opt-in (`--trusted`)** — `chrome.debugger` + `Input.dispatchMouseEvent`/`dispatchKeyEvent`/`insertText` produces `isTrusted === true`. Off by default because Chrome shows a non-suppressible "extension started debugging this browser" banner for the duration of the attachment. Deliberately avoids `Runtime.enable` to sidestep the published CDP-detection trick. Honest about the trade-off in [tech-solution/12-risks.md](./tech-solution/12-risks.md#headline-risk-the-extension-itself-is-fingerprintable).
- **Per-domain shim disable (`bproxy domain set <pattern>`)** — escape hatch for sites where the MAIN-world wrapper itself is the detection signal. The cost is documented: `wait --network` and `wait response` no-op on disabled origins.
- **CSP-proof `eval` via `chrome.scripting.executeScript({ world: 'MAIN' })`** — bypasses page CSP that would block inline `<script>` injection.
- **History API patching over polling** — synchronous `bproxy:locationchange` event from a MAIN-world patch on `pushState`/`replaceState`, with `chrome.webNavigation.onHistoryStateUpdated` as a backstop for the rare cases the patch misses.
- **npm-based install (`npm i -g bproxy`)** — one cross-platform install command, no `sudo`, no PATH manipulation. The `bin` field is the primitive on every supported OS. The daemon is run via `child_process.spawn(detached: true)` + `unref`; auto-restart-on-crash is deliberately out of scope so the user notices reliability problems.
- **Multi-Chrome-profile: one daemon, multiple WS clients** — keyed by a persisted profile UUID announced in a `hello` frame. Sessions auto-bind to the first profile that pins for them; cross-profile reuse returns `WRONG_PROFILE`.
- **Playwright as test harness, not runtime path** — Layer 2 launches a real Chromium with the extension loaded and drives test pages from Playwright while bproxy commands flow through the production CLI → proxy → extension path. Layer 1 is `node --test` for proxy-internal logic; Layer 3 is gated anti-bot fixtures (Cloudflare Turnstile, Datadome). See [tech-solution/10-testing.md](./tech-solution/10-testing.md).

The implementation order — Phase 0 foundations through Phase 5 multi-profile and ops, with each phase shipping testable deliverables — is in [tech-solution/11-implementation-order.md](./tech-solution/11-implementation-order.md).
