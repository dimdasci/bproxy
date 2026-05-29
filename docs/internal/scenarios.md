---
title: Scenarios
---

These scenarios drive the design choices captured in [`journal/2026-04-30-default-instrumentation-strategy.md`](./journal/2026-04-30-default-instrumentation-strategy.md). Each shows how the agent runs end-to-end and what bproxy primitives it needs. New scenarios should be added here as they surface.

The framing assumption across all scenarios: **the user is in front of the browser**. The agent does data reads, copy-paste relief, and bounded autonomous batch work. Login, CAPTCHA, and consent screens are handed back to the human via `HUMAN_REQUIRED`.

---

## Scenario 1 — Google topic research

User opens Google, signed in with their real account. They ask the agent to compile a shortlist of recent job postings on a topic.

### Agent flow

1. **Plan (no browser activity).** LLM produces a list of search queries and parameters (time filter, language, location, pagination cap).
2. **Execute each search via URL.** `bproxy navigate --url "https://www.google.com/search?q=...&tbs=qdr:w&hl=en&start=0" --session research`. Google search is fully URL-driven — every parameter the human sets in the UI maps to a query-string field (`q`, `tbs`, `hl`, `gl`, `start`, `num`, `lr`).
3. **Read SERP.** `bproxy text --selector main --session research` returns rendered SERP text. The LLM extracts `[{title, url, snippet, source}]` directly from the text — no need to teach bproxy Google's selector schema.
4. **Paginate via URL.** `&start=10`, `&start=20`. Never click "Next."
5. **Compile shortlist.** Pure LLM work: dedupe URLs across queries, rank by relevance and recency.
6. **Optional deep read.** For each candidate URL, `navigate` + `text` again. Still URL-driven.

### What Google sees

| Signal | This flow | Risk |
|---|---|---|
| `isTrusted: false` events | None — no events are ever dispatched | zero |
| Wrapped `fetch` / `history` / etc. | None in read mode | zero |
| `navigator.webdriver` | `false` (real Chrome) | zero |
| TLS / cookies / session | User's real Google account | zero |
| Page load rate | One per query/page | flaggable if too fast — needs pacing |
| Pagination depth | Capped at 3 pages | low |
| Topical query clustering | Variations of one theme | shape-flagged on long runs |

The remaining detection vector is **timing and frequency**, not content. Pacing addresses 95% of it; the residual is Google's "unusual traffic" rate limiter, which fires for real users too.

### Capabilities the flow uses

- `bproxy navigate --url <url> --session research` — full navigation, not pushState.
- `bproxy text --selector <selector> --session research` — ISOLATED-world DOM read.
- `bproxy require-human --reason <reason> --session research` — for the rare CAPTCHA / sign-out interstitial.

### Capabilities the flow does *not* use

- No `bproxy click` or `bproxy type` — never dispatches a synthetic event.
- No MAIN-world shim — never wraps `fetch` / `history`.
- No MutationObserver — server-rendered SERPs are complete on `load`.
- No Phase 4 trusted-input mode — no synthetic events to make trusted.

### Why this works

Google search is URL-driven for everything. Reads happen against a server-rendered SERP through ISOLATED-world DOM access. The agent never has to dispatch an event on a Google page, so there is nothing for `isTrusted` checks to flag and nothing for function-tampering probes to find.

---

## Scenario 2 — LinkedIn daily feed snapshot

User opens LinkedIn home (signed in), bound to the `li-snapshot` session (for example, `bproxy session bind --tab-id 123 --pacing human --session li-snapshot`). They ask the agent to capture today's feed: who posted what, with truncated bodies and permalinks, ready for the user to digest.

### Why LinkedIn is harder than Google

1. **It's a SPA with lazy-loaded feed.** No `?start=20` equivalent. Posts load only when scroll position approaches them — LinkedIn's page uses an IntersectionObserver to fire Voyager API requests as the user scrolls. **No scroll, no posts.**
2. **The feed truncates post bodies.** Long posts show ~3 lines + "see more." Full text isn't in the DOM until either the user clicks "see more" or navigates to the post's permalink page.
3. **LinkedIn's bot detection watches scroll behaviour.** Scroll velocity, pause patterns, reverse-scroll moments, and tab visibility (`document.hidden`) are part of their signal. A perfectly-paced programmatic scroll has a different signature than a human's even when slow.

### Agent flow

```
1. read visible feed  (top ~6-8 posts already in DOM)
2. extract URNs + author + truncated body + reactions/comments counts
3. scroll one viewport down with paced behaviour
4. wait for new posts to appear (DOM polling with jittered intervals; see ADR-006)
   - Shadow-DOM aware: posts may appear inside open shadow roots
5. read newly-loaded posts
6. repeat 3-5 until N posts collected (cap: ~30, or ~5 scroll cycles)
7. for each post: keep URN + permalink + truncated body
8. compile digest: who posted what; full bodies via permalink only on demand
9. on any interstitial: HUMAN_REQUIRED → stop
```

Note step 8: **the agent's job is to prepare a digest, not to read every full body upfront.** Truncated bodies are usually enough for the user to decide "do I care." Full body retrieval becomes on-demand via popup click or permalink visit—the LinkedIn "see more" button opens a shadow-DOM modal (`#interop-outlet`, validated in PoC 3).

### New primitive — `bproxy scroll`

Belongs in concept B's read-mode toolkit alongside `navigate` and `text`. Implementation lives entirely in ISOLATED world — no MAIN-world presence needed.

- `window.scrollBy({ top: distance, behavior: 'smooth' })` triggers Chrome's native animated scroll. The page's IntersectionObserver fires normally; lazy-load triggers.
- After scroll completes, the extension polls the DOM (`setInterval` 200 ms, count target elements like `[data-id^="urn:li:activity"]`, stop when count stable for two intervals or 5 s elapsed). No listener install. No fingerprint.
- Returns `{ before: 6, after: 14, scrolledPx: 800, stable: true }`.

CLI surface kept narrow:

```
bproxy scroll --session li-snapshot \
  --by viewport \
  --direction down \
  --until-stable
```

The session's `--pacing` value (for example, set with `bproxy session bind --tab-id 123 --pacing human --session li-snapshot`) governs the inter-scroll wait, the velocity profile, and the occasional reverse-scroll noise. The agent does not have to model human shape itself.

### Bot-signal accounting

| Signal | This flow | Risk |
|---|---|---|
| `isTrusted: false` events | None — `scrollBy` doesn't dispatch user events | low |
| Wrapped `fetch` / `history` | None in read mode | zero |
| Scroll velocity uniformity | Native smooth-scroll varies; jittered distance and pacing | **medium — primary risk** |
| Scroll pause variance | Paced 4–8 s with jitter | low |
| Reverse-scroll behaviour | Occasional, randomised | low |
| `document.hidden` (tab focus) | Tab must stay foreground for content to actually render | needs care |
| MutationObserver presence | None (DOM polling instead) | zero |
| Custom listeners on elements | None | zero |
| Permalink navigation rate | Few, on-demand later | low |

The remaining detection risk is **scroll fingerprinting**. There is no perfect mitigation in pure read mode without dropping into MAIN world or `chrome.debugger`.

### Tab-focus subtlety

LinkedIn's lazy-loader checks `document.visibilityState`. A backgrounded tab will not lazy-load. The snapshot must run while the tab is foregrounded. For a daily flow this is natural — the user can leave the tab visible — but the extension should not silently activate the tab. If the tab is not visible when a `scroll` command arrives, return a structured `TAB_NOT_VISIBLE` error rather than steal focus.

### Escape hatches if pure read mode hits limits

In rough order of preference, kept on the shelf for incremental escalation as real usage reveals which ones are actually needed:

**1. Permalink-driven full-body retrieval.** For posts the user wants in full, `chrome.tabs.create({ url: permalink, active: false })` in background, read DOM, close tab. URL-driven, no clicks, no scroll. Each permalink is still a page load — pace these to 8–15 s and only fetch on-demand.

**2. `chrome.debugger` for trusted scroll.** `Input.dispatchScrollEvent` via CDP produces `isTrusted: true` scroll, lifting the scroll-fingerprint risk. Cost: yellow Chrome banner for the duration of the snapshot. Probably an acceptable opt-in for a daily flow the user kicked off intentionally.

**3. Voyager API direct call.** LinkedIn's own page calls `https://www.linkedin.com/voyager/api/feed/...` with the user's session cookies. From an ISOLATED-world content script the same `fetch('/voyager/...')` works (same-origin, same cookies, CSRF token from the rendered page).

- Pros: zero scroll, zero clicks, zero rendering. Returns full post bodies, no truncation. Fastest possible execution.
- Cons: LinkedIn's terms of service prohibit scraping; the legal posture for personal aggregation against your own logged-in account is a different question than scraping at scale, but it is not risk-free. Internal API is undocumented and changes without notice.

This is genuinely the cleanest technical solution and a real legal grey zone. Phase 4 does **not** ship a domain-policy command for this; any future `linkedin.com` API opt-in would need an explicit out-of-scope command and warning copy. Off by default.

### Recommended posture

1. **Default:** read mode + paced `bproxy scroll --by viewport --direction down --until-stable --session li-snapshot` + DOM polling + truncated-body digest. URLs to permalinks captured but not visited unless the user asks. Pacing 4–8 s between scrolls, ~30 posts max per snapshot, hard stop on `HUMAN_REQUIRED`.
2. **Escalate only when needed:** the three hatches above, in order, based on what real usage reveals.

---

## Scenario 3 — Job application form fill

User opens a job application page (LinkedIn or a custom company site), bound to the `apply-companyX` session (for example, `bproxy session bind --tab-id 456 --pacing human --session apply-companyX`). They provide the candidate dossier (resume content, work history, answers to standard questions) in the conversation. The agent's job is to fill the form. **It must not submit** — the user reviews and submits.

### Why "don't submit" is load-bearing

Application forms have the heaviest bot detection on the web — invisible reCAPTCHA v3 scores the *entire* form-fill behaviour (typing pace, tab order, mouse movement, focus patterns) and adjudicates at submit. By drawing the line at "fill but don't submit," the user sidesteps the hardest problem entirely:

- The submit click will be `isTrusted: true` because the **user** does it.
- Any CAPTCHA challenge fires on submit, not during fill — the user encounters it naturally.
- The agent never has to "look human enough to pass scoring." It has to "produce values the user can review and ship."

This is the same pattern as the LinkedIn digest: agent prepares, user reviews and acts.

### Agent flow

```
1. read form structure        → bproxy elements --form --session apply-companyX
2. LLM maps candidate fields  → {target: ElementTarget, value: string, method: FillMethod, world: ExecutionWorld}
3. fill all fields            → bproxy fill-form --file fields.json --session apply-companyX
4. handle file inputs         → bproxy require-human --reason "Attach resume" --for-attach "#resume" --session apply-companyX
5. read back filled state     → bproxy elements --form --session apply-companyX (verify framework accepted values)
6. report: "form filled, please review and submit"
7. user reviews, fixes anything, clicks submit themselves
```

### The realistic write model — paste, not typing

Real humans do not type their CV into application forms. The actual mix:

- **Personal info** (name, email, phone, address): Chrome autofill or paste from a saved info doc. Never typed.
- **Resume content** (work history, education, skills): pasted from CV / LinkedIn / Google Doc.
- **Cover letter**: pasted from a template, sometimes edited.
- **Custom questions** ("why this company?"): pasted from a reusable answers file, occasionally typed when composing fresh.
- **Yes/No, dropdowns, dates**: clicked.

Typing per-character is the *exception*, not the rule. Most application forms are filled in 30–90 seconds by a human, almost entirely via paste + click + autofill.

`bproxy fill` should therefore be called with an explicit **paste-flavored method** (`--method paste --world isolated` for ordinary fields), not character-by-character typing:

```js
input.focus();
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;
setter.call(input, value);
input.dispatchEvent(new InputEvent('beforeinput', {
  inputType: 'insertFromPaste', data: value, bubbles: true,
}));
input.dispatchEvent(new InputEvent('input', {
  inputType: 'insertFromPaste', data: value, bubbles: true,
}));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

The key signal is `inputType: "insertFromPaste"`. Frameworks (React, Vue, Angular, form libraries) inspect `inputType` to distinguish typed vs pasted vs autofilled, and they accept all three. Anti-fraud trackers that score keystroke cadence have nothing to score because there are no keystrokes.

The session's `--pacing` value governs the **delay between fields** (0.5–2 s with jitter), not delay between characters. Real humans paste fast within a field but pause between fields to glance, scroll, or read the next label. Total fill time of 30–90 s for a 20-field form is realistic.

Explicit `method: direct`, `method: paste`, or `method: runtime-api` and `world: isolated|main` are required in every `fill` / `fill-form` payload; Phase 4 has no CLI-side method selection or fallback chain.

### The framework-state trap

Setting `input.value = "..."` directly **does not update React/Vue/Angular controlled-input state** — the framework still sees the old value, and the user's eventual submit will send empty fields. The fix is to use the native value setter on the prototype and dispatch an `input` event, exactly as shown above. This is well-known but tricky enough to warrant a first-class primitive instead of leaving it to the agent.

After fill, **read back via `bproxy elements --form --session apply-companyX`** to confirm the framework's reflected value matches what was sent. If it does not, the field is using a custom component that intercepts events before the framework sees them — fall back to the per-component strategy (e.g., custom dropdown helper).

### Hidden-field guard

`bproxy fill-form` must **never write to fields that are hidden, `display:none`, `visibility:hidden`, `aria-hidden=true`, off-screen, or have zero dimensions**. These are honeypots — filling them is a guaranteed bot flag, regardless of any other behaviour. The actionability check refuses silently and logs the rejection. The agent cannot override.

### Custom dropdowns

Most modern application forms use React-Select, Select2, or custom comboboxes — `<div>` trees with click handlers, not `<select>`. Pattern is always the same: click the trigger, wait for the menu, click the option matching some text. Enough boilerplate to deserve a primitive:

```
bproxy select --selector <trigger-selector> --option-text <option-text> --session apply-companyX
```

Opens, waits for menu, clicks option. Falls back gracefully on standard `<select>` (sets value + change event). The agent never needs to model the platform's specific dropdown widget.

### File uploads

`<input type="file">` cannot be populated programmatically — browsers prohibit it for security. Three options exist:

1. `DataTransfer` drop simulation — synthesises a drop event with file data. Works on permissive sites, fails on strict ones.
2. `chrome.debugger` + `Page.handleFileChooser` — works reliably. Yellow banner cost.
3. Hand off to human via `bproxy require-human --reason "Attach resume" --for-attach "#resume" --session apply-companyX` — surfaces a desktop notification deep-linked to the field.

For MVP, option 3 is right. The user already needs to review the form before submitting; attaching the file is a five-second step they were going to do anyway. Revisit options 1 and 2 if real usage shows the handoff is annoying.

### New primitives

| Primitive | Purpose |
|---|---|
| `bproxy elements --form --session apply-companyX` | Form-shaped read: each field with `{label, type, currentValue, options, required, pattern, name}`. |
| `bproxy fill --selector <css> --value <text> --method paste --world isolated --session apply-companyX` | Paste-flavored write with framework-event dispatch. Also supports `--value-file` or `--value-stdin`. |
| `bproxy fill-form --file fields.json --session apply-companyX` | Bulk fill in one round-trip with internal pacing. Payload is `{ "fields": [...] }` and each field carries target, value, method, and world. |
| `bproxy select --selector <trigger> --option-text <text> --session apply-companyX` | Custom-dropdown helper. Opens, waits, clicks option. |
| `bproxy require-human --reason <reason> --for-attach <selector> --session apply-companyX` | File upload handoff with deep-link to field. |

### Bot-signal accounting

| Signal | This flow | Risk |
|---|---|---|
| `isTrusted: false` on `input` events | Yes — every fill | low; frameworks accept |
| `isTrusted: false` on click for custom dropdowns | Yes — opening menus | low for most components |
| MAIN-world helper execution (`world: main`) | Used only for `runtime-api` writes; one-shot execution | low |
| Hidden-tab destructive action guard | `fill`, `fill-form`, and `select` reject with `TAB_NOT_VISIBLE` when tab is hidden | low |
| Typing pace fingerprint | None — paste, not typing | zero |
| Per-field delay | 0.5–2 s with jitter (paste-realistic) | low |
| Tab order / focus pattern | Agent fills in DOM order, not visual order | medium for paranoid scoring |
| Mouse movement | None | medium for invisible reCAPTCHA scoring |
| Hidden honeypot fields | Filtered by visibility check; never filled | zero |
| Total fill time | 30–90 s for 20 fields | low |
| Submit click | **User does it — real `isTrusted`** | **zero** |
| Final reCAPTCHA v3 score | Possibly lower than human | medium — user-submit can rescue |

The user-submit line is doing most of the heavy lifting. Even if the agent's fill behaviour scores low, a real user-driven submit is a strong positive signal that often offsets it.

### Capabilities the flow uses

- `bproxy elements --form --session apply-companyX`, `bproxy fill-form --file fields.json --session apply-companyX`, `bproxy select --selector <trigger> --option-text <text> --session apply-companyX`, `bproxy require-human --reason <reason> --for-attach <selector> --session apply-companyX`.
- Read mode foundations (ISOLATED-world DOM access, no MAIN-world shim, no MutationObserver).

### Capabilities the flow does *not* use

- No MAIN-world shim — paste-flavored events fire from ISOLATED world fine.
- No MutationObserver — the read-back verify after each fill is enough to confirm framework state.
- No network shim — we do not care about the form's XHRs.
- No Phase 4 trusted-input/debugger mode for form writes — `isTrusted: false` on `input` events is accepted by all major frameworks and most form libraries.
- No CAPTCHA solving — handed off to the user at submit.

### Recommended posture

1. **MVP**: read mode + `fill` / `fill-form` / `select` / `elements --form` primitives + explicit `--method paste --world isolated` where appropriate + `require-human --for-attach` for file uploads. No trusted-input mode in Phase 4.
2. **Iterate**: if specific forms reject `isTrusted: false` clicks on custom dropdowns, consider a future trusted-input opt-in (not a Phase 4 CLI flag).
3. **Defer**: file upload synthesis (DataTransfer or debugger) until real usage shows the handoff is too annoying.

---

## What these scenarios reveal about the design

- **Read mode covers most of the work** for both URL-driven and SPA-shaped sites, provided we add a scroll primitive.
- **DOM polling beats MutationObserver** as the default "is the page settled" mechanism for read mode. Lower fingerprint, no listener install, simpler mental model.
- **Pacing is a daemon-enforced primitive**, set per session, applied to navigations, scrolls, and per-field fill delay. The agent does not implement human shape; the extension does.
- **Paste, not typing, is the realistic write primitive.** Real humans never type their CV into application forms — they paste, autofill, and click. The agent should choose explicit `--method paste` / `method: "paste"` values for paste-shaped writes; Phase 4 has no per-character typing primitive.
- **Interact mode is a thin extension of read mode**, not a wholesale switch into heavy instrumentation. The additions are paste-shaped writes (`fill`, `fill-form`, `select`), a form-shaped read variant (`elements --form`), and a file-upload handoff (`require-human --for-attach`). No MAIN-world shim, no MutationObserver, no Phase 4 trusted-input mode.
- **Interstitial detection + `HUMAN_REQUIRED`** is load-bearing for any sustained autonomous run. Without it, the agent will retry through CAPTCHAs and confirm itself as automation.
- **"Don't submit" handoff is load-bearing for write-heavy autonomous flows.** The agent prepares; the user reviews and submits. The user-driven submit is `isTrusted: true`, which often offsets any lower bot score from the fill behaviour. Same posture as "agent prepares, user digests" in the read scenarios.
- **Escape hatches stay on the shelf** until real usage signals which ones earn their cost. Start simple, iterate.

Add new scenarios to this file as they come up. Each new scenario should include: agent flow, new primitives needed (if any), bot-signal accounting, and what it reveals about the design.
