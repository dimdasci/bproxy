# 5. Page State Detection & SPA Handling

[← Index](./README.md) · Prev: [Extension Internals](./04-extension.md) · Next: [Failure Modes →](./06-failure-modes.md)

---

The reliability of every action depends on knowing *what* to wait for and *when* to give up. The earlier design exposed a global "is the page ready?" flag and asked the agent to react to it. That contract is wrong: it conflates page-wide settling (which is unbounded for animated dashboards, chat apps and live feeds) with what the agent actually needs (the specific element it is about to touch is interactable). Playwright learned the same lesson and codified it as **explicit waiters with implicit auto-wait on actions** ([Playwright — Auto-waiting](https://playwright.dev/docs/actionability)). bproxy follows the same pattern.

This page describes:

1. The **auto-wait contract** every action runs before failing.
2. The **explicit waiter API** (`bproxy wait …`) for cases the agent needs to gate on.
3. **SPA navigation detection** via `history` API patching plus a `webNavigation` backstop.
4. **MutationObserver** with a noise filter and an adaptive quiescence window.
5. **Network-idle** detection injected at `document_start` so the captured `fetch` is ours.
6. The honest residual list — never-settle pages, service-worker fetches, cross-origin frames.

The `state` field that still appears in `page` blocks is now *advisory only*: a hint the agent can log or display. It is **never** the basis for action retries — the auto-wait inside each action is. See [Output Contract → Page context](./01-output-contract.md#page-context-on-every-response) for the surfacing rules.

## Auto-wait on actions

Every destructive action — `click`, `type`, `navigate` — runs **actionability checks** on its target before failing. The checks borrow Playwright's vocabulary because Playwright's design is the most extensively battle-tested in this space:

| Check          | Meaning                                                                                  | Used by              |
|----------------|------------------------------------------------------------------------------------------|----------------------|
| **attached**   | `querySelector` resolves a node (re-checked on every poll, since SPAs swap the subtree). | click, type          |
| **visible**    | Node has non-zero bounding box, no `display:none`/`visibility:hidden`/`opacity:0` ancestor, not in a `hidden` attribute subtree. | click, type |
| **stable**     | Bounding box has not changed for two consecutive `requestAnimationFrame` ticks.          | click                |
| **enabled**    | Not `disabled`, not `aria-disabled="true"`, not in a `<fieldset disabled>`.              | click, type          |
| **editable**   | Enabled, plus not `readonly`, plus a focusable/text-input role.                          | type                 |
| **receives events** | `document.elementFromPoint(cx, cy)` at the element's centre returns the target or a descendant — not an overlay. | click |

The action polls these checks at **~60 Hz** (one per `rAF`) until they all pass or the timeout fires. There is no global "page ready" gate. A click on a button inside a hydrated header succeeds even if a chat widget at the bottom of the page is still re-rendering forever — the click only cares about *its own* target.

Defaults:

| Action     | Auto-wait timeout | Override                                        |
|------------|-------------------|-------------------------------------------------|
| `click`    | 10 s              | `--timeout <ms>` on the action (extends only — the proxy/CLI wrap timeouts still apply, see [07-timeouts.md](./07-timeouts.md)). |
| `type`     | 10 s              | same                                            |
| `navigate` | 60 s for load + 3 s soft settle cap (see [Two-tier navigate](#navigate-command)) | `--timeout` overrides the load wait only |

If the timeout fires, the action returns `WAIT_TIMEOUT` (not a special per-action code) with a `hint` describing which check failed last, e.g. `"#submit is attached and visible but not stable: bounding box still changing (animation?)"`. The agent reads the hint and decides — bump the timeout, wait for `--hidden ".loading"`, or pick a different selector.

Idempotency note: the auto-wait loop is **side-effect free**. It runs `querySelector`, reads geometry, calls `elementFromPoint`. It never mutates the DOM, never `fetch`es, never logs anything that would survive replay. This is required by the at-least-once semantics declared in [01-output-contract → Per-action idempotency policy](./01-output-contract.md#per-action-idempotency-policy): `wait` may be re-executed by the dedupe layer, and the auto-wait *inside* destructive actions runs once per attempt without leaking observable side effects.

## Explicit waiter API

For everything auto-wait does not cover — "wait for the URL to change", "wait for this XHR to complete", "wait for `window.MyApp.ready` to be true" — the agent uses `bproxy wait` with an explicit strategy. This is the same surface Puppeteer and Playwright expose (`waitForFunction`, `waitForResponse`, `waitForURL`, `waitForSelector`).

```
bproxy wait selector <css>      [--hidden] [--detached] [--enabled] [--timeout <ms>]
bproxy wait url <pattern>       [--timeout <ms>]
bproxy wait function <js>       [--timeout <ms>] [--polling <ms|"raf">]
bproxy wait response <urlGlob>  [--status <code>] [--timeout <ms>]
bproxy wait navigation          [--timeout <ms>]
bproxy wait settle              [--network] [--timeout <ms>]   # advisory; see "Settle as advisory"
```

Strategies:

| Strategy       | Default condition                                                  | Default timeout |
|----------------|--------------------------------------------------------------------|-----------------|
| `selector`     | element matches and is **visible**                                 | 10 s            |
| `selector --hidden`   | element either does not match or is not visible             | 10 s            |
| `selector --detached` | element does not match the DOM                              | 10 s            |
| `selector --enabled`  | element matches, is visible, and passes the `enabled` check | 10 s            |
| `url`          | `location.href` matches the pattern (substring or `/regex/`)       | 30 s            |
| `function`     | a JS expression returns truthy in the **MAIN** world               | 30 s            |
| `response`     | a network response matches `urlGlob` (and optional `--status`)     | 30 s            |
| `navigation`   | a top-frame navigation commits *and* the new document loads        | 30 s            |
| `settle`       | adaptive DOM-quiescence window met (see below)                     | 10 s            |
| `settle --network` | adaptive window AND zero in-flight fetch/XHR/etc. for 500 ms   | 30 s            |

Combining: passing multiple `--…` flags is an **AND**. `bproxy wait selector ".results" --enabled --network` resolves only when the selector is enabled *and* the network is idle.

Side-effect freedom is required (replay-safety). Practical implications:

- `function` runs the expression in `MAIN` world via `chrome.scripting.executeScript`. The expression should be pure; documented in the CLI help.
- `response` reads from the network shim's ring buffer (see [Network-idle](#network-idle-detection)). It does not start a new request.
- `navigation` listens to `chrome.webNavigation.onCommitted` plus `onCompleted`; no probes are issued.

Polling cadence: selector / function checks run on `rAF` by default (`~16 ms`) so a page that flips a flag during a layout pass is observed within one frame. `function --polling 500` switches to a fixed-interval poll for expensive checks. `function --polling raf` is the explicit form of the default.

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

The agent gets enough to reason: *what* it was waiting for, *what* it last saw, and *where* the page is now.

### Settle as advisory

`bproxy wait settle` exists, but it is documented as *"best-effort, page-level"*. Its only correct use is when the agent has no specific anchor to wait for and is willing to accept a near-quiescent page. **Actions never call settle internally** — they wait on their own target's local quiescence (the `stable` check) instead. This is the central design correction: never gate destructive actions on global page settle.

## SPA navigation detection

URL changes from SPA routing happen synchronously inside a click handler. By the time the click's reply is built, the URL has already changed but the new view may not have rendered yet. The agent needs three things:

1. **Immediate, synchronous flip** of the internal `state` to `settling` so the `page` block on the click reply reports the new URL truthfully.
2. A signal `bproxy wait navigation` and `bproxy wait url` can subscribe to.
3. A backstop for cases where the content script wasn't injected fast enough or the page replaces the `history` object aggressively (some single-spa-style frameworks do this; see [single-spa#528](https://github.com/single-spa/single-spa/issues/528)).

### Patching `history.pushState` / `history.replaceState`

The 200 ms polling loop is removed. Instead, at content-script injection time (which is now `document_start`, see [Extension Internals → Content script run_at](./04-extension.md#content-script-runat-document_start-and-main-world-shim)), the script monkey-patches both methods and dispatches a synthetic event:

```js
// In MAIN world, document_start.
(function () {
  if (window.__bproxyHistoryPatched) return;
  window.__bproxyHistoryPatched = true;

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const before = location.href;
      const ret = orig.apply(this, args);
      if (location.href !== before) {
        window.dispatchEvent(new CustomEvent('bproxy:locationchange', {
          detail: { from: before, to: location.href, kind: fn }
        }));
      }
      return ret;
    };
  }

  window.addEventListener('popstate',   () => emit('popstate'));
  window.addEventListener('hashchange', () => emit('hashchange'));

  function emit(kind) {
    window.dispatchEvent(new CustomEvent('bproxy:locationchange', {
      detail: { from: null, to: location.href, kind }
    }));
  }
})();
```

The isolated-world content script listens for `bproxy:locationchange` and updates `state` to `settling`, the URL stamp, and the in-flight `wait url` / `wait navigation` subscriptions. The flip is synchronous with the navigation, so the very next `page` block reports the new URL.

WXT's content-script framework arrived at the same pattern after the 1 s polling approach proved too slow ([wxt — Improved wxt:locationchange](https://github.com/wxt-dev/wxt/issues/1567)).

### Why patch in `MAIN` world

`history` in the isolated world is a different binding than in the page; patching it on the isolated side is invisible to page code. The patch must run in `MAIN` world, before any page script captures a reference to the original method. This is the same constraint that drives the [network-shim injection point](#network-idle-detection).

### `webNavigation` backstop

The history patch runs in the page's world. There are two cases where it can miss:

- The content script + main-world shim hasn't injected yet (between tab creation and `document_start`). Rare, but possible on data-URL pages and in some test harnesses.
- The page replaces `window.history` with its own object (very rare; framework misbehaviour).

For both, the background script registers `chrome.webNavigation.onHistoryStateUpdated` and `chrome.webNavigation.onCommitted` ([chrome.webNavigation reference](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)). Either fires per-frame with `tabId`, `frameId`, `url`. The background dedupes by `(tabId, url, transitionType)` against the most recent in-page event so the same SPA navigation does not get reported twice; if the in-page event has not arrived within 50 ms, the background-side event is treated as authoritative. This adds ~50 ms of latency only in the corner case; the common path is the synchronous in-page event.

`webNavigation` is also the *only* signal available when the content script hasn't been able to attach (CSP-locked extension pages, `chrome://` URLs, `view-source:`). `bproxy wait navigation` works on those cases too.

### Implication for `navigate`

`navigate` still uses `chrome.tabs.update(tabId, { url })`; the rationale in [Navigate command](#navigate-command) below has not changed. The patching changes *detection*, not the act of navigating.

## Settle detection (MutationObserver)

The observer is the source of truth for "the DOM is changing right now." Three problems with the previous design are addressed:

### Observer root: `document.documentElement`

`document.body` does not exist at `document_start`. Some pages also swap `<body>` during hydration (older Angular Universal bootstraps, some MV3 popup builders), and an observer rooted on the old node sees nothing afterward. We observe `document.documentElement` from `document_start`, with subtree, childList, characterData, **and** attributes:

```js
const observer = new MutationObserver(handle);
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
});
```

`attributes: true` is on because the *filter* below removes the noise that originally motivated turning it off. Keeping attributes lets us see real signal (a button's `disabled` flipping, an `aria-busy` toggle, a `data-state="loaded"` attribute that frameworks like Radix and shadcn use as their canonical "ready" marker).

### Meaningful-mutation filter

Each mutation is checked against a small predicate. Anything that fails the predicate is *ignored* for the purpose of resetting the quiescence timer (it still flows through `bproxy:locationchange` listeners, etc.):

```js
function isMeaningful(m) {
  const n = m.target;

  // Noise roots.
  if (n.nodeType === Node.ELEMENT_NODE) {
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'LINK' || tag === 'STYLE' || tag === 'META') return false;
  }
  // Closest ancestor we care about.
  const el = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
  if (!el) return false;

  // Skeleton / shimmer / progress noise we already filter for `busy`.
  if (el.matches?.('[class*="skeleton"], [class*="shimmer"], .spinner, .loader')) return false;

  // Off-screen + hidden = not user-visible churn.
  if (!isOnScreen(el)) return false;
  if (!isVisible(el)) return false;

  // Common telemetry / ad iframes by accessible name.
  const ifr = el.closest?.('iframe');
  if (ifr && /\b(ads?|telemetry|tracking|beacon|analytics)\b/i.test(ifr.title || ifr.name || ifr.src || '')) return false;

  // Attribute mutations: only count semantic ones.
  if (m.type === 'attributes') {
    const a = m.attributeName;
    const semantic = a === 'aria-busy' || a === 'aria-hidden' || a === 'aria-expanded' ||
                     a === 'aria-disabled' || a === 'disabled' || a === 'hidden' ||
                     a === 'data-state' || a === 'data-loaded' || a === 'open';
    if (!semantic) return false;
  }
  return true;
}
```

`isOnScreen` is implemented with a long-lived `IntersectionObserver` keyed on the mutated element's nearest layout-bearing ancestor — checking `getBoundingClientRect()` on every mutation would be O(N) layout work per batch on busy pages. The IO cache is invalidated when the element is removed.

The filter is intentionally a *small* predicate the doc can reproduce verbatim. Sites that need extra rules can be handled per-app by the agent issuing `bproxy wait selector` against a real anchor instead of relying on settle.

### Adaptive quiescence window

A fixed 500 ms threshold is wrong in both directions: too long for sites that paint under 200 ms total, too short for sites that batch hydration into ~800 ms passes. The observer measures **inter-mutation gaps** for the first ~2 s after the page becomes interactive, takes the median, and picks the threshold as `clamp(2 × median, 200 ms, 2 s)`. Once chosen, the threshold is fixed for the lifetime of the document.

```js
let gaps = [];
let lastT = performance.now();
const adaptUntil = lastT + 2000;

let threshold = 500;  // sensible default while we sample
function onMutationBatch(now) {
  if (now < adaptUntil) {
    gaps.push(now - lastT);
    lastT = now;
    if (gaps.length >= 5) {
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      threshold = Math.min(2000, Math.max(200, Math.round(2 * median)));
    }
  } else {
    lastT = now;
  }
}
```

Why "2× median" and not the 95th percentile? Median is robust to a single long pause (network jank during hydration); the 95th would over-fit to a slow image-decode tail. The 200 ms floor exists because two `rAF` ticks (≈ 32 ms) is the lower bound at which a "no mutations" claim is meaningful — any tighter and a single `rAF`-coalesced batch reads as quiet. The 2 s ceiling exists because, at that point, the agent should be using `wait selector` instead.

This is a pragmatic recommendation, not a research claim. The alternative ("hard 500 ms always") is documented as the fallback if the adaptive logic ever proves unstable in production — flip a feature flag and we are back to the previous behaviour.

### Never-settle pages

Long-polling chats, animated dashboards, lazy-list IntersectionObserver feeds will not meet the threshold for the full timeout. `wait settle` then returns a **best-effort summary** instead of a hard `WAIT_TIMEOUT`:

```json
{
  "ok": false,
  "error": "NEVER_SETTLED",
  "message": "DOM did not reach quiescence within 10000ms",
  "retry": false,
  "hint": "Last 1s: 47 mutations under .chat-feed, 12 under aside.live-stats. Use `bproxy wait selector` on a specific anchor.",
  "page": { "url": "...", "title": "...", "state": "settling", "busy": false },
  "data": {
    "samples": [
      { "selector": ".chat-feed",     "mutations": 47, "kind": "childList+characterData" },
      { "selector": "aside.live-stats","mutations": 12, "kind": "attributes" }
    ],
    "thresholdMs": 480
  }
}
```

The agent reads the samples and either retries with a longer `--timeout`, switches to `wait selector` against a stable region, or proceeds anyway. **Crucially, this only affects the explicit `wait settle` command.** Destructive actions never reach this state because they wait on their target's `stable` check, not global settle.

`NEVER_SETTLED` is `retry: false` because retrying the same call with the same timeout will return the same result. The agent has to change strategy.

## Network idle detection

`wait settle --network` (and the underlying ring buffer used by `wait response`) is fed by a `MAIN`-world shim that wraps `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `EventSource`, `WebSocket`, and dynamic `import()`. Two changes from the previous design.

### Inject at `document_start`, unconditionally

Pages that cache a reference to `window.fetch` at module load are a real, widespread pattern (every `fetch`-based HTTP client wrapper does it: axios-fetch adapters, Apollo's HTTP link, redux-toolkit's RTK Query). If our shim runs after the cache is taken, those calls are invisible. The previous design only injected on first `wait --network`, which guaranteed the bug.

The shim is now declared in the manifest as a `MAIN`-world content script at `document_start`:

```jsonc
// manifest.json — relevant excerpt; full manifest is in 04-extension.md.
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["network-shim.js"],
    "run_at": "document_start",
    "world": "MAIN",
    "all_frames": true
  },
  {
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_start",
    "all_frames": true
  }
]
```

`run_at: "document_start"` + `world: "MAIN"` is the only configuration where Chrome guarantees our code runs **before** any page script ([Chrome — Content scripts: run_at](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)).

### What the shim wraps

```js
// network-shim.js — runs in MAIN world at document_start in every frame.
(() => {
  if (window.__bproxyNetShim) return;
  window.__bproxyNetShim = true;

  let pending = 0;
  const recent = [];        // ring buffer, size 200; entries: {url, status, t}
  const RING = 200;

  const bump = (delta) => { pending += delta; emit(); };
  const remember = (entry) => { recent.push(entry); if (recent.length > RING) recent.shift(); emit(entry); };
  const emit = (entry) => {
    document.dispatchEvent(new CustomEvent('bproxy:net', {
      detail: { pending, entry: entry || null }
    }));
  };

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    bump(+1);
    const url = (args[0] && args[0].url) || String(args[0]);
    return origFetch.apply(this, args).then(
      (res) => { bump(-1); remember({ url, status: res.status, t: Date.now() }); return res; },
      (err) => { bump(-1); remember({ url, status: 0, t: Date.now(), error: String(err) }); throw err; },
    );
  };

  // XHR
  const origSend = XMLHttpRequest.prototype.send;
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__bpUrl = u; return origOpen.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    bump(+1);
    this.addEventListener('loadend', () => {
      bump(-1);
      remember({ url: this.__bpUrl, status: this.status, t: Date.now() });
    }, { once: true });
    return origSend.apply(this, args);
  };

  // sendBeacon — fire-and-forget, count as instantaneous.
  const origBeacon = navigator.sendBeacon?.bind(navigator);
  if (origBeacon) {
    navigator.sendBeacon = function (url, body) {
      remember({ url: String(url), status: 0, t: Date.now(), kind: 'beacon' });
      return origBeacon(url, body);
    };
  }

  // EventSource — long-lived; counts toward 1 while open, useful for `wait response`.
  const OrigES = window.EventSource;
  if (OrigES) {
    window.EventSource = function (url, init) {
      const es = new OrigES(url, init);
      bump(+1);
      es.addEventListener('error', () => { if (es.readyState === 2) bump(-1); });
      remember({ url: String(url), status: 0, t: Date.now(), kind: 'eventsource' });
      return es;
    };
    window.EventSource.prototype = OrigES.prototype;
  }

  // WebSocket — same shape as EventSource.
  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, protos) {
    const ws = new OrigWS(url, protos);
    bump(+1);
    ws.addEventListener('close', () => bump(-1), { once: true });
    remember({ url: String(url), status: 0, t: Date.now(), kind: 'websocket' });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;

  // Dynamic imports — Chrome surfaces these as fetch under the hood, so they are
  // already counted via the fetch wrapper above. No separate hook required.
})();
```

`network-shim.js` writes only to `window.__bproxyNetShim` and dispatches `bproxy:net` events on `document`. It does not hold references that prevent garbage collection. It does not call any extension API (it can't — `MAIN` world has no `chrome.*` other than what the page would). The isolated-world content script listens for `bproxy:net` on `document` and forwards to the background.

### Idle threshold

`pending === 0` for **500 ms**. We keep this fixed (rather than adaptive) because real fetch traffic arrives in clusters that are well-separated from settle-style mutation jitter; 500 ms matches Puppeteer's `networkidle0` and Chrome DevTools' "Network idle" definition ([Puppeteer — page.waitForNetworkIdle](https://pptr.dev/api/puppeteer.page.waitfornetworkidle), [networkidle0 vs networkidle2](https://www.webshare.io/academy-article/puppeteer-networkidle0-vs-networkidle2)). EventSource and WebSocket are excluded from the idle count after they have been open for 1 s, otherwise dashboards with a single SSE channel never go idle — they are still recorded in the ring buffer for `wait response`.

### Per-domain shim disable

Some sites — typically those running aggressive bot-management JS — flag the *presence* of any wrapper on `window.fetch`, `XMLHttpRequest.prototype`, or `history.pushState` even when [native-form preservation](./04-extension.md#native-form-preservation-for-the-main-world-shim) closes the cheap toString check. For these origins the agent can opt the shim out per origin.

```
bproxy domain set https://*.example.com/* --no-network-shim --no-history-patch
```

Spec for `bproxy domain` is in [02-cli-design.md → `bproxy domain` configuration](./02-cli-design.md#bproxy-domain-configuration); this section documents the runtime contract.

**Mechanism.** The manifest still injects `network-shim.js` at `document_start` in MAIN world on every URL — that injection is the *only* configuration where the shim wins the race against page scripts that cache `window.fetch` at module init ([Chrome — Content scripts: run_at](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)). What changes per-domain is the shim's *first action*: at the top of its IIFE, it reads a small per-origin rule set passed in via `chrome.scripting.executeScript` `args` (the SW evaluates the rules against `tabId` at injection time and forwards the resulting flags). On a `noNetworkShim: true` rule the IIFE returns immediately without wrapping anything; on `noHistoryPatch: true` it skips the `history.pushState` / `replaceState` patch but still installs the network wrappers (the two flags are independent).

The earlier "always-on at document_start" model documented in [04-extension.md → Content script run_at](./04-extension.md#content-script-runat-document_start-and-main-world-shim) is therefore *conditionally* always-on: the script always runs, the wrappers are conditional. We do not gate injection itself behind the rule because that re-introduces the toString-cache race for any future re-enable of the shim mid-session.

**Cost on disabled origins.**

| Capability                | On disabled origin                                                                                            |
|---------------------------|---------------------------------------------------------------------------------------------------------------|
| `wait --network`          | **Does not work.** Returns immediately as if the network were idle, since `pending === 0` is the only signal we have. The agent sees `waited: 0` with `state: "ready"` and must use a different strategy. |
| `wait response <urlGlob>` | **Does not work.** Ring buffer is empty; the wait will time out as `WAIT_TIMEOUT` even if the response did arrive. |
| `wait settle` (no `--network`) | **Works.** Relies on MutationObserver in the isolated world, which is independent of the MAIN-world shim. |
| `wait selector` / `wait function` | **Works.** Independent of the shim entirely.                                                          |
| Auto-wait inside `click` / `type` | **Works.** The auto-wait checks (visible / stable / enabled / receives events) are observation-only, no wrapper. |
| `bproxy:locationchange` events | **Suppressed** when `noHistoryPatch: true`. SPA navigation detection falls back to `chrome.webNavigation.onHistoryStateUpdated` (~50 ms higher latency, still reliable). |

The agent's recourse on disabled origins is to use `wait selector` against a real anchor (a result row, a heading, a state attribute) and to issue actions trusting auto-wait. This is the same pattern the agent uses on never-settle pages and on cross-origin frames; bproxy already documents it as a fallback mode.

**When to set this rule.** The pattern is: agent observes a Cloudflare Turnstile / Datadome / HUMAN challenge banner appearing on every navigation under default mode, even with native-form preservation. The hypothesis is that the wrapping signature itself is being used. The mitigation is to disable the wrappers and accept the loss of network-based waits on that origin, not to rotate stealth tricks indefinitely. See [12-risks.md → Headline risk](./12-risks.md#headline-risk-the-extension-itself-is-fingerprintable) for the broader stance.

### Residual: service-worker-mediated fetches are invisible

A page with a service worker can intercept its own network requests and respond from a Cache or IndexedDB. From a content script's perspective, `window.fetch` *is* called (we see it), but the network request that actually leaves the browser is initiated by the SW and is not observable from our shim. For the *idle* signal this is fine — we counted the page-side `fetch`, not the wire-level request. For `wait response <urlGlob>` this can miss requests where the SW serves from cache and the page never sees the URL we're matching against (rare, since the SW typically forwards the same URL).

There is no fix from a content script. Documented honestly. The agent's recourse is to use `chrome.devtools.network` if it ever proves a real blocker (a future task; not in v1).

## Page-state field is advisory

The `page.state` field is still emitted on every response for situational awareness:

| Value         | Meaning                                                                                  |
|---------------|------------------------------------------------------------------------------------------|
| `"loading"`   | `document.readyState !== "complete"`. Initial full-page load only.                       |
| `"settling"`  | Document loaded; the adaptive quiescence window has not been met.                        |
| `"ready"`     | Adaptive window met *and* no busy indicators visible.                                    |

The state is now an *advisory* hint. Concretely:

- **The agent does not branch on `state` for retry decisions.** Auto-wait inside actions is the contract.
- The `state` field is logged and shown to humans inspecting the response, and helps the agent pick a *strategy* for `bproxy wait` (settling + busy → try `wait selector`).
- The transitions remain: `loading → settling` on `readystatechange complete`; `settling → ready` on adaptive quiescence + no busy; either → `settling` on `bproxy:locationchange`, `popstate`, `hashchange`, or any meaningful mutation after `ready`.

Busy detection (the `busy` flag) is unchanged from the previous design (`aria-busy`, narrow set of class-name patterns, with size and visibility checks). It is a hint for humans and a tiebreaker for `state: "ready"`. It is *not* consulted by auto-wait.

## Navigate command

`navigate` always uses `chrome.tabs.update(tabId, { url })` regardless of whether the target URL is same-origin or cross-origin. This triggers a full page navigation, the content script re-injects, and the result is predictable. The earlier design alternative (try `pushState` for same-origin) is rejected for the same reasons as before:

- `history.pushState()` changes the URL bar but does not trigger the app's router.
- `location.href = sameOriginUrl` triggers a full reload anyway.
- The only reliable way to trigger SPA-internal navigation is to click a link.

### Two-tier wait

`navigate` uses a two-tier wait strategy:

1. **Hard wait**: `chrome.webNavigation.onCompleted` for the top frame of the target tab, plus `chrome.tabs.onUpdated` `status: 'complete'` as a backup. Either must succeed before the deadline or it's `NAVIGATION_FAILED`. (`webNavigation` is more precise — `onCompleted` fires when the document fires its `load` event, while `tabs.onUpdated complete` fires at a slightly different point. We listen to both and take the first.)
2. **Soft wait**: After load, wait for the adaptive settle window to be met **with a 3-second cap**. If settle does not land within 3 s, return anyway with `state: "settling"`.

The soft cap prevents `navigate` from timing out on never-settle pages. The agent gets the page back in a usable state and can `bproxy wait selector` for whatever it actually needs.

Response includes timing:

```json
{
  "ok": true,
  "data": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "waited": 2340 },
  "page": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "state": "ready", "busy": false }
}
```

If the destination is a cross-origin page that itself navigates again before load (a common login-redirect pattern), `navigate` follows the navigation chain — `webNavigation.onCommitted` fires for each hop, and `onCompleted` for the final document is what closes the hard wait. The agent sees the terminal URL.

## Per-frame settle and network aggregation

The network shim, observer, and history patch run with `all_frames: true` (plus `match_origin_as_fallback: true` for `about:srcdoc` / `data:` / `blob:` frames; see [04-extension.md → Frame routing](./04-extension.md#frame-routing-and-frame-detection)). Each frame computes its own quiescence and tracks its own pending-request counter; cross-frame DOM access is forbidden by the same-origin policy and the extension does not bypass it. The top-level "page state" is therefore an *aggregate* over the frame tree, not a single shared observer.

### Routing path

Iframes — same-origin or cross-origin — cannot directly message each other when origins differ. The bridge is the SW. Each frame's `content.js` sends per-frame events to the SW via `chrome.runtime.sendMessage`; the SW maintains a per-tab aggregate and answers in-flight `bproxy wait` requests from there.

```
content.js in frame F  ──{ tabId, frameId, kind: "settle" | "net" | "locationchange", payload }──▶
                                            chrome.runtime.sendMessage
                                                       │
                                                       ▼
                              SW per-tab aggregator (background.js)
                                                       │
                                                       ▼
                          in-flight `wait` request resolver / `page` block builder
```

Each frame's content script reports:

- `pending` count (its own frame's network shim).
- `settled` boolean (its own MutationObserver + adaptive threshold).
- `lastUrl` plus `bproxy:locationchange` events (its own history patch).
- `lastRequest` ring-buffer entries, keyed by frame, for `wait response`.

The SW keeps these in `aggregateState[tabId][frameId]` (in-memory, rebuilt on SW restart from the next batch of frame messages — short-lived so the loss is acceptable).

### Aggregation rules

The aggregate definitions used by `wait` and by the `page.state` field are:

| Aggregate signal               | Rule                                                                                                                                                                                                                                            |
|--------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Top-level settle**           | Top frame's own settle AND every subframe is *either* settled, *or* has been observed for at least its **per-frame timeout of 3 s** without settling. The 3 s budget per frame prevents one ad iframe from holding the whole page hostage.       |
| **Top-level network idle**     | `Σ pending` across the top frame and each subframe equals 0 for 500 ms. Long-lived `EventSource`/`WebSocket` are excluded after 1 s in *every* frame, with the same rule as the top-frame counter — see [Network-idle threshold](#idle-threshold).|
| **Per-frame waiter**           | When `--frame` is supplied, the SW resolves the `frameId` (per [Frame routing](./04-extension.md#frame-routing-and-frame-detection)) and reads only that frame's slice of `aggregateState`. The per-frame timeout does *not* apply — explicit waiters get the full caller-supplied `--timeout`. |

The 3 s per-frame budget is deliberately short enough to absorb advertising and tracking iframes, and long enough that a real Stripe Checkout iframe (which typically settles in 1–2 s after fetching its bundle) is included in the aggregate. The agent that wants to *require* a slow subframe to settle does so explicitly via `bproxy wait settle --frame <selector>` — the per-frame timeout never silently truncates an explicit per-frame wait.

### Long-polling SSE / WS in subframes

The same exclusion rule the top frame uses (`EventSource` / `WebSocket` drop out of the pending count after they have been open for 1 s) applies per-frame. Without this, a chat iframe with one SSE channel never lets the page reach network-idle even though the user-visible work is done. The frame's `content.js` performs the exclusion locally, so the SW receives a `pending` count that already excludes long-lived streams.

### Cross-origin DOM still opaque

The aggregator only bridges *signal* (counts, booleans). It does not let the parent's `bproxy wait selector ".foo"` find `.foo` inside a cross-origin child. For that the agent uses `bproxy wait selector --frame <iframe-selector|url-pattern> ".foo"`; the SW routes the wait into the child's content script, which evaluates against its own document. This is the same shape Playwright uses with `frameLocator` ([Playwright — Frames](https://playwright.dev/docs/frames)).

### Residual

- **Sandboxed iframes without `allow-same-origin`** are an opaque origin even within the same site. They report their own settle / network status to the aggregator, but the parent cannot read their DOM and `--frame <selector>` against them works only when the selector matches the parent's `<iframe>` element.
- **`data:` and `about:srcdoc` frames** are reachable via `--frame` but only by **selector**; their document URL is the literal scheme and rarely uniquely identifies the frame.
- **A subframe that detaches between the SW receiving a settle update and the next aggregate evaluation** drops its slice of `aggregateState` immediately on the `chrome.webNavigation.onBeforeNavigate` event; the aggregate recomputes without it. See [06-failure-modes.md → Frame detached mid-action](./06-failure-modes.md#frame-detached-mid-action) for in-flight commands targeting that frame.

## Sources

- [Playwright — Auto-waiting / actionability](https://playwright.dev/docs/actionability)
- [Playwright — Frames](https://playwright.dev/docs/frames)
- [Chrome — Manifest content_scripts (`match_origin_as_fallback`, `all_frames`)](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Chrome — chrome.scripting (`target.frameIds` vs `allFrames`)](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Puppeteer — page.waitForFunction / waitForResponse / waitForNetworkIdle](https://pptr.dev/api/puppeteer.page.waitfornetworkidle)
- [Chrome — chrome.webNavigation reference](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [Chrome — Content scripts: run_at and world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)
- [wxt — Improved wxt:locationchange (history-patch motivation)](https://github.com/wxt-dev/wxt/issues/1567)
- [single-spa#528 — Native pushState fires synthetic popstate](https://github.com/single-spa/single-spa/issues/528)
- [networkidle0 vs networkidle2](https://www.webshare.io/academy-article/puppeteer-networkidle0-vs-networkidle2)
- [MDN — History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
