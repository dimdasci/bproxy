# 10. Testing Strategy

[← Index](./README.md) · Prev: [Build & Distribution](./09-build.md) · Next: [Implementation Order →](./11-implementation-order.md)

---

The previous draft relied on jsdom for content-script logic. That is unsound: MutationObserver scheduling, layout-dependent visibility, MAIN-world isolation, frame routing, and `chrome.*` API semantics all behave differently outside a real Chrome process. Validating the claims in tasks 1–9 requires a real browser.

This chapter specifies the harness that makes every claim testable and ties each canonical error code in [06-failure-modes.md](./06-failure-modes.md#canonical-error-code-table) to at least one fixture.

## Three layers

### Layer 1 — Unit (Node only)

Fast, headless, no Chrome. Covers proxy-internal logic that does not depend on browser semantics.

- Proxy idempotency table: dedupe by `(profileId, id)`, replacement-on-resend, `replay: true` on cached returns, deadline eviction.
- Failure-mode taxonomy: every code in [06-failure-modes.md → Canonical error code table](./06-failure-modes.md#canonical-error-code-table) round-trips through the envelope schema; `category`/`retry` invariants enforced; deprecated codes (`EXTENSION_TIMEOUT`, `FRAME_NOT_FOUND`) rejected by a wire-side lint.
- CLI argument parsing: every subcommand from [02-cli-design.md](./02-cli-design.md), `--port` resolution order, `--session` validation `[a-z0-9_-]{1,32}`, `--frame` form discrimination (selector / index / regex / substring).
- Token discovery, `Host`/`Origin`/`Sec-Fetch-Site` checks, `Sec-WebSocket-Protocol` parsing.

Runner: `node --test` plus a thin assertion helper. Target: each test < 50 ms; full suite < 10 s.

### Layer 2 — Extension integration (Playwright + extension loaded)

Playwright is the **test harness**, not the runtime path. We launch a real Chromium with the bproxy extension loaded and drive test pages from Playwright while bproxy commands flow through the CLI → proxy → extension as in production.

```js
// Playwright fixture (sketch)
import { chromium } from '@playwright/test';
const ext = path.resolve('extension/dist');
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false, // MV3 SW + chrome.debugger require headed Chrome
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    `--no-first-run`,
    `--user-data-dir=${userDataDir}`,
  ],
});
```

Headed-only because MV3 service workers, `chrome.debugger`, and `captureVisibleTab` are all unreliable or unavailable in `--headless=new` as of Chrome 124. CI runs under Xvfb on Linux.

The harness brings up the daemon (`bproxy service start --port <ephemeral> --allow-eval --enable-debugger-mode`) per test file, sets the bearer token in `chrome.storage.local` programmatically (Playwright can write it via the SW's exposed test handle, see below), waits for the WS `hello`, then runs assertions.

What gets covered, by area:

- **SW lifecycle.** Force termination via `chrome.runtime.reload()` mid-`click`; assert pending entry replays once and the dedupe table returns the cached result rather than re-clicking. Half-open WS via Playwright's `route` interception emulating a stuck connection; assert app-level ping/pong recovers within 25 s.
- **Auth.** Missing token, bad token, `Host` mismatch, browser-origin (`Sec-Fetch-Site: cross-site`) all yield 401 → `AUTH_REQUIRED` with the right `details.reason`. Token rotation mid-flight: stop the daemon, restart it, the next command yields `AUTH_REQUIRED` until the test re-pastes; the new token then succeeds.
- **Idempotency.** Reuse an `id` with mismatched params → `REPLAY_REJECTED`. Burst beyond `MAX_PENDING` → `QUEUE_FULL`.
- **Page model.** Auto-wait on `click` (overlay-covered button, CSS-animated bbox until settled, disabled-then-enabled input); `wait` strategies; SPA `pushState`+render; `NEVER_SETTLED` continuous-mutation chat fixture; cached-fetch-reference page proves shim ordering; body-swap page proves `documentElement` root.
- **Frame routing.** Same-origin parent + same-origin iframe; Stripe-shaped cross-origin iframe; `about:srcdoc`; `data:` iframe; sandboxed-without-`allow-same-origin`; `loading="lazy"` below fold; `chrome://settings` for `RESTRICTED_URL`; SPA route change unmounting iframe mid-`type` for `FRAME_DETACHED`.
- **Tab management.** Multi-window pin survives Chrome window switch; minimized window → `TAB_NOT_VISIBLE` `reason: minimized`; two `--session` names share a tab without collision; pin survives SW restart; `--activate` restores previous active.
- **Debugger mode.** `--trusted` click on a page that asserts `event.isTrusted === true`; `DEBUGGER_DISABLED` when `--enable-debugger-mode` was not passed; `DEBUGGER_UNAVAILABLE` when another DevTools is already attached.
- **Multi-profile.** Two `launchPersistentContext` instances with distinct `--user-data-dir`; assert two WS connections, distinct `profileId`, `WRONG_PROFILE` on cross-profile session reuse.
- **Daemon ops.** `EADDRINUSE` → `PORT_IN_USE`; `service start` after a stale PID file recovers; enterprise-policy hint emitted only after 60 s with no extension ever connected.
- **Network shim.** Cached `window.fetch` reference grabbed before our shim → none (proves `document_start` ordering); SW-mediated cached responses surface as page-side `fetch` (the residual case from [12-risks.md](./12-risks.md) is asserted as the documented limit).

To make `chrome.runtime.reload`-style intrusion testable, the SW exposes a hidden `__bproxyTestBridge` keyed by a per-launch nonce written to `chrome.storage.session.testNonce`. The bridge is gated by `process.env.BPROXY_TEST === '1'` at build time so it is a no-op in distributed builds.

### Layer 3 — Anti-bot fixtures (gated)

Run separately under `npm run test:antibot`. Pulls live demo pages and is therefore network-flaky and rate-limit-sensitive; it does not gate the default `npm test` loop.

Pass criteria from [08-tab-management.md → debugger mode](./08-tab-management.md#shared-debugger-attachment-with-trusted-events) and the [Headline risk](./12-risks.md#headline-risk-the-extension-itself-is-fingerprintable):

- **Cloudflare Turnstile demo** (`https://turnstile.zeroclover.io/` or equivalent low-difficulty surface): under default mode, page renders without a challenge banner; under `--trusted`, a click on the target element resolves without re-challenging.
- **Datadome demo** (`https://antoinevastel.com/bots/datadome`): same shape.
- Negative-result tracking: every quarterly review records new fingerprint vectors found; passes do not silently regress because the fixture is run on every release-candidate.

## Coverage rule

Every error code in [06-failure-modes.md → Canonical error code table](./06-failure-modes.md#canonical-error-code-table) is reachable from at least one fixture. The taxonomy unit test asserts the inverse: a code that has no fixture entry fails CI.

| Code | Fixture |
|---|---|
| `NO_CONNECTION` | extension uninstalled mid-run |
| `EXTENSION_UNRESPONSIVE` | content-script `await new Promise(()=>{})` injected |
| `AUTH_REQUIRED` | missing/bad token, host mismatch, browser-origin (4 variants) |
| `EVAL_DISABLED` | daemon started without `--allow-eval` |
| `PROTOCOL_VERSION_MISMATCH` | extension build with bumped version |
| `SELECTOR_NOT_FOUND` | non-existent `#nope` and `--frame` miss |
| `SELECTOR_AMBIGUOUS` | two `<button class="x">` |
| `WAIT_TIMEOUT` | `wait selector` against permanently-hidden element |
| `NEVER_SETTLED` | continuous-mutation chat fixture |
| `NAVIGATED_DURING_ACTION` | click triggering `location.assign` |
| `FRAME_DETACHED` | SPA route change unmounting iframe mid-`type` |
| `RESTRICTED_URL` | `navigate chrome://settings`, then any DOM action |
| `TAB_CLOSED` | close pinned tab via `chrome.tabs.remove` |
| `NO_TAB_TARGETED` | session pin cleared mid-script |
| `TAB_NOT_VISIBLE` | minimize window, screenshot |
| `DEBUGGER_DISABLED` | `--trusted` without `--enable-debugger-mode` |
| `DEBUGGER_UNAVAILABLE` | DevTools open on the pinned tab |
| `WRONG_PROFILE` | two profiles, same `--session` |
| `PORT_IN_USE` | `nc -l <port>` then `service start` |
| `DAEMON_NOT_RUNNING` | any command without a daemon |
| `DAEMON_FAILED_TO_START` | port-binds-but-not-listens stub |
| `QUEUE_FULL` | 65 parallel commands at `MAX_PENDING=64` |
| `REPLAY_REJECTED` | re-issue `id` with mismatched params |
| `EVAL_ERROR` | `bproxy eval 'throw new Error()'` |
| `INTERNAL_ERROR` | injected fault via `__bproxyTestBridge` |

The macOS-Sequoia local-network-prompt smoke test is platform-conditional; it asserts the install banner copy is printed on `EADDRINUSE`-shape failures on Darwin.

## CI matrix

Cost vs. coverage trade-off: every cell costs minutes per release and a paid runner. Minimum:

| Trigger | OS | Chrome channel | Layers |
|---|---|---|---|
| Every PR | Linux (Xvfb) | stable | 1, 2 |
| Every PR | macOS | stable | 1, 2 |
| Every PR | Windows | stable | 1, 2 |
| Nightly | Linux | beta | 1, 2 |
| Release candidate | all three | stable | 1, 2, 3 |

Beta on Linux only because (a) Chrome's MV3 surface tends to regress earliest there, (b) one beta channel is enough to catch a breaking primitive change, (c) running beta on every OS triples cost without a proportional signal. macOS-specific behaviour (Sequoia local-network prompt, `~/Library/Logs/bproxy` paths) is exercised by Layer 2 on macOS stable.

## Local dev loop

```
npm test            # Layer 1 + Layer 2 against the host's Chrome
npm run test:unit   # Layer 1 only, < 10 s
npm run test:e2e    # Layer 2 only
npm run test:antibot  # Layer 3, requires network
```

Anti-bot is gated because (a) demo sites rate-limit and the tests are flaky against rate limits, (b) IP reputation matters — running them from CI cloud IPs degrades over time, (c) they assert against a third-party's defence posture which can change without notice. Treat Layer 3 as a release-candidate gate and a quarterly review cue, not a per-PR check.

## Test infrastructure as code

```
test/
├── fixtures/
│   ├── pages/
│   │   ├── basic.html               # links, buttons, inputs, text
│   │   ├── overlay.html              # button covered by overlay until t=500ms
│   │   ├── animated-bbox.html        # button moving until rAF settles
│   │   ├── body-swap.html            # replaces document.body on load
│   │   ├── cached-fetch.html         # captures window.fetch in <head>
│   │   ├── chat-mutation.html        # NEVER_SETTLED
│   │   ├── spa-pushstate.html        # synchronous pushState + render
│   │   ├── parent-iframe.html        # same-origin iframe
│   │   ├── stripe-shape.html         # cross-origin iframe
│   │   ├── srcdoc.html
│   │   ├── data-iframe.html
│   │   ├── sandboxed-no-sao.html
│   │   ├── lazy-iframe.html          # loading="lazy" below fold
│   │   └── sw-cache.html             # registers a SW that caches /api/*
│   └── server.js                     # minimal static server with deterministic delays
├── helpers/
│   ├── launch.js                     # Playwright + extension launcher
│   ├── daemon.js                     # spawns/teardowns bproxy service per file
│   └── bridge.js                     # __bproxyTestBridge access
├── unit/
│   ├── taxonomy.test.js
│   ├── idempotency.test.js
│   └── cli-args.test.js
├── e2e/
│   ├── sw-lifecycle.spec.js
│   ├── auth.spec.js
│   ├── frames.spec.js
│   ├── tabs.spec.js
│   ├── debugger-mode.spec.js
│   ├── multi-profile.spec.js
│   └── coverage.spec.js              # asserts every code in the table is reachable
├── antibot/
│   ├── turnstile.spec.js
│   └── datadome.spec.js
└── playwright.config.js
```

`playwright.config.js` runs the `e2e/` and `antibot/` projects with separate launch options; `unit/` runs through `node --test`. `package.json` scripts:

```jsonc
{
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "node --test test/unit/*.test.js",
    "test:e2e": "playwright test --project=e2e",
    "test:antibot": "playwright test --project=antibot"
  }
}
```

The harness is in place from Phase 0 of [11-implementation-order.md](./11-implementation-order.md) — even before any fixture exists — so every subsequent task lands with a working test target.
