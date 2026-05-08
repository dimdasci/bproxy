# PoC 3 — Paste-flavored writes on real frameworks

## Question

Does the paste-flavored input pattern (native value setter + `InputEvent('beforeinput'/'input', { inputType: 'insertFromPaste' })` + `Event('change')`) update controlled state in a real React/Vue application form?

## Run (extension flow)

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `poc/paste-fill/extension/`.
2. Open LinkedIn feed: https://www.linkedin.com/feed/
3. Click **Start a post** so the composer modal is visible.
4. Click the PoC extension icon.
5. Click **1) Fill composer**.
6. Manually type one extra character in the composer (for example `!`).
7. Click **2) Check current composer text**.
8. Observe:
   - The value was inserted by the extension.
   - After your manual extra character, text is preserved (`<inserted><typed-char>`), not reset.

If needed, you can still use `snippet.js` manually as fallback.

Findings → `docs/journal/2026-05-08-poc-paste-fill.md`.
