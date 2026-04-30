# Default instrumentation strategy

Date: 2026-04-30
Status: open question, pending pivot decision

## Context

The tech-solution docs (committed at `9eab66b`) describe a default extension behaviour that injects content scripts and a MAIN-world network shim into every page the user visits, runs a MutationObserver on `document.documentElement` whenever a tab is targeted, and patches `history.pushState`/`replaceState` to detect SPA navigations synchronously.

When discussing anti-bot detection, the question came up: **why is the default so heavy?** That led to two distinct design concepts for the same system. This entry captures both before we decide which direction to pivot toward.

The deciding factor is the **assumed agent model**:

- If the agent is the primary actor (Playwright replacement): heavy default is justified.
- If the user is the primary actor and the agent does data reads + occasional batch work: heavy default is overkill.

## Concept A — Heavy default (current docs)

The extension is fully instrumented on every page the user visits. All capabilities are available on first command without setup latency.

### What it includes
- Declarative content scripts in the manifest with `all_frames: true`, `run_at: "document_start"`.
- MAIN-world network shim wrapping `fetch` / `XHR` / `sendBeacon` / `EventSource` / `WebSocket`, injected at `document_start` so it wins the race against page bundles caching `window.fetch`.
- History API patching (`pushState` / `replaceState`) for synchronous SPA detection.
- MutationObserver on `documentElement` with full options when settle is observed.
- Native-`toString` preservation on wrappers to defeat the cheapest fingerprint check.
- Per-domain disable (`bproxy domain set ... --no-network-shim`) as an escape hatch.

### What it enables
- `bproxy wait --network` (page is quiet) and `bproxy wait response <urlPattern>` (specific request returned) work on any tab without setup.
- `bproxy wait settle` works as a global page-quiescence signal.
- SPA navigation is detected synchronously, even when a click handler does `pushState` + render in one tick.
- First command on any tab has no extra latency from injection.
- Auto-reinjection on navigation is automatic (manifest-declared scripts run on every load).

### Costs
- **Fingerprint surface.** Every patched global is a detection signal. Cloudflare et al. can compare `fetch.toString()` to its native form, probe for our shim's side-effects, observe the listener attached for `bproxy:locationchange`. Native-`toString` mitigation closes the cheapest check; sophisticated detectors can dig deeper.
- **Performance.** MutationObserver, network counters, history wrappers run on every tab the user has open — including tabs the agent will never touch. CPU cost is real on busy pages (live dashboards, chat apps).
- **Reach.** The extension touches pages the user is just browsing. Privacy-adjacent: the extension *could* observe activity on those pages even if it doesn't.
- **All-or-nothing.** The per-domain disable softens this but inverts the model — disabling on hostile domains assumes you can enumerate them in advance.

### When this fits
- Agent drives interactions broadly (clicks, types, multi-step flows on many sites).
- Sites the agent touches have heavy SPA behaviour and complex network patterns.
- The user is comfortable with the extension being broadly active.

## Concept B — Minimal default, opt-in capabilities (the reframe)

The extension is mostly invisible until the agent explicitly targets a tab. Capabilities turn on when asked.

### What it includes
- Manifest declares `host_permissions` only; **no declarative content scripts**.
- Programmatic injection via `chrome.scripting.executeScript` only when the agent first issues a command on a tab. Costs ~50–100 ms latency on first command per tab.
- Network shim is **opt-in**: only injected when the agent calls `wait --network`, `wait response`, or `wait navigation` on a SPA. For pure read flows, never installed.
- MutationObserver runs only when `wait settle` is called. Auto-wait on `click`/`type` checks per-element local stability instead.
- History patching falls back to `chrome.webNavigation.onHistoryStateUpdated` (background-side, invisible to the page). Loses synchronous detection of synchronous-pushState-and-render, which is rare for read flows.
- Per-session **mode flag**: `--mode read` (default, minimal footprint) vs `--mode interact` (full instrumentation).
- Pacing: `--pacing human|fast` adds 1–3 s jitter between batch operations to avoid timing-shaped detection.
- Human-in-the-loop hand-off: `bproxy require-human <reason>` surfaces a desktop notification for login / CAPTCHA / consent screens, blocks until the user confirms, then resumes.

### What it enables
- Pages the user is browsing carry zero bproxy footprint until the agent acts on them.
- Bot score on read-mostly flows drops dramatically because there are no wrapped globals to detect, no extra observers running, no MAIN-world script to fingerprint.
- The agent's design naturally splits: read mode for the autonomous-batch and data-extraction use case, interact mode for the rare cases that need synthetic input.
- Login, CAPTCHA, consent are no longer a problem to solve — they are handed back to the human, who is already at the keyboard.

### Costs
- **First-command latency** per tab (~50–100 ms) for programmatic injection. Negligible in interactive use, noticeable in tight batch loops if not amortized.
- **Lost capabilities by default.** `wait --network`, `wait response`, global settle, synchronous SPA detection are not available unless the agent opts in. Most read flows do not need these, but flows that do must explicitly enable them.
- **More state to manage.** Sessions now have a mode; the agent must know which mode it is in (or the user picks at session start).
- **Auto-reinjection on navigation needs explicit handling** in the SW (listen for `chrome.webNavigation.onCompleted` and re-inject into pinned tabs).
- **Recipe library required** for URL-first navigation patterns to be worth the effort (e.g., Google pagination via `?start=20` rather than clicking "Next"). Without recipes, this is just docs — the agent still clicks.

### When this fits
- The user is in front of the browser doing the high-friction interactive work.
- The agent's primary job is reading data, copy-paste relief, and bounded autonomous batch tasks.
- Detection avoidance matters because the agent will operate on protected sites (search engines, social, e-commerce).

## Driving scenarios

Two concrete use cases inform concept B and live in their own document: [`docs/scenarios.md`](../scenarios.md).

- **Google topic research** — URL-driven happy path. The whole flow runs in read mode with `navigate` + `text` only; no clicks, no scroll, no shim. Validates that read mode covers a substantial autonomous workflow with effectively zero bot-detection footprint.
- **LinkedIn daily feed snapshot** — SPA + lazy-loaded feed. Adds a `scroll` primitive (ISOLATED-world `window.scrollBy` + DOM polling, no MutationObserver) and surfaces three escape hatches kept on the shelf for incremental escalation: permalink-driven full-body retrieval, `chrome.debugger` trusted scroll, and the Voyager internal API.

New scenarios should be added to `scenarios.md`; this journal only tracks the design-process reasoning behind them.

## Confirmed requirements (2026-04-30)

These two requirements are confirmed for concept B regardless of which mode becomes the default:

### 1. Human-pace throttling

A built-in primitive, not an agent responsibility. Every agent that reuses bproxy should not have to reinvent jitter.

- `--pacing human` (default for `--mode read`): inserts a randomised delay before each `navigate` and before each pagination request. Default range: 1.5–4 s for navigations, 0.8–2 s for paginations. Configurable per session.
- `--pacing fast`: no enforced delay. Used for trusted internal tools or when the user accepts the risk.
- Pacing is enforced by the daemon, not the CLI, so a hot loop in the agent can't accidentally bypass it.
- **Why:** the only meaningful detection signal that survives the read-mode design is request rate. Pacing is the cheapest mitigation and one of the highest-leverage.

### 2. CAPTCHA / sign-out detection with human hand-off

The agent must receive a structured, terminal feedback when continuing autonomously is no longer safe — and must hand control back to the user immediately.

- The extension watches for known interstitials after every `navigate` and DOM read: Google "unusual traffic," Cloudflare Turnstile, hCaptcha, generic "sign in to continue" pages, consent walls.
- Detection is content-based (text / title patterns + a small recipe library per high-traffic site), not behavioural.
- On detection, the in-flight CLI command terminates with a structured error: `code: HUMAN_REQUIRED`, `category: policy`, `retry: conditional`, `details: { reason: "captcha" | "signin" | "consent" | "rate_limit" | "unknown_interstitial", url, hint }`.
- The agent's loop reads `HUMAN_REQUIRED` and stops — no further commands are issued in that session until the user confirms.
- Hand-off is surfaced via a desktop notification ("agent paused: CAPTCHA on google.com") and a `bproxy session status` view. The user resolves the interstitial in the actual browser, then sends `bproxy session resume <name>` to release the agent.
- **Why:** retrying through a CAPTCHA is the worst possible behaviour — it confirms to the bot detector that something automated is at the keyboard. The agent must see this and stop, not paper over it.

These two requirements together turn read mode from "less detectable" into "intentionally cooperative with bot detection" — the agent moves at human pace and explicitly defers to the human at every interstitial.

## Hybrid considerations

The two concepts are not mutually exclusive at the system level. Both can coexist behind the mode flag:

- `--mode read` is concept B's behaviour.
- `--mode interact` is concept A's behaviour.
- A session declares which it is at start; the agent doesn't have to know.

This is probably the realistic landing point. The pivot question is not "A or B" but **"which is the default?"**

## Outstanding questions

1. Default mode — read or interact? Argument for read: matches the stated use case, lower default fingerprint, less surprising for the user. Argument for interact: matches the current doc, no migration cost, parity with Playwright-style expectations.
2. Should `bproxy require-human` block the calling CLI command (synchronous) or return immediately and the agent polls? Synchronous is simpler agent code; async fits longer human-attention windows.
3. Does the network shim need a third state — `injected-but-inert` — for sessions that want fast switchover from read to interact mid-flight without a per-tab inject delay?
4. How is "first command on a tab" defined when sessions span SW restarts? The pinned-tab map is in `chrome.storage.session` and survives SW restart but not browser restart; that boundary needs spelling out under either concept.
5. Per-domain config (`bproxy domain set`) currently disables shim/observer on a domain. Under concept B it would conversely *enable* them on selected domains. Same primitive, inverted default — worth confirming the UX is not confusing.

## Decision log

- **2026-04-30** — both concepts captured. No pivot committed. Continuing reflection.
- **2026-04-30** — Google-search worked example added. Validates that read mode covers a substantial autonomous use case with effectively zero bot-detection footprint when paired with URL-first navigation.
- **2026-04-30** — Two requirements confirmed regardless of default-mode decision: (1) daemon-enforced human-pace throttling, (2) interstitial detection with `HUMAN_REQUIRED` structured error and explicit `session resume` hand-off. These belong in concept B's spec.
- **2026-04-30** — LinkedIn snapshot scenario added. Surfaces a third confirmed primitive for read mode: `bproxy scroll` with ISOLATED-world implementation (`window.scrollBy` + DOM polling, no MutationObserver). CLI surface stays narrow — agents pass intent (`--by`, optionally `--until-stable`); the extension owns the human-shaped behaviour governed by the session's `--pacing` setting.
- **2026-04-30** — Worked-example sections moved out of this journal into `docs/scenarios.md`. The journal stays focused on design reasoning; scenarios accumulate as a separate growing document.
- **2026-04-30** — MVP posture confirmed: ship read mode + paced `scroll` + DOM polling + `HUMAN_REQUIRED` first; the three LinkedIn escape hatches (permalink retrieval, `chrome.debugger` trusted scroll, Voyager API) stay on the shelf and only earn their cost when real usage shows the basic loop is insufficient. Avoids over-engineering ahead of usage signal.
- **2026-04-30** — Form-fill scenario added (Scenario 3 in `scenarios.md`). Sharpens the meaning of "interact mode": it is read mode plus a small set of paste-shaped write primitives (`fill`, `fill-form`, `select`, `elements --form`, `require-human --for-attach`), not a wholesale switch into concept A's heavy instrumentation. Concept A may not have a separate identity at all — there is just one default mode (read mode) with write primitives that turn on when used.
- **2026-04-30** — Paste-as-default established. Earlier reasoning assumed paced character-by-character typing was the realistic primitive; correction: real humans paste from saved info docs / resumes / LinkedIn / templates and never type their CV. `bproxy fill` defaults to paste-flavored input events (`inputType: "insertFromPaste"`); per-character typing is opt-in. The session's `--pacing` value governs delay between fields, not within fields.
- **2026-04-30** — "Don't submit" handoff confirmed as load-bearing for write-heavy flows. Agent prepares the form; user reviews and clicks submit. The user-driven submit is `isTrusted: true` and often offsets any lower bot score from the fill behaviour. Mirrors the "agent prepares, user digests" posture from the read scenarios — consistent project-wide pattern of agent-as-preparer-not-actor.
