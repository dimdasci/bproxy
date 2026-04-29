# 12. Technical Risks

[← Index](./README.md) · Prev: [Implementation Order](./11-implementation-order.md)

---

Known risks identified during design review, their mitigations, and residual concerns.

## Mitigated risks

These risks have been identified and addressed in the technical solution.

### MV3 service worker termination kills WebSocket

**Risk**: Chrome terminates MV3 service workers after ~30s of inactivity. The WebSocket connection drops. Commands arriving during the gap get `NO_CONNECTION` errors. Since agent think-time routinely exceeds 30s, this would happen on nearly every command.

**Mitigation**: The proxy holds commands and waits for the extension to reconnect instead of failing immediately. SW wakeup + WS reconnect takes ~200–600ms — well within the 30s command timeout. See [Proxy Service → Why queue instead of fail-fast](./03-proxy-service.md#why-queue-instead-of-fail-fast).

**Residual**: If the browser is genuinely closed (not just SW sleeping), the proxy holds the command for the full timeout before failing. This adds latency to a clear error. Acceptable trade-off — the 30s timeout covers both cases.

### CSP blocks inline script injection

**Risk**: The original `eval` implementation injected a `<script>` tag with inline code. Sites with Content Security Policy (no `'unsafe-inline'`) silently block this — including GitHub, banking sites, and Google properties.

**Mitigation**: `eval` now uses `chrome.scripting.executeScript({ world: 'MAIN' })`, which bypasses page CSP entirely. Same fix applied to network interception (`wait --network`). See [Extension Internals → eval](./04-extension.md#eval-in-the-main-world).

**Residual**: None. The Chrome API is the correct mechanism for this.

### SPA navigate via pushState doesn't trigger routers

**Risk**: `history.pushState()` changes the URL but doesn't trigger React Router, Vue Router, etc. The URL updates but page content stays the same.

**Mitigation**: `navigate` always uses `chrome.tabs.update()` for full navigation. SPA-internal navigation is done by clicking links (`bproxy click`), which is how a real user would do it. See [Page State → Navigate command](./05-page-state.md#navigate-command).

**Residual**: Full navigation on same-origin URLs is slower than a true SPA transition. Acceptable — reliability over speed.

### Settle detection never reaches "ready" on animated pages

**Risk**: The MutationObserver watched all mutations including attribute changes. CSS animations, framework state management, and transition classes generate constant attribute mutations, preventing the page from ever reaching "ready" state. `navigate` would timeout on these pages.

**Mitigation**: Two changes:
1. MutationObserver now excludes `attributes` — only watches `childList` and `characterData`. Meaningful content changes almost always involve these; attribute-only changes are noise.
2. `navigate` uses a two-tier wait: hard wait for load, then a 3-second soft cap on settle. If the page doesn't settle in 3s, it returns with `state: "settling"` instead of timing out. See [Page State → Two-tier wait](./05-page-state.md#two-tier-wait).

**Residual**: Pages that continuously add/remove DOM nodes (chat apps, live feeds) will still never settle. The agent must use `wait --selector` for specific content on these pages. This is documented in the `WAIT_TIMEOUT` hint.

### Content script injection race condition

**Risk**: After injecting `content.js` via `chrome.scripting.executeScript`, the background immediately retries `sendMessage`. The message can arrive before the content script has registered its `onMessage` listener, causing a silent failure.

**Mitigation**: Content script sends `chrome.runtime.sendMessage({ type: 'bproxy-ready' })` on load. Background waits for this ack before retrying the command. See [Extension Internals → Content script communication](./04-extension.md#content-script-communication).

**Residual**: None. Standard pattern for extension communication.

### Busy indicator false positives

**Risk**: Substring matching on class names (`[class*="loading"]`, `[class*="spinner"]`) matches unrelated elements — documentation about spinners, shipping company "loading dock" sections, etc.

**Mitigation**: Narrowed heuristics to specific class names (`.spinner`, `.loader`, `[class*="skeleton"]`) with visibility AND size checks. Elements larger than 600×600px are skipped. See [Page State → Busy indicator detection](./05-page-state.md#busy-indicator-detection).

**Residual**: Some false negatives — custom loading indicators with non-standard class names won't be detected. Agent falls back to `wait --selector` or `wait --hidden`. False negatives are much safer than false positives.

### Screenshot requires active tab

**Risk**: `captureVisibleTab` captures whatever is currently visible, not a specific tab. Screenshots of background tabs return the wrong content.

**Mitigation**: Background script activates the target tab (`chrome.tabs.update(tabId, { active: true })`) before capturing. See [Extension Internals → Screenshot flow](./04-extension.md#screenshot-flow).

**Residual**: Tab switch is visible to the user. Acceptable for a dev tool.

### Selector generation reliability

**Risk**: Auto-generating unique CSS selectors for `elements` is fragile — duplicate IDs, dynamic IDs (React: `r-abc123`), deeply nested DOMs.

**Mitigation**: Priority-based fallback: `#id` (if truly unique) → `[data-testid]` → `[name]` → `[aria-label]` → shortest unique CSS path. Skip dynamic-looking IDs. See [CLI Design → elements](./02-cli-design.md#bproxy-elements).

**Residual**: Some pages will still produce fragile selectors. This is inherent to CSS selector generation. `eval` is the escape hatch for pages where auto-selectors fail.

## Accepted risks (not mitigated)

### Network interception ordering

`wait --network` patches `window.fetch` and `XMLHttpRequest.prototype.send`. If the page's own code stores a reference to the original `fetch` before our patch runs (e.g., in a module-scoped variable during initial load), those requests are invisible to our interception.

**Impact**: `wait --network` may report "idle" while untracked requests are still in flight. Low probability — most code calls `fetch` at call time, not from a cached reference.

**Workaround**: Agent can combine `wait --network --selector ".results"` to add a content-based check alongside network idle.

### Shadow DOM

`querySelector` doesn't pierce shadow roots. Elements inside shadow DOM (used by web components, some GitHub UI, Material components) are invisible to `elements`, `click`, `text`, etc.

**Impact**: Some interactive elements can't be discovered or targeted. Affects a growing number of sites as web components gain adoption.

**Workaround**: `eval` with custom traversal code can reach into shadow roots. A `deepQuerySelector` helper could be added later as a content script utility if this becomes a frequent problem.

### Iframes

Content scripts can be injected into iframes via `all_frames: true` in the manifest, but command routing becomes complex — which frame receives the click? Currently, commands target the top frame only.

**Impact**: Elements inside iframes (ads, embedded widgets, some payment forms) can't be interacted with.

**Workaround**: `eval` can access same-origin iframes. Cross-origin iframes are a hard boundary. Could add `--frame` targeting later if needed.

### Multiple browser windows

The proxy accepts exactly one WebSocket connection. If a user has multiple Chrome windows (each with the extension), only the most recently connected one is controlled. Switching requires closing/reopening the extension or browser.

**Impact**: Low. The typical use case is one browser, one agent. Multi-window support can be added later with a window-selection mechanism.
