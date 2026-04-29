# 4. Extension Internals

[← Index](./README.md) · Prev: [Proxy Service](./03-proxy-service.md) · Next: [Page State Detection →](./05-page-state.md)

---

## Background service worker (`background.js`)

Responsibilities:
- Open and maintain a WebSocket to `ws://localhost:9615/ws`, authenticated with the user-supplied bearer token (see [Token setup](#token-setup)).
- Keep the WebSocket alive across MV3 service-worker idle ticks (see [Service worker lifecycle](#mv3-service-worker-lifecycle)).
- Recover in-flight command state across SW restarts (see [Pending state in chrome.storage.session](#pending-state-in-chromestoragesession)).
- Resolve each command's target tab via the session pin (see [Tab resolver](#tab-resolver) and [08-tab-management.md](./08-tab-management.md)).
- Route incoming commands to the correct handler.
- Commands handled directly in background: `screenshot`, `tab list`, `tab pin`, `tab unpin`, `tab open`, `tab close`, `status`, `navigate`, `eval`.
- Commands forwarded to content script: `click`, `type`, `text`, `images`, `elements`, `outline`, `dom`, `wait`.

## Token setup

The proxy authenticates every WebSocket upgrade with a bearer token that the user pastes into the extension once. See [03-proxy-service.md → WebSocket authentication](./03-proxy-service.md#websocket-authentication) for the protocol-level rules.

### Why an options-page paste, not auto-discovery

The extension cannot read `~/.bproxy/token` — sandboxed browser code has no filesystem access, by design. Several alternatives were considered and rejected:

- **Native messaging host.** Strongest model (the OS authenticates the host process), but it requires a separate per-OS installer, registered in the platform's native-messaging registry. That moves us from "browser extension" to "browser extension plus desktop app," and is over-engineered for v1.
- **Token in the extension package.** Not viable — the token is per-installation and rotates on every proxy restart; a packaged token is not.
- **Localhost handshake without a token** (extension trusts any `127.0.0.1`). This is the *current* failure mode that this whole task exists to fix.

A one-time paste is the least-bad UX: it makes the trust step explicit, the user controls it, and we do not bring a desktop installer along for the ride.

### Storage in the extension

The pasted token lives in `chrome.storage.local` under a single key:

```js
await chrome.storage.local.set({ bproxyToken: '<token>' });
```

`chrome.storage.local` is per-extension and is not visible to other extensions or to web pages. It is no more privileged than `localStorage`, but neither is the threat model: anyone with code execution inside *this* extension's context already has the token, and the browser sandbox is the boundary we rely on. We do not encrypt the value at rest — there is no useful key to encrypt it with that is not also stored next to it.

The storage key is read once at SW startup and cached in the bootstrap closure; rotations are handled by `chrome.storage.onChanged` watching the key and triggering a WS reconnect.

### Options page flow

`options.html` shows a single text field labelled "bproxy proxy token" with a "Save" button. On save:

1. Trim whitespace.
2. Length-check (43 base64url chars expected; warn but accept other lengths to remain forward-compat).
3. Write to `chrome.storage.local`.
4. Close the existing WS (if any) so the listener-driven reconnect picks up the new token.

The page also displays the current connection state (connected / disconnected / auth failure) so the user can confirm the paste worked. On a 401-style upgrade failure, the SW writes a `lastAuthError` field into `chrome.storage.local` which the options page reads and renders as "Token rejected by proxy — restart `bproxy service start` and re-paste."

### Using the token on connect

```js
const { bproxyToken } = await chrome.storage.local.get('bproxyToken');
if (!bproxyToken) {
  // Surface "no token" state; do not attempt connect.
  return;
}
const ws = new WebSocket('ws://127.0.0.1:9615/ws', [
  `bproxy.bearer.v1.${bproxyToken}`,
]);
```

The token never travels in the URL or in any frame payload. If the upgrade fails (server closes without selecting our subprotocol), the listener treats it as a recoverable error, records `lastAuthError`, and stops reconnect attempts until the storage key changes — there is no point in hammering the proxy with a known-bad token.

### Token rotation

When the user runs `bproxy service start` again, the proxy generates a new token. The next SW reconnect attempt will hit the proxy with the old token and fail the upgrade. The user sees this in the options page status and re-pastes. We do not try to detect rotation automatically: a "the proxy thinks the world is different" event is exactly what we want a human to notice.

## MV3 service worker lifecycle

Chrome terminates an MV3 background service worker after **30 seconds of inactivity** (any extension event or extension API call resets this idle timer; see Chrome's [extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) doc). When the SW is terminated, **its WebSocket is force-closed** and any in-memory state is gone. Any agent command issued after that point would arrive at a proxy with no extension client.

Two facts drive the whole design:

1. **An inbound WebSocket frame does not wake a dead service worker.** Once the SW has been terminated, the OS-level socket is closed; the proxy has nothing to deliver to. Frames only count as activity *while the SW is already running*. (Chrome 116+ does reset the SW idle timer on WS traffic, but that only helps an already-live SW stay live — it does not revive a dead one. See [Use WebSockets in service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets).)
2. **Only specific events wake a stopped SW**: `chrome.runtime.onStartup`, `chrome.runtime.onInstalled`, `chrome.alarms.onAlarm`, `chrome.runtime.onMessage` from a content script, `chrome.tabs.*`, user clicks on the extension action, native messaging port traffic, and a handful of other registered listeners. **Inbound WS frames are not on this list.**

The reliability strategy is therefore: **never let the SW go idle while the extension is meant to be online.** The WS itself is treated as a fragile transport that will die during browser sleep, network changes, or unhandled edge cases — the design has to recover, not avoid the problem.

### Wake path and keepalive

Canonical keepalive is `chrome.alarms`. Alarms wake the SW on schedule even after termination, and the listener fires before the WS would otherwise have idled out.

```js
// Top-level in background.js — must be registered synchronously on every SW start.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bproxy-keepalive') ensureConnected();
});

chrome.runtime.onStartup.addListener(bootstrap);
chrome.runtime.onInstalled.addListener(bootstrap);

async function bootstrap() {
  await chrome.alarms.create('bproxy-keepalive', { periodInMinutes: 0.5 });
  ensureConnected();
}
```

**Alarm period: 0.5 minutes (30 s).** This is the minimum allowed since Chrome 120 (`periodInMinutes: 0.5`; see [chrome.alarms reference](https://developer.chrome.com/docs/extensions/reference/api/alarms)). It matches the SW idle window exactly: the alarm fires just as the SW would otherwise be terminated, the listener resets the idle timer, the WS stays open, and we get continuous reachability without an offscreen document.

In addition to the alarm, the background script also runs an **app-level WS heartbeat every 20 s** while connected (Chrome's official tutorial recommends 20 s — comfortably under the 30 s idle window). The heartbeat doubles as dead-connection detection: if no pong arrives within 5 s, the WS is treated as dead and reconnect is triggered. See [Reconnect strategy](#reconnect-strategy).

Both mechanisms are intentionally redundant. The alarm guarantees the SW is alive even if the WS is briefly down (so a reconnect attempt can run); the WS heartbeat guarantees the connection itself is healthy and not silently half-open.

Chrome alarms **generally persist across SW restarts and even across browser restarts**, but the alarms reference notes this is "not guaranteed, and alarms may be cleared when the browser is restarted." Therefore `bootstrap()` always re-creates the alarm if missing — `chrome.alarms.create` is idempotent (overwrites by name).

### Bootstrap triggers

The extension (re-)opens the WS on any of:

| Event                              | When it fires                                                  |
|------------------------------------|----------------------------------------------------------------|
| `chrome.runtime.onStartup`         | Browser launch with the extension already installed.           |
| `chrome.runtime.onInstalled`       | Fresh install, extension update, or manual reload.             |
| `chrome.alarms.onAlarm` (`bproxy-keepalive`) | Every 30 s — recovers from any miss above.           |
| `chrome.runtime.onMessage` (content script `bproxy-ready`) | Content script load wakes the SW; useful first signal after a fresh tab. |

`onStartup` plus `onInstalled` ensures we reconnect after Chrome launch and after each extension update. The 30 s alarm catches everything else, including the case where neither `onStartup` nor `onInstalled` fired (the user disabled and re-enabled the extension via the chrome://extensions page, etc.).

### Pending state in `chrome.storage.session`

In-flight command state previously lived in a `Map` in SW memory and was lost on every restart. It now lives in `chrome.storage.session`, which is in-memory at the extension level and survives SW restarts within the same browser session (cleared on browser restart, extension reload, and extension update; see [chrome.storage reference](https://developer.chrome.com/docs/extensions/reference/api/storage)). This is the right scope: anything the proxy still cares about after a true browser restart is the proxy's responsibility, not ours.

Schema, keyed by command id:

```jsonc
// chrome.storage.session key: "pending"
{
  "<command-id>": {
    "action":   "click",
    "params":   { "selector": "#submit" },
    "deadline": 1714000000000,   // epoch ms; absolute, not relative
    "attempts": 1,                // incremented on each (re)dispatch
    "startedAt": 1713999999500
  }
}
```

Lifecycle:

1. On dispatch from WS → write entry, then begin work.
2. On response → delete entry, then write WS reply.
3. On SW restart → read `pending`, drop entries past `deadline`, re-establish handlers for the rest. Whether to re-execute is the responsibility of the [dedupe table and request lifecycle](#dedupe-table-and-request-lifecycle) layered on top — this section only persists and surfaces the entries; the dedupe table decides replay semantics.
4. **TTL / eviction**: any entry whose `deadline` is in the past is dropped on every SW startup and on every alarm tick (cheap sweep). 10 MB cap on `storage.session` is far beyond what one extension instance needs at < 1 KB per entry; no LRU is required.

`storage.session` is **not** used as a queue between proxy and extension — the proxy is the queue (see [Proxy Service](./03-proxy-service.md)). It is purely for "what was I doing when I died?"

## Dedupe table and request lifecycle

The `pending` map answers "what was I doing when I died?" but it does not answer "did I already do this?" That second question is what makes destructive-action retries safe, and is the contract the proxy depends on for [replay on reconnect](./03-proxy-service.md#replay-on-reconnect). The dedupe table provides it.

We layer two storage entries on top of `pending`, all in `chrome.storage.session` so they share its lifetime (in-memory at the extension, survives SW restart, cleared on browser restart / extension update — exactly the right scope for at-most-once *within one browser session*).

```jsonc
// chrome.storage.session.pending  — already defined in the SW lifecycle section
{ "<id>": { action, params, deadline, attempts, startedAt } }

// chrome.storage.session.done — NEW
// Cached terminal results, keyed by id, for replay protection.
{
  "<id>": {
    "fingerprint": "click:#submit:sha256(params)", // (action, params) hash
    "destructive": true,
    "response":   { "ok": true, "data": { "clicked": true }, "page": {...} },
    "completedAt": 1714000001234,
    "expiresAt":   1714086401234   // 24h after completedAt
  }
}
```

### Request lifecycle (extension side)

Five states, written to `pending` and `done` atomically (single `chrome.storage.session.set` call per transition):

```
received ──▶ pending ──▶ running ──▶ done
                │                      ▲
                └──── (replay) ────────┘
```

- **received**: WS frame arrived. The handler immediately writes a `pending` entry, sends an `ack` frame back to the proxy, and only *then* dispatches to the action handler. The ack/`pending`-write order matters: if the SW dies between ack and write, the proxy assumes "extension owns it" and the next reconnect must find it in `pending` or `done` for the at-most-once promise to hold. We put the write first and the ack second to make this true.
- **pending**: handler dispatched, action executing.
- **running**: same as pending from the proxy's perspective; internally the extension may transition through sub-steps (e.g. content-script injection, ready-ack, resend) — they don't change the lifecycle state.
- **done**: action completed (success or terminal error). Write the response into `done`, send the `result` frame on WS, then delete from `pending`. Order matters here too: if the SW dies after writing `done` but before deleting `pending`, the next bootstrap will see both, treat `done` as authoritative, and clean up `pending`.
- **(replay)**: a new WS frame arrives with an `id` already in `done`. Don't dispatch the handler. Resend the cached response with `replay: true`. If the new frame's (action, params) fingerprint doesn't match the cached fingerprint, return `REPLAY_REJECTED` — the agent has reused an `id` for a different operation, which is a bug.

### Dedupe semantics by action class

The extension reads the `destructive` flag from the envelope:

- `destructive: false` (read-only actions): on a re-delivered id that is in `done`, return the cached response — but it is also acceptable to re-run the action and overwrite `done`. We pick "return cached" for consistency: the agent gets the *same* answer to the *same* id, which is easier to reason about and matches Stripe's behaviour ([Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)). Re-running on a fresh id is the agent's tool for "I want a new reading."
- `destructive: true`: on a re-delivered id that is in `done`, return the cached response and **do not re-execute**. This is the at-most-once guarantee. The dedupe table is the single point of enforcement; do not also try to detect duplicates by other means.

### Cap, TTL, and pruning

| Knob               | Value | Rationale                                                                                              |
|--------------------|-------|--------------------------------------------------------------------------------------------------------|
| `done` TTL         | 24 h  | Matches Stripe's idempotency-key window. Agents do not retry days later; 24 h is a generous ceiling.   |
| `done` size cap    | 1000 entries | At < 2 KB per entry, 1000 fits in `chrome.storage.session`'s 10 MB budget with room to spare. |
| `pending` size cap | 64 entries | Mirrors the proxy's `MAX_PENDING`; the proxy is the upstream gate. |
| Eviction           | LRU on `done`, FIFO on `pending` (deadline-ordered). |

Pruning runs on three triggers:
1. Every `bproxy-keepalive` alarm tick (cheap sweep — drop `pending` entries past deadline, drop `done` entries past `expiresAt`).
2. Just before writing a new entry, if the cap would be exceeded.
3. On `bootstrap()` after SW restart (catches anything missed during downtime).

### Replay on reconnect (extension side)

When the WS reconnects, the SW is responsible for two catch-up actions, performed before draining the inbound frame queue:

1. **Resume in-flight work.** For every entry in `pending` whose `deadline` is still in the future and which has no corresponding entry in `done`, treat it as if the action had not run (because we can't tell whether it did) and re-dispatch the handler. The dedupe table will catch us on the second pass if the proxy re-sends the same id.
2. **Volunteer cached responses.** For every entry in `done` whose `expiresAt` is in the future, send a `result` frame on the WS labelled `replay: true`. The proxy ignores any whose id is no longer in its pending map; the rest unblock waiting HTTP callers immediately. This is the catch-up half of the [proxy's replay-on-reconnect](./03-proxy-service.md#replay-on-reconnect) plan and the equivalent of the `last_seen_id` rejoin used by Phoenix Channels ([Phoenix — Channels guide](https://hexdocs.pm/phoenix/channels.html)).

Step 1 is at-least-once for read-only actions and at-most-once for destructive actions, as documented in [01-output-contract → Per-action idempotency policy](./01-output-contract.md#per-action-idempotency-policy). The mechanism is identical; only the dedupe-table behaviour differs by `destructive` flag.

### Concurrency inside the extension

Even though the proxy already serializes per tab (see [03-proxy-service.md → Concurrency](./03-proxy-service.md#concurrency)), the extension also owns a per-tab mutex as a defence in depth: at most one in-flight tab-affecting handler per tab id. If a duplicate slips through (e.g. an alarm-driven resume races with an inbound frame), the second one waits in a small in-memory queue and runs after the first's `done` write.

The mutex lives in SW memory, not `storage.session`. Acceptable — if the SW dies, the in-memory queue is lost and resume picks the work back up from `pending`.

### Cancel handling

Inbound `{ type: "cancel", id }` frames map to the request lifecycle as follows:

| Current state of the id  | Effect of cancel                                                                  |
|--------------------------|-----------------------------------------------------------------------------------|
| not in `pending` or `done` | No-op. Possibly arrived after the result; the proxy will discard our late reply. |
| in `pending`, not yet running | Drop the entry. Send `result` with `error: CANCELLED`.                       |
| in `pending`, running    | Let it finish. Write the real result into `done`. Do not send a fresh `result` frame — the HTTP caller is gone. The `done` cache absorbs it for any future replay. |
| in `done`                | No-op. Already cached.                                                            |

This matches the proxy-side contract that destructive actions may complete despite cancellation; the agent must observe page state to confirm.

### Reconnect strategy

Triggers that initiate a connect attempt:
- `bootstrap()` from `onStartup` or `onInstalled`
- Alarm tick if `webSocket === null` or `readyState !== OPEN`
- WS `onclose` / `onerror`
- Heartbeat pong timeout (treat as dead connection)
- Content-script `bproxy-ready` `onMessage` if no WS open

Backoff: exponential with full jitter, **capped at 20 s**.

```js
// attempt n: delay in [0, min(2^n * 250ms, 20_000ms)]
const base = Math.min(250 * 2 ** attempts, 20_000);
const delay = Math.random() * base;
```

The 20 s cap is deliberate: it must be **strictly less than the 30 s SW idle window** so that a reconnect attempt always runs while the SW is still alive (or, if the SW dies anyway, the next alarm tick at 30 s picks up where backoff left off). Backoff state itself lives in `storage.session` so a SW restart mid-backoff doesn't reset attempts to 0 and hammer the proxy.

Dead-connection detection:
- App-level heartbeat: send `{type:"ping"}` every 20 s; require pong within 5 s. This catches half-open connections that look fine to `readyState` but have lost packets (corporate proxies, NAT timeouts, OS sleep/wake).
- Browser WS ping/pong frames are not exposed to JS in the WebSocket API, so app-level is required regardless. The proxy implements the matching pong (already does ping/pong every 10 s server-side; see [Proxy Service](./03-proxy-service.md)).

### OS sleep / network change

| Event                          | What fires in the SW                                       | Recovery                                 |
|--------------------------------|------------------------------------------------------------|------------------------------------------|
| Laptop sleep                   | Nothing during sleep. On wake: existing alarms fire on schedule. | Next alarm tick (≤ 30 s) reconnects.     |
| Wi-Fi switch / VPN reconnect   | WS may go half-open silently; `onclose` is **not** guaranteed. | App-level heartbeat detects within 25 s. |
| Loss of network                | `onclose` may fire (or may not, depending on stack).       | Heartbeat backstop + alarm tick.         |
| Chrome itself was killed       | Nothing until next launch.                                 | `onStartup` on next launch.              |

Expected worst-case time from "agent issues command after a long quiet period" to "command starts executing":
- SW alive, WS healthy: a few ms.
- SW alive, WS half-open: ≤ 25 s (one heartbeat + pong window) + reconnect handshake.
- SW dead but alarm fires on schedule: ≤ 30 s + reconnect handshake.
- Browser was sleeping: time until OS wakes the alarm subsystem + the above.

The proxy holds the command for the full command timeout (default 30 s, 60 s for `navigate`); see [Proxy Service](./03-proxy-service.md#why-queue-instead-of-fail-fast). For most cases this absorbs the gap transparently. For long sleeps, the proxy will surface `NO_CONNECTION` after the timeout and the agent retries.

### Non-goals and known limits

- **First-command-after-long-idle latency**: if the SW happened to die *and* the alarm hasn't fired yet (e.g. between 0 and 30 s before the next tick) and there is no other event to wake it, the command waits up to one alarm cycle. This is inherent to MV3 — Chrome does not expose any API that wakes a stopped SW on inbound WS traffic. We absorb it with the proxy hold + 30 s timeout, and document it as the expected worst case for an otherwise-idle browser.
- **No offscreen-document keepalive.** Offscreen documents can hold a WS independently of the SW, but they introduce a second context to keep in sync, do not eliminate the SW restart problem (commands still execute in the SW), and trade one set of edge cases for another. The alarm + heartbeat path is sufficient and simpler. Reconsider if Chrome ever raises the alarm minimum back above 30 s.
- **Pending state survives SW restart, not browser restart.** A command in flight when the user quits Chrome is lost; the agent will see `EXTENSION_UNRESPONSIVE` (or `NO_CONNECTION` if the SW also dropped) and decide whether to retry. This is the right boundary: the extension is not a durable queue.
- **Extension auto-update mid-command** clears `storage.session`. Same outcome as browser restart: the in-flight command times out cleanly.

## Tab resolver

Every command is dispatched through a session-aware resolver before any Chrome API is touched. The resolver reads the per-session pin from `chrome.storage.session.tabs`, validates that the tab still exists, and emits `NO_TAB_TARGETED` or `TAB_CLOSED` synchronously when it does not. Self-pinning commands (`status`, `navigate`, `tab list`, `tab pin`, `tab open`, `tab unpin`, `tab close`) skip the unpinned check and may auto-create a pin.

The resolver, the storage shape (`chrome.storage.session.tabs` keyed by session name), the pin lifecycle, and the canonical error payloads are owned by [08-tab-management.md → Sticky pin per session](./08-tab-management.md#sticky-pin-per-session) and [§ Tab resolver in the SW](./08-tab-management.md#tab-resolver-in-the-sw). This chapter only documents how the resolver plugs into the per-tab mutex and the dedupe table — the pin itself is not the SW's concept of state, it is the session's.

The previous "active tab in last-focused window" heuristic was replaced because it silently follows user window-switching mid-script; see [08-tab-management.md → Why "active tab in last-focused window" is wrong](./08-tab-management.md#why-active-tab-in-last-focused-window-is-wrong).

## Navigate flow

`navigate` uses `chrome.tabs.update(tabId, { url })` + waits for `chrome.tabs.onUpdated` with `status: 'complete'`. This is more reliable than telling the content script to set `window.location` (which kills the content script).

`tabId` is resolved through the session pin (see above). On a fresh session `navigate` auto-pins the active tab before updating it; `bproxy tab open <url>` is the alternative form that creates a new tab and pins it. Both flows are specified in [08-tab-management.md → Navigate flow (revised)](./08-tab-management.md#navigate-flow-revised).

## Screenshot flow

The default capture path is `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` against the pinned tab's window. The SW first verifies that the pinned tab is the **active** tab of its window and that the window is **not minimized**. If either check fails, the SW emits `TAB_NOT_VISIBLE` (see [08-tab-management.md → Default mode](./08-tab-management.md#default-mode-capturevisibletabwindowid-with-explicit-fallback)) instead of stealing user focus by activating the tab silently or returning a black PNG from a minimized window.

Two opt-in modes are available:

- `bproxy screenshot --activate` — explicitly activates the pinned tab, captures, and best-effort restores the previously active tab. Documented as a focus-steal opt-in.
- `bproxy screenshot --debugger` (requires `bproxy service start --enable-debugger-mode`) — uses `chrome.debugger.attach` + `Page.captureScreenshot` for any-tab capture without focus steal. Trade-off: Chrome shows a non-suppressible "extension started debugging this browser" infobar on every attached tab. This mode is shared infrastructure with the trusted-events path; the same flag and the same attached debugger session serve both. See [Debugger mode (trusted events and CDP screenshots)](#debugger-mode-trusted-events-and-cdp-screenshots) below.

The previous flag name `--enable-debugger-screenshots` is kept as a deprecated alias for one minor version. The CLI prints a one-line stderr deprecation when it sees the old form; both flags resolve to the same internal state.

The previous "always activate the tab before capture" rule was removed: silent focus steal is the same class of bug as silent target drift, and the `--activate` opt-in covers the cases where the agent has a reason to take the user's focus.

## Content script communication

`chrome.tabs.sendMessage(tabId, command, { frameId })` → the content script in the targeted frame processes the message → responds via `sendResponse`. `frameId` defaults to `0` (top frame) when no `--frame` qualifier was provided. The content script's `chrome.runtime.onMessage` listener is per-frame; same code, different frame instance.

If `sendMessage` fails (content script not injected — most often a freshly opened tab where `document_start` injection is still pending, or a frame just attached), the background uses this recovery sequence:

1. Inject `content.js` via `chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] })`.
2. **Wait for a ready acknowledgment**: the content script sends `chrome.runtime.sendMessage({ type: 'bproxy-ready', frameId })` on load (the frame ID is read from `chrome.runtime` message metadata on the receiver side; the content script itself does not need to know its own frameId). The background listens for the ack matching the targeted frameId before proceeding.
3. Retry the original command via `sendMessage` with the same `{ frameId }`.
4. If the second attempt fails *and* the frame is still in `frameTable` → `TAB_NOT_AVAILABLE`. If the frame disappeared from `frameTable` between the two attempts → `FRAME_DETACHED` (see [06-failure-modes.md](./06-failure-modes.md#frame-detached-mid-action)).

The ready-ack eliminates the race condition where `sendMessage` fires before the content script has registered its `onMessage` listener. Without it, the retry silently fails because the message arrives at a script that isn't listening yet.

The same `bproxy-ready` message also serves as a SW wake signal — if the SW happens to be down when a content script loads, the runtime message wakes it, and the keepalive listener will (re)open the WS.

### Content script `run_at`: `document_start` and MAIN-world shim

Both `content.js` (isolated world) and `network-shim.js` (MAIN world) declare `run_at: "document_start"` in the manifest. The earlier `document_idle` setting is **wrong** for two layers of this design:

- The MutationObserver root is `document.documentElement`; `document.body` does not yet exist at `document_start` and observers must be attached before `body` to catch hydration. See [Page State → Settle detection](./05-page-state.md#settle-detection-mutationobserver).
- The network shim must wrap `window.fetch` *before* any page script captures a reference to it. Modern HTTP clients (Apollo, RTK Query, axios-fetch adapters) cache the reference at module init; `document_idle` injection always loses that race. `document_start` + `world: "MAIN"` is the only configuration where Chrome guarantees our code runs first ([Chrome — Content scripts: run_at](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)).

The MAIN-world shim has no `chrome.*` API access (it lives in the page's world). It communicates with the isolated-world `content.js` via `document.dispatchEvent(new CustomEvent('bproxy:net', …))` and `bproxy:locationchange`. The isolated-world script attaches the event listeners before the page can interfere with them; the listener registration is the only side effect either script performs at `document_start`.

Both scripts also declare `all_frames: true` so subframes participate in settle, network-idle, and SPA detection. Cross-origin frames the extension still has host_permissions for execute the shim in their own world but cannot reach the parent's DOM; routing of waits and actions across frames is owned by [Frame routing and frame detection](#frame-routing-and-frame-detection) below.

For URLs that look like `about:blank`, `about:srcdoc`, `data:`, `blob:`, or `filesystem:` (subframes commonly take these schemes — see [Same-origin and special-frame nuances](#same-origin-and-special-frame-nuances)), the manifest opts in via `match_origin_as_fallback: true`. This tells Chrome to inject when the *initiator origin* (rather than the URL) matches `<all_urls>`. The trade-off: `match_origin_as_fallback` is the modern superset of `match_about_blank`; when both are specified `match_origin_as_fallback` wins ([Chrome — Manifest content_scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)).

```jsonc
// excerpt — full manifest at the bottom of this page
{
  "matches": ["<all_urls>"],
  "js": ["network-shim.js"],
  "run_at": "document_start",
  "world": "MAIN",
  "all_frames": true,
  "match_origin_as_fallback": true
}
```

## Frame routing and frame detection

Pages with iframes — Stripe Checkout, embedded auth, ads, sandboxed widgets — require the SW to direct each command at a *specific* frame. The CLI surface is the optional `--frame <selector|index|url-pattern>` qualifier defined in [02-cli-design.md → --frame qualifier](./02-cli-design.md#frame-qualifier). This section is the SW-side resolver.

### Frame table

The SW maintains a per-tab map of frame metadata, keyed by `tabId`:

```jsonc
// in-memory only; rebuilt from chrome.webNavigation.getAllFrames on tab focus
frameTable[tabId] = {
  "0":   { "url": "https://parent.example.com/checkout", "parentFrameId": -1, "iframeSelectorHint": null },
  "4":   { "url": "https://js.stripe.com/v3/elements-...","parentFrameId": 0, "iframeSelectorHint": "iframe[name='__privateStripeFrame4']" },
  "11":  { "url": "about:srcdoc",                         "parentFrameId": 0, "iframeSelectorHint": "iframe.embedded-doc" }
}
```

Lifecycle:

- On any of `chrome.webNavigation.onCommitted`, `onErrorOccurred`, `onBeforeNavigate` (per [06-failure-modes.md → Frame detached mid-action](./06-failure-modes.md#frame-detached-mid-action)), update or delete the entry for `(tabId, frameId)`.
- On tab activation or first command for a tab, a one-shot `chrome.webNavigation.getAllFrames(tabId)` reconciles the table.
- `iframeSelectorHint` is filled lazily by asking the *parent* frame's content script to enumerate `iframe` elements and report back `{ frameId-of-each-iframe, outerHTML-derived-selector }`. Chrome does not natively expose "which frame element corresponds to which `frameId`," so we resolve it page-side: each `<iframe>`'s `contentWindow` matches the `frameId` Chrome assigns by index in the document's frame tree at registration. The content script in the parent walks `document.querySelectorAll('iframe')` and pairs each with its frameId via `frameElement` round-trip in the child.

### Resolving `--frame`

| Form              | Resolution                                                                                        |
|-------------------|---------------------------------------------------------------------------------------------------|
| omitted           | Top frame (`frameId === 0`).                                                                      |
| `--frame <selector>` | Parent frame's content script runs `document.querySelector(<selector>)`; result must be an `<iframe>`. The SW reads `iframeSelectorHint` to find the matching `frameId`. If the selector matches >1 iframe → `SELECTOR_AMBIGUOUS`. |
| `--frame <integer>` | **Top-only flat index over all subframes the SW currently sees in `frameTable[tabId]`, sorted by depth-first traversal of the frame tree (parent before children, siblings in DOM order).** `0` is always the top frame; `1` is the first iframe in the document; nested iframes follow their parent. We pick depth-first, not "top-only," because real pages embed nested checkouts (e.g. Stripe Elements inside a wrapper iframe) and the agent needs a deterministic way to address those. |
| `--frame /<regex>/` or `--frame <substring>` | Matches against the frame's *document URL* in `frameTable`. First match wins; if zero match → `SELECTOR_NOT_FOUND` (`details.selector` echoes the frame qualifier; `retry: true` because the frame may not have loaded yet). The previously-named `FRAME_NOT_FOUND` was folded into `SELECTOR_NOT_FOUND` — see [06-failure-modes.md → Deprecated codes](./06-failure-modes.md#deprecated-codes). |

The qualifier resolves to a single `frameId`. From there, dispatch is uniform:

```js
// Action dispatch in background.js
const { frameId, restricted } = await resolveFrame(tabId, params.frame);
if (restricted) return reply(RESTRICTED_URL_ERROR);
// content-script-backed action:
chrome.tabs.sendMessage(tabId, command, { frameId }, sendResponse);
// MAIN-world eval:
chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func, args });
```

`chrome.tabs.sendMessage` accepts the `frameId` option to route to a specific frame; `chrome.scripting.executeScript` accepts `target.frameIds` (note: **not** with `allFrames: true` — they are mutually exclusive per [chrome.scripting reference](https://developer.chrome.com/docs/extensions/reference/api/scripting)).

### Cross-origin frames: what works and what does not

The extension's `host_permissions` is `<all_urls>`, so its content script and shim run inside same-origin *and* cross-origin iframes. Within a frame, `content.js` has full DOM access to *that frame's* document — `click`, `type`, `text`, `wait selector` all work on a Stripe Checkout iframe targeted with `--frame 'iframe[name^="__privateStripeFrame"]'`.

What does **not** work:

- `eval`, `outline`, and `dom` against the *parent* cannot read the cross-origin child's DOM, even via the parent's content script. Same-origin policy applies inside the page exactly as it does to the page's own JS. The agent must target the child frame directly via `--frame`.
- `bproxy elements` returns elements only from the targeted frame. Agents that want all interactives across the page run `bproxy elements` once with no `--frame` (top frame), then inspect the returned `iframe` placeholders and recurse.
- The history patch in `network-shim.js` runs in each frame's MAIN world and reports its own location; the parent cannot observe a child's `pushState` directly. The aggregator (see [05-page-state.md → Per-frame settle aggregation](./05-page-state.md#per-frame-settle-and-network-aggregation)) bridges this.

### Restricted-URL gate

Before any forward to a content script — top frame or subframe — the SW consults `isRestricted(url)` (rule and rationale in [06-failure-modes.md → Restricted URL](./06-failure-modes.md#restricted-url-no-content-script-possible)). On a hit, the dispatcher returns `RESTRICTED_URL` immediately, without touching the content-script path. The gate sits in the same dispatcher that resolves `--frame`, so a `--frame` qualifier that resolves to e.g. a `chrome-extension://` subframe of another extension fails the same way.

`navigate`, `tabs`, `tab`, `status`, and `screenshot` bypass the gate — they are background-only APIs that work on restricted URLs.

### Same-origin and special-frame nuances

| Frame kind                             | Content script runs?                  | Notes                                                                                                                                                              |
|----------------------------------------|---------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Same-origin iframe                     | Yes                                   | Works exactly like the top frame.                                                                                                                                  |
| Cross-origin iframe (we have host perm)| Yes, in the iframe's own world        | Cannot read parent's DOM; the parent's content script cannot read its DOM. Route via `--frame`.                                                                    |
| Sandboxed iframe **without** `allow-same-origin` | Yes, but it is a unique opaque origin | The shim and `content.js` run, but `match_origin_as_fallback` resolves the initiator as opaque and host_permissions still match `<all_urls>`. Reads *its own* DOM only. The parent's script cannot reach it across the opaque-origin boundary. |
| Sandboxed iframe with `allow-scripts` only | Same as above                       | Sandbox flags do not prevent extension content scripts from running ([web.dev — Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes)).      |
| `srcdoc` iframe (`about:srcdoc`)       | Yes (with `match_origin_as_fallback`) | Document URL is literally `about:srcdoc`; URL-pattern `--frame` qualifiers should match against the *parent* URL or use a selector instead.                          |
| `data:` URL iframe                     | Yes (with `match_origin_as_fallback`) | URL is `data:...` and is **not** restricted by our gate when the initiator origin is in scope. URL-pattern qualifiers are nearly useless here; use a selector.       |
| `blob:` URL iframe                     | Yes (with `match_origin_as_fallback`) | Same as `data:`.                                                                                                                                                  |
| `chrome://`, `chrome-extension://` (other extension), `view-source:` | No | Hit the [restricted-URL gate](#frame-routing-and-frame-detection). The SW returns `RESTRICTED_URL` before forwarding.                                              |
| PDF viewer                             | No                                    | Restricted; same gate.                                                                                                                                            |
| `loading="lazy"` iframe before scrolling | Pending                              | Chrome creates the `frameId` only when the iframe is fetched (after entering the viewport). Until then the frame is absent from `frameTable` and `--frame` selectors resolve to `SELECTOR_NOT_FOUND`. The agent's recourse is to scroll first (`bproxy eval 'window.scrollTo(...)'`) or `bproxy wait selector 'iframe...'` then route. |

These rows are the design contract: agents and tests can rely on them.

## Content script (`content.js`)

Listens for messages from the background worker via `chrome.runtime.onMessage`.

Each action is a function:

| Action     | Implementation                                                                 |
|------------|--------------------------------------------------------------------------------|
| `click`    | `querySelector(sel)` → check visibility → `.click()`. Fail if 0 or >1 match. |
| `type`     | `querySelector(sel)` → `.focus()` → clear → dispatch `input` events per char. |
| `text`     | `querySelector(sel)` → `.innerText`. Default selector: `body`.                |
| `images`   | Scan for `img` tags → filter visible → return src, alt, dimensions.           |
| `elements` | Scan for interactive tags → filter visible → generate selectors → return list.|
| `outline`  | Collect semantic landmarks + ARIA roles + headings → build region list.       |
| `dom`      | Walk subtree from selector to depth N → return pruned tree with metadata.     |
| `wait`     | Block using strategy (settle/network/selector/hidden) until condition met.     |

`eval` is **not** handled by the content script — it runs directly in the background via `chrome.scripting.executeScript`. See [eval in the main world](#eval-in-the-main-world) below.

### Selector matching

`querySelector` is used, not `querySelectorAll`. If the selector matches nothing → `SELECTOR_NOT_FOUND`. For `click`, if multiple matches are possible and intent is ambiguous, the agent should use `elements` first to discover the right selector.

### `eval` in the main world

Content scripts run in an isolated world. To execute arbitrary JS in the page's actual context (access page variables, call page functions), use the Chrome API:

```js
// In background.js — NOT in the content script
async function evalInPage(tabId, code) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code) => {
      try {
        const result = new Function(code)();
        return { result: JSON.stringify(result) };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [code]
  });
  return results[0].result;
}
```

**Why `chrome.scripting.executeScript` instead of `<script>` tag injection:**

- **CSP-proof**: Many modern sites (GitHub, banking sites, Google properties) set Content Security Policy headers that block inline `<script>` execution. `chrome.scripting.executeScript` with `world: 'MAIN'` bypasses page CSP entirely because it runs through the Chrome extension API, not through the page's script loading path.
- **Simpler**: No need for CustomEvent-based communication between injected script and content script. The result is returned directly to the background script.
- **Synchronous result**: Returns a promise that resolves with the execution result. No event listener cleanup.

Note: `eval` is handled by the **background script** directly (like `screenshot` and `navigate`), not forwarded to the content script. This is because `chrome.scripting.executeScript` is a background API.

## Debugger mode (trusted events and CDP screenshots)

Default `click`, `type`, and `navigate` execute via DOM dispatch in the page's MAIN world. The events they generate carry `event.isTrusted === false` — fingerprintable by every commercial bot-management script ([12-risks.md → Headline risk](./12-risks.md#headline-risk-the-extension-itself-is-fingerprintable)). For sites that consume `isTrusted` as a primary signal, the extension can route the same actions through the Chrome DevTools Protocol via `chrome.debugger`, which dispatches events with `isTrusted === true`.

The mode is **opt-in twice**: once at service start (the user accepts the user-visible Chrome banner cost) and once per command (the agent declares it needs trusted dispatch for that specific action).

### Service-level opt-in: `--enable-debugger-mode`

`bproxy service start --enable-debugger-mode` is the umbrella flag covering both `--debugger` screenshots and `--trusted` actions. Without it, both `screenshot --debugger` and any action carrying `--trusted` return `DEBUGGER_DISABLED` (see [06-failure-modes.md](./06-failure-modes.md#debugger_disabled)). The flag does not by itself attach a debugger; it only unlocks the per-command opt-ins.

The previous spelling `--enable-debugger-screenshots` is a deprecated alias for one minor version; the CLI prints a stderr deprecation notice when it sees the old form. Both resolve to the same internal `debuggerEnabled` flag on the proxy.

### Per-command opt-in: `--trusted` on `click`, `type`, `navigate`

Specified in [02-cli-design.md → `--trusted` flag](./02-cli-design.md#trusted-flag-on-click-type-navigate). When the agent passes `--trusted`:

- `click` resolves the target's screen coordinates in the SW (via the content-script `elementFromPoint` round-trip), then issues `Input.dispatchMouseEvent` with `type: "mousePressed"` followed by `type: "mouseReleased"` against those coordinates. `clickCount: 1`. The dispatched events fire on whatever element the OS-level coordinate hits, just like a real user click — overlay-occluded targets fail the same way they would for a human.
- `type` issues `Input.dispatchKeyEvent` per character for ASCII; for non-ASCII or composed characters, `Input.insertText` (which maps to the IME path and is also `isTrusted === true`).
- `navigate` issues `Page.navigate` (rather than `chrome.tabs.update`) to keep the action attributable to the same debugger session and avoid a debugger-detach mid-navigation; the load-completion wait remains `chrome.webNavigation.onCompleted` as documented in [05-page-state.md → Two-tier wait](./05-page-state.md#two-tier-wait).

Default off even when service-level debugger mode is enabled. The agent decides per-command whether the cost is justified.

### Attachment lifecycle

Lazy attach, idle detach. The SW maintains a per-tab debugger handle keyed by `tabId`:

- **First `--trusted` (or `--debugger`) command for a tab** → `chrome.debugger.attach({ tabId }, "1.3")`. Attach cost is ~150–300 ms in our measurements; the command's auto-wait absorbs it. No `Runtime.enable` is sent — `Input.*` and `Page.captureScreenshot` do not require it, and avoiding `Runtime.enable` sidesteps the [DataDome 2024 CDP-detection trick](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/) ([Rebrowser writeup](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries)). This is a normative constraint: the implementation MUST NOT emit `Runtime.enable` from the trusted-events path.
- **Subsequent commands within an idle window** → reuse the existing handle. Default idle window: **60 s** since the last `--trusted` / `--debugger` command. Configurable via `bproxy service start --debugger-idle-ms <N>` (range 5_000–600_000); defaults chosen as the smallest window that survives a typical multi-step agent turn (read DOM → think → click → wait → click) without re-attaching.
- **Idle timer fires** → `chrome.debugger.detach({ tabId })`. The Chrome banner disappears with detach.
- **Tab closes / debugger evicted by Chrome (e.g. user opens DevTools)** → `chrome.debugger.onDetach` event drops the handle. The next `--trusted` command re-attaches.

Re-attach has a cost (~150–300 ms) but is always cheaper than holding the banner indefinitely. The 60 s window is a UX trade-off: longer means fewer banner flashes inside an agent turn; shorter means the banner is gone sooner once the agent moves on.

### Banner UX across a session

Chrome's "extension started debugging this browser" infobar is persistent for the life of the attachment and **cannot be suppressed** ([chrome.debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger)). It also disables in-tab DevTools while attached. Implications the user must accept when they pass `--enable-debugger-mode`:

- Within an agent session that mixes default and `--trusted` commands, the banner appears on the first `--trusted` command and stays for at least the idle window after the last one. It does not reappear on each command — same attachment, same banner.
- If the user opens DevTools on the attached tab, Chrome force-detaches our debugger and emits `chrome.debugger.onDetach` with reason `canceled_by_user`. The next `--trusted` command re-attaches and the banner returns. The agent must not interpret `canceled_by_user` as a fatal error; the next command's attach is normal recovery.
- Two extensions attempting `chrome.debugger.attach` against the same tab are mutually exclusive — last attacher wins, the previous one receives `onDetach` with reason `replaced_with_devtools` (or similar). bproxy treats this as `DEBUGGER_UNAVAILABLE` (see [06-failure-modes.md](./06-failure-modes.md#debugger_unavailable)) and does not auto-re-attach until the next `--trusted` command.

### Errors

Two new error codes (canonical entries in [06-failure-modes.md](./06-failure-modes.md)):

- `DEBUGGER_DISABLED` — `--trusted` or `--debugger` was used but the proxy was not started with `--enable-debugger-mode`. `retry: false`. The agent's recourse is to drop the flag (and accept the reduced-stealth fallback) or have the user restart the service.
- `DEBUGGER_UNAVAILABLE` — `chrome.debugger.attach` failed (target detached, another debugger client owns the target, restricted URL). `retry: conditional` with a 1 s `retryAfterMs`; the next attempt may succeed once the conflicting client releases the target.

## Native-form preservation for the MAIN-world shim

The shim from [05-page-state.md → Network-idle detection](./05-page-state.md#network-idle-detection) wraps `window.fetch`, `XMLHttpRequest.prototype.open/send`, `navigator.sendBeacon`, `EventSource`, `WebSocket`, `history.pushState`, and `history.replaceState`. Without protection, `Function.prototype.toString.call(window.fetch)` returns the wrapper body — the cheapest possible bot-detection check ([puppeteer-extra#403 — toString detection](https://github.com/berstend/puppeteer-extra/issues/403)). Native-form preservation closes this surface for the default mode.

### Mechanics

At injection time (top of `network-shim.js`, before any wrapping), the shim caches `Function.prototype.toString.call(originalFn)` for every native it intends to replace. Each wrapper carries an explicit `toString` override that returns the cached string:

```js
// network-shim.js — runs in MAIN world at document_start; closure scope only.
(() => {
  if (window.__bproxyNetShim) return;
  Object.defineProperty(window, '__bproxyNetShim', { value: true, enumerable: false, configurable: false, writable: false });

  const FpToString = Function.prototype.toString;
  const cachedNative = new WeakMap();
  const memo = (orig) => { cachedNative.set(orig, FpToString.call(orig)); return orig; };

  function wrap(original, impl) {
    memo(original);
    Object.defineProperty(impl, 'toString', { value: () => cachedNative.get(original), configurable: true });
    Object.defineProperty(impl, 'name',     { value: original.name,                       configurable: true });
    return impl;
  }

  // Proxy Function.prototype.toString itself so a page-side
  //   Function.prototype.toString.call(window.fetch)
  // also returns the cached native string. Without this, an attacker bypasses
  // our per-property override by going through the prototype directly.
  const origFpToString = Function.prototype.toString;
  Function.prototype.toString = wrap(origFpToString, function () {
    if (cachedNative.has(this)) return cachedNative.get(this);
    return origFpToString.call(this);
  });
  // … wrap window.fetch, XMLHttpRequest.prototype.open/send, etc.
})();
```

Two non-obvious points worth flagging:

- **`Function.prototype.toString` is itself wrapped.** Per-property `toString` overrides on each wrapper are necessary but not sufficient — a page can grab `Function.prototype.toString` once at load and call it directly on any wrapped function. Patching the prototype too closes that path. The patch is the *only* place we modify a built-in; everything else is assignment to specific globals.
- **No global state on `window`.** `window.__bproxyNetShim` is the single re-entry guard, declared non-enumerable so `for (const k in window)` does not see it. Everything else lives in the IIFE's closure. A page-side enumeration of own properties on `window` will not find shim state, wrapper handles, or cached native strings.

### What is preserved

For each wrapped global the shim guarantees, on a clean Chrome profile with no other extensions:

- `Function.prototype.toString.call(window.fetch)` returns `function fetch() { [native code] }` (the cached original).
- `window.fetch.toString()` returns the same.
- `window.fetch.name` is `"fetch"`.
- `String(window.fetch)` falls through `Symbol.toPrimitive` → `toString` → cached native, identically.
- `(class extends window.fetch.constructor {})` is unaffected (we don't redefine `[[Prototype]]`).
- `delete window.fetch` followed by reload — the shim runs on the next load and re-wraps. Page-side delete cannot undo the patch durably.

### What this does *not* protect against

Honest scope:

- **Behavioural detection.** A bot-management script can still measure that `fetch` is *slightly slower* than a clean Chrome and infer wrapping. We do not race the page's clock; the wrappers add measurable latency on the order of microseconds per call, which is detectable on careful instrumentation. No fix.
- **MAIN-world side-effects from injection.** The IIFE's existence is observable via `performance` traces, mark/measure entries, and timing of the very first `fetch` after `document_start`. ACM CCS 2024 documents this class of detection ([Peeking through the window](https://dl.acm.org/doi/10.1145/3658644.3670339)). No fix without dropping content scripts entirely (out of scope for v1).
- **`history.pushState` patching has the same toString protection** but a unique signature: a page-side `history.pushState !== history.constructor.prototype.pushState` returns `false` after our patch (we patch the prototype), but a user-defined `addEventListener('popstate', …)` plus our injected `popstate` dispatch after `pushState` is a stable behavioural fingerprint. We are not making `pushState` indistinguishable from native; we are making the cheap `toString` check fail. The agent's escape hatch on a page that detects this is `bproxy domain set <pattern> --no-network-shim` ([02-cli-design.md → `bproxy domain` configuration](./02-cli-design.md#bproxy-domain-configuration)), which turns the shim and history patch into no-ops on that origin at the cost of `wait --network` and `wait response` no longer working on it.

The cost of the protection is small (one closure per wrapper, one prototype patch on `Function.prototype.toString`) and is unconditional in the default mode.

## Manifest

```json
{
  "manifest_version": 3,
  "name": "bproxy",
  "version": "0.1.0",
  "description": "Browser control for coding agents",
  "permissions": [
    "activeTab",
    "tabs",
    "scripting",
    "alarms",
    "storage",
    "webNavigation"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["network-shim.js"],
      "run_at": "document_start",
      "world": "MAIN",
      "all_frames": true,
      "match_origin_as_fallback": true
    },
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start",
      "all_frames": true,
      "match_origin_as_fallback": true
    }
  ],
  "options_page": "options.html"
}
```

`alarms` and `storage` are required by the keepalive and pending-state design above. `webNavigation` is the SPA-detection backstop (see [Page State → SPA navigation detection](./05-page-state.md#spa-navigation-detection)) and the authoritative source of frame lifecycle events for the [restricted-URL gate](#frame-routing-and-frame-detection) and [`FRAME_DETACHED` detection](./06-failure-modes.md#frame-detached-mid-action). `options_page` hosts the [token setup](#token-setup) UI. `network-shim.js` runs in the page's MAIN world at `document_start` so it wraps `fetch` / `XHR` / `WebSocket` / `EventSource` / `sendBeacon` before any page script captures references; `content.js` runs in the isolated world, listens for the shim's events, and owns the actionability checks that back auto-wait. Both declare `all_frames: true` and `match_origin_as_fallback: true` so subframes with `about:srcdoc`, `data:`, `blob:`, and `filesystem:` URLs receive the scripts when their initiator is in scope; cross-frame action and waiter routing is described in [Frame routing and frame detection](#frame-routing-and-frame-detection).
