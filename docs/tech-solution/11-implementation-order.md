# 11. Implementation Order

[← Index](./README.md) · Prev: [Testing Strategy](./10-testing.md) · Next: [Technical Risks →](./12-risks.md)

---

The principle: **nothing lands until it can be tested.** The previous draft put `navigate` before page-state design, `eval` near the end (when it is the cheapest way to validate the full round-trip), content-script auto-reinjection at step 15 (multi-page tests fail without it), and the test harness at step 19 (every preceding claim was unverifiable).

Each phase ends with a runnable, testable deliverable. Tests written in a phase use the harness from [10-testing.md](./10-testing.md) and the fixtures available at that point.

## Phase 0 — Foundations

Nothing in any later phase is testable until this phase is done. Phase 0 is allowed to be small and ugly; it is not allowed to be missing.

- Project skeleton: `package.json` with `bin: { "bproxy": "./cli/bproxy.js" }`, Node ≥ 20.10 engine pin, `extension/` and `service/` workspaces.
- Daemon lifecycle: `bproxy service start | stop | restart | status`, PID file under per-platform state directory, detached spawn via `child_process.spawn(detached: true)` + `unref`, log rotation, `EADDRINUSE` → `PORT_IN_USE`, `DAEMON_NOT_RUNNING`, `DAEMON_FAILED_TO_START`. Source: [03-proxy-service.md → Service lifecycle](./03-proxy-service.md#service-lifecycle), [09-build.md](./09-build.md).
- Auth bootstrap: token file `0600` (POSIX) / owner-only ACL (Windows), options page that displays connection state, WS subprotocol `bproxy.bearer.v1.<token>`, `Host`/`Origin`/`Sec-Fetch-Site` gates on HTTP. Source: [03-proxy-service.md → Authentication](./03-proxy-service.md#authentication).
- Test harness skeleton: Playwright launches Chromium with the extension loaded, the daemon comes up on an ephemeral port, the `__bproxyTestBridge` test seam is wired. No fixtures yet — the infrastructure runs `assert(true)`.

**Phase 0 ships when**: `bproxy service start` works on macOS, Linux, and Windows; `bproxy status` returns a daemon-up envelope; the test harness can launch a browser and tear it down.

## Phase 1 — Minimum viable round-trip

The point of Phase 1 is to validate **CLI → proxy → SW → content script → page → back** with the smallest possible action surface. `eval` is included because it is the lowest-risk way to validate that round-trip; `text` is included because it is the simplest read-only contract.

- SW lifecycle: `chrome.alarms` keepalive at 30 s, `chrome.storage.session` pending map, exponential-backoff reconnect (cap < SW idle), `bproxy-ready` ack from content script. Source: [04-extension.md → MV3 service worker lifecycle](./04-extension.md#mv3-service-worker-lifecycle).
- Bearer auth gate enforced end to end: 401 → `AUTH_REQUIRED` with `details.reason`.
- One read-only command (`text`) and `eval` (gated by `--allow-eval`) — proves the round-trip end to end without yet committing to the page-state model.
- Content script auto-reinjection on navigation (every multi-page test fails without it). Source: [04-extension.md → Content script communication](./04-extension.md#content-script-communication).
- Idempotency layer: dedupe by `(profileId, id)`, `replay: true` flag, replay-on-reconnect, `REPLAY_REJECTED`, `QUEUE_FULL`. Source: [03-proxy-service.md → Replay on reconnect](./03-proxy-service.md#replay-on-reconnect), [04-extension.md → Dedupe table](./04-extension.md#dedupe-table-and-request-lifecycle).

**Phase 1 ships when**: three integration tests pass — SW restart mid-`text`, `REPLAY_REJECTED` on id reuse with mismatched params, and `AUTH_REQUIRED` on bad token.

## Phase 2 — Page model

Now that the round-trip is provably reliable, build the page-correctness layer that destructive actions need. `navigate` lands here, **after** settle/auto-wait exists, not before.

- Auto-wait actionability for `click` and `type` (visible + stable bbox + pointer-events + enabled/editable). Source: [05-page-state.md](./05-page-state.md).
- Explicit waiter API (`bproxy wait <strategy>`).
- `navigate` with two-tier wait (load + settle), full-page only (no SPA `pushState`).
- History API patching in MAIN world (`pushState` / `replaceState` / `popstate` / `hashchange` → `bproxy:locationchange`).
- MAIN-world `document_start` network shim (`fetch`, `XMLHttpRequest`, `sendBeacon`, `EventSource`, `WebSocket`, dynamic imports).
- Adaptive quiescence (median inter-mutation gap, 200 ms – 2 s) with meaningful-mutation predicate; `documentElement` root; `NEVER_SETTLED` payload.
- Multi-frame routing: `--frame <selector|index|/regex/>`, frame table from `chrome.webNavigation`, `match_origin_as_fallback`, `RESTRICTED_URL` and `FRAME_DETACHED`.

**Phase 2 ships when**: every page-model fixture from [10-testing.md](./10-testing.md) Layer 2 passes — overlay-covered button, animated-bbox, body-swap, cached-fetch ordering, SPA `pushState`+render, NEVER_SETTLED chat, and the iframe matrix (same-origin, cross-origin Stripe-shape, `srcdoc`, `data:`, sandboxed, lazy).

## Phase 3 — Capture and control

The agent UX surface and the failure-mode taxonomy land here, on top of a working page model.

- `captureVisibleTab(windowId)` default screenshot with the no-focus-steal-by-default rule; `--activate` opt-in.
- Sticky session pin in `chrome.storage.session.tabs`, `--session` qualifier, `bproxy tab list | pin | unpin | open | close`. Source: [08-tab-management.md](./08-tab-management.md).
- The full failure-mode taxonomy from [06-failure-modes.md](./06-failure-modes.md) wired into every dispatcher path; deprecated codes blocked at the wire by a lint.
- The remaining read-only / structural commands: `images`, `elements`, `outline`, `dom`, `wait --network`, `wait --response`.

**Phase 3 ships when**: the coverage matrix in [10-testing.md → Coverage rule](./10-testing.md#coverage-rule) is satisfied for every code emitted from this layer (multi-window pin, minimized-window `TAB_NOT_VISIBLE`, two-session non-collision, `SELECTOR_AMBIGUOUS`, `WAIT_TIMEOUT`, etc.).

## Phase 4 — Stealth and observability

The anti-bot work from task 8 lands once the rest of the system is reliable. Putting it earlier risks hiding correctness bugs behind detection signal.

- Native-toString preservation in the network shim and history patch (closure-scoped wrappers, cached `Function.prototype.toString.call(orig)`, proxied `Function.prototype.toString` to defeat per-property bypass).
- `--trusted` via `chrome.debugger` (`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`), gated behind `bproxy service start --enable-debugger-mode`. The `--debugger` screenshot path shares the same attachment.
- `bproxy domain set <pattern> --no-network-shim` per-domain disable, with the documented cost: `wait --network` and `wait --response` no-op on disabled origins. Source: [05-page-state.md → Per-domain shim disable](./05-page-state.md#per-domain-shim-disable).
- Anti-bot fixtures wired into the release-candidate CI gate (Cloudflare Turnstile demo, Datadome demo).

**Phase 4 ships when**: `--trusted` produces `event.isTrusted === true` on the assertion fixture, the Turnstile and Datadome demos pass under their respective documented modes, and `Function.prototype.toString.call(window.fetch)` returns the native form on the cached-fetch fixture.

## Phase 5 — Multi-profile and ops

The cross-platform installation and multi-profile work from task 9 lands last because it requires the full system to be exercisable across a CI matrix.

- Profile-bound sessions: WS `hello` frame with `profileId`, `extensionsByProfileId` map, auto-bind on first self-pinning command, `WRONG_PROFILE` on cross-profile reuse, `bproxy session bind <session> <profileId>` escape hatch.
- Cross-platform install verification across the [10-testing.md → CI matrix](./10-testing.md#ci-matrix): macOS, Linux, Windows × stable, plus Linux × beta nightly.
- Enterprise-policy hint (60 s no-extension-ever-connected → `details.hint`).
- macOS Sequoia local-network-prompt smoke test (banner copy on `EADDRINUSE`-shape Darwin failure).

**Phase 5 ships when**: the full release-candidate matrix is green, including Layer 3 anti-bot fixtures.

## Out of v1

Documented in [12-risks.md → Out-of-scope](./12-risks.md#out-of-scope-acknowledged-untouched). Not a phase; an explicit non-goal list.

- Chrome Web Store distribution.
- TLS / canvas / WebGL fingerprint spoofing.
- CAPTCHA solving.
- Shadow-DOM piercing utilities (`deepQuerySelector`).
- Full-page screenshot stitching.
