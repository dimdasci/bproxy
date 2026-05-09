# PoC 3 — Write technique for hostile rich-text editors

> Directory name kept as `paste-fill/` for git-history continuity; the PoC has pivoted away from paste-flavored writes. See `docs/journal/2026-05-08-poc-paste-fill.md` § "2026-05-09 — PoC 3 pivot" for the rationale.

## Question

Can the bproxy extension write text into LinkedIn's post composer (inside an open shadow root, with synthetic-event resistance) by:

1. Clicking `Start a post`.
2. Detecting the composer inside shadow DOM.
3. Waiting briefly for runtime mount and resolving editor instance.
4. Mutating and reading via editor API (`setText` / `getText` for Quill in this validated build) — no synthetic `InputEvent` / `ClipboardEvent` / `Event('change')`.

Validated live route in this PoC: `div.editor-content.ql-container.__quill`.

## Constraints

- **Extension-only execution.** All probes and primitive calls run through `chrome.scripting.executeScript`, content scripts, and popup-driven actions in `extension/`. No devtools-pasted snippets, no `javascript:` URLs, no console-paste fallbacks. `snippet.js` is a historical artifact and is not used.
- **No decision-doc edits during this PoC.** The fiber-walk method is a hypothesis. `docs/decisions.md` (ADR-007 and adjacent), `docs/architecture.md`, and `docs/solution/*` are revisited as a separate task only **after** PoC 3 closes with a verdict.

## Run

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `poc/paste-fill/extension/`.
2. Open `https://www.linkedin.com/feed/`.
3. Click the PoC extension icon to open the popup.
4. (Optional) Open composer manually, or let **Fill composer** click `Start a post`.
5. Click **Fill composer** with a known test value.
6. Click **Check current composer text** — value should match.
7. Optional sanity: append one char manually; content should stay stable.
8. Do not submit post during PoC runs.

## Verdict

See `docs/journal/2026-05-08-poc-paste-fill.md` final section (2026-05-09). Current verdict: **⚠️ Modifies** (runtime API approach confirmed on LinkedIn; Quill route observed in this session).
