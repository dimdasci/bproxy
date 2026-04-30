# Use cases

These scenarios drive the design choices captured in [`journal/2026-04-30-default-instrumentation-strategy.md`](./journal/2026-04-30-default-instrumentation-strategy.md). Each shows how the agent runs end-to-end and what bproxy primitives it needs. New scenarios should be added here as they surface.

The framing assumption across all scenarios: **the user is in front of the browser**. The agent does data reads, copy-paste relief, and bounded autonomous batch work. Login, CAPTCHA, and consent screens are handed back to the human via `HUMAN_REQUIRED`.

---

## Scenario 1 — Google topic research

User opens Google, signed in with their real account. They ask the agent to compile a shortlist of recent job postings on a topic.

### Agent flow

1. **Plan (no browser activity).** LLM produces a list of search queries and parameters (time filter, language, location, pagination cap).
2. **Execute each search via URL.** `bproxy --session research navigate "https://www.google.com/search?q=...&tbs=qdr:w&hl=en&start=0"`. Google search is fully URL-driven — every parameter the human sets in the UI maps to a query-string field (`q`, `tbs`, `hl`, `gl`, `start`, `num`, `lr`).
3. **Read SERP.** `bproxy --session research text "main"` returns rendered SERP text. The LLM extracts `[{title, url, snippet, source}]` directly from the text — no need to teach bproxy Google's selector schema.
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

- `bproxy navigate <url>` — full navigation, not pushState.
- `bproxy text <selector>` — ISOLATED-world DOM read.
- `bproxy require-human <reason>` — for the rare CAPTCHA / sign-out interstitial.

### Capabilities the flow does *not* use

- No `bproxy click` or `bproxy type` — never dispatches a synthetic event.
- No MAIN-world shim — never wraps `fetch` / `history`.
- No MutationObserver — server-rendered SERPs are complete on `load`.
- No `--trusted` mode — no synthetic events to make trusted.

### Why this works

Google search is URL-driven for everything. Reads happen against a server-rendered SERP through ISOLATED-world DOM access. The agent never has to dispatch an event on a Google page, so there is nothing for `isTrusted` checks to flag and nothing for function-tampering probes to find.

---

## Scenario 2 — LinkedIn daily feed snapshot

User opens LinkedIn home (signed in), pinned to `--session li-snapshot`. They ask the agent to capture today's feed: who posted what, with truncated bodies and permalinks, ready for the user to digest.

### Why LinkedIn is harder than Google

1. **It's a SPA with lazy-loaded feed.** No `?start=20` equivalent. Posts load only when scroll position approaches them — LinkedIn's page uses an IntersectionObserver to fire Voyager API requests as the user scrolls. **No scroll, no posts.**
2. **The feed truncates post bodies.** Long posts show ~3 lines + "see more." Full text isn't in the DOM until either the user clicks "see more" or navigates to the post's permalink page.
3. **LinkedIn's bot detection watches scroll behaviour.** Scroll velocity, pause patterns, reverse-scroll moments, and tab visibility (`document.hidden`) are part of their signal. A perfectly-paced programmatic scroll has a different signature than a human's even when slow.

### Agent flow

```
1. read visible feed  (top ~6-8 posts already in DOM)
2. extract URNs + author + truncated body + reactions/comments counts
3. scroll one viewport down with paced behaviour
4. wait for new posts to appear (DOM polling, no MutationObserver)
5. read newly-loaded posts
6. repeat 3-5 until N posts collected (cap: ~30, or ~5 scroll cycles)
7. for each post: keep URN + permalink + truncated body
8. compile digest: who posted what; full bodies via permalink only on demand
9. on any interstitial: HUMAN_REQUIRED → stop
```

Note step 8: **the agent's job is to prepare a digest, not to read every full body upfront.** Truncated bodies are usually enough for the user to decide "do I care." Full body retrieval becomes on-demand, which keeps page-load volume low.

### New primitive — `bproxy scroll`

Belongs in concept B's read-mode toolkit alongside `navigate` and `text`. Implementation lives entirely in ISOLATED world — no MAIN-world presence needed.

- `window.scrollBy({ top: distance, behavior: 'smooth' })` triggers Chrome's native animated scroll. The page's IntersectionObserver fires normally; lazy-load triggers.
- After scroll completes, the extension polls the DOM (`setInterval` 200 ms, count target elements like `[data-id^="urn:li:activity"]`, stop when count stable for two intervals or 5 s elapsed). No listener install. No fingerprint.
- Returns `{ before: 6, after: 14, scrolledPx: 800, stable: true }`.

CLI surface kept narrow:

```
bproxy --session li-snapshot scroll
  [--by <px|viewport>]          how far (default: ~0.85 viewport, jittered)
  [--direction up|down]          default: down
  [--until-stable]               default behaviour: poll until DOM settles
```

The session's `--pacing` value (set at session start) governs the inter-scroll wait, the velocity profile, and the occasional reverse-scroll noise. The agent does not have to model human shape itself.

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

This is genuinely the cleanest technical solution and a real legal grey zone. Surface to the user as `bproxy domain set linkedin.com --use-api` with explicit warning copy. Off by default.

### Recommended posture

1. **Default:** read mode + paced `bproxy scroll` + DOM polling + truncated-body digest. URLs to permalinks captured but not visited unless the user asks. Pacing 4–8 s between scrolls, ~30 posts max per snapshot, hard stop on `HUMAN_REQUIRED`.
2. **Escalate only when needed:** the three hatches above, in order, based on what real usage reveals.

---

## What these scenarios reveal about the design

- **Read mode covers most of the work** for both URL-driven and SPA-shaped sites, provided we add a scroll primitive.
- **DOM polling beats MutationObserver** as the default "is the page settled" mechanism for read mode. Lower fingerprint, no listener install, simpler mental model.
- **Pacing is a daemon-enforced primitive**, set per session, applied to navigations and scrolls. The agent does not implement human shape; the extension does.
- **Interstitial detection + `HUMAN_REQUIRED`** is load-bearing for any sustained autonomous run. Without it, the agent will retry through CAPTCHAs and confirm itself as automation.
- **Escape hatches stay on the shelf** until real usage signals which ones earn their cost. Start simple, iterate.

Add new scenarios to this file as they come up. Each new scenario should include: agent flow, new primitives needed (if any), bot-signal accounting, and what it reveals about the design.
