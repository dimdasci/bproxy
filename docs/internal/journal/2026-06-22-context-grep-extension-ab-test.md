# Context-grep extension A/B test — planning session

**Date:** 2026-06-22  
**Context:** Parallel planning sessions for issue #21 (agentic session ergonomics). Same operator, same model (`claude-opus-4-6-v1`), same prompts, same starting commit (`d5537fa`). Lane A had the context-grep Pi extension enabled; Lane B ran with `--no-extensions`.

## Setup

Two git worktrees from main:

| Lane | Branch | Extension | Session ID |
|------|--------|-----------|------------|
| A | `feat/21-agentic-ux-lane-a` | context-grep enabled | `019ef0b8-11ca-79c9-957f-93e772c48f3a` |
| B | `feat/21-agentic-ux-lane-b` | `--no-extensions` | `019ef0b8-820e-7504-afc9-7d903616d2dc` |

Task: read issue #21, review against architecture/ADRs, produce a phase 10 implementation plan, self-review and fix.

## Quantitative results

### Session-level metrics

| Metric | Lane A (ext) | Lane B (no ext) | Delta |
|--------|-------------|-----------------|-------|
| Wall clock | ~20 min | ~22 min | B +10% |
| User messages | 4 | 5 | B needed extra confirmation turn |
| Assistant turns | 36 | 46 | B +28% |
| Tool calls | 42 | 49 | B +17% |
| Total cost | $2.28 | $2.58 | B +13% |
| Plan doc size | 13.9 KB | 19.6 KB | B +41% larger |

### Tool usage breakdown

| Tool | Lane A | Lane B |
|------|--------|--------|
| `read` | 21 | 17 |
| `bash` | 17 | 29 |
| `edit` | 3 | 2 |
| `write` | 1 | 1 |
| grep/rg commands (subset of bash) | 8 | 18 |
| cat commands (subset of bash) | 0 | 6 |

### Thinking depth

| Metric | Lane A | Lane B |
|--------|--------|--------|
| Turns with thinking | 13/36 (36%) | 8/46 (17%) |
| Total thinking chars | 15,088 | 6,897 |
| Avg thinking length | 1,161 chars | 862 chars |
| Max thinking block | 6,535 chars | 5,783 chars |

### The mechanism: enrichment per grep call

| Metric | Lane A | Lane B |
|--------|--------|--------|
| Grep/rg calls | 8 | 18 |
| Enriched results | 7/8 (87%) | 0/18 (0%) |
| Total grep result chars | 18,164 | 8,784 |
| Enrichment chars appended | 13,248 | 0 |
| **Info per grep call** | **2,271 chars** | **488 chars** |

Lane A received 4.6× more context per search call. Each enriched grep showed the enclosing function/interface body and callers — information that Lane B needed 2–3 follow-up greps to assemble.

## Qualitative observations

### Code exploration strategy

- **Lane A** (with enrichment): prefers `read` for full file context. Uses grep to locate, then reads entire relevant files. Fewer but more targeted searches.
- **Lane B** (no enrichment): prefers iterative `grep` + `cat` for surgical extraction. More round-trips to accumulate equivalent understanding.

The enrichment output told Lane A *which files to read in full* — the AST containers and back-references pointed to specific functions and their callers. Lane B had to discover the same call graph through repeated grep.

### Thinking vs. tool-calling trade-off

Lane A substituted **internal reasoning** for tool calls. With richer context per search, it could synthesize architecture alignment checks mentally (6,535-char and 3,452-char thinking blocks during review). Lane B substituted **more tool calls** for thinking — running 16 bash commands during its review phase versus Lane A's 4.

### Interaction flow

Lane A completed in 4 user messages (review → plan → self-review+fix → commit). Lane B needed 5 — after producing review findings, it presented them and waited for human approval ("Yes") before applying edits. This is a minor autonomy difference, not clearly extension-caused.

### Design choices diverged

| Decision | Lane A | Lane B |
|----------|--------|--------|
| `text --after` | Protocol-level (extension does slicing) | CLI-local post-processing |
| `links` result with offset | No `total` field added | Adds `total` + `capped` (breaking change) |
| Window focus on tab activate | Not mentioned | Explicit `windows.update` + seam |
| Collection safety cap | Not mentioned | 2000-link `MAX_COLLECTION_CAP` |

Lane B's extra grep cycles traversed implementation details (e.g., `exit.ts`, `command.ts`) that informed different architectural decisions. The extension made Lane A more efficient but potentially reduced incidental exposure to adjacent code paths.

## Consistency with Phase 9 validation

Phase 9 experimental data for investigation tasks:

| Metric | Phase 9 reported | This session |
|--------|-----------------|--------------|
| Turn reduction | −44% | −22% |
| Search command reduction | −53% | −56% |
| Bash call reduction | −56% | −41% |

Smaller turn reduction is expected — planning is less search-intensive than pure investigation. The search-reduction signal (−56% grep calls) is almost identical, confirming the same mechanism operates: enrichment eliminates iterative grep→grep→grep refinement cycles.

## Confounds and limitations

1. **Single data point.** LLM generation is non-deterministic. One session cannot separate extension effect from random variance. The implementation sessions (lane-a-02, lane-b-02, ...) will add more signal.
2. **Plan quality is subjective.** Lane B produced a more defensive plan with more edge cases documented; Lane A produced a leaner, more actionable plan. Neither is clearly superior without implementation outcome data.
3. **Incidental learning.** Lane B's extra grep cycles exposed it to code it wouldn't otherwise have seen (ExitPlan pattern, command.ts handle flow), leading to different design decisions. Efficiency and comprehensiveness may trade off.
4. **Same operator.** Prompts were near-identical but not byte-identical (minor whitespace/newline differences in user turn 2).

## Conclusion

The context-grep extension demonstrably reduced search iterations (8 vs 18 grep calls) and total turns (36 vs 46) while maintaining plan quality. The mechanism matches the Phase 9 design hypothesis: AST containers + back-references eliminate iterative search refinement. The efficiency gain came with a potential trade-off in incidental code exposure that led to different (not worse) design choices.

Implementation sessions will test whether this planning-phase efficiency translates to fewer bugs, faster convergence on passing `pnpm check`, or merely faster wall-clock time with equivalent quality.

---

## Session 02: Feature 1 implementation (`tab.activate`)

**Sessions:**
- Lane A: `019ef0ce-dd51-7447-9290-c9d732c04e68`
- Lane B: `019ef0ce-8781-722d-93f1-4bc15ef7e0d9`

### Outcome

Both lanes successfully implemented `tab.activate`. Both pass `pnpm check` and `pnpm test`. Both committed.

| Metric | Lane A (ext) | Lane B (no ext) | Delta |
|--------|-------------|-----------------|-------|
| Wall clock | ~30.5 min | ~20.5 min | **A slower (+49%)** |
| User messages | 4 | 3 | A needed extra turn |
| Assistant turns | 56 | 78 | B +39% |
| Tool calls | 60 | 83 | B +38% |
| Edits | 16 | 22 | B +38% |
| Reads | 23 | 33 | B +43% |
| pnpm runs | 8 | 14 | B +75% |
| Output tokens | 12,545 | 16,504 | B +32% |
| Total cost | $3.36 | $3.82 | B +14% |
| Code diff (excl. docs) | +74 / −2 | +119 / −4 | B +61% larger |
| Tests added | 179 total | 180 total | B +1 test |

### Key observation: Extension enrichment did NOT fire

Unlike the planning session, **zero grep results were enriched in either lane**. The greps during implementation were:
- File-listing greps (`grep -rn "tab" ... -l`)
- Test output filtering (`pnpm test | grep -E "(FAIL|PASS)"`)
- Pattern matching for insertion points (`grep -n "tab\." service/src/schemas.ts`)

These produce short outputs (68–627 chars) with few matching lines — likely below the enrichment threshold or not matching the enrichment trigger patterns (the extension requires successful grep output with file:line format to enrich). The implementation workflow is fundamentally different from investigation: it's edit→verify cycles, not search→understand cycles.

### Wall clock paradox: Lane A was slower despite fewer turns

Lane A took 30.5 minutes vs Lane B's 20.5 minutes, despite making fewer tool calls and fewer assistant turns. Two factors:

1. **Extra user interaction.** Lane A's agent asked for confirmation ("Good, Feature 1 is complete, isn't it?") and the operator replied "yes" — this added a human-in-the-loop round-trip. Lane B's agent also asked the same question but the operator immediately gave the final commit instruction without a separate "yes" turn.

2. **Test failure debugging.** Lane A hit a test assertion mismatch (`activates a tab via tabs.update`) and needed an extra pnpm cycle to fix it. The 77s spent in turn 3 ("yes") was entirely debugging a test expectation.

### Implementation approach comparison

**Lane A (16 edits, 13 files):** Leaner implementation. Wrote `activate.ts` CLI command, added to shared types, service routing, extension handler. Test came last and needed one fix cycle.

**Lane B (22 edits, 15 files):** More thorough. Additionally edited `protocol-shape.assertions.ts` and `action-contract.test.ts`. Larger test suite in browser-actions (58 lines vs 27). Added window focus behavior (`windows.update`). Ran `pnpm format:fix` explicitly. Hit formatting issue → fixed → re-ran check → pass.

### Design differences in the implementation

| Aspect | Lane A | Lane B |
|--------|--------|--------|
| Window focus | Not implemented | Calls `windows.update` for window focus |
| Protocol assertion | Not updated | Added to `protocol-shape.assertions.ts` |
| Service test | No new service test | Updated `action-contract.test.ts` |
| Extension test size | 27 lines | 58 lines |
| Formatting | Passed first try | Needed `pnpm format:fix` |

Lane B's implementation is more complete (matches its more defensive plan), but Lane A's implementation also passes all gates.

### Extension impact assessment for implementation tasks

The context-grep extension provided **no measurable benefit** during implementation. The mechanism that helped during planning (enriched grep results showing AST containers) simply doesn't activate during edit→typecheck→test cycles. Implementation greps are short, targeted, and produce output that doesn't meet enrichment criteria.

The efficiency differences in this session are attributable to:
- Implementation scope (Lane B did more — window focus, extra assertions)
- Non-deterministic model behavior (different edit ordering, test structure)
- Human interaction timing (operator gave Lane A an extra confirmation turn)

### Forward-propagation effect

The raw turn/tool-call gap (56 vs 78 turns, 60 vs 83 tool calls) is **not** an implementation efficiency difference — it's a **scope difference** inherited from session 01.

Lane B's plan (produced without extension enrichment, via more grep cycles that incidentally exposed more code) prescribed additional work:
- `protocol-shape.assertions.ts` — compile-time shape assertion
- `BrowserWindowsSeam` — separate interface for `chrome.windows.update`
- `action-contract.test.ts` — service-level integration test update
- Window focus alongside tab activation

Lane A's plan mentioned none of these. The session 02 agents faithfully implemented their respective specifications — Lane B did more because its plan said to do more.

The cascade (updated after session 03 investigation):

```
Session 01 (planning):
  Extension enrichment showed paths like "extension/src/background/browser-actions.ts:118-142"
  → Lane A agent internalized full package-rooted paths
  → Lane A plan written with full paths: cli/src/commands/links.ts, extension/src/content/actions/links.ts
  → Lane A plan included fewer touchpoints (less incidental code exposure)

  No enrichment in Lane B
  → Lane B agent used shorter path references from docs
  → Lane B plan written with bare filenames: commands/links.ts, schemas.ts, content/actions/links.ts
  → Lane B plan included more touchpoints (more code exposure → more comprehensive spec)

Session 02–03 (implementation):
  Lane A reads plan with full paths → searches from package dirs (shared/src, cli/src/) → fewer finds
  Lane B reads plan with bare names → doesn't know which package → searches from "." → more finds
```

Decomposed by phase within the main implementation turn:

| Phase | Lane A | Lane B | Extra work in B |
|-------|--------|--------|----------------|
| EXPLORE | 20 turns | 36 turns | +4 files (protocol-shape, action-contract, cli.md, own plan) |
| IMPLEMENT | 13 turns | 21 turns | Protocol assertion, windows seam, action-contract test, larger extension test |
| VERIFY | 8 turns | 14 turns | Per-package test runs + `pnpm format:fix` cycle |

This is the most interesting finding: **the extension's efficiency gain during planning had a second-order narrowing effect on implementation scope.** Faster planning ≠ better planning if speed comes at the cost of structural exposure. The agent that struggled more during exploration produced a more thorough specification.

### Path specificity propagation (confirmed in session 03)

Session 03 revealed a second propagation mechanism beyond scope. The plan files carry **structural knowledge** in their path references:

- **Lane A plan** uses full package-rooted paths: `cli/src/commands/links.ts`, `extension/src/content/actions/links.ts`
- **Lane B plan** uses bare filenames: `commands/links.ts`, `content/actions/links.ts`, `schemas.ts`

This directly causes different file-discovery behavior:

| Session | Lane A find roots | Lane B find roots |
|---------|------------------|------------------|
| 02 | `shared/src`, `cli/src/commands/tab`, `service/src`, `extension/src` | `extension/src`, `.`, `service/src` |
| 03 | `shared/src`, `extension/src` (2 finds total) | `.` with exclusions (8 out of 10 finds from root) |

Lane A's model reads `cli/src/commands/links.ts` in the plan and knows to search within `cli/src/`. Lane B's model reads `commands/links.ts` and must search from `.` to locate it. This explains the persistent exploration gap (13 vs 34 turns in session 03) even when the extension's real-time enrichment is minimal (only 2/6 greps enriched).

**The causal chain:**
1. Extension enrichment in session 01 showed full paths in AST context blocks
2. Planning agent wrote those full paths into the plan document
3. Implementation agents in sessions 02–03 read the plan and inherited the path knowledge
4. Path knowledge → targeted searches from package dirs → fewer find commands → fewer exploration turns

This is a **one-time investment**: the extension's session-01 contribution is permanently encoded in the plan file. Even if the extension were disabled for sessions 02–03, the plan would still carry the structural knowledge forward.

### Conclusion for session 02

The extension's value is **task-type dependent**:
- Planning/investigation: strong direct effect (−56% grep calls, −22% turns)
- Implementation: no direct effect (0 enrichments triggered)
- But planning efficiency has a **forward-propagating indirect effect** — a leaner exploration during planning produced a leaner spec, which produced a leaner implementation

Whether this is good or bad depends on whether Lane B's extras (window focus, protocol assertions) represent genuine quality improvement or over-engineering. Both pass all gates. The 1-test difference (180 vs 179) and the `protocol-shape.assertions.ts` update suggest Lane B's implementation is marginally more robust against future regressions — but not materially so for a feature this simple.

---

## Session 03: Feature 2 implementation (`links --href-contains`)

**Sessions:**
- Lane A: `019ef0ed-48c4-7ba1-b0b7-169e4605cdab`
- Lane B: `019ef0ef-070a-7112-a30a-41ca70b8e0fa`

### Outcome

Both lanes successfully implemented `links --href-contains`. Both pass `pnpm check` and `pnpm test`. Both committed.

| Metric | Lane A (ext) | Lane B (no ext) | Delta |
|--------|-------------|-----------------|-------|
| Wall clock | 12.4 min | 11.6 min | ~same |
| User messages | 3 | 3 | same |
| Assistant turns | 41 | 59 | B +44% |
| Tool calls | 45 | 63 | B +40% |
| Reads | 17 | 25 | B +47% |
| Searches (grep/find) | 7 | 17 | **B 2.4×** |
| Edits | 8 | 9 | ~same |
| pnpm runs | 10 | 9 | ~same |
| Output tokens | 10,913 | 11,008 | same |
| Total cost | $1.93 | $1.31 | **A +48% more expensive** |
| Code diff (excl. docs) | +97 / −3 | +77 / −3 | A +26% larger |
| Tests added | 182 ext | 181 ext | A +1 ext test |

### Extension enrichment: minimal but present

Lane A had **2 out of 6** grep calls enriched (vs 0/8 in Lane B). The enriched greps showed:
- `reads.test.ts` helper function structure (the `request()` helper pattern)
- `rpc.ts` full `parseContentRpcRequest` function

This is much less than session 01 (7/8 enriched) but more than session 02 (0/6). The implementation of `links --href-contains` involves modifying existing code (content script, schemas, CLI flags) which requires understanding current structure — a moderate search task.

### The exploration gap is the main driver

| Phase | Lane A | Lane B |
|-------|--------|--------|
| EXPLORE | 13 turns | 34 turns |
| IMPLEMENT | 6 turns | 8 turns |
| VERIFY | 8 turns | 9 turns |

Lane B spent **2.6× more turns exploring** before implementing. The implementation and verification phases were nearly identical. The gap is entirely in how much context-gathering was needed.

Lane B's exploration pattern reveals the cause: **17 searches** (8 grep + 9 find) vs Lane A's **5 searches** (4 grep + 1 find). Lane B had to:
- `find` to locate test files (5 find commands searching for links-related tests)
- `grep` to understand test helper patterns
- Read `decisions.md` three times (at different offsets for specific ADRs)
- Read CLI test helpers to understand the testing approach

Lane A found what it needed faster — partly from the 2 enriched greps (which showed the test helper structure), partly from reading fewer but more targeted files.

### Cost paradox: Lane A was more expensive despite fewer turns

Lane A cost $1.93 vs Lane B's $1.31 (+48%). This is because:
- Lane A's cache read was higher (1.82M vs 1.51M tokens) — it accumulated more context from reading files fully
- Lane A had fewer turns but each turn processed more cached context
- The per-turn cost difference compounds: Lane A's 41 turns at ~$0.047/turn vs Lane B's 59 turns at ~$0.022/turn

This suggests that Lane A's approach (read whole files, think more, search less) is more expensive per-turn due to larger context windows, even though it requires fewer turns. Lane B's approach (narrow searches, small reads with offset/limit) keeps per-turn cost lower.

### Scope difference is smaller this time

Unlike session 02 where Lane B implemented significantly more (window focus, protocol assertions), session 03 shows similar scope:
- Both modified 7 files
- Both added protocol-shape assertions
- Lane A added a service schema test; Lane B added a CLI test
- Lane A wrote slightly more extension tests (71 lines vs 49)

The plans converged for this feature — both specified similar touchpoints for `links --href-contains`.

### Pattern emerging across sessions

| Session | Extension enrichments | Explore turns A vs B | Total turns A vs B | Wall clock |
|---------|----------------------|---------------------|-------------------|------------|
| 01 (planning) | 7/8 vs 0/18 | inherent to task | 36 vs 46 (−22%) | 20 vs 22 min |
| 02 (tab.activate) | 0/6 vs 0/9 | 20 vs 36 (+80%) | 56 vs 78 (−28%) | 30.5 vs 20.5 min |
| 03 (links filter) | 2/6 vs 0/8 | 13 vs 34 (+162%) | 41 vs 59 (−31%) | 12.4 vs 11.6 min |

The exploration-phase gap is consistent: Lane B always explores more. When the extension fires (even partially), it reduces the search overhead. The effect scales with how much of the task requires understanding existing code structure.

Session 02's wall-clock anomaly (Lane A slower) was operator-interaction timing; sessions 01 and 03 show the expected pattern of similar or slightly faster wall clock for Lane A despite fewer turns.

### Cost structure difference

Session 03 revealed that Lane A's fewer-turns approach is actually **more expensive** ($1.93 vs $1.31):

| Component | Lane A | Lane B |
|-----------|--------|--------|
| Cache write | $0.72 | $0.25 |
| Cache read | $0.91 | $0.76 |
| Output | $0.27 | $0.28 |
| Avg cache/turn | 44K tokens | 26K tokens |

Lane A reads whole files (full-path confidence from plan) → larger context → higher cache costs. Lane B uses grep→partial-read with offset/limit (uncertain paths) → smaller context per turn → cheaper per turn despite more turns.

The extension optimizes for **time and cognitive efficiency** (fewer round-trips, less fragmented exploration), not for **cost**. In API-cost terms, the targeted-search pattern is more economical.

---

## Session 04: Feature 3 implementation (`links --offset` + truncation investigation)

**Sessions:**
- Lane A: `019ef0fa-c118-7e74-8985-1ac256dfdece`
- Lane B: `019ef0fa-cfcf-7889-bd64-8018d5bc9c94`

### Outcome

Both lanes successfully implemented feature 3. Both pass `pnpm check` and `pnpm test`. Both committed. But the implementations are **architecturally different**.

| Metric | Lane A (ext) | Lane B (no ext) | Delta |
|--------|-------------|-----------------|-------|
| Wall clock | 19.0 min | 19.5 min | ~same |
| User messages | 3 | 3 | same |
| Assistant turns | 76 | 101 | B +33% |
| Tool calls | 79 | 105 | B +33% |
| Reads | 26 | 46 | B +77% |
| Searches (grep/find) | 23 | 24 | ~same |
| Edits | 12 | 16 | B +33% |
| pnpm runs | 14 | 18 | B +29% |
| Output tokens | 17,086 | 24,813 | B +45% |
| Total cost | $4.43 | $4.53 | ~same |
| Code diff | 9 files, +268/−3 | 12 files, +222/−31 | see below |
| Tests | 186 ext, 264 svc, 390 cli | 182 ext, 259 svc, 390 cli | A has more tests |

### Enrichment: minimal again

Lane A: 3/17 greps enriched. Lane B: 0/15. The enrichment continues to be a minor factor during implementation.

### Two fundamentally different architectures for the same feature

This is the most interesting session so far. The plans diverged on whether `ActionResult['links']` should change, and this produced completely different implementations:

**Lane A (simpler, no result shape change):**
- Extension: streaming offset — skip N items during DOM walk, then collect up to limit. Single-pass, no full collection.
- Result type unchanged: still `{ links: Array<LinkInfo> }` — no `total`, no `capped`.
- Truncation fix: wrote a test proving the CLI handles >100KB JSON correctly. Concluded the issue is environmental. No code change to the output path.
- 9 files changed, net +265 lines.

**Lane B (richer, breaking result shape change):**
- Extension: two-phase — collect ALL matching links up to `MAX_COLLECTION_CAP` (2000), then slice by offset/limit. Returns `total` count and `capped` flag.
- Result type changed: `{ links: Array<LinkInfo>; total: number; capped?: boolean }` — breaking change requiring updates across packages.
- Truncation fix: modified `cli/src/exit.ts` to use synchronous `writeFileSync(1, payload)` for stdout, preventing pipe-buffer truncation. Added `exit.test.ts`.
- Also updated `service/src/routes/command.ts` to handle the new `total`/`capped` fields in `decorateReadHandles`.
- 12 files changed, net +191 lines.

### Why the implementations diverge

The plans prescribed different designs:

| Aspect | Lane A plan | Lane B plan |
|--------|------------|------------|
| Result shape | No change to `ActionResult['links']` | Add `total: number`, `capped?: boolean` |
| Collection strategy | Skip offset during iteration | Collect all, then slice |
| Truncation approach | "If test passes, issue is environmental" | "Ensure `executeExitPlan` uses synchronous writes" |
| Collection cap | Not mentioned | `MAX_COLLECTION_CAP = 2000` |

Lane B's plan explicitly noted the truncation fix path (`exit.ts` + `writeFileSync`) and the `total`/`capped` pagination metadata — because its session 01 planning had explored `exit.ts` and `command.ts` (the forward-propagation effect from more grep cycles). Lane A's plan treated truncation as an investigation-only task.

### Which is better?

Lane B's implementation is arguably more robust:
- `total` lets agents know how many pages remain without a separate call
- `capped` prevents silent data loss on huge pages
- The `writeFileSync` fix addresses the actual truncation root cause
- `command.ts` properly handles the new result fields

Lane A's implementation is simpler and non-breaking:
- No result shape change means no downstream consumers need updating
- Streaming offset is more memory-efficient (no full collection array)
- The truncation test proves the current output path works correctly

Both pass all gates. The trade-off is: Lane B is more feature-complete for the stated use case (agents paginating large link sets), Lane A is more conservative and lower-risk.

### Exploration pattern update

| Phase | Lane A | Lane B |
|-------|--------|--------|
| EXPLORE | 33 turns | 50 turns |
| IMPLEMENT | 10 turns | 15 turns |
| VERIFY | 12 turns | 21 turns |

The exploration gap (33 vs 50, +52%) persists. The implementation gap (10 vs 15) reflects the larger scope. The verify gap (12 vs 21) reflects more test failures and more per-package test runs in Lane B — unsurprising given it touched more files and made a breaking type change.

### Cost convergence

Unlike session 03 where Lane A was 48% more expensive, session 04 shows near-equal cost ($4.43 vs $4.53). The driver: Lane B's cache write cost dropped to $0.61 (from session-typical ~$0.7+) while Lane A's rose to $1.19. Lane A's larger cache write here reflects reading more docs (it updated `cli.md` and `shared.md` during the review turn). The cost model is not stable across sessions — it depends on what gets read and cached.

### Session pattern (updated)

| Session | Enrichments | Explore A vs B | Total turns A vs B | Cost A vs B |
|---------|------------|----------------|-------------------|-------------|
| 01 (planning) | 7/8 vs 0/18 | inherent | 36 vs 46 (−22%) | $2.28 vs $2.58 |
| 02 (tab.activate) | 0/6 vs 0/9 | 20 vs 36 | 56 vs 78 (−28%) | $3.36 vs $3.82 |
| 03 (links filter) | 2/6 vs 0/8 | 13 vs 34 | 41 vs 59 (−31%) | $1.93 vs $1.31 |
| 04 (offset+trunc) | 3/17 vs 0/15 | 33 vs 50 | 76 vs 101 (−25%) | $4.43 vs $4.53 |

Consistent pattern: Lane B uses 25–33% more turns across all implementation sessions, with the gap concentrated in exploration. Cost varies and doesn't consistently favor either approach.

---

## Hypothesis: extension disrupts post-trained exploration patterns

After session 04 revealed that Lane A produced an architecturally inferior implementation (blind pagination, unfixed truncation bug), a stronger hypothesis emerges:

**The extension satisfies the model's "do I know enough?" threshold prematurely.**

The model was post-trained (RLHF) to operate in a calibrated exploration loop:

```
grep → short result (line numbers) → "I need more context" → read/grep again → deeper understanding
```

The trained threshold for "I understand enough to proceed" assumes a specific information density per tool call. When the extension enriches grep output with AST containers + callers (4.6× more context per call), that threshold is crossed earlier — before the incidental breadth exposure that the natural loop would provide.

This is analogous to how custom fine-tuning can degrade a model: overwriting learned weight distributions makes the model better at the fine-tuned task but worse at general behavior. The extension "fine-tunes" the information landscape, making the model better at targeted lookup but worse at thorough exploration.

**Evidence from sessions 01–04:**

| Session | Extension effect | Consequence |
|---------|-----------------|-------------|
| 01 | Agent stopped exploring earlier | Plan missed `exit.ts`, `command.ts`, used shorter paths |
| 02 | Plan prescribed less work | Implementation lacked window focus, protocol assertions |
| 03 | Agent skipped file-discovery steps | Functionally equivalent but explored less |
| 04 | Plan didn't prescribe truncation fix | Agent concluded "not my bug" — left a real defect unfixed |

The extension makes each individual search more productive, but **the exploration loop itself is the mechanism for discovering things you didn't know to search for.** Cutting the loop short removes serendipitous discovery.

**Counter-hypothesis:** maybe the extension just needs a task-type gate (active during implementation, disabled during planning). Or maybe it's not needed at all — let the model act the way it was trained, accepting more turns and more cost in exchange for broader structural understanding.

This question remains open. The final session (feature 5, `text --after`) will add one more data point.

---

## Session 05: Feature 4/5 implementation (`text --after`) + protocol version bump

**Sessions:**
- Lane A: `019ef10f-8234-7038-99e2-d9bc48bbbe52` — implemented `text --after` (feature 4 in its plan)
- Lane B: `019ef10f-e099-72c3-bdd4-869417d0b67f` — implemented `text --after` (feature 5 in its plan) + protocol version bump + protocol version constant centralization (operator-requested refactor)

### Scope difference (operator-driven)

Lane B had significantly more work because:
1. Its feature 3 added `total` and `capped` to the result type → this is a protocol-breaking change → operator requested protocol version bump (1→2)
2. Operator then noticed `protocol_version: 1` was scattered as a literal across 53 files and requested centralization to a single `PROTOCOL_VERSION` constant

This makes direct comparison unfair for total metrics but the `text --after` portion is still comparable.

### Raw metrics

| Metric | Lane A (ext) | Lane B (no ext) |
|--------|-------------|------------------|
| Wall clock | 15.6 min | 74.0 min |
| User messages | 3 | 6 |
| Assistant turns | 57 | 272 |
| Tool calls | 64 | 284 |
| Total cost | $2.74 | $16.27 |
| Failed tool results | 3 | 15 |
| Enrichment | 3/10 | 0/105 |
| Code diff | 6 files, +211/−5 | 53 files, +381/−174 |

### Lane B turn breakdown

| Turn | Duration | Cost | What |
|------|----------|------|------|
| 1 | 2.9 min | $0.76 | Explore for text --after implementation |
| 2 | 3.4 min | $1.51 | Review: discovered missing items (capped test, offset parsing tests) |
| 3 | 4.6 min | $2.13 | Implement missing items + protocol version bump |
| 4 | 1.8 min | $0.61 | "stop then" — operator redirected |
| 5 | 18.3 min | $10.07 | **Cohesion-of-name refactor**: replace scattered `protocol_version: 1` literal with `PROTOCOL_VERSION` constant across 53 files |
| 6 | 0.5 min | $1.18 | Update plan + commit |

Turn 5 alone: 162 assistant turns, 133 bash commands, 26 edits, $10. This is a mechanical refactor (find-and-replace across a codebase) that the model executed as individual grep→edit cycles.

### Lane A: failed tool calls

Lane A had 3 failures, all minor:
1. **Edit mismatch** — tried to edit `text.ts` with wrong whitespace, recovered by reading the file and using `format:fix`
2. **Grep with no output** — searched for test failures that didn't exist (tests were passing)
3. **Grep with no output** — overly specific regex on `actions.ts`

These are typical implementation friction — the model guessed at content that had slightly different formatting. Not related to the extension.

### Lane B: failed tool calls and `packages/` confusion

Lane B had 15 failures. The first three are notable:
1. `read packages/shared/src/actions.ts` → ENOENT
2. `find packages/cli/src/commands` → no such directory
3. `ls packages/` → no such directory

The model assumed a `packages/` monorepo layout (common in many projects) despite the actual layout being flat (`shared/`, `cli/`, `service/`, `extension/`). It corrected after `ls packages/` failed. This is the **path-specificity issue** again: without full paths in its plan, the model guessed at a conventional structure.

The remaining failures were grep-with-no-output (searching for patterns that didn't exist in the codebase) and one malformed edit call.

### Design divergence on `text --after`

| Aspect | Lane A | Lane B |
|--------|--------|--------|
| Implementation location | Extension (content script) | CLI-local (per plan: "no protocol change") |
| Protocol change | Added `after` + `maxLength` to `ActionParams['text']` | None — CLI-only post-processing |
| Where slicing happens | In the browser, before data crosses the wire | In the CLI, after receiving full text |

Wait — Lane B DID implement `text --after` in this session (as CLI-local post-processing per its plan), but the work is **uncommitted**. The version refactor consumed the session's commit cycle — the operator said "commit" after the refactor, and the `text --after` changes plus documentation updates remain in the working tree (14 modified files unstaged).

**Lane A** implemented `text --after` as a protocol-level change (extension does the slicing), which differs from Lane B's CLI-local approach. Lane A's approach sends less data over the wire (only post-marker text); Lane B sends full text then slices locally in the CLI.

### Extension hypothesis reinforcement

Lane B's `packages/` confusion (3 failed calls at session start) demonstrates the path-specificity propagation effect in real-time. The model's first instinct was wrong because its plan didn't contain full paths. It self-corrected quickly (3 wasted calls), but this adds friction that Lane A never experiences.

The 105 grep calls with 0 enrichments in Lane B (vs 10 greps with 3 enrichments in Lane A) shows the extension effect during the mechanical refactor: Lane B had to manually trace every file containing `protocol_version: 1` through repeated grep cycles, while this type of task (if Lane A had been asked to do it) would have benefited from enrichment showing the full function context around each match.

### Experiment status after session 05

| Feature | Lane A | Lane B |
|---------|--------|--------|
| tab.activate | ✅ | ✅ |
| links --href-contains | ✅ | ✅ |
| links --offset + truncation | ✅ (simpler) | ✅ (richer) |
| text --after | ✅ (extension-level) | ✅ implemented but uncommitted (CLI-local) |
| Protocol version bump | N/A (no breaking changes) | ✅ |
| PROTOCOL_VERSION centralization | N/A | ✅ |

Lane B has one feature remaining but a stronger protocol foundation. Lane A is feature-complete but has a latent truncation bug and no `total`/`capped` pagination metadata.

---

## Overall findings

### The extension's effect is real but double-edged

**Benefits:**
- Fewer exploration turns (25–33% reduction consistently)
- Faster planning sessions
- Better path specificity in artifacts (propagates to future sessions)
- Reduced find/grep cycles during implementation

**Costs:**
- Narrower structural exposure during planning → underspecified plans
- Premature satisfaction of the "do I know enough?" threshold
- Plans miss code paths the model would have discovered through natural exploration
- This propagates: leaner plan → leaner (sometimes inadequate) implementation

### The strongest evidence: session 04's truncation divergence

Lane A's plan said "investigate and document" because the planning agent never saw `exit.ts`. Lane B's plan said "fix with writeFileSync" because the planning agent's extra grep cycles exposed the output path. The result: Lane A left a real bug unfixed; Lane B fixed it. This is not a trade-off — it's a quality deficiency caused by reduced exploration.

### Hypothesis: let the model explore naturally

The model's post-trained exploration loop is calibrated for plain tool output. The extension disrupts this calibration by satisfying the information-seeking drive earlier than the training assumed. The additional turns Lane B spends exploring are not waste — they're the mechanism for discovering things the agent didn't know to look for.

The extension's efficiency gain is real in metrics (fewer turns, less wall clock) but may come at the cost of implementation quality on non-trivial tasks where breadth of understanding matters more than speed of execution.
