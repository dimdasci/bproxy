# 8. Tab Management and Screenshot Capture

[← Index](./README.md) · Prev: [Timeouts](./07-timeouts.md) · Next: [Build & Distribution →](./09-build.md)

---

This chapter is the canonical source for **which tab a command lands on** and **how a screenshot is taken without stealing user focus**. Two related problems are addressed together because both originate in the same Chrome API gap: there is no first-class "act on this exact tab regardless of user behaviour" primitive, and the obvious surrogate (`captureVisibleTab` against the last-focused window's active tab) silently follows the user's window-switching.

## Why "active tab in last-focused window" is wrong

The previous design resolved every command's target as `chrome.tabs.query({ active: true, lastFocusedWindow: true })`. That heuristic looks correct in a single-window demo but fails the real workflow:

- The user alt-tabs to a non-Chrome app, then back to Chrome window B (where their email is open). The agent's next command silently lands on the email tab. **This is the worst class of automation bug** — silent target drift mid-script.
- The user manually flips tabs in window A while the agent is between commands. The next command lands on a different page than the agent reasoned about.
- "Last-focused window" is a property of user behaviour, not agent intent. Two agents driving the same browser cannot disambiguate themselves with it at all.

The fix is a sticky, explicit pin per agent session, with a clear lifecycle the agent can observe and the user cannot accidentally subvert.

## Sticky pin per session

A **session** is one agent's view of the browser. Each session owns at most one pinned `tabId`. All commands in a session target that pin until the agent retargets or the tab closes.

### Session naming

A session is identified by a stable string passed on the wire as `session: <name>` and on the CLI as `--session <name>`:

- Default session name is `"default"`. Single-agent users never see the field.
- The CLI reads `BPROXY_SESSION` from the environment if `--session` is not given. CI agents set it once at job start.
- Session names are `[a-z0-9_-]{1,32}`; longer or invalid names are rejected with `INVALID_COMMAND` at the CLI before any HTTP request runs.

The proxy passes `session` through unchanged into the WS frame; the SW keeps one pin per session. There is no proxy-side session state — the SW is authoritative because the pin is meaningful only inside the browser.

### Storage location and lifetime

The pin lives in `chrome.storage.session` under a single keyed map, alongside the per-command `pending` and `done` tables already defined in [04-extension.md → Pending state in `chrome.storage.session`](./04-extension.md#pending-state-in-chromestoragesession):

```jsonc
// chrome.storage.session key: "tabs"
{
  "default":  { "tabId": 42,  "windowId": 1, "pinnedAt": 1714000000000 },
  "ci-agent": { "tabId": 87, "windowId": 1, "pinnedAt": 1714000000123 }
}
```

`chrome.storage.session` is the right scope: per-extension, in-memory at the extension level, survives SW restarts inside one browser session, cleared on browser restart and on extension reload. A pin that does not survive a browser restart is the right contract — after the user kills Chrome, the agent's previous tab is gone anyway and the agent must re-pin.

### Pin lifecycle

| Trigger                                                  | Effect                                                                                              |
|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| First command of a fresh session                         | Auto-pin to the active tab of the last-focused window at that instant. Recorded with `pinnedAt`.    |
| `bproxy navigate <url>` on a fresh session               | Auto-pin to the existing active tab, then navigate it. Symmetric with `tab open`.                   |
| `bproxy tab open <url>` on any session                   | Create a new tab, set `tabId` as the session's pin.                                                 |
| `bproxy tab pin <id>`                                    | Explicit pin to a known `tabId`. Replaces any prior pin. Returns `INVALID_COMMAND` if `id` is not a number.|
| `bproxy tab unpin`                                       | Drop the session's pin. Subsequent commands return `NO_TAB_TARGETED` until the agent re-pins.       |
| `bproxy tab close [<id>]`                                | Default `<id>` is the pinned tab. Drops the pin if it matches the closed tab. Calling `close` on an unrelated tab leaves the pin alone. |
| `chrome.tabs.onRemoved` for the pinned tab               | The SW deletes the pin and the next command in that session returns `TAB_CLOSED`.                   |
| Browser restart, extension reload, profile switch        | `storage.session` is cleared. Next command auto-pins as if it were the first.                       |

Once a session has an entry in `tabs`, **all** of its commands target that `tabId`. The SW does not consult window focus, last-focused window, or the active flag. If the pinned tab is in the background, it stays in the background — see [Screenshot capture](#screenshot-capture) for the only command where this is non-obvious.

### Multi-agent (`--session`) semantics

Two agents driving the same browser pass different `--session` names. Each owns its own pinned tab; commands cannot collide because the SW dispatcher reads the session field before resolving the target.

A few invariants:

- **Two sessions can pin the same tab.** This is allowed and useful (a supervisor agent observes what a worker agent is driving). Destructive actions still serialise on the per-tab mutex defined in [04-extension.md → Concurrency inside the extension](./04-extension.md#concurrency-inside-the-extension), so the *order* of effects is deterministic, not the assignment.
- **Sessions are not authenticated against each other.** Anyone with the bearer token can drive any session. Session names are a routing field, not a security boundary; the auth boundary is the bearer token (see [03-proxy-service.md → Authentication](./03-proxy-service.md#authentication)).
- **`bproxy tab list` is global within a profile** and union-of-profiles when multiple are connected. See [`tab list` with profiles](#tab-list-with-profiles) below.

## Profile-bound sessions

The previous design implicitly assumed one Chrome profile per machine. That breaks the moment a user runs Work + Personal profiles, both with the bproxy extension installed and authenticated against the same daemon: tab ids are scoped per profile (Chrome does not share them), and a session that records `tabId: 42` without recording *which profile* is ambiguous. This section is the canonical model for the multi-profile case; the proxy-side mechanics are in [03-proxy-service.md → Multi-profile WebSocket clients](./03-proxy-service.md#multi-profile-websocket-clients).

### What the SW announces

On WS connect, every extension instance sends a `hello` frame including its `profileId` (a 64-bit UUID minted on first SW startup, persisted in `chrome.storage.local`) and a user-supplied `profileLabel` (set in the options page; defaults to "default"). The proxy stores these per-WS in `extensionsByProfileId`. Single-profile installs see a one-element map and the rest of this section is invisible.

### Pin storage shape (revised)

The pin map in `chrome.storage.session` extends to record the source profile. Each extension's storage holds only its own profile's session entries:

```jsonc
// chrome.storage.session key: "tabs" — inside Profile "Work" (profileId "p_1f3c9a")
{
  "default":  { "tabId": 42, "windowId": 1, "profileId": "p_1f3c9a", "pinnedAt": 1714000000000 }
}

// chrome.storage.session key: "tabs" — inside Profile "Personal" (profileId "p_8b21d0")
{
  "reviewer": { "tabId": 87, "windowId": 1, "profileId": "p_8b21d0", "pinnedAt": 1714000000123 }
}
```

The `profileId` field is redundant with the storage location (it equals the SW's own profile id), but it is included on the wire so the proxy and the CLI can address it without re-querying.

### Auto-binding on first command

A session has at most one profile binding at any time. Bindings are created in two ways:

- **Auto-bind** on the first self-pinning command for a session. `bproxy navigate <url>`, `bproxy tab pin <id>`, and `bproxy tab open <url>` all create a pin; the proxy records the source profile id as the session's binding when none exists. Subsequent commands for the same session are routed only to that profile.
- **Explicit bind** via `bproxy session bind <session> <profileId>` (CLI surface in [02-cli-design.md → `bproxy session`](./02-cli-design.md#bproxy-session)). Used by the user to set the binding before the first command, or to rebind after `session unbind`.

The single-extension-per-profile invariant is the correctness story: once a session is bound (auto or explicit), commands for that session whose target tab lives in a different profile fail with `WRONG_PROFILE` (see [06-failure-modes.md → `WRONG_PROFILE`](./06-failure-modes.md#wrong_profile)). This prevents the most insidious bug — a Work command silently landing on a Personal tab because both profiles' SWs answered for the same numeric tab id.

The auto-bind decision is irreversible without an explicit `session unbind` or `session bind`. We rejected first-writer-wins on the grounds that "first" is not a meaningful order across two SWs reconnecting on different timelines; the user-controlled rebinding is the right escape hatch.

### `tab list` with profiles

`bproxy tab list` queries every connected extension and concatenates the responses. Each row carries the source profile so the agent can disambiguate:

```json
{
  "ok": true,
  "data": {
    "session": "default",
    "boundProfile": { "profileId": "p_1f3c9a", "profileLabel": "Work" },
    "pinned": { "tabId": 42, "windowId": 1, "url": "https://example.com", "profileId": "p_1f3c9a" },
    "tabs": [
      { "id": 42, "windowId": 1, "url": "https://example.com",   "title": "Example",  "active": true,  "minimized": false, "pinnedBy": ["default"], "profileId": "p_1f3c9a", "profileLabel": "Work" },
      { "id": 87, "windowId": 1, "url": "https://github.com",    "title": "GitHub",   "active": false, "minimized": false, "pinnedBy": [],          "profileId": "p_1f3c9a", "profileLabel": "Work" },
      { "id": 12, "windowId": 4, "url": "https://gmail.com",     "title": "Inbox",    "active": true,  "minimized": false, "pinnedBy": ["reviewer"], "profileId": "p_8b21d0", "profileLabel": "Personal" }
    ]
  }
}
```

`boundProfile` is the calling session's profile binding (`null` when unbound). `tabs[*].profileId` is mandatory and stable.

`bproxy tab list --profile <id>` filters to one profile when the agent already knows which one it wants. `bproxy tab list --profile current` is shorthand for the calling session's bound profile.

`bproxy tab pin <id>` resolves `<id>` against the calling session's bound profile. If the session is unbound, the pin operation auto-binds to the profile that owns the requested `<id>`; the agent gets the binding back in the response so it can confirm.

### Single-profile users

All of the above is invisible when `extensions.length === 1`. The CLI omits `boundProfile`, the per-row `profileId` is still emitted (machine-readable agents read it), and `bproxy session list` is a no-op listing one entry. The `WRONG_PROFILE` code is unreachable in this configuration.

## CLI surface

The previous flat `tabs` / `tab <id>` pair is replaced by a `tab` subcommand group. The old forms are kept as deprecated aliases for one minor version so existing scripts do not break; see [02-cli-design.md → Deprecated tab commands](./02-cli-design.md#deprecated-tab-commands).

```
bproxy tab list                         # read-only; lists all tabs across windows
bproxy tab pin <id>                     # destructive (mutates session pin)
bproxy tab unpin                        # destructive
bproxy tab open <url>                   # destructive; opens new tab and pins it
bproxy tab close [<id>]                 # destructive; default is pinned tab
```

All accept `--session <name>`. `tab list` is read-only and idempotent (at-least-once); the rest are destructive (at-most-once per `id`) — the dedupe table in [04-extension.md → Dedupe table](./04-extension.md#dedupe-table-and-request-lifecycle) protects re-deliveries.

`tab list` response:

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

`pinned` is `null` when the session has no current pin.

`tab pin` / `tab open` responses include the same `pinned` shape. `tab unpin` returns `{ "ok": true, "data": { "previous": { "tabId": 42 }, "pinned": null } }` so the agent can confirm what it released.

## Failure-mode payloads (canonicalisation)

[06-failure-modes.md](./06-failure-modes.md) lists `TAB_CLOSED` and `NO_TAB_TARGETED` as `target`-category, `retry: false` codes with placeholder `details`. This chapter finalises both.

### `TAB_CLOSED`

Emitted when the pinned tab is closed (by the user, by the page, or by `bproxy tab close`) **before or during** the command. The SW listens to `chrome.tabs.onRemoved`; when the removed `tabId` matches a session pin, the pin is deleted in the same event-loop turn.

```jsonc
{
  "ok": false,
  "error": {
    "code": "TAB_CLOSED",
    "category": "target",
    "retry": false,
    "suggestedAction": "re-pin a tab or open a new one",
    "message": "Pinned tab 42 was closed",
    "details": {
      "session": "default",
      "tabId": 42,
      "lastUrl": "https://app.example.com/dashboard",
      "closedAt": 1714000005000,
      "reason": "user_closed"   // "user_closed" | "page_closed" | "command_closed" | "window_closed"
    }
  }
}
```

`reason` is a closed enum populated from `chrome.tabs.onRemoved`'s `removeInfo`:

| `reason`         | When                                                                                         |
|------------------|----------------------------------------------------------------------------------------------|
| `user_closed`    | `removeInfo.isWindowClosing === false` and no `bproxy tab close` was in flight.              |
| `page_closed`    | The page called `window.close()` (cannot be reliably distinguished from `user_closed` on Chrome; we collapse both into `user_closed` unless the SW saw a same-tick `window.close` postMessage shim — best-effort hint, do not branch on it). |
| `command_closed` | The pin was removed by `bproxy tab close` issued by *any* session.                            |
| `window_closed`  | `removeInfo.isWindowClosing === true`.                                                       |

The agent's recourse is identical for all four — re-pin or re-open. `reason` is a logging aid.

### `NO_TAB_TARGETED`

Emitted when the session has no pin **and** the command is not a self-pinning command. Self-pinning commands (`navigate`, `tab open`, `tab pin`, `tab list`, `status`) auto-resolve and do not emit this code.

```jsonc
{
  "ok": false,
  "error": {
    "code": "NO_TAB_TARGETED",
    "category": "target",
    "retry": false,
    "suggestedAction": "run `bproxy tab pin <id>` first",
    "message": "Session 'default' has no pinned tab",
    "details": {
      "session": "default",
      "reason": "unpinned"      // "unpinned" | "session_cleared" | "first_command_failed_to_resolve"
    }
  }
}
```

`reason`:

| `reason`                          | When                                                                                          |
|-----------------------------------|-----------------------------------------------------------------------------------------------|
| `unpinned`                        | The agent ran `bproxy tab unpin` and has not yet re-pinned.                                   |
| `session_cleared`                 | `storage.session` was reset (browser restart, extension reload, profile switch). The pin existed in a previous SW lifetime; this is the first command in the new lifetime. |
| `first_command_failed_to_resolve` | The agent's first command tried to auto-pin but `chrome.tabs.query` returned no candidate (no Chrome windows, headless edge case). |

The first two cases collapse into the same recovery: re-pin. The third is rare and almost always means the user has no Chrome window open at all; the agent should `bproxy tab open <url>` instead.

## Screenshot capture

Screenshots are the second half of this chapter because the API constraints couple them tightly to tab targeting.

### What Chrome actually offers

| API                                          | Captures                                          | Focus needed?                                                                  | Notes |
|----------------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------|-------|
| `chrome.tabs.captureVisibleTab(windowId, opts)` | Active tab of `windowId` only                     | The window does not need to be foregrounded, **but the tab must be active in its window**. | The only no-banner option. Returns black/blank on minimized windows because the OS stops compositing them ([Chromium issue 41130703](https://issues.chromium.org/issues/41130703)). |
| `chrome.tabs.captureTab(tabId)` (proposed)   | Any tab by id                                     | No                                                                             | **Never shipped on stable Chrome** as of April 2026 (verified against [chrome.tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs); the closest is `captureVisibleTab(windowId)` with no `tabId` overload). Mentioning it as a fix is a documentation hazard — do not. |
| `chrome.debugger` + `Page.captureScreenshot` (CDP) | Any attached tab, including background           | No                                                                             | Shows the user-visible "extension started debugging this browser" banner across every attached tab ([Chrome — chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)). The banner cannot be suppressed from extension code; the `--silent-debugger-extension-api` flag exists but requires a Chrome relaunch with the flag and is therefore an opt-in deploy choice, not a runtime knob. |
| `chrome.tabCapture` + offscreen document     | Live media stream                                 | No, but                                                                        | For audio/video streams, not still images. Out of scope. |

There is no fourth option. The choice is therefore between `captureVisibleTab(windowId)` plus a plan for "pinned tab is not active in its window," and `chrome.debugger` plus a plan for the banner.

### Default mode: `captureVisibleTab(windowId)` with explicit fallback

Default `bproxy screenshot`:

1. Resolve the session's pinned `tabId`. If unset → `NO_TAB_TARGETED`.
2. If the pinned tab was closed → `TAB_CLOSED`.
3. Look up the pinned tab's `windowId` and check `chrome.tabs.get(tabId)` for `active` and the parent window's `state`.
4. Branch:
    - **Tab is active in its window, window not minimized** → `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })`. No focus change. **This is the happy path.**
    - **Tab is not active in its window** → emit `TAB_NOT_VISIBLE` (sub-case of the `target` category, see below). Do not silently activate the tab; that is the focus-steal bug we are removing.
    - **Window is minimized** → emit `TAB_NOT_VISIBLE` with `details.reason: "minimized"`. The OS will return a black image; we refuse to ship that to the agent because a black screenshot is a worse failure than a clear error.
    - **Window is occluded by another OS window** → still proceed; Chrome's compositor produces a real frame for occluded but un-minimized windows. No special handling.

`TAB_NOT_VISIBLE` is the new code added by this chapter. See [06-failure-modes.md](./06-failure-modes.md#tab-not-visible) for the canonical row; the shape is:

```jsonc
{
  "ok": false,
  "error": {
    "code": "TAB_NOT_VISIBLE",
    "category": "target",
    "retry": "conditional",
    "suggestedAction": "focus the pinned tab, un-minimize its window, or use --activate / --debugger",
    "message": "Pinned tab 42 is not the active tab in window 1",
    "details": {
      "session": "default",
      "tabId": 42,
      "windowId": 1,
      "reason": "not_active",   // "not_active" | "minimized" | "no_window"
      "currentlyActiveTabId": 87
    }
  }
}
```

`retry: conditional` because the precondition is observable — the agent can poll `bproxy tab list` and see whether the pinned tab is `active: true` and `minimized: false`, or it can pass `--activate` (next section).

### Opt-in `--activate`: brief focus steal with explicit consent

`bproxy screenshot --activate` opts in to the previous behaviour: the SW activates the pinned tab via `chrome.tabs.update(tabId, { active: true })`, captures, and then restores the previously active tab. This is offered because some agents (CI fixtures, supervised single-user sessions) want a screenshot regardless of focus and the user accepts the brief flicker.

Trade-offs documented for the agent:

- The active-tab swap is visible to the user. On a foreground Chrome window the user sees their tab change for ~50–200 ms.
- The restore step is best-effort: if the user changes the active tab between our two `chrome.tabs.update` calls, we do not fight them. The response includes `data.activated: true` and `data.restoredPreviousTab: false` so the agent knows what happened.
- Minimized windows are still refused — `--activate` cannot un-minimize without a stronger user prompt, and silently un-minimizing a window is a worse focus-steal than tab-flipping.

### Opt-in `--debugger`: CDP capture with the banner trade-off

`bproxy service start --enable-debugger-mode` enables a parallel capture path using `chrome.debugger.attach({ tabId }, '1.3')` + `Page.captureScreenshot`. Per-command opt-in is `bproxy screenshot --debugger`. The previous spelling `--enable-debugger-screenshots` is a deprecated alias for one minor version; both flags resolve to the same internal `debuggerEnabled` state.

What this buys:

- True any-tab capture without focus steal and without the active-tab gate. Works on background tabs, non-active tabs, and tabs in non-focused windows. Does **not** work on minimized windows (same OS-compositor reason as `captureVisibleTab`).
- Symmetry with the "trusted events" path used by anti-bot bypass — the same `chrome.debugger` attachment is reused. See [Shared debugger attachment with trusted events](#shared-debugger-attachment-with-trusted-events).

What this costs:

- Chrome shows a persistent infobar at the top of every tab the extension has attached to: *"`bproxy` started debugging this browser."* The banner is not suppressible by extension code. It survives detach + reattach cycles within a short window (Chrome rate-limits the dismiss-then-reshow). Documented for the user before they pass the flag.
- Cannot be enabled per-session; the flag is global to the proxy. Two agents using the same proxy share the banner.
- `chrome.debugger` requires the `debugger` permission, which prompts the user once on extension update.

### Recommendation

The default is **`captureVisibleTab(windowId)` with the no-focus-steal-by-default rule and `TAB_NOT_VISIBLE` error**. The two opt-ins (`--activate`, `--debugger`) cover the cases where the agent has a reason to override the default.

Why not "always activate":

- The whole point of the redesign is that silent target drift is the worst class of bug. Silent focus steal is the same bug seen from the user's side. We refuse to do it by default, and the `--activate` opt-in is one CLI flag away when the agent really wants it.

Why not "default to debugger":

- The banner is a permanent, user-visible UX cost. A tool that is meant to be reliable for daily use cannot impose that on every screenshot. The opt-in flag is correct.

### Minimized windows: what we return

`captureVisibleTab` and `Page.captureScreenshot` both rely on the OS compositor for the window's framebuffer. Minimized Chrome windows on macOS, Windows, and Linux are not composited — the API technically returns success, but the returned PNG is a single solid color (most often black, occasionally the last-rendered frame on some Linux compositors). This is observable in production and reproduces the long-standing [Chromium issue 41130703](https://issues.chromium.org/issues/41130703) class of bugs.

Returning a black PNG to the agent is worse than failing: the agent's vision model will reason about the black image as a real page state. Therefore both the default and the `--debugger` path emit `TAB_NOT_VISIBLE` with `details.reason: "minimized"` and never return the corrupt frame.

`--activate` does not un-minimize. Un-minimizing requires `chrome.windows.update(windowId, { state: 'normal' })`, which is a stronger user-disruption than tab activation. We do not do it implicitly. An agent that needs it can call `bproxy eval` plus `chrome.windows.update` (when `--allow-eval` is set) — at which point the user has explicitly opted into the disruption.

## Tab resolver in the SW

The dispatcher in `background.js` runs this resolver before forwarding any command:

```js
async function resolveTarget(envelope) {
  const session = envelope.session ?? 'default';
  const { tabs } = await chrome.storage.session.get('tabs');
  const pin = tabs?.[session];

  // Self-pinning commands skip the unpinned check.
  if (SELF_PINNING.has(envelope.action)) {
    return { session, pin: pin ?? null };
  }

  if (!pin) {
    return error('NO_TAB_TARGETED', { session, reason: 'session_cleared' });
  }

  const tab = await chrome.tabs.get(pin.tabId).catch(() => null);
  if (!tab) {
    await deletePin(session);
    return error('TAB_CLOSED', { session, tabId: pin.tabId, lastUrl: pin.lastUrl, reason: 'user_closed' });
  }

  return { session, pin, tab };
}
```

The resolver is called once per command. Per-command Chrome API calls are cheap (`chrome.tabs.get` is a synchronous lookup in Chrome's tab table), and the small extra cost is paid once at dispatch — well under the timeout budget defined in [07-timeouts.md](./07-timeouts.md).

`SELF_PINNING` is the closed set `{ status, tab list, tab pin, tab open, tab unpin, tab close, navigate }`. `navigate` is on this list because a fresh-session `bproxy navigate <url>` should auto-pin the active tab and then navigate, exactly as if the agent had run `tab pin` + `navigate`.

### First-command auto-pin

For an action that is not in `SELF_PINNING`, the resolver also auto-pins on the *first* command in a fresh session:

```js
if (!pin && envelope.action === 'click' /* or any non-self-pinning action */) {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) return error('NO_TAB_TARGETED', { session, reason: 'first_command_failed_to_resolve' });
  await setPin(session, { tabId: active.id, windowId: active.windowId, pinnedAt: Date.now() });
  // continue with active.id as the resolved tab
}
```

This preserves the "agent issues `click` and it works" feel for single-window single-agent users while making the pin explicit from that point on. Subsequent commands target the same tab even if the user switches windows.

## Navigate flow (revised)

`navigate` keeps the implementation from [04-extension.md → Navigate flow](./04-extension.md#navigate-flow) — `chrome.tabs.update(tabId, { url })` plus `onUpdated` await — but the `tabId` is now the resolved session pin, not "the active tab." On a fresh session, `navigate` auto-pins the active tab before updating it (see above).

`bproxy tab open <url>` is the new variant for "navigate, but in a fresh tab." It calls `chrome.tabs.create({ url, active: false })` and pins the result. The new tab is **not** activated by default; the agent that wants the user to see it passes `--activate`. This keeps the no-focus-steal rule consistent.

## Shared debugger attachment with trusted events

The opt-in `--debugger` path attaches `chrome.debugger` to the pinned tab for screenshots, and the same attachment is reused for trusted-event dispatch under `--trusted` (specified in [04-extension.md → Debugger mode](./04-extension.md#debugger-mode-trusted-events-and-cdp-screenshots)). Both ride on the single `bproxy service start --enable-debugger-mode` flag and share the user-visible banner, the rate-limit on detach/reattach, and the lifecycle (attach on first use, detach on session unpin / browser close, re-attach on SW restart).

Contract this chapter commits to:

- `--debugger` and `--trusted` are opt-in at service-start time. Default behaviour never attaches `chrome.debugger`.
- The user-visible banner is a documented UX cost, not a bug.
- `TAB_NOT_VISIBLE` with `reason: "minimized"` is emitted regardless of capture mode, because the limit is in the OS compositor, not the API.

## Non-goals

- **Cross-browser pin sharing.** A pinned `tabId` is per-Chrome-process. The agent cannot pin a Firefox tab from the same proxy.
- **Pin a tab by URL pattern.** Tempting (`bproxy tab pin --url '*example.com*'`) but ambiguous when multiple tabs match; we prefer the agent run `tab list` and pick a numeric `id`.
- **Per-frame pin.** `--frame` is per-command, not per-session; see [04-extension.md → Frame routing](./04-extension.md#frame-routing-and-frame-detection).
- **Screenshot stitching for full-page capture.** Out of scope for v1. The `data` field is the visible viewport only.
