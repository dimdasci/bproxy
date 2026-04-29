# 6. Failure Modes

[← Index](./README.md) · Prev: [Page State Detection](./05-page-state.md) · Next: [Timeouts →](./07-timeouts.md)

---

This chapter is the canonical source of truth for bproxy error codes. Every error response written by the CLI, the proxy, or the extension uses one of the codes in [§ Canonical error code table](#canonical-error-code-table) and conforms to the structured envelope defined in [01-output-contract.md → Error shape](./01-output-contract.md#error-shape). Any code referenced elsewhere in the docs that is not listed here is a bug; please raise it.

The taxonomy is designed for one specific consumer: a coding agent that branches on `error.code` and `error.retry` to decide whether to retry, retry-after-fix, give up, or escalate to the user. Categories follow the gRPC `Status.Code` partitioning ([gRPC — Status codes](https://grpc.io/docs/guides/status-codes/)) adapted to the bproxy domain; the structured envelope follows RFC 9457 / RFC 7807 ([Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)) with a fixed set of extensions; the `retry` / `retryAfterMs` semantics follow Stripe's retryable-error convention ([Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)).

## Categories

Every code belongs to exactly one category. The category is what the agent should branch on first; the code refines.

| Category     | Meaning                                                                                                                       |
|--------------|-------------------------------------------------------------------------------------------------------------------------------|
| `connection` | The CLI cannot reach the proxy, or the proxy cannot reach the extension. Transport-layer.                                     |
| `auth`       | The request was rejected for an authentication or authorisation reason. Includes the `--allow-eval` gate.                     |
| `protocol`   | The two ends disagree about the wire contract: version skew, idempotency-key reuse, queue overflow, cancellation.             |
| `target`     | The page, tab, frame, or DOM element the agent named is not addressable. Selector misses, restricted URLs, missing pin.       |
| `timing`     | A deadline expired or an action observed an in-flight navigation / detach. Almost always retryable on a fresh page state.     |
| `policy`     | The action would violate a bproxy policy (e.g. download instead of nav, eval disabled, future safety gates).                  |
| `internal`   | Bug bucket. A code path that should be unreachable in steady state was reached.                                               |

## Canonical error code table

Columns:

- **code** — the string written to `error.code` on the wire. Stable; new codes are additive.
- **category** — one of the seven above.
- **retry** — `true` (transient, the agent should retry verbatim), `false` (the agent must change the request before retrying), or `conditional` (retry is appropriate iff the precondition described in `suggestedAction` becomes true; see [§ `retry: conditional` semantics](#retry-conditional-semantics)).
- **retryAfterMs** — set when the proxy or extension knows a deterministic floor for when a retry could succeed (e.g. backoff window, alarm cycle). Absent otherwise. Mirrors Stripe's `Stripe-Should-Retry` plus exponential-backoff guidance ([Stripe blog — Idempotency](https://stripe.com/blog/idempotency)).
- **suggestedAction** — one short phrase the agent can act on. Not a paragraph.
- **description** — when the code is emitted.

| code | category | retry | retryAfterMs | suggestedAction | description |
|------|----------|-------|--------------|-----------------|-------------|
| `NO_CONNECTION` | `connection` | `true` | `30000` | open the browser and reload the extension | Proxy has no extension WS for the resolved profile and the hold window expired. See [§ Extension not connected](#extension-not-connected). On enterprise installs, `details.hint` MAY be set to `"extension may be disabled by policy; check chrome://extensions"` — see [§ Enterprise policy hint](#enterprise-policy-hint). |
| `EXTENSION_UNRESPONSIVE` | `connection` | `true` | `1000` | retry; if it persists, restart the extension | SW connected but did not ack the command within its deadline. Replaces the generic content-script-timeout case formerly under `EXTENSION_TIMEOUT`. |
| `PROXY_NOT_RUNNING` | `connection` | `true` | – | run `bproxy service start` | CLI's HTTP request to the daemon's port was refused mid-call (the daemon was up at `bproxy status` time but went away before this command landed). Distinct from `DAEMON_NOT_RUNNING` — see [§ Daemon-related codes](#daemon-related-codes). |
| `DAEMON_NOT_RUNNING` | `connection` | `true` | – | run `bproxy service start` | The CLI could not reach the daemon at all: no PID file at the per-user runtime directory, or the recorded port returns `ECONNREFUSED` on the first probe. Emitted by `bproxy status`, `bproxy service stop`, `bproxy service restart`, and any command's pre-flight check. See [§ Daemon-related codes](#daemon-related-codes). |
| `DAEMON_ALREADY_RUNNING` | `connection` | `false` | – | run `bproxy service status` for the running daemon, or `bproxy service restart` | `bproxy service start` was issued while a live daemon owns the PID file and answers on the recorded port. Not transient — the user must decide whether to restart or attach to the running one. |
| `DAEMON_FAILED_TO_START` | `connection` | `false` | – | check `bproxy service start` log output | `bproxy service start` spawned the daemon but `/version` did not respond within the 5 s readiness probe. `details.lastLogLines` carries the last 20 lines from the daemon's log file. |
| `PORT_IN_USE` | `connection` | `false` | – | pass `--port <N>` or stop the other process | The configured port is bound by an unrelated process (the listener does not respond as a bproxy daemon). `details.port` and `details.suggestedAlternativePort` (next free port in the 9615–9625 window) are populated for the agent. We deliberately do not auto-bump; the CLI would lose track of the daemon. |
| `WRONG_PROFILE` | `target` | `false` | – | run `bproxy session bind <session> <profileId>` first, or pass a `--session` already bound to the right profile | The command's resolved `(session, tabId)` lives in a different Chrome profile than the session is bound to. Multi-profile installs only. See [§ `WRONG_PROFILE`](#wrong_profile). |
| `AUTH_REQUIRED` | `auth` | `false` | – | re-paste the token from `bproxy service start` | Bearer token missing, malformed, or rejected. Sub-reason in `details.reason` (`missing_token`, `bad_token`, `host_mismatch`). See [§ Auth sub-reasons](#auth-sub-reasons). |
| `EVAL_DISABLED` | `auth` | `false` | – | restart the proxy with `--allow-eval` | `eval` was called but the service was not started with `--allow-eval`. Policy-shaped, but lives under `auth` because it's a startup-flag gate. |
| `DEBUGGER_DISABLED` | `auth` | `false` | – | restart the proxy with `--enable-debugger-mode` | `--trusted` (on `click` / `type` / `navigate`) or `--debugger` (on `screenshot`) was used but the service was not started with `--enable-debugger-mode`. Same shape as `EVAL_DISABLED`: a startup-flag gate with a user-visible cost (Chrome's debugging banner) that the user must accept once at service start. |
| `DEBUGGER_UNAVAILABLE` | `connection` | `conditional` | `1000` | close DevTools on the target tab, or wait for the conflicting client to detach | `chrome.debugger.attach` failed. Most common cause: Chrome DevTools is open on the target tab (mutually exclusive with extension debuggers); secondary causes: another extension owns the debugger, the target tab has detached, or the URL is restricted. Conditional because the conflict can resolve. See [§ `DEBUGGER_UNAVAILABLE`](#debugger_unavailable). |
| `PROTOCOL_VERSION_MISMATCH` | `protocol` | `false` | – | reinstall CLI and extension to matching versions | CLI / proxy / extension are not on the same `protocol_version`. |
| `QUEUE_FULL` | `protocol` | `true` | `5000` | wait for the extension to reconnect, then retry | Proxy's bounded offline queue exceeded while extension was disconnected. |
| `REPLAY_REJECTED` | `protocol` | `false` | – | generate a new `id` for a fresh operation | Same `id` reused with different `action` / `params`. |
| `DUPLICATE_REQUEST` | `protocol` | `false` | – | use the cached result, or generate a new `id` | Same `(id, action, params)` already completed within the dedupe TTL. The cached response is returned with `replay: true`; this code is only emitted when the cache is unreachable but the id-set indicates completion. |
| `CANCELLED` | `protocol` | `false` | – | re-issue with a fresh `id` if still wanted | CLI dropped the HTTP connection (Ctrl-C) before the extension finished. |
| `INVALID_COMMAND` | `protocol` | `false` | – | fix the command syntax | Unknown `action`, missing required `params`, or schema violation. |
| `WAIT_TIMEOUT` | `timing` | `true` | – | widen `--timeout`, or pick a different waiter | Explicit `bproxy wait` or an action's auto-wait did not satisfy its condition before deadline. `details.check` names the failed predicate. |
| `NEVER_SETTLED` | `timing` | `false` | – | switch to `wait selector` against a specific anchor | `bproxy wait settle` ran to its full budget on a continuously-mutating page. `details.busiestRoots` lists the noisy DOM roots. |
| `NAVIGATED_DURING_ACTION` | `timing` | `conditional` | – | re-issue once the new page is reachable | Top-frame navigation fired after the action's target was located but before completion. Conditional because the agent must reconfirm the new URL is the intended one. |
| `FRAME_DETACHED` | `timing` | `conditional` | – | re-issue once the parent page settles | The targeted iframe was removed from the DOM mid-action. Subframe analogue of `NAVIGATED_DURING_ACTION`. |
| `SELECTOR_NOT_FOUND` | `target` | `false` | – | fix the selector or wait for the element | Selector matched zero elements after auto-wait completed. |
| `SELECTOR_AMBIGUOUS` | `target` | `false` | – | tighten the selector to a single element | Selector matched multiple elements where one was required (e.g. `click`). |
| `ELEMENT_NOT_INTERACTABLE` | `target` | `conditional` | – | wait for visible / enabled, or use a different selector | Element was found but failed visibility, enabled, or stability checks for `click` / `type`. Conditional because the page may yet make it interactable. |
| `TAB_CLOSED` | `target` | `false` | – | re-pin a tab or open a new one | The pinned tab was closed by the user, the page, another session's `tab close`, or because its window closed. See [§ `TAB_CLOSED`](#tab_closed). |
| `TAB_NOT_VISIBLE` | `target` | `conditional` | – | focus the pinned tab, un-minimize its window, or use `--activate` / `--debugger` | `bproxy screenshot` was called and the pinned tab is not the active tab in its window, or the window is minimized. Conditional because focusing the tab or un-minimizing the window resolves it; the agent may also opt in to `--activate` or `--debugger`. See [§ `TAB_NOT_VISIBLE`](#tab_not_visible). |
| `RESTRICTED_URL` | `target` | `false` | – | navigate away from the restricted URL | Active tab or `--frame` is on a URL where Chrome forbids content-script injection (`chrome://*`, `chrome-extension://*`, `view-source:*`, the PDF viewer, the Chrome Web Store, `file://*` without opt-in). See [§ Restricted URL](#restricted-url-no-content-script-possible). |
| `NO_TAB_TARGETED` | `target` | `false` | – | run `bproxy tab pin <id>` first | The session's sticky pin is unset (never pinned, explicit `tab unpin`, or `chrome.storage.session` was cleared by browser restart / extension reload). See [§ `NO_TAB_TARGETED`](#no_tab_targeted). |
| `NAVIGATION_FAILED` | `target` | `false` | – | check the URL and network reachability | `chrome.tabs.update` reported an error (`ERR_NAME_NOT_RESOLVED`, etc.). |
| `EVAL_ERROR` | `target` | `false` | – | fix the script | The user-supplied JS threw. `details.error` carries the message and stack. |
| `DOWNLOAD_TRIGGERED` | `policy` | `false` | – | use `bproxy navigate` directly, or accept the download | The clicked link / form submission produced a `chrome.downloads.onCreated` event instead of a navigation. The agent's mental model of the page differs from the page's behaviour. |
| `INTERNAL_ERROR` | `internal` | `true` | `1000` | retry once; if it persists, file a bug | Bug bucket. Should be empty in steady state. `details.where` carries the source location. |

### Deprecated codes

| Old code | Replaced by | Why |
|----------|-------------|-----|
| `EXTENSION_TIMEOUT` | `EXTENSION_UNRESPONSIVE`, `WAIT_TIMEOUT`, `NAVIGATED_DURING_ACTION`, `FRAME_DETACHED`, `RESTRICTED_URL` | One bucket collapsed five distinct causes. The agent could not branch deterministically — see [§ Taxonomy rules](#taxonomy-rules) for the disambiguation tree. |
| `TAB_NOT_AVAILABLE` | `TAB_CLOSED`, `RESTRICTED_URL`, `NO_TAB_TARGETED` | Same problem at a smaller scale: "tab not available" hid three independently-actionable conditions. |
| `FRAME_NOT_FOUND` | `SELECTOR_NOT_FOUND` (when the `--frame` selector matches zero) | Already a special case of selector-miss; folded in to keep the vocabulary minimal. |

The deprecated codes MUST NOT appear on the wire. The CLI, proxy, and extension all have lint rules forbidding them; the testing chapter's matrix asserts this ([10-testing.md](./10-testing.md)).

## `retry: conditional` semantics

`conditional` is the third value of `retry`, distinct from `true` and `false`:

- `retry: true` — the agent should retry the same request without changing anything. The proxy / extension reports it as transient; success is just a question of timing or a fresh connection.
- `retry: false` — the agent must change the request (selector, URL, params) or its strategy before retrying. A verbatim retry will fail again.
- `retry: conditional` — the agent should retry **iff** the precondition stated in `suggestedAction` is satisfied. The agent is responsible for verifying the precondition; the protocol does not auto-retry. This avoids the trap where a generic `retry: true` makes the agent burn its budget on a structurally-impossible retry loop, and the trap where `retry: false` makes the agent give up on a problem that resolves in the next 200ms.

For example, `NAVIGATED_DURING_ACTION` is `conditional`: if the new URL is the page the agent intended to drive to anyway, it can re-issue (often with the same `id`, since the dedupe layer protects against double-application); if the new URL is a logout page or an error page, the agent must escalate. The protocol cannot make that judgement.

## Taxonomy rules

Where two codes could plausibly apply, the dispatcher picks by the rules below. The rules are normative — `06-failure-modes.md` is the single source for them, and the testing matrix in [10-testing.md](./10-testing.md) has one row per rule.

1. **`connection` outranks everything** when the WS is not connected. If there is no extension to ask, no `target` / `timing` / `policy` claim is meaningful: emit `NO_CONNECTION`.
2. **`auth` outranks `protocol`**. An expired token produces `AUTH_REQUIRED` even if the request is also missing required params.
3. **A content-script timeout while the page is loading is `WAIT_TIMEOUT`, not `EXTENSION_UNRESPONSIVE`.** The extension is responsive; the page is not. This is the single most common confusion under the old `EXTENSION_TIMEOUT` bucket.
4. **A content-script timeout while the page is on a restricted URL is `RESTRICTED_URL`, not `EXTENSION_UNRESPONSIVE` or `WAIT_TIMEOUT`.** The SW pre-flight catches this before forwarding (see [§ Restricted URL](#restricted-url-no-content-script-possible)) — by construction `RESTRICTED_URL` is emitted synchronously, not by deadline expiry.
5. **A content-script timeout while a top-frame navigation is in flight is `NAVIGATED_DURING_ACTION`, not `WAIT_TIMEOUT`.** The dispatcher consults the `chrome.webNavigation` event history before deciding. If a `onBeforeNavigate` for the top frame fired during the action, this code wins.
6. **A content-script timeout while the targeted subframe was removed is `FRAME_DETACHED`, not `NAVIGATED_DURING_ACTION`.** Same dispatcher, frame-table-aware. See [§ Frame detached mid-action](#frame-detached-mid-action).
7. **`SELECTOR_NOT_FOUND` is emitted only after auto-wait has completed**, so the agent never has to second-guess whether a brief retry would have succeeded. If the agent wants a longer wait, it sets `--timeout` or uses an explicit `bproxy wait`.
8. **`ELEMENT_NOT_INTERACTABLE` outranks `SELECTOR_NOT_FOUND`** if the element was found at any point during auto-wait. The distinction matters: the agent's selector is right but the element is occluded / disabled / animating.
9. **`DOWNLOAD_TRIGGERED` outranks `NAVIGATED_DURING_ACTION`** if the click both navigated and produced a download in the same dispatch cycle. The agent's recourse is structurally different.
10. **`INTERNAL_ERROR` is the bucket of last resort.** Adding a new specific code is preferred over routing a known cause through `INTERNAL_ERROR`. Anything emitted as `INTERNAL_ERROR` is on the to-fix list.

## Auth sub-reasons

`AUTH_REQUIRED` carries `details.reason` from a closed enum, so the agent can refine its message without parsing free text:

| `details.reason`  | When                                                                  |
|-------------------|-----------------------------------------------------------------------|
| `missing_token`   | `Authorization` header absent on `/command` or `/log`.                |
| `bad_token`       | Token present but `crypto.timingSafeEqual` failed against the file.   |
| `host_mismatch`   | `Host` header was not in the `127.0.0.1:PORT` / `localhost:PORT` allowlist (defeats DNS rebinding). |

See [03-proxy-service.md → Authentication](./03-proxy-service.md#authentication) for the protocol detail; this table is the only place `details.reason` values are enumerated.

---

## Code-by-code reference

The following sections elaborate the codes that need more than a table row. Codes whose row is self-explanatory (e.g. `INVALID_COMMAND`, `PROXY_NOT_RUNNING`) are not repeated here.

### Extension not connected

Trigger: browser closed, extension disabled, or page on `chrome://` URL.

Proxy detects: no WebSocket client in the connection slot.

Behavior: the proxy **holds the command** and waits for an extension to connect (up to the command's timeout). If the MV3 service worker was simply asleep, it will wake up and reconnect within ~200–600ms, and the command proceeds transparently. If no connection is established before timeout → `NO_CONNECTION`, `retry: true`, `retryAfterMs: 30000`, `suggestedAction: "open the browser and reload the extension"`.

See [Proxy Service → Why queue instead of fail-fast](./03-proxy-service.md#why-queue-instead-of-fail-fast) for the rationale.

### `DEBUGGER_DISABLED`

Trigger: the agent passed `--trusted` on `click` / `type` / `navigate`, or `--debugger` on `screenshot`, but the proxy was not started with `--enable-debugger-mode`.

```jsonc
{
  "ok": false,
  "error": {
    "code": "DEBUGGER_DISABLED",
    "category": "auth",
    "retry": false,
    "suggestedAction": "restart the proxy with --enable-debugger-mode",
    "message": "--trusted requires the proxy to be started with --enable-debugger-mode",
    "details": {
      "command": "click",
      "flag": "--trusted"
    }
  }
}
```

`retry: false` because the same call against the same proxy will keep failing. The user must restart the service. Documented at startup: `bproxy service start` prints "debugger mode is disabled (start with --enable-debugger-mode to enable --trusted and --debugger)" alongside the existing eval-disabled banner.

The flag is required because `chrome.debugger.attach` shows a non-suppressible browser banner that the user has to accept. We do not pop the banner without explicit consent. See [04-extension.md → Debugger mode](./04-extension.md#debugger-mode-trusted-events-and-cdp-screenshots).

### `DEBUGGER_UNAVAILABLE`

Trigger: `chrome.debugger.attach({ tabId }, "1.3")` failed. Causes, in rough order of frequency:

1. **Chrome DevTools is open on the target tab.** Chrome enforces mutual exclusion between the extension debugger and DevTools on the same target. The user closes DevTools and the next attempt succeeds.
2. **Another extension owns the debugger.** The most recent attacher wins; the loser sees `onDetach` with reason `replaced_with_devtools` (or similar) and the next `--trusted` command tries to attach again. If another extension is racing us, we will lose every other attempt.
3. **The target tab detached / the navigation completed before attach.** Race between SW receiving the command and `attach` resolving. Retry succeeds against the new tab id.
4. **Restricted URL.** `chrome.debugger.attach` works on most pages, but some sequences (Chrome Web Store, certain `chrome://` URLs) refuse the attach. The dispatcher prefers `RESTRICTED_URL` over `DEBUGGER_UNAVAILABLE` when the SW already knows the URL is restricted; this code is emitted only when the attach failure is the first signal.

```jsonc
{
  "ok": false,
  "error": {
    "code": "DEBUGGER_UNAVAILABLE",
    "category": "connection",
    "retry": "conditional",
    "retryAfterMs": 1000,
    "suggestedAction": "close DevTools on the target tab, or wait for the conflicting client to detach",
    "message": "chrome.debugger.attach failed for tab 42",
    "details": {
      "tabId": 42,
      "reason": "another_debugger_attached",
      "chromeError": "Another debugger is already attached to the tab with id: 42."
    }
  }
}
```

`details.reason` is one of `another_debugger_attached`, `devtools_open`, `target_detached`, `attach_failed_unknown`. The agent does not need to branch on `reason` — the recovery for all four is "retry, possibly after the user closes DevTools" — but it is logged.

`retry: conditional` because the conflict is recoverable (the user closes DevTools, the conflicting extension detaches) but is not transient on its own. The agent should not auto-retry in a tight loop; the `retryAfterMs: 1000` is a floor, not a guarantee. After two consecutive `DEBUGGER_UNAVAILABLE` results the agent should surface to the user rather than keep trying.

The error sits in the `connection` category because the agent's recourse looks like a connection problem (a transport became unavailable) rather than a permission problem (auth would never resolve without intervention; this can resolve in seconds).

### Service worker termination

Trigger: Chrome terminates the MV3 background service worker after ~30s of inactivity.

Impact: WebSocket connection to proxy drops. The proxy enters a "no client" state.

Recovery: when the next command arrives at the proxy, the proxy holds it (see above). Meanwhile, the CLI's HTTP request or the content script's `chrome.runtime.sendMessage` wakes the service worker. The SW reconnects to the proxy via WebSocket. The proxy sees the new connection, drains any held commands, and processing continues.

Key timing: SW wakeup (~50–500ms) + WS handshake (~10–50ms) = ~200–600ms total. Well within the 30s command timeout. No error code is emitted on the happy path; if the deadline expires anyway, the code is `NO_CONNECTION` (proxy still empty) or `EXTENSION_UNRESPONSIVE` (SW connected but silent).

### Content script not injected

Trigger: new tab opened via bookmark, or navigation to a new origin before content script auto-injects.

Background detects: `chrome.tabs.sendMessage` returns error.

Recovery sequence:
1. Background calls `chrome.scripting.executeScript` to inject `content.js`.
2. Background **waits for a ready acknowledgment**: the content script sends `chrome.runtime.sendMessage({ type: 'bproxy-ready' })` on load.
3. Background retries the original command via `sendMessage`.
4. If second attempt fails → `EXTENSION_UNRESPONSIVE` (SW is up; the content script's `onMessage` listener never registered).

The ready-ack eliminates a race condition: without it, the retry `sendMessage` can fire before the freshly injected content script has registered its `onMessage` listener, causing a silent failure.

### Page navigation during command

Trigger: agent sends `type`, but a redirect or SPA navigation fires mid-execution.

Content script: dies silently (for cross-origin nav) or stays alive (SPA).

Background: the dispatcher subscribes to `chrome.webNavigation.onCommitted` for the active tab's top frame. If a commit fires for the top frame while a command is `pending`, the dispatcher resolves the pending request as `NAVIGATED_DURING_ACTION` with `retry: conditional`.

The previous behaviour (let the proxy-side 30s timer expire and emit `EXTENSION_TIMEOUT`) is retired. The agent can now distinguish "page moved under me" from "extension hung."

### Frame detached mid-action

Trigger: an iframe is removed from the DOM while a command targeting it is in flight. Common causes: a SPA route change unmounts the embedded checkout, the page replaces the iframe's `src` attribute, or a parent container is re-rendered. Distinct from `NAVIGATED_DURING_ACTION` (which is a *top-frame* navigation).

Detection: the SW subscribes to `chrome.webNavigation.onBeforeNavigate` and `chrome.webNavigation.onErrorOccurred`. **`onBeforeNavigate` is the authoritative signal** — it fires per-frame with `tabId` and `frameId` immediately before navigation begins, including the synthetic navigation that fires when an iframe element is removed from the DOM (the frame's document is unloaded). `onErrorOccurred` is a backstop for the case where the navigation begins but fails to load.

We pick `onBeforeNavigate` because:

- It fires *earlier* than `onErrorOccurred` — the agent sees the failure as soon as the frame is gone, not after the navigation attempt times out.
- It is per-frame with `frameId`, matching exactly the granularity the multi-frame router needs.
- Note: chrome.webNavigation has no first-class "frame removed" event — DOM iframe removal is observed indirectly through the unload-side navigation event. This is documented in [Chrome — chrome.webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).

The SW maintains `frameTable[tabId] → Map<frameId, { url, parentFrameId }>` populated from `chrome.webNavigation.getAllFrames` on tab activation and updated on `onCommitted` / `onBeforeNavigate`. When a frame disappears from the table while a command for that `(tabId, frameId)` is in `pending`, the dispatcher writes a `FRAME_DETACHED` envelope (see [§ Canonical error code table](#canonical-error-code-table)) with `details.frameId` and `details.parentUrl`.

Residual: a frame can detach *between* the SW reading `frameTable` and the content-script `sendMessage` resolving. The window is small (one event-loop turn) but non-zero; the dispatcher treats `chrome.tabs.sendMessage` rejection with "no receiving end" as a probable detach and emits `FRAME_DETACHED` rather than `EXTENSION_UNRESPONSIVE` *if* the frame is also missing from the most recent `frameTable` snapshot. If both checks disagree, fall back to `EXTENSION_UNRESPONSIVE` — we do not invent failure modes from inference alone.

### Selector on wrong page

Trigger: agent clicks `#login-btn` but the page already navigated to the dashboard.

Content script: `SELECTOR_NOT_FOUND`, `retry: false`.

The structured envelope's `details` includes the current page URL and title so the agent can realize it's on the wrong page:

```json
{
  "ok": false,
  "error": {
    "code": "SELECTOR_NOT_FOUND",
    "category": "target",
    "retry": false,
    "suggestedAction": "fix the selector or wait for the element",
    "message": "No element matches '#login-btn'",
    "details": { "selector": "#login-btn", "matchCount": 0 }
  },
  "page": { "url": "https://app.example.com/dashboard", "title": "Dashboard", "state": "ready", "busy": false }
}
```

The `page` block is at the envelope top level (not under `details`) and is populated for every content-script-bound action regardless of `ok`. See [01-output-contract.md → Page context on every response](./01-output-contract.md#page-context-on-every-response).

### Restricted URL (no content script possible)

Trigger: the active tab — or the targeted subframe — has a URL that Chrome forbids content-script injection into. Concretely: any of `chrome://*`, `chrome-extension://*` (other extensions, including this one's options page), `chromewebstore.google.com`, `chrome.google.com/webstore` (the legacy host), `view-source:*`, the built-in PDF viewer, the New Tab Page when overridden by a web-store extension, and `file://*` (unless the user has flipped "Allow access to file URLs" for the extension). `about:*`, `data:*`, `blob:*`, and `filesystem:*` frames are restricted unless the manifest opts in via `match_about_blank` or `match_origin_as_fallback` ([Chrome — Manifest content_scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)).

Without the pre-flight, the SW would forward to a non-existent content script and the agent would observe a deadline expiry. That is the wrong contract: the SW *can know immediately* by inspecting the URL it gets back from `chrome.tabs.get(tabId)` (top frame) or from the `frameId → url` map maintained for the multi-frame router (subframes; see [Extension Internals → Frame routing](./04-extension.md#frame-routing-and-frame-detection)).

Recovery: the SW pre-flights the URL before forwarding. On a hit it fails fast with the structured envelope:

```json
{
  "ok": false,
  "error": {
    "code": "RESTRICTED_URL",
    "category": "target",
    "retry": false,
    "suggestedAction": "navigate away from the restricted URL",
    "message": "Content scripts cannot run on chrome://settings/",
    "details": { "url": "chrome://settings/", "reason": "scheme_chrome" }
  },
  "page": { "url": "chrome://settings/", "title": "Settings", "state": "ready", "busy": false }
}
```

`retry: false` because the URL itself is the problem; the same call against the same tab will keep failing. The agent's recourse is `bproxy navigate` away from the page (which the background *can* do — `chrome.tabs.update` works on restricted URLs even where content scripts can't).

`details.reason` is one of `scheme_chrome`, `scheme_chrome_extension`, `scheme_view_source`, `host_chrome_web_store`, `scheme_file_no_optin`, `scheme_about_no_optin`. The agent rarely needs to branch on this, but the value is logged.

Detection rule (single source in `background.js`):

```js
const RESTRICTED = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^edge:\/\//i,
  /^view-source:/i,
  /^https:\/\/chromewebstore\.google\.com\//i,
  /^https:\/\/chrome\.google\.com\/webstore\b/i,
  /^file:\/\//i, // conditional — see below
];
function isRestricted(url) {
  return RESTRICTED.some(re => re.test(url));
}
```

The `file://` entry is guarded by a single check at SW startup: if `chrome.extension.isAllowedFileSchemeAccess()` resolves true, the regex is removed from the array. This keeps the gate accurate for users who have explicitly opted in.

Where the gate sits: the SW's command dispatcher consults `isRestricted` *before* `chrome.tabs.sendMessage` for any content-script-bound action, and *before* `chrome.scripting.executeScript` for `eval`. `navigate`, `tab list`, `tab pin`, `tab unpin`, `tab open`, `tab close`, and `status` bypass the gate — they do not need a content script. `screenshot` also bypasses the restricted-URL gate; `captureVisibleTab` works on most restricted pages with `activeTab`. `screenshot` is still subject to the visibility check defined in [§ `TAB_NOT_VISIBLE`](#tab_not_visible) — restricted-URL and not-visible are independent failure modes.

For subframes (`--frame` qualifier), the same predicate runs against the resolved frame URL from `chrome.webNavigation.getAllFrames(tabId)`. A `data:` or `about:srcdoc` subframe whose parent matches our `host_permissions` *and* which qualifies under `match_origin_as_fallback` is **not** restricted; see [Extension Internals → Frame routing](./04-extension.md#frame-routing-and-frame-detection) for the matrix.

### `TAB_CLOSED`

Trigger: the session's pinned tab was closed before or during the command. The SW listens to `chrome.tabs.onRemoved`; on a match against any session pin it deletes the pin and the next command for that session resolves to `TAB_CLOSED`.

`retry: false` because the same call against the same (now-gone) `tabId` will always fail; the agent must re-pin or open a new tab.

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
      "reason": "user_closed"
    }
  }
}
```

`details.reason` is a closed enum: `user_closed`, `page_closed`, `command_closed`, `window_closed`. Mapping rules and rationale are in [08-tab-management.md → `TAB_CLOSED`](./08-tab-management.md#tab_closed). Agents do not need to branch on `reason` — the recovery is identical for all four — but it is logged.

### `NO_TAB_TARGETED`

Trigger: the session has no pinned tab and the command is not a self-pinning command (`status`, `navigate`, `tab list`, `tab pin`, `tab open`, `tab unpin`, `tab close`). Self-pinning commands auto-resolve and never emit this code.

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
      "reason": "session_cleared"
    }
  }
}
```

`details.reason` is one of `unpinned` (explicit `tab unpin`), `session_cleared` (`chrome.storage.session` was reset by browser restart, extension reload, profile switch), `first_command_failed_to_resolve` (auto-pin tried but `chrome.tabs.query` returned no candidate — almost always means no Chrome window is open). The semantics are owned by [08-tab-management.md → `NO_TAB_TARGETED`](./08-tab-management.md#no_tab_targeted).

### `TAB_NOT_VISIBLE`

Trigger: `bproxy screenshot` (default mode) was called and the pinned tab is either not the active tab of its window or its window is minimized. The SW refuses to silently activate the tab (focus-steal) or to return a black PNG from a minimized window (the OS compositor stops compositing minimized windows; see [Chromium issue 41130703](https://issues.chromium.org/issues/41130703)).

`retry: conditional` because the agent can resolve the precondition: focus the pinned tab manually, un-minimize the window, or pass `--activate` (focus-steal opt-in) or `--debugger` (CDP opt-in, requires `bproxy service start --enable-debugger-mode`; the older `--enable-debugger-screenshots` is a deprecated alias).

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
      "reason": "not_active",
      "currentlyActiveTabId": 87
    }
  }
}
```

`details.reason` is one of `not_active`, `minimized`, `no_window`. The full rationale and the trade-offs of the three capture modes (default, `--activate`, `--debugger`) are in [08-tab-management.md → Screenshot capture](./08-tab-management.md#screenshot-capture).

### Daemon-related codes

The daemon's lifecycle (start, stop, restart, port discovery, multi-instance handling) is owned by [03-proxy-service.md → Service lifecycle](./03-proxy-service.md#service-lifecycle). Five codes in the table above touch the daemon; the disambiguation rule is:

| Situation                                                                          | Code                       |
|------------------------------------------------------------------------------------|----------------------------|
| `bproxy status` (or any pre-flight) finds no daemon to talk to (no PID file, or `ECONNREFUSED` on first probe). | `DAEMON_NOT_RUNNING`       |
| Mid-command `ECONNREFUSED` after the CLI had previously seen the daemon up.         | `PROXY_NOT_RUNNING`        |
| `bproxy service start` while a live daemon already owns the PID file.               | `DAEMON_ALREADY_RUNNING`   |
| `bproxy service start` spawned the daemon but the readiness probe (`/version`) timed out within 5 s. | `DAEMON_FAILED_TO_START`   |
| The configured port is held by a process that does not look like a bproxy daemon.   | `PORT_IN_USE`              |

`DAEMON_NOT_RUNNING` and `PROXY_NOT_RUNNING` are distinct on purpose: an agent treating "the daemon never started" the same as "the daemon vanished mid-conversation" loses information that affects how it reports the failure to the user. Both are `connection`-category and both are `retry: true`, but `DAEMON_NOT_RUNNING` carries `details.pidFilePresent: false` and `suggestedAction: "run \`bproxy service start\`"` whereas `PROXY_NOT_RUNNING` is the legacy spelling for "the request was refused on a port we expected to be live."

```jsonc
// DAEMON_NOT_RUNNING example
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

```jsonc
// PORT_IN_USE example
{
  "ok": false,
  "error": {
    "code": "PORT_IN_USE",
    "category": "connection",
    "retry": false,
    "suggestedAction": "pass --port <N> or stop the other process",
    "message": "Port 127.0.0.1:9615 is held by another process (not a bproxy daemon)",
    "details": { "port": 9615, "suggestedAlternativePort": 9616 }
  }
}
```

### `WRONG_PROFILE`

Trigger: a command's resolved `(session, tabId)` belongs to a Chrome profile that the session is not bound to. Common causes: the user pinned a Work tab under `--session default` and then ran a Personal-profile command under the same session; the session's binding was minted automatically against a profile that has since been unbound; two extensions raced the auto-bind for `--session default`.

Background and the full multi-profile model live in [03-proxy-service.md → Multi-profile WebSocket clients](./03-proxy-service.md#multi-profile-websocket-clients) and [08-tab-management.md → Profile-bound sessions](./08-tab-management.md#profile-bound-sessions).

```jsonc
{
  "ok": false,
  "error": {
    "code": "WRONG_PROFILE",
    "category": "target",
    "retry": false,
    "suggestedAction": "run `bproxy session bind <session> <profileId>` first, or pass a `--session` already bound to the right profile",
    "message": "Session 'default' is bound to profile 'Work' (p_1f3c9a); requested tab 87 is in profile 'Personal' (p_8b21d0)",
    "details": {
      "session": "default",
      "boundProfileId": "p_1f3c9a",
      "boundProfileLabel": "Work",
      "requestedTabId": 87,
      "requestedProfileId": "p_8b21d0",
      "requestedProfileLabel": "Personal"
    }
  }
}
```

`retry: false` because the binding mismatch is a configuration error, not transient. The agent's recourse is to choose a session bound to the right profile, or to rebind explicitly via `bproxy session bind`. The single-extension-per-profile invariant — that a session, once auto-bound, is locked to its profile until the user rebinds — is what prevents silent profile drift.

### Enterprise policy hint

When the daemon has **never** seen an extension connect since startup (an empty `extensionsByProfileId` map for the entire session lifetime, not merely "currently disconnected"), the next `NO_CONNECTION` envelope adds `details.hint` with the string:

> `"extension may be disabled by policy; check chrome://extensions"`

This handles the enterprise-Chrome `ExtensionInstallBlocklist` case ([Chrome Enterprise — ExtensionInstallBlocklist](https://chromeenterprise.google/policies/#ExtensionInstallBlocklist)) where the policy silently disables sideloaded extensions and the user otherwise sees only an opaque "extension never connects" symptom. The hint is best-effort — we cannot detect the policy directly from outside Chrome — but it is the right pointer for the actual cause.

The hint is **omitted** once any extension has connected at least once during the daemon's uptime; from then on `NO_CONNECTION` reverts to its standard `suggestedAction: "open the browser and reload the extension"`.

---

## Cross-references

- **Tab management.** `TAB_CLOSED`, `NO_TAB_TARGETED`, and `TAB_NOT_VISIBLE` are normative above; [08-tab-management.md](./08-tab-management.md) is the source of truth for the conditions that emit them.
- **Anti-bot / debugger mode.** `chrome.debugger` is shared infrastructure. The `--debugger` opt-in for screenshots and the `--trusted` opt-in for `click` / `type` / `navigate` attach to the same tab and share the `--enable-debugger-mode` service-start gate. `DEBUGGER_DISABLED` and `DEBUGGER_UNAVAILABLE` are the canonical codes for the gate and for attach failures; the `Runtime.enable`-avoidance constraint is documented in [04-extension.md → Debugger mode](./04-extension.md#debugger-mode-trusted-events-and-cdp-screenshots).
- **Testing.** Every code in [§ Canonical error code table](#canonical-error-code-table) is a row in the integration matrix in [10-testing.md](./10-testing.md). The matrix asserts (a) every code is reachable from at least one fixture, (b) deprecated codes never appear on the wire, (c) `details` shapes match the documented schema per code.
