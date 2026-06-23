# PoC 3 — production composer write path (retrospective, compact)

Date range: 2026-05-08 → 2026-05-09
Status: closed

## Original question

Can extension-driven write logic reliably set content in a production site's post composer without relying on synthetic paste/input events?

---

## What was actually validated

### Final validated path (live, logged-in Chrome)

1. Find/click `Start a post` via `button,[role="button"]` (exact normalized text).
2. Detect composer inside open shadow root (`div#interop-outlet.theme--light`).
3. Wait briefly for runtime mount; resolve editor handle.
4. Write/read via editor runtime API (no synthetic input/paste/change events).

Observed successful extension result (`0.0.5`):
- `ok: true`
- `route: root.query.__quill`
- `editorClass: editor-content ql-container`
- `attempts: 4`
- value round-tripped correctly.

Timing probe (same surface):
- dialog appears ~101ms after click
- editor + runtime handle appear ~409ms

So modal shell appears first; editor runtime is async shortly after.

---

## Investigation flow (compressed)

### Phase A — initial blocked run
- Extension repeatedly returned `COMPOSER_NOT_FOUND`.
- Early framing blamed generic context/timing mismatch.

### Phase B — first real root cause
- Composer was behind open shadow DOM; light-DOM `querySelector` and `allFrames` did not reach it.
- `Start a post` finder was also wrong initially (`div` in candidate set matched page root by descendant text).

### Phase C — hypothesis pivot
- Pivoted from synthetic paste logic to runtime-API mutation.
- Hypothesis was initially phrased as Lexical + React fiber walk.

### Phase D — live surface reality check
- On validated session, composer was Quill-shaped:
  - editable node: `.ql-editor[contenteditable="true"][role="textbox"]`
  - runtime handle: `.editor-content.ql-container.__quill`
- React fiber markers were not observed on the effective path.
- Runtime API (`setText/getText`) worked; append preserved content.

### Phase E — extension hardening for PoC reliability
- Switched execution to `world: 'MAIN'` so page runtime handles are visible.
- Replaced deep/global scans with deterministic staged flow:
  - click trigger
  - detect shadow-root modal
  - progressive short waits for runtime handle
  - write + read-back
- Added extension version stamping in logs to avoid stale-build confusion.

---

## Retrospective notes (wrong turns and misses)

### Wrong turns

1. **Over-trusting light-DOM selectors and frame iteration**
   - Treated missing nodes as frame/timing issue first.
   - Real issue was shadow-root boundary.

2. **Brittle trigger finder**
   - Included `div` in candidates and regex on descendant text.
   - This produced false hits on app containers.

3. **Assuming Lexical/fiber as mandatory target path**
   - Useful as a possible route, but not a guaranteed one on live production surfaces.
   - Concrete session validated Quill runtime path instead.

4. **Late adoption of `MAIN` world**
   - Isolated world obscured runtime handles (`__quill`), causing false negatives.

5. **Over-expensive global discovery loops**
   - Full-tree recursive scans caused latency and instability.
   - Staged/scoped checks were faster and more reliable.

### What was missed at those moments

- Shadow-root detection should have been first diagnostic after first selector miss.
- Modal-shell vs editor-runtime two-phase mount should have been measured early (timed probe).
- Runtime-handle checks should have been scoped to active composer root from the start.
- Versioned popup logs should have been introduced earlier to eliminate stale-code uncertainty.

---

## Confirmed conclusions for PoC 3

- Synthetic event simulation is not required for this surface.
- Shadow-aware discovery is required.
- Runtime API mutation is implementable and reliable on the validated production session.
- **Execution world choice is architectural:** runtime-handle access (`__quill` and similar page-owned objects) required `chrome.scripting.executeScript(..., { world: 'MAIN' })` in this PoC path; isolated world produced false negatives.
- Practical implementation must be runtime-adaptive (Quill confirmed here; Lexical/fiber may exist on other builds/surfaces).

## Verdict

⚠️ **Modifies** the strict Lexical/fiber framing.

The core hypothesis stands (runtime API path works), but the validated live route was Quill runtime handle resolution rather than React-fiber-to-Lexical discovery.

Additionally, this PoC establishes primary architectural constraints for this write primitive:

1. **Page-runtime mutations must run in `MAIN` world** when the strategy depends on page-owned editor instances.
2. **DOM discovery should be progressive and intent-scoped, not full-scan-first** on complex SPAs with shadow DOM.

### Recommended strategy

1. **Tiered discovery (cheap → expensive)**
   - Start with fast probes:
     - active element chain (`document.activeElement` + `shadowRoot.activeElement`)
     - visible dialogs/popovers
     - clickable controls in viewport
   - Only escalate to deeper traversal if needed.

2. **Scope by intent**
   - If action is “click button”, search visible `button,[role=button]` first.
   - If action is “fill text”, scope to:
     - focused control
     - active modal root
     - nearest editable subtree
   - Avoid global query for every action.

3. **Viewport-first + hit-testing**
   - Use `elementsFromPoint` around interaction regions (center, cursor, target rect).
   - Resolve nearest shadow host and search only that root.

4. **Stable route caching**
   - Cache successful element routes:
     - host chain + selector + role/name signature
   - Revalidate quickly next time; fallback to discovery only on miss.

5. **Runtime-handle detection as a specialized pass**
   - For hostile editors, run targeted runtime probes (`__quill`, lexical/fiber patterns) only inside scoped root.
   - Keep this separate from generic DOM discovery.

6. **Two-mode operation**
   - **Fast mode (default):** bounded latency budget, scoped queries, cached routes.
   - **Explain/debug mode:** deeper traversal + rich diagnostics for agent reasoning.

7. **Agent-facing DOM model = summarized graph, not raw tree**
   - Return:
     - interactive nodes
     - shadow boundaries
     - modal/layer structure
     - candidate actions per node
   - Include confidence and discovery path (why this node was selected).
