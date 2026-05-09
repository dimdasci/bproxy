# PoC 3 — Paste-flavored writes on real frameworks

Date: 2026-05-08
Status: blocked

## Question

Does the paste-flavored input pattern update controlled state in a real React/Vue application form, such that the user's eventual submit sends the pasted values?

## Method

Two PoC paths were prepared:

1. Devtools snippet (`poc/paste-fill/snippet.js`).
2. Minimal Chrome MV3 extension (`poc/paste-fill/extension/`) to avoid console-paste friction.

### Extension used for testing

`poc/paste-fill/extension/` contains:
- `manifest.json` — popup + scripting permissions
- `popup.html` / `popup.js` — controls for `Fill composer`, `Check current composer text`, `Dump DOM snapshot JSON`
- `background.js` — runtime injection helper
- `content.js` — structured DOM snapshot producer

### How DOM structure was shown

The popup `Dump DOM snapshot JSON` action executed script in all frames and printed structured JSON with:
- `frameId`
- `frameHref`
- `documentTitle`
- `elements[]` (interactive/contenteditable candidates with role/type/selector/text)
- truncated page text

This was used as the PoC stand-in for the planned `elements/dom` discovery pattern.

### How selectors were used

- Initial fill/check used broad contenteditable selectors.
- Then switched to user-provided LinkedIn-specific selectors.
- Then switched to the exact inspected target selector requirement:
  - `div.ql-editor[contenteditable="true"][role="textbox"]`
- Fill/check were run with `allFrames: true` and per-frame diagnostics.

## Finding

### Blocker

Despite the element being visible in DevTools inspector and user-provided outerHTML confirming it exists in the modal, extension-driven execution repeatedly returned `COMPOSER_NOT_FOUND` in every reachable frame.

Observed behavior:
- Snapshot output repeatedly showed feed-level DOM (including “Start a post”) but not the modal editor node.
- Multiple selector revisions were attempted without success.
- Per-frame execution diagnostics (`allFrames`) still showed no matches.

This indicates a context/timing mismatch for this specific LinkedIn modal in this PoC setup (inspector-visible node not reliably reachable from the extension execution path used).

### What was attempted before stop

- Added structured snapshot action.
- Added all-frames fill/check diagnostics.
- Reworked selectors multiple times based on real DOM and user-provided HTML.
- Added fallback to click “Start a post” and poll for editor appearance.

Still unresolved within PoC execution time.

## Implication

PoC could not validate or invalidate paste-flavored write behavior on LinkedIn composer in this run due to element-targeting blocker. This is a tooling/context blocker, not evidence against ADR-007 itself.

## Verdict

⚠️ **Inconclusive (blocked)** — hypothesis not validated in this target flow.

## Artifacts

- `poc/paste-fill/snippet.js`
- `poc/paste-fill/extension/`

---

## 2026-05-08 (continued) — root cause is shadow DOM, not selectors or timing

Drove a fresh LinkedIn feed tab via the `claude-in-chrome` MCP and re-ran the PoC's logic step-by-step against the live DOM. Three things came out, in increasing order of importance.

### The PoC's "Start a post" click finder picks the wrong element

The fallback click in `poc/paste-fill/extension/popup.js`:

```javascript
const startPostCandidates = Array.from(document.querySelectorAll('[role="button"], button, div'));
const startPost = startPostCandidates.find((el) => /start a post/i.test((el.textContent || '').trim()));
```

`querySelectorAll` returns elements in document tree order. Including `div` in the union means *every* div on the page is a candidate, and `regex.test(textContent)` matches descendant text recursively. The first hit is the React root — `<div id="root">`. Confirmed live: textLen 12953 chars, containing the entire page text. Clicking the React root does nothing.

Querying only `[role="button"], button` and using exact-string comparison `el.textContent.trim() === 'Start a post'` finds the real trigger (a `<div role="button">` with rect 464×46, no `aria-label`, obfuscated class names). `.click()` on that element opens the modal.

### `div.ql-editor` does not match current LinkedIn

Zero `ql-editor` elements anywhere on the feed, before or after the modal opens. The selector likely came from an older LinkedIn build or a Stack-Overflow snippet. Moot, given finding #3 below — but worth recording so the next attempt doesn't repeat it.

### The composer's editor is inside an open Shadow DOM root

When the modal is visibly open (verified via screenshot — placeholder "What do you want to talk about?" is right there), the main document reports:

- `document.querySelectorAll('[contenteditable]').length === 0`
- `document.body.textContent.includes('talk about') === false`
- Zero text nodes anywhere under `document.body` match the placeholder

The placeholder text exists in exactly one place: a Shadow DOM root (mode `open`) attached to a DIV on the page. `document.elementsFromPoint` at the composer center returns a stack whose topmost element has its `shadowRoot` populated.

`document.querySelector` does not pierce shadow boundaries. `chrome.scripting.executeScript({ allFrames: true })` does not either — shadow roots are *not* frames; they are same-document encapsulation. That is why the original journal's per-frame `allFrames` diagnostics reported no matches in any frame: the editor isn't in *any* frame. It is behind a shadow wall in the *main* frame.

This reframes the previous verdict ("context/timing mismatch"). The execution context is correct. The timing isn't the issue. Per-frame iteration won't help. The lookup primitive itself is wrong for this surface.

### What this changes in the investigation

- Element discovery for `select`/`fill` needs a shadow-piercing recursive walker (traverse `element.shadowRoot` at every node) before this PoC's hypothesis can even be tested on LinkedIn.
- Shadow DOM encapsulation isn't a LinkedIn quirk. JS-heavy sites and design systems use it routinely. The bproxy `elements/dom` discovery action almost certainly needs to traverse shadow roots in production. Recording the finding here; *not* amending any ADR yet — investigation continues.
- The original three questions remain answerable; just not on this surface with the current discovery primitive.

### Still open

- Does shadow-piercing query land the live editor element? Need to confirm by walking the open shadow root and matching by visible attributes (likely `[role="textbox"]`, `[contenteditable]` of some flavor, or aria-labelled).
- Once the editor is in hand, which write technique actually mutates it? The PoC's current approach (`innerHTML=''` + `appendChild(<p>)` + `InputEvent({inputType:'insertFromPaste'})`) is unlikely to update controlled state in modern rich-text editors — they reconcile DOM mutations away on next render. More plausible candidates: `ClipboardEvent` carrying a real `DataTransfer`, or `execCommand('insertText', false, value)`. To be probed next.
- ADR-007's framing was `<input>`/`<textarea>` paste behavior on Welcome-to-the-Jungle-style forms. That surface and contenteditable rich-text surfaces are arguably two separate experiments; the verdict on one doesn't decide the other. Worth keeping the LinkedIn probe and the original ADR-007 spike distinct.

### Tools used

- `claude-in-chrome` MCP driving a real Chrome tab on `https://www.linkedin.com/feed/`.
- Probes ran via the `javascript_tool` MCP action against the page; outputs returned as JSON.
- No edits to the PoC extension yet — diagnostic-only.

### Status

Investigation continuing. Verdict from the previous section unchanged for now. The original ⚠️ Inconclusive (blocked) reflected a tooling-level surprise; this addendum names the surprise (shadow DOM encapsulation) and points to the next concrete experiment (shadow-piercing discovery, then write technique probe against a real editor element).

---

## 2026-05-08 (further) — external evidence: Lexical, isTrusted, and the prior art

Stopped probing and ran three targeted web searches to see whether 2025–2026 community knowledge would save us from a long empirical loop. Two DEV articles by the same author — running an MCP server that posts to LinkedIn, which is bproxy's exact context — gave high-signal data.

### LinkedIn's composer is Lexical (as of April 2026)

Per [LinkedIn Quietly Migrated From ProseMirror to Quill — achiya-automation, DEV](https://dev.to/achiya-automation/linkedin-quietly-migrated-from-prosemirror-to-quill-and-broke-every-browser-automation-tool-that-4927) and [The 3 isTrusted:false Bugs That Made LinkedIn Posts Impossible From My MCP Server — achiya-automation, DEV, Apr 22 2026](https://dev.to/achiya-automation/the-3-istrustedfalse-bugs-that-made-linkedin-posts-impossible-from-my-mcp-server-102f), the post composer has churned through three editor frameworks in succession: **ProseMirror → Quill → Lexical**. The `div.ql-editor` selector the original PoC tried was correct for a brief Quill window earlier this year and is now stale. Current production target is Meta's Lexical.

### Synthetic paste events are explicitly rejected by the editor

The April 22 article documents three concrete `isTrusted: false` failures the author hit:

1. Synthetic `blur()` triggered `focusout` on the dialog, dismissing the modal before content persisted.
2. The editor's paste handler explicitly rejects events with `isTrusted: false`. This blocks programmatic `ClipboardEvent`. It also blocks `execCommand` fallbacks.
3. OS-level real Cmd+V via CGEvent had its own focus-stealing problem on Safari.

What ultimately worked for the author: bypass synthetic events entirely. Locate the Lexical editor instance in React's fiber tree and call `editor.setEditorState()` directly with the desired document structure. Higher-level than ADR-007's `fill` primitive — requires per-editor knowledge and React-internals traversal. The `isTrusted` rejection pattern reproduced across two consecutive editor frameworks (ProseMirror, then Lexical), suggesting it's a deliberate hardening pattern in LinkedIn's wrapper code, not a quirk of one library.

### What this changes in our model

- **The shadow DOM observation may be a fresh change.** Neither article mentions shadow DOM; the second describes the composer as a regular `<div role="dialog">` in the main document. We observed the composer's placeholder text inside a Shadow DOM root just two weeks later. Either LinkedIn introduced shadow encapsulation since (plausible — they ship aggressively), or we're looking at a different surface than the author was, or the article's selectors worked at the time because the composer wasn't shadowed yet. Worth verifying tomorrow; doesn't change the practical conclusions below.
- **The paste-flavored write hypothesis is almost certainly false on LinkedIn.** The editor checks `isTrusted` on its paste handler. We will hit a wall even after we pierce the shadow root. Confirmed across two editor migrations.
- **ADR-007's original Welcome-to-the-Jungle target is probably still fine.** Plain `<input>`/`<textarea>` forms don't typically have an `isTrusted` gate in user-land code. The `fill` paste-event approach should still validate there. Different surface, different verdict.
- **The PoC's original framing is two PoCs in disguise.** "Validate paste-flavored writes on real frameworks" is genuinely answerable on traditional form inputs (likely ✅) but needs a separate experiment for framework-mounted rich-text editors (likely ⚠️ — works only via editor-instance API access). Worth keeping the LinkedIn surface separate from the Welcome-to-the-Jungle surface in the final verdict.
- **The bproxy `fill` primitive likely needs to be tiered.** Default path = paste events for traditional inputs. Escape hatch = framework-aware editor-instance API access for known rich editors (Lexical, ProseMirror, Quill) detected by sniffing the focused element's React fiber. Not capturing this in ADR yet — investigation continuing.

### Other community signal

[browser-use issue #3829](https://github.com/browser-use/browser-use/issues/3829) confirms that the broader headless-browser community treats `isTrusted` propagation as a load-bearing automation-detection signal. Not LinkedIn-specific; pattern is widespread.

[LinkedIn Engineering's 2016 Artdeco overview](https://engineering.linkedin.com/blog/2016/05/speaking-the-same-language) describes the design system but predates the shadow-DOM work and the Lexical migration by years. The shadow encapsulation we observed is more recent than 2016; the search didn't surface a public reference for the specific change.

### Still uncertain — to verify when investigation resumes

- Whether the Lexical editor instance is reachable from outside the shadow root via React fiber traversal, or only from inside it. This determines the shape of the bproxy primitive.
- Whether the `isTrusted` check is in Lexical's core or in LinkedIn's wrapper around it. Matters for whether the same trick generalises to other Lexical sites.
- The exact attribute on the editor element under the current build — likely `[data-lexical-editor]` per Lexical convention.
- Whether the structural framing of the modal has actually changed (shadow DOM vs `[role="dialog"]` in main DOM) since the April 22 article, or whether we hit a different composer surface than the author did.

### Pause point — to continue 2026-05-09

Pausing for the day. Next concrete steps (not yet executed):

1. Shadow-piercing walker probe: enumerate every `element.shadowRoot` recursively, find the editor element by Lexical's conventional attributes (`[data-lexical-editor]`), capture its structure.
2. React fiber probe: from the editor element, walk `__reactFiber$*` upward to find the Lexical editor instance, confirm `editor.setEditorState` is reachable from outside the shadow root.
3. Decide PoC 3's verdict shape: probably split into two — Welcome-to-the-Jungle (paste events on traditional inputs) and LinkedIn (editor-instance API on Lexical). Two surfaces, two verdicts.

### Sources consulted (2026-05-08)

- [LinkedIn Quietly Migrated From ProseMirror to Quill — DEV / achiya-automation](https://dev.to/achiya-automation/linkedin-quietly-migrated-from-prosemirror-to-quill-and-broke-every-browser-automation-tool-that-4927)
- [The 3 isTrusted:false Bugs That Made LinkedIn Posts Impossible From My MCP Server — DEV / achiya-automation, Apr 22 2026](https://dev.to/achiya-automation/the-3-istrustedfalse-bugs-that-made-linkedin-posts-impossible-from-my-mcp-server-102f)
- [Bug: Synthetic Events Leak Automation with isTrusted — browser-use issue #3829](https://github.com/browser-use/browser-use/issues/3829)
- [Speaking the Same Language — LinkedIn Engineering (Artdeco overview, 2016)](https://engineering.linkedin.com/blog/2016/05/speaking-the-same-language)

---

## 2026-05-09 — Welcome to the Jungle disqualified as a target

The plan's suggested first target, Welcome to the Jungle (`https://www.welcometothejungle.com/`), is **out of scope** for PoC 3.

Reason: the site's login flow does not complete for Dim in his Chrome — not a "login is required" gate (which would still let us reach a public Apply page), but the auth endpoint itself failing to produce a working session. Without a session we can't reach the application form behind it.

This is an environmental block on the test harness, not evidence about the hypothesis. PoC 3's target needs to be a different React/Vue application-form surface that's reachable without sign-in. Specific replacement TBD; the user will pick.

---

## 2026-05-09 — constraint: extension-only, no script injection

The "devtools-pasted snippet" path described in the original Method (`poc/paste-fill/snippet.js`) is **abandoned** and will not be revisited.

What failed:
- Console-paste friction (browsers gating `allow pasting`) made the loop slow and inconsistent.
- The snippet runs in the page's main world but with the user gesture/origin context of devtools, which interacts unpredictably with focus, clipboard, and `isTrusted` checks.
- It does not reflect how the production primitive will execute, so a ✅ in the snippet would not transfer.

Going-forward rule (binds all future PoC work and production design):

- **Only the extension surface is used to exercise write/read primitives.** All probes go through `chrome.scripting.executeScript` (or content scripts) from the PoC extension at `poc/paste-fill/extension/`, the same path the production `bproxy` extension will use.
- **`snippet.js` is kept committed as a historical artifact only.** Do not extend it, do not run it, do not reference it as a fallback when extension-side probes are inconvenient.
- **"Just paste this in the console" is not a valid investigation step.** If a probe is hard to run from the extension, fix the extension — the friction is the signal that the production primitive would have the same problem.

Why this matters: bproxy's whole premise is that the extension is the execution surface. Any technique that only works from devtools is a dead end by construction.

---

## 2026-05-09 — PoC 3 pivot: fiber-walk on LinkedIn post composer (subsumes traditional-input question)

PoC 3's question is rewritten. The old framing — "do paste-flavored writes update controlled state on traditional `<input>`/`<textarea>` forms?" — is **subsumed** by the new one, not just deferred.

### New question

Can the bproxy extension write text into LinkedIn's post composer (Lexical-backed contenteditable, inside an open shadow root, with the editor's paste handler gating on `isTrusted`) by:

1. Locating the editor element via a shadow-piercing recursive walker rooted at `document`.
2. Walking React fibers (`__reactFiber$*` / `__reactProps$*`) up from that element to obtain the Lexical editor instance.
3. Mutating editor state via the editor's own API (`editor.update()` / `editor.setEditorState()`) — no synthetic `InputEvent` / `ClipboardEvent` / `Event('change')`.

### Why subsumed, not deferred

Fiber-walk is strictly more powerful than paste-flavored writes:

- Bypasses the `isTrusted` gate (no synthetic events involved).
- Survives shadow-DOM encapsulation (we already pierce shadow roots to locate the element).
- Works regardless of framework reconciliation (we talk to the framework, not fake input to it).
- Generalises to traditional inputs: the same fiber-walk technique lands on any React/Vue component holding form state — terminating at a different node, but the technique is the same.

There is no scenario in bproxy's design where paste-flavored writes would succeed but fiber-walk would not. The inverse fails routinely — LinkedIn is the canonical example. So validating fiber-walk on the harder surface answers both the LinkedIn question and the traditional-input question; the original PoC 3 framing closes with the LinkedIn verdict alone.

### What this changes in the plan

`docs/plans/phases/00-poc.md` Task 3 is rewritten around the fiber-walk technique on LinkedIn. The Goal, Tech Stack, and File Structure sections are updated to match. Steps now exercise the existing PoC extension (`poc/paste-fill/extension/`) rather than describing a fresh scaffold; `snippet.js` remains a historical artifact, not a runnable path.

### What this does NOT change yet

`docs/decisions.md` (ADR-007 and adjacent), `docs/architecture.md`, and `docs/solution/*` are **untouched** by this pivot. The fiber-walk method is a hypothesis until PoC 3 confirms it. ADR-007 — and the broader question of whether the production `fill` primitive should be tiered (fiber-walk default, paste events as a cheap path for known-friendly sites) — is a separate task, downstream of the PoC 3 verdict, not inside it.

### Practical consequence

The journal section that closes PoC 3 produces a single verdict on the fiber-walk hypothesis on LinkedIn's post composer. ADR work happens after, not inside, this PoC.

---

## 2026-05-09 (later) — live DOM validation on Dim's logged-in LinkedIn: Quill instance path works; React-fiber/Lexical path not observed

Resumed investigation against the real Chrome session (remote debugging on `9222`) with LinkedIn feed open and the post composer modal visibly open.

### What was validated

1. **Composer is reachable only through shadow-aware traversal in this session.**
   - Main document queries return no direct editor candidates (`[contenteditable]`, `[role="textbox"]`, `[data-lexical-editor]` all absent in light DOM).
   - Composer/modal content is found under an open shadow root hosted on `div.theme--light`.

2. **The live editor element in this build is Quill-shaped.**
   - Located element: `div.ql-editor[contenteditable="true"][role="textbox"]`.
   - Placeholder attrs present (`data-placeholder` / `aria-placeholder`: "What do you want to talk about?").

3. **React fiber markers were not found on the editor path.**
   - No `__reactFiber$*` / `__reactProps$*` keys on the editor element or inspected ancestors in this modal subtree.

4. **A Quill instance is directly reachable and mutable.**
   - Found at `div.editor-content.ql-container.__quill`.
   - Confirmed API methods: `setText`, `getText`, `setContents`, `getContents`, `focus`.
   - Verified write/read loop in-session:
     - `setText("bproxy quill test <timestamp>")` succeeded.
     - `getText()` returned the exact value.
     - `insertText(...)` appended one extra char and preserved prior content.

### Implication for PoC 3 hypothesis

- The currently observed LinkedIn surface in this session does **not** match the strict Lexical+fiber route assumed by the rewritten PoC question.
- However, the higher-level principle is still supported: **synthetic events are unnecessary** when we can reach the editor's own runtime instance and mutate through its API.
- On this concrete build/profile, that runtime instance is Quill (`__quill`), not a discovered Lexical instance via React fiber.

### Status update

PoC evidence now supports an implementable extension path on live LinkedIn using:
- shadow-piercing discovery
- editor-runtime API write/read

The exact runtime binding must remain adaptable (Quill here; potentially Lexical/fiber on other LinkedIn builds/surfaces).

---

## 2026-05-09 (final) — PoC 3 verdict on live LinkedIn session

Ran the extension end-to-end (version `0.0.5`) against Dim's logged-in LinkedIn tab.

### Final method used

1. Find and click visible `Start a post` control (`button,[role="button"]`, normalized exact text).
2. Detect composer modal in open shadow root (`div#interop-outlet.theme--light` host).
3. Resolve editor runtime handle with progressive short waits (`__quill` appears shortly after modal shell).
4. Write/read through editor API (`setText` / `getText`), no synthetic input/paste/change events.

### Observed result

Successful fill log:

- `ok: true`
- `route: "root.query.__quill"`
- `editorClass: "editor-content ql-container"`
- `attempts: 4`
- `value: "PoC LinkedIn test"`

Timing probe confirmed async mount sequence in this build:
- dialog first seen at ~101ms
- editor + `__quill` first seen at ~409ms

### Verdict

⚠️ **Modifies** the strict fiber-walk/Lexical framing.

- The PoC confirms the core hypothesis that **editor-runtime API mutation is implementable** on LinkedIn and avoids synthetic-event gates.
- In the validated live surface, the working runtime is **Quill (`__quill`)**, not Lexical discovered through React fiber.
- Therefore the practical PoC outcome is runtime-adaptive editor API access (Quill confirmed here; Lexical/fiber remains a possible variant on other builds).
