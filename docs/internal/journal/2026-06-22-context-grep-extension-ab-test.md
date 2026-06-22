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
