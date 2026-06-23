---
title: "Phase 11: Extension popup compliance and presentation"
status: complete
date: 2026-06-23
---

## Phase 11: Extension popup compliance and presentation

**Motivation:** The extension popup was functional but too minimal for first-run clarity and Chrome Web Store review. It needed to explain what bproxy is, show version/protocol metadata, link to docs and privacy information, and present pairing state more clearly without turning the popup into a dashboard.

**Source decisions:**

- [ADR-001](../../decisions.md#adr-001-default-instrumentation-strategy--read-mode) — programmatic injection only
- [ADR-011](../../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) — popup-driven pairing
- [ADR-016](../../decisions.md#adr-016-web_accessible_resources-default-deny) — no WAR by default
- [ADR-017](../../decisions.md#adr-017-sensoractuator-boundary) — popup remains a thin pairing surface, not a dashboard
- [ADR-024](../../decisions.md#adr-024-no-arbitrary-page-eval-and-no-scroll-target-inference) — no extra control/eval surface
- [ADR-025](../../decisions.md#adr-025-security-scanner-findings-are-remediated-in-code) — compliance changes land in code/tests

---

## Scope shipped

| # | Deliverable | Outcome |
|---|-------------|---------|
| 1 | Popup markup/style redesign | Shipped |
| 2 | Version and protocol metadata rendering | Shipped |
| 3 | Footer links (docs, license, credits) | Shipped |
| 4 | Paired/unpaired state presentation | Shipped |
| 5 | Privacy policy page for CWS | Shipped |
| 6 | Store listing manifest description | Shipped |
| 7 | Popup test updates | Shipped |

Out of scope remained unchanged:
- No session counts, tab counts, recent activity, or operator dashboard UI
- No options page
- No new permissions or `web_accessible_resources`
- No strategy, selector repair, retries, or fallback chains in the popup

---

## Major changes

### Popup UI rewrite

`extension/src/entrypoints/popup/index.html` was redesigned into a compact single-column utility layout with:
- inline cable icon + product name
- subtitle: `Human-in-the-loop browser bridge for AI agents.`
- explicit pairing status line above the form
- pairing help text
- footer metadata and outbound links

The popup stayed fully static in HTML/CSS for presentation:
- inline styles only
- no external assets
- native form semantics preserved
- no new runtime permissions or WAR entries

### Pairing-state presentation

`extension/src/entrypoints/popup/main.ts` now:
- reads local bootstrap state from `chrome.storage.local`
- renders `Not paired` vs `Paired with local daemon`
- shows a gray or green status dot
- updates status immediately after successful pairing

Important honesty rule preserved: "Paired" means a valid local bootstrap record exists; it does not claim the daemon is currently reachable.

### Version and protocol metadata

The popup now renders:
- `Extension ${VERSION}`
- `Protocol ${PROTOCOL_VERSION}`

Both values come from `@bproxy/shared`.

### Footer links and attribution

The popup footer now includes static external links to:
- documentation
- privacy page
- MIT license
- GitHub repository (icon link)

Attribution is shown as plain text: `Created by Dim Kharitonov`.

### Re-pair UX follow-up

After manual review, the paired-state submit button was clarified:
- unpaired: `Pair extension`
- paired: `Re-pair with new code`

This matches actual architecture behavior: entering a new valid pairing code replaces the stored bootstrap and reconnects the background worker with a fresh extension token.

### Manual presentation tweak after review

After loading the built extension in Chrome, popup spacing was increased to improve visual separation from the page behind it:
- outer padding increased
- major section spacing increased

This was a presentation-only adjustment; no behavioral changes.

### Manifest and privacy materials

- `extension/wxt.config.ts` manifest description was updated to CWS-safe wording:
  - `Companion extension for bproxy. Connects Chrome to a local bproxy daemon for explicit human-in-the-loop browser actions.`
- `docs/public/privacy.md` was rewritten as a short factual privacy policy page for `/privacy/`

### Tests

Added `extension/src/entrypoints/popup/__tests__/presentation.test.ts` to cover:
- title/subtitle/copy
- footer metadata and links
- attribution and GitHub link
- paired/unpaired view-model behavior
- version/protocol rendering fallback behavior

Existing pairing-flow tests remained intact.

---

## Files changed

| Package | File |
|---|---|
| extension | `src/entrypoints/popup/index.html` |
| extension | `src/entrypoints/popup/main.ts` |
| extension | `src/entrypoints/popup/__tests__/presentation.test.ts` |
| extension | `wxt.config.ts` |
| docs/public | `privacy.md` |

No changes were required in `shared/`, `service/`, `cli/`, the background SW, content scripts, or the protocol wire shape.

---

## Shipped outcome

The popup now presents bproxy as a clear pairing utility instead of a bare form:
- product identity and purpose are visible immediately
- pairing state is visible immediately
- version/protocol metadata is available for support/debugging
- documentation/privacy/license/credits are one click away
- paired users see `Re-pair with new code`, which matches the actual token-rotation flow

This improved first-run clarity and CWS readiness without expanding the popup into an operator surface or violating the extension's sensor/actuator boundary.

---

## Validation

Validated during implementation:
- `pnpm --filter @bproxy/extension typecheck`
- `pnpm --filter @bproxy/extension test`
- `pnpm docs:build`
- `pnpm check`
- `pnpm --filter @bproxy/extension build`

Manual verification in Chrome confirmed:
- updated layout and spacing render correctly
- paired/unpaired states display correctly
- successful pairing updates the status line
- paired state shows `Re-pair with new code`
- footer links open correctly

---

## Deferred / rejected

| Item | Reason |
|---|---|
| Session/tab/activity dashboard in popup | Rejected for this phase; daemon remains the authority and popup is not an operator dashboard |
| WebSocket live connection state in popup | Deferred; badge already covers transport state |
| Options page | Explicitly out of scope |
| Store icons/screenshots/promo assets | Deferred; non-code store assets |
| Dark mode | Deferred; no requirement for this increment |
| Localization | Deferred; English-only for now |
