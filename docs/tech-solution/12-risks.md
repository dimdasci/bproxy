# 12. Technical Risks

[← Index](./README.md) · Prev: [Implementation Order](./11-implementation-order.md)

---

Single canonical risk register. Every risk cross-references the doc section that mitigates it. Removed entries that duplicated content already normative in 01–09.

## Headline risk: the extension itself is fingerprintable

bproxy exists because Playwright-style automation gets blocked by Cloudflare, Datadome, HUMAN, and Akamai. Running inside a real user browser closes the easy detection paths (real TLS fingerprint, real WebGL/canvas, real cookies, real session, real navigator entropy) — but it does **not** automatically close the harder ones.

The four detection surfaces that survive into a real-Chrome extension architecture:

1. **Untrusted DOM events.** `element.click()`, `dispatchEvent(new MouseEvent(...))`, and `chrome.scripting.executeScript({ world: 'MAIN', func })` all set `event.isTrusted = false`. Cloudflare Turnstile, Datadome, HUMAN, and Akamai consume `isTrusted` as a primary signal ([Castle.io — Detecting CDP-injected scripts](https://blog.castle.io/how-to-detect-scripts-injected-via-cdp-in-chrome-2/), [Tapscape — Cloudflare Turnstile bypass guide](https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/)).
2. **MAIN-world wrapper signatures.** Without protection, `window.fetch.toString()` exposes the wrapper body — the cheapest fingerprint a bot script can do, and the same vector that detects puppeteer-extra-stealth ([puppeteer-extra#403 — toString detection](https://github.com/berstend/puppeteer-extra/issues/403)).
3. **MAIN-world script execution traces.** Per-extension fingerprints from DOM mutations and global-namespace pollution survive toString patching ([ACM CCS 2024 — Peeking through the window](https://dl.acm.org/doi/10.1145/3658644.3670339)).
4. **MutationObserver overhead.** A page that storms cheap mutations can measure the cost differential from `performance.now()`.

**Mitigations** — best-effort stealth as the default, opt-in trusted events, opt-in per-domain shim disable. Specified in:

- [04-extension.md → Native-form preservation](./04-extension.md#native-form-preservation-for-the-main-world-shim) — closure-scoped wrappers, cached `Function.prototype.toString.call(orig)`, proxied `Function.prototype.toString`.
- [04-extension.md → Debugger mode](./04-extension.md#debugger-mode-trusted-events-and-cdp-screenshots) and [02-cli-design.md → `--trusted` flag](./02-cli-design.md#trusted-flag-on-click-type-navigate) — `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` produce `isTrusted === true`. Trusted-event dispatch via `Input.*` does not require `Runtime.enable`, so the Datadome CDP-detection signal ([DataDome — How New Headless Chrome & the CDP Signal Are Impacting Bot Detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)) is not tripped.
- [02-cli-design.md → `bproxy domain` config](./02-cli-design.md#bproxy-domain-configuration) and [05-page-state.md → Per-domain shim disable](./05-page-state.md#per-domain-shim-disable) — `--no-network-shim` per origin.

**Residual** — read carefully:

- **Default mode is detectable on hard-protected sites.** Pages that consume `event.isTrusted` from clicks (Cloudflare Turnstile, Datadome, HUMAN, Akamai) will see synthetic events. The mitigation is `--trusted`, not a default-mode change — the user-visible Chrome banner is unacceptable always-on.
- **Debugger mode trades one signal for another.** `chrome.debugger.attach` shows a non-suppressible "extension started debugging this browser" infobar. Some bot scripts also flag attached debuggers via timing or protocol-monitor probes. Better than `isTrusted: false` on most sites; not undetectable.
- **No mode is undetectable.** Runtime-attestation challenges of the Cloudflare Turnstile class ([Penligent — ChatGPT and Cloudflare Turnstile React-state analysis](https://www.penligent.ai/hackinglabs/chatgpt-and-cloudflare-turnstile-what-the-react-state-analysis-actually-shows/)) will eventually identify bproxy. We are climbing a finite ramp.
- **Extension fingerprint research generalises.** ACM CCS 2024 found 2,747 Chrome extensions susceptible to fingerprinting via injected-code traces alone. bproxy is a member of that population; deeper evasion (no MAIN-world content scripts, all-CDP control plane) is not on the v1 roadmap.

**Validation**: Layer 3 fixtures in [10-testing.md → Anti-bot fixtures](./10-testing.md#layer-3--anti-bot-fixtures-gated). The contract surface is a Cloudflare Turnstile demo and a Datadome demo, not paying customer production sites.

## Architectural risks (mitigated in design)

These risks were identified during design review and are now resolved in the normative chapters. The summary lives here; the detail lives in the cited section.

### MV3 service worker termination kills WebSocket

Chrome terminates MV3 SWs after ~30 s of inactivity. An inbound WS frame does not wake a stopped SW.

**Mitigation**: [04-extension.md → MV3 service worker lifecycle](./04-extension.md#mv3-service-worker-lifecycle) — `chrome.alarms` heartbeat at 30 s, app-level WS ping/pong, pending state in `chrome.storage.session`, dedupe table for at-most-once destructive replays. Reconnect backoff capped under SW idle.

**Residual**: First command after a long idle window can wait up to one alarm cycle (~30 s). Inherent to MV3.

### CSP blocks inline script injection

The original `eval` injected a `<script>` tag. CSP-strict sites silently block it.

**Mitigation**: [04-extension.md → eval](./04-extension.md#eval-in-the-main-world) — `chrome.scripting.executeScript({ world: 'MAIN' })` bypasses page CSP. Same fix applied to network interception. **Residual**: none.

### Settle detection blocks actions on never-settle pages

Chat apps, lazy-load lists, and live feeds never reach "ready."

**Mitigation**: [05-page-state.md](./05-page-state.md) — auto-wait on the **target's** local quiescence, not global page settle. `page.state` is advisory. `bproxy wait settle` uses adaptive quiescence (200 ms – 2 s) and returns structured `NEVER_SETTLED` with busiest mutation roots. Observer is anchored at `document.documentElement` so body-swap pages survive.

**Residual**: Pages whose only "ready" signal is purely visual (no DOM marker, no network completion) cannot be observed. Documented as a fundamental limit.

### SPA navigate via pushState doesn't trigger routers

**Mitigation**: [05-page-state.md → SPA navigation detection](./05-page-state.md#spa-navigation-detection) — `navigate` always uses `chrome.tabs.update()` for full reloads. SPA-internal navigation is via clicks. MAIN-world history patch dispatches `bproxy:locationchange` synchronously with `pushState` / `replaceState`. **Residual**: full reload is slower than a true SPA transition; reliability over speed.

### Selector generation reliability

**Mitigation**: [02-cli-design.md → elements](./02-cli-design.md#bproxy-elements) — priority fallback `#id` (if stable) → `[data-testid]` → `[name]` → `[aria-label]` → shortest unique CSS path. Skip dynamic-looking IDs. **Residual**: some pages still produce fragile selectors. `eval` is the escape hatch.

### Localhost proxy exposes everything to anything on 127.0.0.1

**Mitigation**: [03-proxy-service.md → Authentication](./03-proxy-service.md#authentication) — bearer token via `Sec-WebSocket-Protocol`, `Host` allowlist (defeats DNS rebinding), `Origin` + `Sec-Fetch-Site` check, `--allow-eval` opt-in. **Residual**: malware running as the same user can read the token file (OS-level isolation problem). Token rotation requires re-pasting in the extension options page.

### Screenshot focus-steal and silent target drift

**Mitigation**: [08-tab-management.md](./08-tab-management.md) — sticky `--session` pin in `chrome.storage.session.tabs`; default screenshot calls `captureVisibleTab(windowId)` only when the pinned tab is the active tab of an unminimized window, otherwise `TAB_NOT_VISIBLE`. `--activate` and `--debugger` are documented opt-ins. **Residual**: minimized windows always fail (`TAB_NOT_VISIBLE` `reason: minimized`); returning a black PNG is worse than failing.

### Multi-profile Chrome (Work / Personal)

**Mitigation**: [03-proxy-service.md → Multi-profile WebSocket clients](./03-proxy-service.md#multi-profile-websocket-clients) and [08-tab-management.md → Profile-bound sessions](./08-tab-management.md#profile-bound-sessions) — `extensionsByProfileId` map keyed by persisted UUID, sessions auto-bind on first self-pinning command, `WRONG_PROFILE` on cross-profile reuse, `bproxy session bind` escape hatch. **Residual**: profile UUID is per-installation; reinstalling the extension breaks existing session bindings.

### Failure-mode taxonomy collapsed five distinct causes onto one bucket

The legacy `EXTENSION_TIMEOUT` made retry decisions undecidable.

**Mitigation**: [06-failure-modes.md](./06-failure-modes.md) — RFC-9457-aligned envelope with seven categories, deprecated `EXTENSION_TIMEOUT` and `FRAME_NOT_FOUND`, `retry: conditional` for cases the agent can resolve. The wire-side lint asserted by [10-testing.md](./10-testing.md) prevents regression. **Residual**: none.

### Cross-platform install and daemon lifecycle

The original "run `node service/index.js`" had no PID, no port-conflict, no detachment, no log destination, no platform parity.

**Mitigation**: [09-build.md](./09-build.md) and [03-proxy-service.md → Service lifecycle](./03-proxy-service.md#service-lifecycle) — `npm i -g bproxy` with `bin` shim on every platform, `bproxy service start | stop | restart`, PID file in per-platform state directory, `EADDRINUSE` → `PORT_IN_USE`. **Residual**: see Operational below.

## Implementation residuals

These are honest residuals of the design decisions, not bugs we are hiding.

- **Token rotation friction.** Each `bproxy service start` rotates the bearer token; the user re-pastes it into the extension options page. We considered automation (extension polls for the new token, native messaging) and rejected each — they re-introduce the trust gap auth is closing. Documented in [03-proxy-service.md → Authentication](./03-proxy-service.md#authentication).
- **Sideload-only distribution.** The extension is sideloaded via Developer Mode for v1; CWS publication is out of scope (review surface is non-trivial). The Developer Mode banner is a daily UX cost.
- **Service-worker-mediated fetches are invisible.** The MAIN-world shim can see page-side `fetch`, but a page service worker that fulfils from Cache or IndexedDB issues wire-level requests our content script cannot intercept. For idle detection this is a non-issue; for `wait response <urlGlob>` it can miss SW-cached URLs the page never sees. Workaround: `chrome.devtools.network` (out of scope for v1).
- **Shadow DOM.** `querySelector` does not pierce shadow roots. `eval` with custom traversal is the escape hatch; a `deepQuerySelector` helper is deferred.
- **Cross-origin frames cannot be read by the parent.** The agent must address them with `--frame` directly. We do not bypass same-origin policy.

## Operational residuals

These will surface in real installs. Right answer: "we know, here's the workaround."

- **Enterprise `ExtensionInstallBlocklist`.** Managed Chrome with the policy set silently disables the sideloaded extension. The daemon emits `NO_CONNECTION` with `details.hint: "extension may be disabled by policy; check chrome://extensions"` after 60 s with no extension having ever connected. See [06-failure-modes.md → Enterprise policy hint](./06-failure-modes.md#enterprise-policy-hint).
- **macOS Sequoia local-network prompt.** macOS 15+ prompts the responsible terminal application on first listen. Documented in the install banner; we cannot pre-empt the prompt.
- **Token file ACL on Windows.** `chmod 0600` does not exist; install path uses `icacls` to set owner-only ACE under `%LOCALAPPDATA%\bproxy\`. Roaming profiles are out of scope; LocalAppData is by definition not roamed.
- **Chrome version drift.** A Chrome auto-update can break a primitive between two of our releases. Mitigation: pin `minimum_chrome_version`, test the integration matrix per release, accept that users on broken combinations stay on the previous bproxy until we ship a patch.
- **Symlinked profiles, Snap/Flatpak Chromium, ChromeOS ARC++.** Untested but expected to work; loopback access is permitted in all these sandboxes.

## Out-of-scope (acknowledged untouched)

We say so up front rather than half-deliver:

- TLS / WebGL / canvas fingerprint spoofing. Chrome's real TLS is the entire point.
- Residential proxy rotation, IP reputation management.
- CAPTCHA solving.
- Anti-detect-browser repackaging (Multilogin / Kameleo style — a different product class; [Multilogin — Browser fingerprint Chrome](https://multilogin.com/blog/browser-fingerprint-chrome/)).
- Chrome Web Store distribution. Reconsider once the threat model and user copy stabilise.
- Multiple daemons per OS user. Solved by running under different OS users.
- Pin-by-URL-pattern. Ambiguous when multiple tabs match; `tab list` + numeric `id` is the contract.
- Per-frame session pin. `--frame` is per-command.
- Full-page screenshot stitching.

## Cassandra: the three things that will surprise us in production

Top three things we expect to be wrong about, with their early-warning indicators. If the indicator fires, the assumption was wrong and the design needs revisiting before a quarterly review.

### 1. Adaptive quiescence will misidentify "ready" on a site we have not seen

**Why we will be wrong**: median-inter-mutation-gap is a heuristic against an adversarial design space. A modern framework that paints into a `<canvas>` (Figma, Linear's editor surface) emits no DOM mutations during the visible state change, so settle returns "ready" while the page is still rendering. The meaningful-mutation predicate is the same shape and will silently agree.

**Early warning**: any incoming bug report of the form "`bproxy click` succeeded but the page was still loading" against a canvas-rendered or WebGL-rendered surface. A spike in agent retries against pages whose `page.state == 'ready'` came back with `data` that the agent rejected.

**What to do**: add a per-origin quiescence override (`bproxy domain set <pattern> --settle-strategy paint-stable`) and a `wait paint` strategy that polls a low-rate `requestAnimationFrame` callback with framebuffer-hash sampling.

### 2. Cloudflare Turnstile will move the goalposts on `--trusted`

**Why we will be wrong**: the Datadome CDP-detection disclosure is recent ([June 2024](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)). Cloudflare ships challenges weekly and the `chrome.debugger` infobar plus the protocol-monitor surface are both observable. A Turnstile update that adds an attached-debugger probe makes our `--trusted` mode regress overnight.

**Early warning**: anti-bot Layer 3 fixture goes red without a code change. Negative-result tracking quarterly review records a new fingerprint vector. User reports of "worked yesterday, blocked today" against Turnstile- or Datadome-protected sites.

**What to do**: be honest in the install banner that `--trusted` is mitigation, not bypass; have the `--no-shim` per-session flag ready to ship as a follow-up.

### 3. Multi-profile Chrome will produce a session-binding bug we did not anticipate

**Why we will be wrong**: profile binding is at first-self-pinning-command. The interaction with concurrent agents that share a `--session default` and target tabs in different profiles is correct on paper, but the failure mode (`WRONG_PROFILE`, `retry: false`) requires the agent to know about profiles. Most agents will not. The first user report will be "my script worked yesterday and now I get `WRONG_PROFILE` and I do not know what that means."

**Early warning**: any `WRONG_PROFILE` in a daemon log paired with a CLI invocation that did not pass `--session`. A spike in `bproxy session bind` calls in the wild after a Chrome profile update.

**What to do**: emit a one-line install hint when the daemon first sees more than one connected profile ("you have N profiles; pass `--session` per agent"). Consider a `bproxy session reset --session <name>` that the user can run without thinking about `profileId`.
