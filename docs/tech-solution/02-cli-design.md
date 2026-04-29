# 2. CLI Design

[← Index](./README.md) · Prev: [Output Contract](./01-output-contract.md) · Next: [Proxy Service →](./03-proxy-service.md)

---

## Commands

```
bproxy service start [--port N] [--allow-eval] [--enable-debugger-mode]
bproxy service stop                  # graceful then forceful daemon shutdown
bproxy service restart               # stop then start, preserving prior flags
bproxy service status                # alias for `bproxy status`
bproxy status                        # connection health check
bproxy session list                  # list sessions and their bound profiles
bproxy session bind <session> <profileId>   # bind a session to a profile (multi-profile users)
bproxy navigate <url> [--trusted]    # go to URL, wait for load
bproxy click <selector> [--trusted]  # click element (auto-waits)
bproxy type <selector> <text> [--trusted]  # clear field, type text (auto-waits)
bproxy text [selector]               # read text (default: body)
bproxy images [selector]             # list images with src and alt
bproxy elements                      # list interactive elements
bproxy outline                       # page structure: landmarks + headings
bproxy dom [selector] [--depth N]    # simplified DOM subtree
bproxy screenshot [--activate] [--debugger]   # capture pinned tab's viewport
bproxy wait <strategy> [args]        # explicit waiter (selector/url/function/response/navigation/settle)
bproxy eval <code>                   # run JS in page context
bproxy tab list [--profile <id>]     # list open tabs across all windows (default: all profiles)
bproxy tab pin <id>                  # pin session to tab id
bproxy tab unpin                     # release session pin
bproxy tab open <url> [--activate]   # open a new tab and pin it
bproxy tab close [<id>]              # close a tab (default: pinned)
bproxy domain list                   # list per-domain config rules
bproxy domain set <pattern> [opts]   # set per-domain config (see `bproxy domain`)
bproxy domain unset <pattern>        # remove a per-domain rule
```

Every command accepts an optional `--session <name>` qualifier. Default is `default`, or the value of `BPROXY_SESSION` if set. Sessions are documented under [`--session` qualifier](#session-qualifier) below.

## `bproxy service`

The lifecycle commands for the long-running daemon. Full semantics — PID file, port discovery, daemonization, log paths, multi-profile WS — are owned by [03-proxy-service.md → Service lifecycle](./03-proxy-service.md#service-lifecycle); this section is the CLI surface only.

```
bproxy service start [--port <N>] [--allow-eval] [--enable-debugger-mode]
bproxy service stop
bproxy service restart
bproxy service status            # alias for `bproxy status`
```

`service start` is the only entry point for launching the daemon. It detaches via `child_process.spawn(detached: true)`, polls `/version` until ready (5 s ceiling), and exits 0 with a banner naming the PID file path, the log path, and the token path. On failure it prints a structured error (`PORT_IN_USE`, `DAEMON_ALREADY_RUNNING`, `DAEMON_FAILED_TO_START`) and exits 1. On `--port <N>`, the chosen port is recorded in the PID file so subsequent CLI invocations talk to the same daemon without an environment variable.

`service stop` reads the PID file, sends `SIGTERM` (POSIX) or `process.kill(pid)` (Windows), waits up to 5 s, then escalates to `SIGKILL` / `taskkill /F`. On a missing PID file it prints `DAEMON_NOT_RUNNING` and exits 1.

`service restart` reads the running daemon's start flags from `/status` (`evalEnabled`, `debuggerModeEnabled`, `port`), runs `service stop`, then `service start` with those flags preserved. If the daemon is already gone, restart falls through to a fresh start using the flags passed on the `restart` invocation.

`service status` is exactly equivalent to `bproxy status`; it exists as a discoverable verb under the `service` group.

### `--port` resolution on the CLI

Every CLI command (not just `service`) needs to know the port. Resolution order:

1. `--port <N>` on the command line.
2. `BPROXY_PORT` environment variable.
3. Line 2 of the PID file at the per-platform runtime directory (see [03-proxy-service.md → State directories](./03-proxy-service.md#state-directories)).
4. Default `9615`.

If the file is missing and `9615` returns connection-refused, the CLI emits `DAEMON_NOT_RUNNING` (see [03-proxy-service.md → Daemon-not-running envelope](./03-proxy-service.md#daemon-not-running-envelope)).

## `bproxy status`

Returns system health. Agent should call this first if unsure. The CLI hits the daemon's `/status` endpoint (auth-gated; see [03-proxy-service.md → `bproxy status` endpoint](./03-proxy-service.md#bproxy-status-endpoint)) and prints the response verbatim.

```json
{
  "ok": true,
  "data": {
    "version": "0.x.y",
    "protocolVersion": 1,
    "uptimeMs": 184302,
    "port": 9615,
    "pid": 28412,
    "evalEnabled": false,
    "debuggerModeEnabled": false,
    "extensions": [
      { "profileId": "p_1f3c9a", "profileLabel": "Work",     "extensionVersion": "0.x.y" },
      { "profileId": "p_8b21d0", "profileLabel": "Personal", "extensionVersion": "0.x.y" }
    ],
    "pendingCommands": 0,
    "pinnedTabsBySession": [
      { "session": "default",  "profileId": "p_1f3c9a", "tabId": 42 },
      { "session": "reviewer", "profileId": "p_8b21d0", "tabId": 87 }
    ]
  }
}
```

`extensions` is a (possibly empty) array of connected extensions, one per Chrome profile that has the extension installed and the token pasted. An empty array means the daemon is up but no extension is currently connected — the agent should open Chrome and confirm the extension is enabled.

`ok: true` because the command itself succeeded — the daemon answered. The agent reads `extensions` length and `pinnedTabsBySession` to decide whether to wait, prompt the user to enable the extension, or proceed.

### Daemon-not-running response

When the daemon cannot be reached (no PID file, or `ECONNREFUSED` on the recorded port), the CLI emits a structured envelope rather than a stack trace:

```json
{
  "ok": false,
  "error": {
    "code": "DAEMON_NOT_RUNNING",
    "category": "connection",
    "retry": true,
    "suggestedAction": "run `bproxy service start`",
    "message": "bproxy daemon is not running on 127.0.0.1:9615",
    "details": { "port": 9615, "pidFilePresent": false }
  }
}
```

Exit code `1`. The pre-existing `PROXY_NOT_RUNNING` is the legacy spelling for the same situation when surfaced from a non-`status` command; both are listed in [06-failure-modes.md → Daemon-related codes](./06-failure-modes.md#daemon-related-codes).

## `bproxy session`

Sessions are profile-bound on multi-profile installs (see [03-proxy-service.md → Multi-profile WebSocket clients](./03-proxy-service.md#multi-profile-websocket-clients) and [08-tab-management.md → Profile-bound sessions](./08-tab-management.md#profile-bound-sessions)). Single-profile users do not see this surface; it is shown in `bproxy --help` only when `bproxy status` reports more than one connected extension.

```
bproxy session list                       # show every session and its profile binding
bproxy session bind <session> <profileId> # set the binding (rejects on conflict)
bproxy session unbind <session>           # drop the binding (next command auto-binds again)
```

`session list` response:

```json
{
  "ok": true,
  "data": {
    "sessions": [
      { "session": "default",  "profileId": "p_1f3c9a", "profileLabel": "Work",     "boundAt": 1714000005000, "boundBy": "auto" },
      { "session": "reviewer", "profileId": "p_8b21d0", "profileLabel": "Personal", "boundAt": 1714000010500, "boundBy": "explicit" }
    ]
  }
}
```

`boundBy` is `"auto"` when the daemon inferred the binding from a self-pinning command (`navigate`, `tab pin`, `tab open`) and `"explicit"` when the user ran `session bind`. The two are equally valid; the field is for the user's mental model.

`session bind` is idempotent — re-binding to the same profile is a no-op. Binding to a different profile while the session has a live pin returns `INVALID_COMMAND` with `details.reason: "session_has_active_pin"`; the user runs `bproxy --session <name> tab unpin` first.

## `bproxy elements`

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
- `selector` is auto-generated with this priority fallback:
  1. `#id` — only if the ID is truly unique on the page (skip duplicate IDs, common in real HTML).
  2. `[data-testid="..."]` — test IDs are the most stable selectors on modern apps.
  3. `[name="..."]` — form element names.
  4. `[aria-label="..."]` — accessibility labels, stable across redesigns.
  5. Shortest unique CSS path — prefer tag + class combos over deeply nested positional paths. Avoid React/Angular dynamic IDs (e.g., `r-abc123`, `ng-c1234`).
- `text` is trimmed, max 80 chars.
- Cap at 200 elements. If more, return `"truncated": true` and suggest the agent narrow scope with `bproxy elements <selector>` (scoped to a container).

## `bproxy images`

Returns a flat list of images on the page. Agents use this to understand visual content, find logos, product images, captchas, or any image-based information.

```json
{
  "ok": true,
  "data": {
    "images": [
      { "index": 1, "src": "https://example.com/logo.png", "alt": "Company Logo", "width": 200, "height": 60, "selector": "img.logo" },
      { "index": 2, "src": "https://example.com/hero.jpg", "alt": "", "width": 1200, "height": 400, "selector": "img.hero-banner" },
      { "index": 3, "src": "https://example.com/chart.png", "alt": "Q4 Revenue Chart", "width": 600, "height": 300, "selector": ".report img:nth-of-type(1)" }
    ]
  }
}
```

Rules for image collection:
- Only visible images with a resolved `src` (skip broken, hidden, or tracking pixels).
- Filter out images smaller than 10×10 px (spacers, trackers).
- `src` is the fully resolved absolute URL.
- `alt` is returned as-is (empty string if missing — agents should note this).
- `width` and `height` are the rendered dimensions, not the natural size.
- `selector` is auto-generated, same strategy as `elements`.
- Optional `[selector]` param scopes the scan to a container: `bproxy images ".product-gallery"`.
- Cap at 100 images. If more, return `"truncated": true`.

## `bproxy outline`

Returns the semantic structure of the page — landmarks and heading hierarchy. This is the agent's first step on an unknown page: understand the layout before interacting.

```json
{
  "ok": true,
  "data": {
    "title": "Acme Corp — Pricing",
    "url": "https://acme.com/pricing",
    "regions": [
      { "tag": "header", "role": "banner",        "selector": "header",       "summary": "Acme Corp logo, nav links" },
      { "tag": "nav",    "role": "navigation",    "selector": "nav.main-nav", "summary": "Home, Products, Pricing, Blog, Contact" },
      { "tag": "main",   "role": "main",          "selector": "main",         "summary": "h1: Pricing Plans, 3 sections" },
      { "tag": "aside",  "role": "complementary", "selector": "aside.faq",    "summary": "h2: FAQ, 5 items" },
      { "tag": "footer", "role": "contentinfo",   "selector": "footer",       "summary": "Copyright, legal links" }
    ],
    "headings": [
      { "level": 1, "text": "Pricing Plans",    "selector": "main h1" },
      { "level": 2, "text": "Starter",          "selector": "#plan-starter h2" },
      { "level": 2, "text": "Professional",     "selector": "#plan-pro h2" },
      { "level": 2, "text": "Enterprise",       "selector": "#plan-enterprise h2" },
      { "level": 2, "text": "FAQ",              "selector": "aside.faq h2" }
    ]
  }
}
```

Region detection:
- **Semantic HTML5 elements**: `<header>`, `<nav>`, `<main>`, `<aside>`, `<article>`, `<section>`, `<footer>`.
- **ARIA landmarks**: any element with `role` attribute (`banner`, `navigation`, `main`, `complementary`, `contentinfo`, `search`, `form`).
- **Fallback heuristics** for pages with no semantic markup: scan for common IDs/classes (`#nav`, `#header`, `.sidebar`, `#content`, `#main`, `.footer`, `#menu`). Report these as regions with `"tag": "div"` and the matched class/id as selector.
- `summary` is auto-generated: first heading inside the region (if any) + first 60 chars of text content + child element count. Keeps the agent oriented without fetching full text.
- Headings (h1–h6) are always collected regardless of landmark quality. Even pages with no landmarks have headings.

Typical agent workflow:
```
1. bproxy outline           → "nav is in nav.main-nav, content is in main"
2. bproxy text main         → get the body copy
3. bproxy elements nav      → get all nav links
```

## `bproxy dom`

Returns a simplified DOM subtree for a given selector at a controlled depth. Used when `outline` doesn't give enough detail — the agent needs to see the shape of a specific region.

```
bproxy dom [selector] [--depth N]
```

Defaults: `selector` = `body`, `depth` = 1.

```json
{
  "ok": true,
  "data": {
    "tree": [
      { "tag": "main", "selector": "main", "children": [
        { "tag": "div", "class": "hero",   "selector": "div.hero",   "text": "Pricing Plans — Choose the plan that...", "childCount": 2 },
        { "tag": "div", "class": "plans",  "selector": "div.plans",  "text": "",                                        "childCount": 3 },
        { "tag": "div", "class": "compare","selector": "div.compare","text": "Compare Features",                          "childCount": 1 }
      ]}
    ]
  }
}
```

Rules:
- At each level, show: `tag`, `class` (if any), `id` (if any), `selector`, `text` (first 80 chars of direct text content, not children), `childCount`.
- At the maximum depth, children are counted (`childCount`) but not expanded. This is the token control mechanism.
- `--depth 0` returns just the selected element's metadata (no children expanded).
- `--depth 1` (default) shows immediate children.
- `--depth 2` shows children and grandchildren. Rarely needed — use scoped selectors instead.
- Skip invisible elements (`display: none`, `visibility: hidden`).
- Skip `<script>`, `<style>`, `<link>`, `<meta>` — structural noise.
- Cap at 500 nodes total in the response. If exceeded, return `"truncated": true`.

This is a progressive disclosure tool. The agent zooms in step by step:
```
1. bproxy dom --depth 1             → see top-level body structure
2. bproxy dom "div.plans" --depth 1  → see what's inside the plans section
3. bproxy text "div.plans > div:nth-child(2)"  → read a specific plan
```

## `--frame` qualifier

Pages embed iframes — Stripe Checkout, embedded auth, sandboxed widgets, ads. Every command that operates on the DOM accepts an optional `--frame <ref>` qualifier that scopes the action to a specific frame inside the active tab. Without `--frame`, commands target the **top frame** (`frameId === 0`).

Applies to: `click`, `type`, `text`, `images`, `elements`, `outline`, `dom`, `wait selector`, `wait function`, `wait response`, `wait settle`, `eval`. Does not apply to `navigate`, `screenshot`, `tabs`, `tab`, `status` — they are tab-level, not frame-level.

```
bproxy click "#pay-now" --frame "iframe[name^='__privateStripeFrame']"
bproxy type "input[name='card']" "4242…" --frame 1
bproxy wait selector ".success" --frame "checkout.stripe.com"
bproxy text body --frame /js\.stripe\.com/
```

`<ref>` resolves in this order:

| Form                      | Match                                                                                                                                                                          |
|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **CSS selector**          | A `<iframe>` element in the *parent* frame matching the selector. The agent names what the user sees in the DOM. Most stable form.                                              |
| **Integer `0..N`**        | Depth-first index over all known frames in the tab. `0` is the top frame; `1` is the first iframe in document order; nested iframes follow their parent. Re-numbered when frames are added or removed — use sparingly. |
| **`/regex/` or substring**| Matches the frame's *document URL*. `/stripe\.com/` and `stripe.com` both work; the leading-slash form is treated as regex.                                                     |

Resolution rules and edge cases are documented in [04-extension.md → Frame routing](./04-extension.md#frame-routing-and-frame-detection); the relevant ones for the agent:

- `--frame` resolving to zero matches → `SELECTOR_NOT_FOUND` (`retry: true` — the iframe may not have rendered yet; pair with `bproxy wait selector "iframe…"` first).
- `--frame` resolving to multiple matches with the **selector** form → `SELECTOR_AMBIGUOUS`.
- `--frame` against a `data:` / `about:srcdoc` / `blob:` iframe — use the **selector** form. URL-pattern matching against these schemes is rarely useful because every such frame on a page shares the same scheme prefix.
- `--frame` targeting a `chrome://` / `chrome-extension://` / `view-source:` / PDF-viewer subframe → `RESTRICTED_URL` (`retry: false`); the SW catches this before forwarding. See [06-failure-modes.md → Restricted URL](./06-failure-modes.md#restricted-url-no-content-script-possible).
- A frame that detaches mid-action → `FRAME_DETACHED` (`retry: true`). See [06-failure-modes.md → Frame detached mid-action](./06-failure-modes.md#frame-detached-mid-action).

The naming is borrowed from Playwright's `frameLocator` / `page.frame({ url })` ([Playwright — Frames](https://playwright.dev/docs/frames)) — selector and URL pattern are the two forms agents reach for first.

## `--trusted` flag (on `click`, `type`, `navigate`)

Default `click`, `type`, and `navigate` execute via DOM dispatch in the page's MAIN world. The events they generate carry `event.isTrusted === false`, which is detectable by Cloudflare Turnstile, Datadome, HUMAN (PerimeterX), and Akamai Bot Manager ([12-risks.md → Headline risk](./12-risks.md#headline-risk-the-extension-itself-is-fingerprintable)). Pass `--trusted` to route the action through `chrome.debugger` + the Chrome DevTools Protocol `Input.*` family, which produces events with `isTrusted === true` ([cnleo/IsTrusted-event-Debugger-API](https://github.com/cnleo/IsTrusted-event-Debugger-API)).

```
bproxy click "#submit"               --trusted
bproxy type  "input[name=q]" "hello" --trusted
bproxy navigate "https://example.com" --trusted
```

The flag is a per-command opt-in. It is not the default because it carries a user-visible cost: Chrome shows a non-suppressible "extension started debugging this browser" infobar on every attached tab for as long as the debugger is attached ([chrome.debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger)). The agent passes `--trusted` only when the page actively consumes `isTrusted`.

Two-tier opt-in:

1. The user starts the proxy with `bproxy service start --enable-debugger-mode`. Without it, any command carrying `--trusted` returns `DEBUGGER_DISABLED` (`retry: false`; `suggestedAction: "restart the proxy with --enable-debugger-mode"`).
2. The agent passes `--trusted` per command. Default off even when service-level debugger mode is enabled.

`--trusted` and `--frame` compose: `bproxy click "#pay" --frame "iframe[name^='__privateStripeFrame']" --trusted` resolves the click coordinates inside the named subframe and dispatches the trusted mouse event into that frame's coordinate space.

Implementation, attach lifecycle (lazy on first `--trusted` command, idle detach after 60 s, configurable via `--debugger-idle-ms`), and the `Runtime.enable`-avoidance constraint are documented in [04-extension.md → Debugger mode](./04-extension.md#debugger-mode-trusted-events-and-cdp-screenshots).

Errors:

- `DEBUGGER_DISABLED` — service was not started with `--enable-debugger-mode`.
- `DEBUGGER_UNAVAILABLE` — `chrome.debugger.attach` failed (target detached, another debugger client owns the target — most often Chrome DevTools open on the same tab — or the URL is restricted). `retry: conditional`.

The flag is the single largest stealth improvement available to the agent, but it is not undetectable: bot scripts can still flag the attached debugger via timing or by observing that DevTools is disabled on the target. See [12-risks.md → Headline risk](./12-risks.md#headline-risk-the-extension-itself-is-fingerprintable) for the honest scope.

## `bproxy tab` subcommands

The `tab` group manages **which tab the agent's session is pinned to**. The full lifecycle, the storage shape, and the multi-agent semantics are owned by [08-tab-management.md](./08-tab-management.md); this section documents the CLI surface only.

```
bproxy tab list                      # list open tabs across all windows
bproxy tab pin <id>                  # set the session's pinned tab
bproxy tab unpin                     # release the session's pin
bproxy tab open <url> [--activate]   # open a new tab and pin it (background by default)
bproxy tab close [<id>]              # close a tab; default is the pinned tab
```

`tab list` is read-only (idempotent, at-least-once). `tab pin`, `tab unpin`, `tab open`, `tab close` are destructive (at-most-once per `id`); the dedupe table in [04-extension.md → Dedupe table](./04-extension.md#dedupe-table-and-request-lifecycle) protects re-deliveries.

### `bproxy tab list`

```json
{
  "ok": true,
  "data": {
    "session": "default",
    "pinned": { "tabId": 42, "windowId": 1, "url": "https://example.com" },
    "tabs": [
      { "id": 42, "windowId": 1, "url": "https://example.com", "title": "Example", "active": true,  "minimized": false, "pinnedBy": ["default"] },
      { "id": 87, "windowId": 1, "url": "https://github.com",  "title": "GitHub",  "active": false, "minimized": false, "pinnedBy": [] },
      { "id": 99, "windowId": 2, "url": "https://gmail.com",   "title": "Inbox",   "active": true,  "minimized": true,  "pinnedBy": [] }
    ]
  }
}
```

`pinned` is `null` when the calling session has no pin. `pinnedBy` lists every session currently pinned to a given tab (multiple agents driving the same browser can share a target — see [08-tab-management.md → Multi-agent (`--session`) semantics](./08-tab-management.md#multi-agent---session-semantics)).

### `bproxy tab pin <id>` / `bproxy tab unpin`

`tab pin` replaces the session's pin. `tab unpin` drops it; subsequent non-self-pinning commands return `NO_TAB_TARGETED` until the agent re-pins.

```json
// tab pin response
{ "ok": true, "data": { "session": "default", "previous": null, "pinned": { "tabId": 87, "windowId": 1 } } }

// tab unpin response
{ "ok": true, "data": { "session": "default", "previous": { "tabId": 87 }, "pinned": null } }
```

### `bproxy tab open <url>`

Opens a new tab via `chrome.tabs.create({ url, active: false })` and pins it to the calling session. Does **not** activate the tab by default — silent focus steal is the same class of bug `bproxy screenshot` was fixed for. Pass `--activate` to bring the new tab to the foreground.

```json
{ "ok": true, "data": { "session": "default", "pinned": { "tabId": 101, "windowId": 1, "url": "https://example.com" }, "activated": false } }
```

### `bproxy tab close [<id>]`

Default `<id>` is the session's pinned tab. Closing the pinned tab drops the pin; a subsequent command returns `NO_TAB_TARGETED`. Closing a tab that other sessions had pinned drops their pins too — they receive `TAB_CLOSED` with `details.reason: "command_closed"` on their next call.

### Deprecated tab commands

The previous flat forms are kept as aliases for one minor version and then removed:

| Old form           | New form               | Notes |
|--------------------|------------------------|-------|
| `bproxy tabs`      | `bproxy tab list`      | Same response shape with the additional `session`, `pinned`, and per-row `pinnedBy` fields. |
| `bproxy tab <id>`  | `bproxy tab pin <id>`  | Numeric form is auto-routed to `pin`; a deprecation warning is printed to stderr (the warning is the only stderr output from these commands and only fires for the alias). |

The deprecated forms are documented in `bproxy help` with a `(deprecated)` marker. Agents should be updated to the new forms; the alias exists for human-typed scripts that pre-date the change.

## `bproxy domain` configuration

Per-origin configuration knobs that turn off MAIN-world wrappers on hard-protected sites where the wrapper's mere presence is the detection signal. Owned by [05-page-state.md → Per-domain shim disable](./05-page-state.md#per-domain-shim-disable); the CLI surface is below. Rules live in `chrome.storage.local` under a single key, are watched by the SW, and take effect on the next document load on a matching origin (no extension reload required).

```
bproxy domain list
bproxy domain set <pattern> [--no-network-shim] [--no-history-patch]
bproxy domain unset <pattern>
```

`<pattern>` is a Chrome match-pattern string ([Chrome — Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)) — for example `"https://*.example.com/*"`. Validation is performed at the CLI before any HTTP request runs; invalid patterns return `INVALID_COMMAND`.

### `bproxy domain set <pattern>`

```json
{
  "ok": true,
  "data": {
    "pattern": "https://*.example.com/*",
    "rules": { "noNetworkShim": true, "noHistoryPatch": false }
  }
}
```

Flags (additive — calling `set` twice merges):

- `--no-network-shim` — `network-shim.js` self-aborts in its IIFE on matching origins. `wait --network` and `wait response` no longer work on those origins; settle still works (it depends on MutationObserver, not the shim). The MutationObserver itself remains attached; if the agent needs to disable it too, that knob lives behind a future `--no-mutation-observer` and is out of scope for v1.
- `--no-history-patch` — `history.pushState` / `history.replaceState` are not patched on matching origins. SPA navigation detection falls back to the `chrome.webNavigation.onHistoryStateUpdated` backstop documented in [05-page-state.md → `webNavigation` backstop](./05-page-state.md#webnavigation-backstop) — slightly higher latency (~50 ms), still reliable.

The flags are independent. Most users who need one need both, but they are separable for the case where only one wrapper trips a specific site's detection.

### `bproxy domain unset <pattern>`

Removes the rule. If no rule exists for `<pattern>`, returns `ok: true` with `data: { removed: false }`. Idempotent.

### `bproxy domain list`

```json
{
  "ok": true,
  "data": {
    "rules": [
      { "pattern": "https://*.example.com/*", "noNetworkShim": true, "noHistoryPatch": true },
      { "pattern": "https://shop.example.org/*", "noNetworkShim": true, "noHistoryPatch": false }
    ]
  }
}
```

### Why per-origin and not per-session

A session pin (`--session`) is the agent's "which tab am I on" state. Shim disable is a property of the *origin*, not of the agent — multiple sessions driving the same browser see the same disabled-list. We do not have a per-session shim disable in v1; if two agents have conflicting requirements for the same origin, the disable wins (safer default — the wrappers, not their absence, are the detection vector).

## `--session` qualifier

Every command accepts `--session <name>`. The session is the unit of "which tab am I pinned to" — two agents driving the same browser pass different `--session` names so their pins do not collide.

```
bproxy --session ci-agent navigate https://example.com
bproxy --session ci-agent click "#submit"

# A second agent on the same browser:
bproxy --session reviewer tab list
bproxy --session reviewer tab pin 42
bproxy --session reviewer screenshot
```

Resolution order:

1. `--session <name>` on the command line.
2. `BPROXY_SESSION` environment variable, if set.
3. Default: `"default"`.

Validation: `[a-z0-9_-]{1,32}`. Names outside the pattern are rejected with `INVALID_COMMAND` at the CLI before any HTTP request runs.

`--session` is a routing field, not a security boundary. Anyone holding the bearer token (see [Authentication](#authentication)) can address any session. Sessions exist so two cooperating agents do not stomp on each other's pinned tab — they are not a multi-tenant isolation primitive. The full semantics are in [08-tab-management.md → Multi-agent (`--session`) semantics](./08-tab-management.md#multi-agent---session-semantics).

## `bproxy screenshot`

Captures the **pinned tab's** visible viewport. By default the SW only captures when the pinned tab is the active tab of its window and the window is not minimized; otherwise it returns `TAB_NOT_VISIBLE` (see [06-failure-modes.md → `TAB_NOT_VISIBLE`](./06-failure-modes.md#tab-not-visible)) instead of stealing user focus or returning a black PNG.

```
bproxy screenshot              # default: no focus steal, fail with TAB_NOT_VISIBLE if not active
bproxy screenshot --activate   # explicitly activate the pinned tab, capture, restore previous active
bproxy screenshot --debugger   # CDP capture (requires --enable-debugger-mode on service)
```

Success response:

```json
{
  "ok": true,
  "data": {
    "image": "<base64 PNG>",
    "tabId": 42,
    "mode": "captureVisibleTab",
    "activated": false,
    "restoredPreviousTab": null
  }
}
```

`mode` is one of `captureVisibleTab` (default), `captureVisibleTab+activate` (`--activate`), or `debugger` (`--debugger`). `activated` is `true` only when the SW changed the active tab to capture; `restoredPreviousTab` is `true` if the previous active tab was restored, `false` if the user changed the active tab during capture (best-effort), `null` when no activation took place.

The full design — when each mode is appropriate, the user-visible banner trade-off for `--debugger`, and the OS-compositor reason minimized windows always fail — is in [08-tab-management.md → Screenshot capture](./08-tab-management.md#screenshot-capture).

## Auto-wait on actions

`click`, `type`, and `navigate` **auto-wait** for their target before failing. The agent does *not* need to call `bproxy wait` before every action — the action itself polls the target's actionability checks (visible, stable, enabled, receives events) and only fails on timeout. This matches Playwright's auto-wait contract ([Playwright — Actionability](https://playwright.dev/docs/actionability)). See [Page State → Auto-wait on actions](./05-page-state.md#auto-wait-on-actions) for the full check list and timeouts.

The agent only reaches for `bproxy wait` when the next action's target is **not yet on the page** (e.g. a search-results list that does not exist before a fetch returns) or when it needs to gate on something other than a DOM target (URL, network response, custom JS predicate).

## `bproxy wait`

Explicit waiter. The agent picks a strategy that names what it is waiting for:

```
bproxy wait selector <css>      [--hidden] [--detached] [--enabled] [--timeout <ms>]
bproxy wait url <pattern>       [--timeout <ms>]
bproxy wait function <js>       [--timeout <ms>] [--polling <ms|"raf">]
bproxy wait response <urlGlob>  [--status <code>] [--timeout <ms>]
bproxy wait navigation          [--timeout <ms>]
bproxy wait settle              [--network] [--timeout <ms>]
```

Strategies:

| Strategy                  | Resolves when                                                    | Default timeout |
|---------------------------|------------------------------------------------------------------|-----------------|
| `selector <css>`          | Element matches and is **visible**.                              | 10s             |
| `selector <css> --hidden` | Element does not match, or matches but is not visible.           | 10s             |
| `selector <css> --detached` | No element matches (stricter than `--hidden`).                 | 10s             |
| `selector <css> --enabled` | Element matches, is visible, and passes the `enabled` actionability check. | 10s    |
| `url <pattern>`           | `location.href` matches `pattern` (substring; `/regex/` for regex). | 30s          |
| `function <js>`           | `js` evaluated in MAIN world returns truthy. Side-effect-free.   | 30s             |
| `response <urlGlob>`      | A network response in this tab matches `urlGlob` (and `--status` if given). | 30s |
| `navigation`              | A top-frame navigation commits and the new document loads.       | 30s             |
| `settle`                  | Adaptive DOM-quiescence window (see Page State doc).             | 10s             |
| `settle --network`        | Quiescence AND zero in-flight fetch/XHR/etc. for 500 ms.         | 30s             |

Multiple flags on the same strategy are an **AND**. `bproxy wait selector ".results" --enabled --network`, for instance, requires the selector to be enabled *and* the network to be idle.

`function` runs in MAIN world via `chrome.scripting.executeScript`. The expression must be pure — `wait` is at-least-once and may be re-executed by the dedupe layer ([Output Contract — Per-action idempotency policy](./01-output-contract.md#per-action-idempotency-policy)). DOM mutations or network calls inside the predicate are unsafe.

`response` reads from a ring buffer fed by the document_start network shim — it observes requests made *after* the wait was issued; nothing earlier. Pair it with the action that initiates the request: `bproxy click "#search"; bproxy wait response 'api/search'`.

Polling cadence: `selector` and `function` strategies poll on `requestAnimationFrame` by default (~16 ms). `function --polling 500` switches to a 500 ms fixed interval for expensive predicates. `function --polling raf` is the explicit form of the default.

Success response:

```json
{
  "ok": true,
  "data": { "waited": 1230, "strategy": "selector", "selector": ".results" },
  "page": { "url": "...", "title": "...", "state": "ready", "busy": false }
}
```

Timeout response:

```json
{
  "ok": false,
  "error": "WAIT_TIMEOUT",
  "message": "selector '.results' was not visible within 10000ms",
  "retry": true,
  "hint": "Last seen: 0 matches. URL is https://app.example.com/dashboard. Did the request fail? Try `bproxy wait response 'api/results'` first.",
  "page": { "url": "...", "title": "...", "state": "settling", "busy": true }
}
```

Best-effort `settle` response (page that never quiesces):

```json
{
  "ok": false,
  "error": "NEVER_SETTLED",
  "message": "DOM did not reach quiescence within 10000ms",
  "retry": false,
  "hint": "Use `bproxy wait selector` against a stable anchor, or proceed; the page is animating continuously.",
  "page": { "url": "...", "title": "...", "state": "settling", "busy": false },
  "data": { "samples": [{ "selector": ".chat-feed", "mutations": 47 }], "thresholdMs": 480 }
}
```

`NEVER_SETTLED` is `retry: false` — the same call with the same timeout will return the same result. The agent must change strategy.

Typical SPA workflow:
```
1. bproxy click "a[href='/dashboard']"   → click auto-waits for the link, then fires.
                                           Response page.url is already "/dashboard"
                                           because the history patch flipped it
                                           synchronously.
2. bproxy wait selector "main h1"         → wait for the new view's heading.
3. bproxy outline                         → read the new page structure.
```

## `bproxy help`

```
bproxy — browser control for coding agents

Service:
  service start [--port <N>] [--allow-eval] [--enable-debugger-mode]
                               Start the proxy daemon (detached). Writes a fresh bearer
                               token, the PID file, and the day's log file to the
                               per-user state directory. --enable-debugger-mode unlocks
                               --trusted on click/type/navigate and --debugger on
                               screenshot, at the cost of a user-visible Chrome banner
                               while a debugger is attached.
  service stop                 Graceful then forceful shutdown of the running daemon.
  service restart              Stop then start, preserving prior --allow-eval / --enable-
                               debugger-mode / --port flags.
  service status               Alias for `status`.

Commands:
  status                       Check proxy and extension connection
  navigate <url> [--trusted]   Navigate to URL (--trusted dispatches via CDP)
  click <selector> [--trusted] Click an element (--trusted = isTrusted=true via CDP)
  type <selector> <text> [--trusted]  Type into an input field
  text [selector]              Extract text content (default: body)
  images [selector]            List images with src and alt text
  elements [selector]          List interactive elements
  outline                      Page structure: landmarks + headings
  dom [selector] [--depth N]   Simplified DOM subtree (default depth: 1)
  wait <strategy> [args]       Explicit waiter. Strategies: selector, url, function,
                               response, navigation, settle. Actions auto-wait on their
                               own target — call wait only for cross-cutting conditions.

DOM-targeted commands (click, type, text, images, elements, outline, dom, wait,
eval) accept an optional `--frame <selector|index|/regex/>` to scope the action
to an iframe instead of the top frame. See `bproxy help frame`.

Every command accepts an optional `--session <name>` to address a specific
agent session (default: "default", or $BPROXY_SESSION). Two agents driving the
same browser pass different --session names so their pinned tabs do not collide.
  screenshot [--activate] [--debugger]
                               Capture the pinned tab's viewport as base64 PNG.
                               Default mode does not steal focus; --activate
                               briefly focuses the pinned tab; --debugger uses
                               the Chrome DevTools Protocol (requires
                               --enable-debugger-mode on service start).
  eval <code>                  Execute JavaScript in page context (requires --allow-eval on service)
  tab list                     List open tabs across all windows
  tab pin <id>                 Pin the session to tab <id>
  tab unpin                    Release the session's pin
  tab open <url> [--activate]  Open a new tab and pin it (background by default)
  tab close [<id>]             Close a tab (default: the pinned tab)
  domain list                  List per-domain config rules (--no-network-shim etc)
  domain set <pattern> [opts]  Set per-domain config (turn off shims on bot-protected sites)
  domain unset <pattern>       Remove a per-domain rule
  session list                 List sessions and their profile bindings (multi-profile users)
  session bind <s> <pid>       Bind a session to a Chrome profile id
  session unbind <s>           Drop a session's profile binding

All commands return JSON to stdout. Authentication is automatic via the
token file; see `bproxy service start` for first-time setup.
Errors include an "error" code and "retry" boolean.
```

Printed to stdout, exit 0. Short enough that an agent can consume it in one shot.

## Authentication

Every request the CLI sends carries an `Authorization: Bearer <token>` header. The token is created by the proxy on `bproxy service start` and written to a per-user file. The CLI reads it from that file on every invocation; there is nothing for the user to copy or remember.

### Token discovery

Resolution order:

1. `BPROXY_TOKEN` environment variable, if set. Useful in CI / Docker where the token must be injected from outside.
2. `BPROXY_TOKEN_FILE` environment variable, if set — read the file at that path.
3. Default per-platform path:
   - Linux: `$XDG_RUNTIME_DIR/bproxy/token`, fallback `~/.bproxy/token`.
   - macOS: `~/Library/Application Support/bproxy/token`.
   - Windows: `%LOCALAPPDATA%\bproxy\token`.

If the file exists but is not `0600` on POSIX (Windows: not owner-only), the CLI logs a warning to stderr and proceeds. We do not refuse — the file is the proxy's contract; the CLI is a reader. The proxy is responsible for writing it correctly. See [03-proxy-service.md → Token file location](./03-proxy-service.md#token-file-location).

### Failure modes

| Situation                                | CLI behaviour                                                                                       |
|------------------------------------------|------------------------------------------------------------------------------------------------------|
| Token file missing                       | Print `AUTH_REQUIRED` JSON with `hint: "Run: bproxy service start"`. Exit 1. No HTTP request issued.|
| Token file unreadable (permissions)      | Print `AUTH_REQUIRED` JSON with the actual filesystem error in `message`. Exit 1.                    |
| Proxy returns 401                        | The token on disk does not match the running proxy (proxy was restarted by another shell, or the file is stale). Print `AUTH_REQUIRED` JSON with `hint: "Token may be stale. Restart the proxy or re-read the token file."`. Exit 1. **The CLI does not auto-retry** — silent re-auth would mask a real misconfiguration. |
| `--allow-eval` not set on the proxy and command is `eval` | Proxy returns `EVAL_DISABLED`. CLI prints it as a normal error. Hint: "Restart the proxy with `bproxy service start --allow-eval` to enable."|

The CLI never prompts interactively. Agents do not have terminals; everything is JSON in / JSON out.

### Bootstrap (first run)

The first run looks like this:

```
$ bproxy service start
bproxy service listening on http://127.0.0.1:9615
token written to /run/user/1000/bproxy/token (mode 0600)
eval is disabled (start with --allow-eval to enable)

Setup the extension once:
  1. Open chrome://extensions and load the bproxy extension.
  2. Click "Details" → "Extension options".
  3. Paste this token into the field shown:

    XKp4...the-token-here...0Q

  4. Click Save. The extension will reconnect.

  (You can re-open the options page later to rotate.)
```

This is the only point where the token leaves the file system. Subsequent CLI invocations never display it. See [04-extension.md → Token setup](./04-extension.md#token-setup) for the matching extension-side flow.

When the proxy restarts and rotates the token, the user must re-paste it into the options page. We considered automating this via a `chrome-extension://`-scoped local handshake but the operational complexity (extension polling a known location, races on rotation) outweighs the once-per-restart paste. Documented as a known sharp edge in [12-risks.md](./12-risks.md#token-rotation-requires-re-pasting-into-the-extension).

## Implementation

The CLI is a single executable Node.js script (ESM, `#!/usr/bin/env node`, Node ≥ 20.10). The packaging and the install story are owned by [09-build.md](./09-build.md). At runtime it:

1. Parses `process.argv` into `action` + `params`.
2. Resolves the daemon port (see [`--port` resolution on the CLI](#--port-resolution-on-the-cli)).
3. Resolves the bearer token (see [Token discovery](#token-discovery)).
4. For lifecycle commands (`service start | stop | restart`), runs the daemon-management path — no HTTP request to the daemon is made for `start`'s pre-listener phase, but `restart` reads `/status` first and `start` polls `/version` until ready.
5. For everything else, sends `POST http://127.0.0.1:<port>/command` with JSON body `{ id, action, params, session?, profileId? }` and the `Authorization: Bearer <token>` header.
6. Prints the response JSON to stdout.
7. Exits with code 0 or 1.

Connection errors are normalised to structured JSON, not stack traces:

- `bproxy status` against a missing daemon: `DAEMON_NOT_RUNNING` (see above). Exit 1.
- Any other command against a missing daemon: `PROXY_NOT_RUNNING` (legacy spelling kept for back-compat). Exit 1.
- 401 from the daemon, or missing token file: `AUTH_REQUIRED`. Exit 1.

Timeout: the CLI sets a 30s HTTP timeout (60s for `navigate`). If exceeded, the daemon's deadline already fired; the CLI surfaces whatever specific code the daemon emitted (`EXTENSION_UNRESPONSIVE`, `WAIT_TIMEOUT`, `NAVIGATED_DURING_ACTION`, `FRAME_DETACHED`, or `RESTRICTED_URL` per [06-failure-modes.md → Taxonomy rules](./06-failure-modes.md#taxonomy-rules)) and exits 1. The legacy `EXTENSION_TIMEOUT` bucket is deprecated and never appears on the wire. The CLI does not maintain a persistent connection to the daemon; each command is one HTTP round-trip.
