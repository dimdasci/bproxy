# Anti-bot detection: MV3 extension vs CDP-based tools

Date: 2026-05-12
Status: reference / analysis memo (informs future ADRs on input strategy and `web_accessible_resources` policy; not itself a decision)

## Summary

- **Perspective shift to sensor+actuator.** The extension stays thin: it exposes capabilities honestly (shadow-aware reads, MAIN-world capability, multiple write methods) and never strategizes internally. The agent owns selector, world, and method choice per call. No discovery state, escalation, or caches in the extension; caching belongs at the proxy keyed by request shape.

- **Legitimate content-mutation path for rich-text editors.** PoC 3 validated that page-owned editor instances (Quill's `__quill`, analogs for Lexical / ProseMirror / TipTap / Slate / etc.) expose public APIs whose intended use is programmatic mutation. `quill.setText(value, 'api')` is the honest, attributed, structurally-clean alternative to synthetic input events — white-hat use of documented interfaces, not impersonation.

- **Extension-agent contract must support this.** The action protocol exposes **three explicit write methods** — `direct` (state in DOM), `paste` (state in event-driven framework), `runtime-api` (state in editor instance) — plus explicit `world: 'isolated' | 'main'`. Read primitives (`dom`, `elements`) surface the markers the agent needs to pick correctly. **Agent guidance for method selection is captured as a skill, not as extension logic.** ADRs to draft: three-method input strategy, MAIN-world hygiene contract, `web_accessible_resources` default-deny.

## Why this exists

After PoC 3 (`2026-05-08-poc-paste-fill.md`) validated that on-demand MAIN-world execution is required for hostile editors, the design briefly drifted toward putting discovery intelligence (shadow-host graph, tiered escalation, hostile-editor classifier) inside the extension. The correction: the extension is a thin sensor+actuator and the calling agent owns all discovery and planning decisions. The agent compares a screenshot against a DOM snapshot and decides what to probe next; the extension just answers honestly.

That correction raised a validation question: *if the extension is a thin layer that does no automation-style instrumentation, what is the essential difference between us and the existing approaches (Playwright via CDP, user-opened Chrome DevTools)? And specifically — what makes anti-bot protection (Cloudflare, Datadome, HUMAN, Akamai) treat them as bots and not us?* This memo captures the answer so future ADRs on input strategy and surface minimization can cite a single grounded reference.

## The essential difference

CDP-based tools (Playwright, Puppeteer, the user-opened DevTools) are an **inspector attached to the page's V8 isolate**. Their power and their detectability come from the same fact: they enable the `Runtime`, `Debugger`, and `Page` domains, evaluate scripts inside the page's own world, and dispatch input through the browser-process input pipeline so events arrive as `isTrusted === true`. The inspector itself is observable from inside the page.

Our bproxy extension is the opposite: a normal, signed Chrome extension with no inspector attached, executing `chrome.scripting.executeScript` into an **ISOLATED world** that is unreachable from the page's `window`, with optional one-shot MAIN-world entries that leave nothing persistent behind, and emitting `isTrusted === false` paste-flavored events.

The detection asymmetry that follows:

- **CDP is detected structurally.** One probe (e.g., the Runtime.enable error-serialization leak) is sufficient to flag every CDP-driven session globally. Detection is cheap and broad.
- **Our extension is detected only behaviorally.** The signals exist (mainly `isTrusted=false` and event-sequence shape), but they only fire when *the specific page handler we touch* chooses to inspect them. Detection is per-handler and per-action.

This is the load-bearing distinction. It means the entire "is an inspector attached?" family of probes — the one Cloudflare and Datadome have invested most heavily in for 2024–2026 — returns negative on us by construction, because no inspector *is* attached.

## What CDP-based tools expose (and we don't)

- **`navigator.webdriver === true`** — set by `--enable-automation`, which Playwright/Puppeteer pass by default. We don't launch Chrome; the user does.
- **The Runtime.enable execution-context-created leak (Castle's canonical signal).** Anti-bots create an Error with a custom getter on `.stack`, then `console.debug(err)`. When a CDP client has `Runtime.enable` active, the inspector serializes the error for the console and trips the getter. V8 partially patched the getter-side-effect path in May 2025, but adjacent variants (toString getters on `name`, source-position leaks via `Error.stack`) still work for Puppeteer/Playwright. No inspector ⇒ nothing trips.
- **Stack-string URL leaks.** Puppeteer's `__puppeteer_evaluation_script__`, Playwright's `pwuser` / `__playwright_utility_world__` appear inside `new Error().stack` and `(function(){}).toString()` for injected bindings. None of these strings exist in our isolated/MAIN execution.
- **`Function.prototype.toString` "toString-on-toString" probes.** CDP overlays patch native functions; checking that `eval.toString().length` matches the V8 baseline catches stealth shims. Our isolated-world content scripts don't patch page-context natives at all.
- **`debugger;` statement timing.** With DevTools or any CDP client paused-on-statement available, a `debugger` keyword measurably stalls execution; `performance.now()` deltas across `debugger;` betray attachment.
- **`window.chrome` trimming.** Vanilla Chrome populates `chrome.loadTimes`, `chrome.csi`, and a full `chrome.runtime` enum surface. Headless and many CDP-launched contexts trim these; missing `chrome.csi` with a Chrome UA is a classic FingerprintJS/BotD tell. We run real user Chrome, so all of it is present.
- **`navigator.permissions.query({name:'notifications'})` vs `Notification.permission`** consistency. In headless these disagree; on us they don't.
- **`HeadlessChrome` UA substring** and the missing automation-infobar viewport delta.
- **CDP-dispatched input fingerprint.** `Input.dispatchMouseEvent` produces `isTrusted === true` but with perfect linear trajectories, no `pointerrawupdate`, no coalesced events, identical `movementX/Y` deltas, missing tilt/pressure on Pointer events.
- **DevTools-open probes** (the `devtools-detector` console-getter trick, viewport-delta on `outerHeight - innerHeight`) hit user-opened DevTools even without automation.

What does *not* discriminate CDP from us: **TLS JA3/JA4 and HTTP/2 SETTINGS frame ordering** are driven by Chrome's network stack itself. Both Playwright-launched Chrome and our user-launched Chrome show real-Chrome JA4. Network fingerprint is a wash.

## What our MV3-extension approach still exposes

The residual surface is real but narrower. Honest list:

- **`event.isTrusted === false`** on every synthetic input we dispatch. This is the **load-bearing risk**. `chrome.scripting.executeScript` cannot produce trusted events; only `chrome.debugger`'s `Input.dispatchKeyEvent` can, and we are explicitly refusing to attach the debugger by default. Any page handler that does `if (!e.isTrusted) return` will reject our input.
- **Event-sequence shape.** A paste-flavored `InputEvent({inputType:'insertFromPaste'})` lacks the preceding `keydown` → `keypress` → `beforeinput(insertText)` → `keyup` chain that real typing produces. `selectionchange` cadence is non-human.
- **Extension-ID enumeration.** Even without a declared `web_accessible_resources`, our extension is reachable via timed `fetch('chrome-extension://<id>/manifest.json')` or via favicon timing. Datadome's Extension-Detector explicitly profiles installed extensions this way.
- **DOM polling cadence.** A fixed `setInterval(poll, N)` is a behavioral tell if `N` is constant.
- **Focus/visibility tells.** `document.hasFocus()` and `document.visibilityState` reflect reality. Input arriving at a `visibilityState === 'hidden'` tab is humanly impossible.
- **Clipboard absence on paste.** A real paste reads from the OS clipboard; sites that call `navigator.clipboard.readText()` from their own paste handler will see different content (or a permission prompt) than what landed in the field.
- **`PointerEvent` absence** on click-to-edit and focus transitions.
- **MAIN-world one-shot footprint while it runs.** The world is fresh per call, but during execution the page's V8 sees an extra script compilation. If our injected `func` throws and the page has pre-installed an `Error.prepareStackTrace` hook, it can capture a `chrome-extension://<id>/` URL from the stack.

## Net assessment

**Where we win, decisively.** The structural CDP-detection family returns negative on us:
- `navigator.webdriver` is false.
- `Runtime.enable` is not active.
- No `pptr://` / `__playwright_utility_world__` strings in any stack the page can reach.
- `chrome.loadTimes` / `chrome.csi` / `chrome.runtime` are the real Chrome ones.
- `navigator.permissions` ↔ `Notification.permission` are consistent.
- JA3/JA4 and H2 SETTINGS are stock-Chrome.
- No `HeadlessChrome` UA, no automation infobar, no `debugger` stall.

**Where we still bleed.** `isTrusted=false`, input-sequence shape, extension-ID enumeration, and the few-millisecond window during a MAIN-world one-shot. None of these are visible *unless the page actively listens on the specific handlers we touch*; most general fingerprinting passes (creepjs, BotD's static probe set) do not gate on `isTrusted` because real users sometimes trigger non-trusted events via assistive tech. Targeted form handlers on hard sites (login, checkout) do check `isTrusted`.

## Implications for design (future ADR seeds)

1. **`isTrusted` defines our practical write strategy.** Paste-flavored writes work everywhere *except* sites with handlers that gate on trust. For those, the only structural answer is `chrome.debugger`-driven `Input.dispatchKeyEvent` (yellow banner, opt-in via `--trusted` / `--debugger`). The agent should be able to ask "does this handler reject untrusted events?" and choose between paths. This is exactly the sensor+actuator framing: extension exposes both, agent picks. → seed for an ADR on input strategy.

2. **Don't fake the typing chain alongside the paste.** A synthetic full `keydown`/`keypress`/`keyup` chain dispatched together with a paste is *more* detectable than a clean paste, because real pastes have no keydown sequence. Counterintuitive but important.

3. **MAIN-world entries need to be hygienic.** No identifying strings in the function body, all errors caught inside the function, never let a `chrome-extension://` URL escape into a stack the page can observe. This is a concrete contract on every MAIN-world helper. → belongs in the extension solution spec when the MAIN-world capability is documented.

4. **Don't ship `web_accessible_resources`** unless something forces it. It is the cheapest extension-ID disclosure vector and the one Datadome's Extension-Detector relies on most. → seed for a future ADR explicitly forbidding `web_accessible_resources` by default, with a documented carve-out process.

5. **Jitter polling and respect visibility.** DOM polling intervals should jitter (not a fixed cadence), and `executeScript` should bail when `document.visibilityState === 'hidden'` unless the call is explicitly user-initiated. Removes both the constant-cadence tell and the "input while hidden" tell.

## State-location taxonomy and the action protocol

A generalization of the PoC 3 finding, surfaced once we asked "if Quill works this way, what about non-Quill targets?". Write targets sort into three shapes by where the page's authoritative state lives:

| Where state lives | Authority | Write technique | DOM events fired |
|---|---|---|---|
| In the DOM | `element.value` / `element.textContent` *is* the state. Plain HTML forms, bare `[contenteditable]`. | `el.value = v` / `el.textContent = v` | none |
| In a documented editor API | Editor instance pinned to host (`__quill`, `__lexicalEditor`, ProseMirror / TipTap / Slate / CodeMirror / Monaco analogs). | `editor.setText(v)` and editor-specific equivalents | none from our code; editor's internal callbacks only |
| In a framework reacting to events | Framework variables populated by `input` / `change` handlers. React / Vue / Angular controlled inputs whose submission reads framework state. | Native-setter trick + `dispatchEvent('input')` | `input` with `isTrusted=false` (always, by definition — JS-dispatched events are untrusted) |

The `isTrusted=false` signal is not an obstacle we engineer around. It is a true property of JS-dispatched events and only arises in the third bucket because the framework's interface IS event-shaped. Buckets 1 and 2 produce no DOM events from our code at all. This generalizes the PoC 3 finding: Quill is one instance of the second bucket; Lexical, ProseMirror, TipTap, Slate, Draft.js, CodeMirror, Monaco follow the same pattern with their own runtime-handle markers and API surfaces.

### Three methods in the action protocol

The action protocol therefore exposes **three explicit `method` values**, one per state-location bucket:

- **`method: 'direct'`** — set `.value` / `.textContent` directly; dispatch nothing. Plain HTML forms, bare contenteditable. Zero DOM events. ISOLATED world.
- **`method: 'paste'`** — native-setter (`HTMLInputElement.prototype` value descriptor) + `dispatchEvent('input')`. React / Vue / Angular controlled inputs that submit via framework state. ISOLATED world.
- **`method: 'runtime-api'`** — call the editor's public API (Quill `setText`, Lexical `editor.update`, etc.). MAIN world for runtime-handle access. No DOM events from the API call itself.

No `'auto'` value. No internal escalation in the extension. The agent inspects the target via the `dom` / `elements` probe (framework markers on ancestors, parent-form shape, runtime-handle presence) and picks per call.

### Agent guidance lives in a skill

The decision tree — "which method for this target?" — is **not** in the extension. It is documented as an **agent skill**, describing how to read the read-primitive output and choose. The extension stays a sensor+actuator that executes whichever method it is told. The skill is what agents load and apply; the extension contract is the three methods plus the read primitives that inform the choice.

## Sources

- [Why a classic CDP bot detection signal suddenly stopped working — Castle (Aug 2025)](https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/)
- [How V8 leaks your headless browser's identity — svebaa.github.io](https://svebaa.github.io/personal/blog/cdp-fingerprinting/)
- [How to fix Runtime.Enable CDP detection — Rebrowser](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries)
- [rebrowser/rebrowser-bot-detector — modern Playwright/Puppeteer leak tests](https://github.com/rebrowser/rebrowser-bot-detector)
- [Playwright Anti-Bot Detection: What Works (2026) — AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)
- [Best Playwright Stealth 2026 vs Cloudflare & Akamai — Scrapewise](https://scrapewise.ai/blogs/playwright-stealth-2026)
- [How to Bypass FingerprintJS in 2026 — Roundproxies](https://roundproxies.com/blog/bypass-fingerprintjs/)
- [Detecting Hidemium: Fingerprinting inconsistencies in anti-detect browsers — Castle](https://blog.castle.io/detecting-hidemium-fingerprinting-inconsistencies-in-anti-detect-browsers/)
- [Datadome Extension-Detector](https://datadome.co/anti-detect-tools/extension-detector/)
- [chromium-dev: isTrusted from content scripts](https://groups.google.com/a/chromium.org/g/chromium-dev/c/94t2J_Jylyw)
- [MDN: Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)
