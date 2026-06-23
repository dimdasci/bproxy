---
title: "Phase 11: Extension popup compliance and presentation"
status: planned
date: 2026-06-23
---

## Phase 11: Extension popup compliance and presentation

**Motivation:** The current extension popup is a minimal pairing form (title, input, button, status line). It is functional but too terse for Chrome Web Store review or for a user/operator encountering the extension for the first time. The popup does not identify the product's purpose, authorship, version, license, or link to documentation. The solution spec at `docs/internal/solution/extension-popup-compliance.md` defines the target state.

**Source decisions:**

- [ADR-001](../../decisions.md#adr-001-default-instrumentation-strategy--read-mode) — programmatic injection only
- [ADR-011](../../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) — popup-driven pairing
- [ADR-016](../../decisions.md#adr-016-web_accessible_resources-default-deny) — no WAR by default
- [ADR-017](../../decisions.md#adr-017-sensoractuator-boundary) — extension is sensor/actuator only; no strategy in popup
- [ADR-024](../../decisions.md#adr-024-no-arbitrary-page-eval-and-no-scroll-target-inference) — no eval / no scroll inference
- [ADR-025](../../decisions.md#adr-025-security-scanner-findings-are-remediated-in-code) — security findings remediated in code

---

## Scope

| # | Deliverable | Layer | Risk |
|---|-------------|-------|------|
| 1 | Popup markup/style redesign | extension popup HTML/CSS | Low |
| 2 | Version and protocol metadata rendering | extension popup TS | Low |
| 3 | Footer links (docs, license, credits) | extension popup HTML | Low |
| 4 | Paired/unpaired state presentation | extension popup TS | Low |
| 5 | Privacy policy page for CWS | docs site (views/) | Low |
| 6 | Store listing manifest description | extension wxt.config.ts | Low |
| 7 | Popup test updates | extension test/ | Low |

**Explicitly out of scope (per solution spec):**

- No session counts, tab counts, recent-activity, or dashboard UI in the popup.
- No options page.
- No external fonts, remote assets, badge/chip components, or gradients.
- No strategy, selector repair, modal solving, or fallback chains.
- No store icon or screenshot creation (blocked until popup code is shipped).
- No new permissions or WAR entries.

---

## Deliverable 1: Popup markup and style redesign

### Intent

Restructure `extension/src/entrypoints/popup/index.html` to match the proposed content layout from the solution spec. The popup should answer: what is this, what does it do, who made it, where to learn more.

### Target layout (single column, ~340–380px)

```
┌──────────────────────────────────────┐
│ ⚡ bproxy                             │
│ Human-in-the-loop browser bridge     │
│ for AI agents.                       │
│                                      │
│ ● Not paired                         │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ Pairing code                         │
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│ [ Pair extension ]                   │
│                                      │
│ Run `bproxy service start` and paste │
│ the one-time code shown by the       │
│ daemon.                              │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ Extension 0.9.0 · Protocol 2         │
│ Documentation · Privacy · MIT        │
│ Created by Dim Kharitonov  [GH]      │
└──────────────────────────────────────┘
```

When paired: `● Paired with local daemon` (dot turns green)

### Typography and visual spec

**Baseline grid:** 4px. All vertical spacing (margins, paddings, line-heights) must be multiples of 4px.

**Font stack:** `system-ui, -apple-system, sans-serif`

**Type scale (two sizes only, anchored to 4px grid):**

| Size | Line-height | Weight | Where |
|------|-------------|--------|-------|
| 16px | 24px (6×4) | 600 | Product name (h1) |
| 13px | 20px (5×4) | 400 | Everything else |

Hierarchy within the 13px tier uses **color only**:

| Color | Where |
|-------|-------|
| `--c-text` | Status text, form label, input, button |
| `--c-muted` | Subtitle, help text, footer, unpaired dot |
| `--c-ok` | Paired dot |
| `--c-error` | Error messages |

**Vertical rhythm:**

| Spacing token | Value | Usage |
|---------------|-------|-------|
| `--space-xs` | 4px | Tight internal gaps (between version and links lines) |
| `--space-sm` | 8px | Between label and input, between adjacent elements |
| `--space-md` | 12px | Section separator padding (above/below dividers) |
| `--space-lg` | 16px | Body padding, gap between major sections |

Body padding: `16px` (4×4) on all sides.  
Dividers: `1px solid` — the 1px sits between rhythm rows, not disrupting them (use `padding-top: 12px; margin-top: 12px` on separated sections = 24px total gap with the 1px rule centered visually).

**Color palette (5 values):**

| Token | Value | Usage |
|-------|-------|-------|
| `--c-text` | `#1a1a1a` | Headings, input text, button text, form labels |
| `--c-muted` | `#555` | Subtitle, help text, footer, links, borders, unpaired dot |
| `--c-ok` | `#167a30` | Paired dot, success messages |
| `--c-error` | `#a4262c` | Error messages |
| `--c-bg` | `#fff` | Body background |

Borders and dividers use `--c-muted` at reduced opacity (`border: 1px solid color-mix(in srgb, var(--c-muted) 30%, transparent)`) or just a light value like `#ddd` derived once in the stylesheet. No separate border token.

Button background: transparent. Button border: `--c-muted`. Links: inherit `--c-muted`, underlined by default.

**Form elements:**
- Input: `padding: 8px; border-radius: 4px; border: 1px solid #ddd`
- Button: `padding: 8px; border-radius: 4px; border: 1px solid var(--c-muted); background: transparent`
- Both inherit font from body.

### Implementation

**File:** `extension/src/entrypoints/popup/index.html`

Changes:
- Set `<title>` to `bproxy`.
- Add `min-width: 340px; max-width: 380px` to `body`.
- Define CSS custom properties (tokens above) on `:root` in the `<style>` block.
- Replace `<h1>bproxy pairing</h1>` with a header row:
  - `<h1><svg ...cable icon.../> bproxy</h1>` — inline SVG (Lucide cable, 20×20, `stroke: currentColor`) sits beside the product name, vertically centered via `display: flex; align-items: center; gap: 8px`.
  - `<p class="subtitle">Human-in-the-loop browser bridge for AI agents.</p>`
- The SVG is inlined directly in the HTML (from `assets/brand/cable.svg`), sized to 20×20 to match the h1 line-height optically. No external image request, no `<img>` tag, no WAR entry.
- Add a `<p id="connection-status">` element above the form showing the current pairing/connection state.
- Keep the form semantics intact: `<form>`, `<label>`, `<input>`, `<button>`.
- Change button text from "Pair" to "Pair extension".
- Add a help paragraph below the form: `Run <code>bproxy service start</code> and paste the one-time code shown by the daemon.`
- Add a `<footer>` section below the form with:
  - Version line: `<span id="version-info">Extension {VERSION} · Protocol {PROTOCOL_VERSION}</span>`
  - Links line: `Documentation · Privacy · MIT` (each an `<a>` with `target="_blank" rel="noreferrer"`; MIT links to the LICENSE file)
  - Attribution: `Created by Dim Kharitonov` followed by an inline GitHub SVG icon linking to `https://github.com/dimdasci/bproxy`
- Keep `<output id="status">` for error/success messages from pairing.
- All spacing uses the rhythm tokens. No arbitrary pixel values outside the scale.
- All colors reference CSS custom properties.

### Constraints

- No external assets loaded. All styles inline in `<style>`.
- Native form semantics preserved (`<form>`, `<label>`, `<input>`, `<button>`, `<output aria-live>`).
- No JavaScript for layout/style. CSS-only visual changes.
- The help text and attribution are static — they do not depend on pairing state.
- Every vertical measurement must align to the 4px grid. Use browser DevTools grid overlay to verify during manual testing.

---

## Deliverable 2: Version and protocol metadata rendering

### Intent

Show the extension version and protocol version in the popup footer, sourced from shared constants.

### Implementation

**File:** `extension/src/entrypoints/popup/main.ts`

Changes:
- Import `VERSION` and `PROTOCOL_VERSION` from `@bproxy/shared` (both already exported from `shared/src/version.ts`).
- On `DOMContentLoaded`, populate the `#version-info` element: `Extension ${VERSION} · Protocol ${PROTOCOL_VERSION}`.
- This is a one-time DOM write during init — no reactive binding needed.

### Constraints

- Import only from `@bproxy/shared`, preserving the workspace dependency rule (extension → shared only).
- If `VERSION` or `PROTOCOL_VERSION` cannot be imported (build misconfiguration), fall back to empty string rather than throwing. Popup must remain functional.

---

## Deliverable 3: Footer links

### Intent

Provide external links to documentation, license, and privacy policy in the popup footer.

### Implementation

**File:** `extension/src/entrypoints/popup/index.html`

Static `<a>` elements in the footer:
- Documentation: `https://dimdasci.github.io/bproxy/`
- Privacy: `https://dimdasci.github.io/bproxy/privacy/`
- MIT: `https://github.com/dimdasci/bproxy/blob/main/LICENSE`
- GitHub icon (on attribution line): `https://github.com/dimdasci/bproxy`

The GitHub icon is an inline SVG (Simple Icons / GitHub mark, 14×14, `fill: currentColor`) placed after "Created by Dim Kharitonov", vertically centered. No text label — the icon alone is the link.

All links use `target="_blank" rel="noreferrer"`.

### Constraints

- Links are static HTML — no JavaScript click handlers.
- No `chrome.tabs.create` for link opening (unnecessary; `target="_blank"` works from popup).
- URLs must not include tracking parameters.

---

## Deliverable 4: Paired/unpaired state presentation

### Intent

Show the current connection status at the top of the popup without adding dashboard/session information.

### Implementation

**File:** `extension/src/entrypoints/popup/main.ts`

Changes:
- On `DOMContentLoaded`, check `chrome.storage.local` for the bootstrap record (already available via `bootstrapItem`).
- If a valid bootstrap payload exists (token present, not expired): render `● Paired with local daemon` — dot is an inline `<svg>` circle (8×8, `fill: var(--c-ok)`).
- If no bootstrap or expired: render `● Not paired` — dot uses `fill: var(--c-muted)`.
- After successful pairing (in `renderResult`), update dot color to green and text to `Paired with local daemon`.
- On pairing error, status remains `● Not paired` (gray dot).

**What this does NOT show:**
- No WebSocket connection state (that's badge territory, already handled in background SW).
- No session count, tab count, or activity summary.
- No daemon version or remote metadata.

### Constraints

- Status is based only on local `chrome.storage.local` bootstrap record — no daemon round-trip on popup open.
- Display is honest: "Paired" means the token exists locally. It does not guarantee the daemon is currently running.
- This deliberately mirrors the solution spec's "session and tab visibility check" conclusion: the popup cannot authoritatively show active sessions.

---

## Deliverable 5: Privacy policy page

### Intent

Publish a minimal privacy policy page at `https://dimdasci.github.io/bproxy/privacy/` for CWS submission.

### Implementation

**File:** `docs/public/privacy.md` (Starlight will render this as `/bproxy/privacy/`)

Content (plain English, no legal boilerplate):

```markdown
---
title: Privacy Policy
---

## bproxy Extension Privacy Policy

The bproxy Chrome extension does not collect, store, or transmit any user data.

**What the extension does:**
- Reads page content only when an AI agent sends a command through the local daemon.
- Passes page content to a daemon running on the same machine (`127.0.0.1`).
- Nothing leaves your device. There is no remote server, no analytics, no telemetry.

**What the extension stores:**
- A pairing token in Chrome's local storage, used to authenticate the WebSocket connection to the local daemon.
- Bounded session diagnostics (request trace, dedupe cache) in Chrome's session storage, cleared when the browser closes.

**Network communication:**
- The extension communicates exclusively with `localhost:9615` (`ws://127.0.0.1:9615/ws` and `http://127.0.0.1:9615/pair/claim`).
- It never contacts any external service.

**Permissions rationale:**
- `tabs`: route actions to specific tabs and manage tab lifecycle.
- `scripting`: programmatically inject the content script on first command.
- `webNavigation`: track top-level navigation for page identity.
- `alarms`: background service-worker keepalive scheduling.
- `storage`: persist bootstrap token and session diagnostics.
- `<all_urls>`: support user-directed actions on any page.
```

### Constraints

- No "we may update this policy" filler.
- Must be consistent with CWS privacy field declarations.
- Must be factually accurate against actual extension behavior.

---

## Deliverable 6: Manifest description update

### Intent

Ensure the manifest `description` field is honest, clear, and CWS-compliant.

### Implementation

**File:** `extension/wxt.config.ts`

Change the `description` field in the manifest object:

```ts
description: "Companion extension for bproxy. Connects Chrome to a local bproxy daemon for explicit human-in-the-loop browser actions.",
```

### Constraints

- No promotional language ("best", "powerful", "seamless").
- No circumvention language ("stealth", "bypass", "undetectable", "anti-bot").
- Under 132 characters (CWS limit).

---

## Deliverable 7: Popup test updates

### Intent

Adjust existing popup tests and add assertions for the new metadata/copy elements.

### Implementation

**File:** `extension/src/entrypoints/popup/__tests__/` (existing test files + potentially new test file)

New assertions:
- Popup renders product subtitle text.
- Popup renders version info containing `VERSION` and `PROTOCOL_VERSION` values.
- Popup renders footer links (Documentation, Privacy, MIT) with correct `href` and `rel="noreferrer"`.
- Popup renders attribution line "Created by Dim Kharitonov" with a GitHub icon linking to the repo.
- Popup renders gray dot + "Not paired" when no bootstrap exists.
- Popup renders green dot + "Paired with local daemon" when valid bootstrap exists.
- Existing pairing flow tests continue to pass (DOM selectors for `#pair-form`, `#code`, `#submit`, `#status` remain stable).

### Constraints

- DOM selectors used in existing tests (`#pair-form`, `#code`, `#submit`, `#status`) must remain unchanged or tests must be updated in the same commit.
- No snapshot tests (fragile for styling changes).
- Tests must not import from packages outside `@bproxy/shared` (workspace rule).

---

## Implementation order

Tasks ordered by dependency:

1. **Deliverable 6 (manifest description)** — Smallest change, zero dependencies. Quick win.
2. **Deliverable 1 (markup/style redesign)** — Foundation for all other popup deliverables.
3. **Deliverable 2 (version metadata)** — Requires new DOM elements from Deliverable 1.
4. **Deliverable 3 (footer links)** — Requires footer structure from Deliverable 1.
5. **Deliverable 4 (paired state)** — Requires status element from Deliverable 1.
6. **Deliverable 7 (test updates)** — Must follow all popup code changes.
7. **Deliverable 5 (privacy page)** — Independent of popup code; can be done in parallel but ordered last because it's in a different package.

---

## Files touched

| Package | File | Change type |
|---------|------|-------------|
| extension | `src/entrypoints/popup/index.html` | Rewrite markup and styles |
| extension | `src/entrypoints/popup/main.ts` | Add imports, init logic for version/status |
| extension | `wxt.config.ts` | Update manifest description |
| extension | `src/entrypoints/popup/__tests__/*.ts` | Update/add test assertions |
| docs/public | `privacy.md` | New file (privacy policy page) |

No changes to: `shared/`, `service/`, `cli/`, background SW, content scripts, or the protocol wire shape.

---

## Validation

All deliverables must pass before the phase is considered complete:

- `pnpm --filter @bproxy/extension typecheck` passes.
- `pnpm --filter @bproxy/extension test` passes.
- `pnpm check` passes (typecheck + format + lint + arch + deadcode).
- `pnpm docs:build` passes (privacy page renders correctly).
- Manual verification: load the built extension in Chrome, open popup, confirm:
  - Product name, subtitle, and purpose text visible.
  - "Not paired" status shown.
  - Pairing flow works as before.
  - After pairing, status shows "Paired with local daemon".
  - Version and protocol version displayed in footer.
  - Footer links open correct URLs in new tabs.
  - Attribution and license visible.
  - Popup width between 340–380px, single column, no scroll needed for typical content.

---

## Deferred

| Item | Reason |
|---|---|
| Store icon (128×128 PNG) | Requires design decision on rendering `cable.svg` at large size; not code work. |
| CWS screenshots (1280×800) | Blocked until popup redesign ships — screenshots must show final UI. |
| Small/marquee promo tiles | Not required for initial submission; marketing asset. |
| Options page | Solution spec explicitly says none needed for this increment. |
| WebSocket connection state in popup | Badge already handles this; popup shows token presence only. |
| Operator session visibility surface | Requires separate ADR; intentionally discarded per solution spec. |
| Dark mode / `prefers-color-scheme` | No requirement stated; can be added later with CSS media query. |
| Localization / i18n | Single-language (English) for now. |
