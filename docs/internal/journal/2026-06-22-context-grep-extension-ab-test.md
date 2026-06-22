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

The cascade:

```
Session 01 (planning):
  Extension → fewer grep cycles → less incidental code exposure
  No extension → more grep cycles → saw protocol-shape, action-contract, ExitPlan patterns
  → Lane B plan included more touchpoints

Session 02 (implementation):
  Lane A implements leaner plan → 19 unique files read → 16 edits → 8 verify cycles
  Lane B implements fuller plan → 23 unique files read → 22 edits → 14 verify cycles
```

Decomposed by phase within the main implementation turn:

| Phase | Lane A | Lane B | Extra work in B |
|-------|--------|--------|----------------|
| EXPLORE | 20 turns | 36 turns | +4 files (protocol-shape, action-contract, cli.md, own plan) |
| IMPLEMENT | 13 turns | 21 turns | Protocol assertion, windows seam, action-contract test, larger extension test |
| VERIFY | 8 turns | 14 turns | Per-package test runs + `pnpm format:fix` cycle |

This is the most interesting finding: **the extension's efficiency gain during planning had a second-order narrowing effect on implementation scope.** Faster planning ≠ better planning if speed comes at the cost of structural exposure. The agent that struggled more during exploration produced a more thorough specification.

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
