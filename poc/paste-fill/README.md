# PoC 3 — Write technique for hostile rich-text editors

> Directory name kept as `paste-fill/` for git-history continuity; the PoC has pivoted away from paste-flavored writes. See `docs/journal/2026-05-08-poc-paste-fill.md` § "2026-05-09 — PoC 3 pivot" for the rationale.

## Question

Can the bproxy extension write text into LinkedIn's post composer (Lexical-backed contenteditable, inside an open shadow root, with the editor's paste handler gating on `isTrusted`) by:

1. Locating the editor element via a shadow-piercing recursive walker rooted at `document`.
2. Walking React fibers (`__reactFiber$*` / `__reactProps$*`) up from that element to obtain the Lexical editor instance.
3. Mutating editor state via the editor's own API (`editor.update()` / `editor.setEditorState()`) — no synthetic `InputEvent` / `ClipboardEvent` / `Event('change')`.

The original question (paste-flavored writes on traditional `<input>`/`<textarea>` forms) is **subsumed** by this one — fiber-walk is strictly more powerful and answers both. Detail in the journal pivot section.

## Constraints

- **Extension-only execution.** All probes and primitive calls run through `chrome.scripting.executeScript`, content scripts, and popup-driven actions in `extension/`. No devtools-pasted snippets, no `javascript:` URLs, no console-paste fallbacks. `snippet.js` is a historical artifact and is not used.
- **No decision-doc edits during this PoC.** The fiber-walk method is a hypothesis. `docs/decisions.md` (ADR-007 and adjacent), `docs/architecture.md`, and `docs/solution/*` are revisited as a separate task only **after** PoC 3 closes with a verdict.

## Run

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `poc/paste-fill/extension/`.
2. Open `https://www.linkedin.com/feed/`.
3. Click the PoC extension icon to open the popup.
4. Click **Open composer** — the "Start a post" trigger is invoked; the modal should appear.
5. Click **Fill composer** with a known test value (entered in the popup's input field).
6. Click **Check current composer text** — the value is read back through the same fiber path used to write it.
7. Manually type one extra character at the end of the composer. The composer must preserve `<inserted><typed-char>`, not reset.
8. Optionally: walk LinkedIn's own preview / post-confirmation flow far enough to verify the content is treated as legitimate. **Do not submit.**

## Verdict

Captured at the bottom of `docs/journal/2026-05-08-poc-paste-fill.md` once PoC 3 closes. ADR amendments — if any — happen as a separate task downstream of the verdict.
