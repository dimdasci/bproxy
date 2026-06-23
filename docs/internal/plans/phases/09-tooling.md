---
title: "Phase 9: Agent search tooling"
status: complete
date: 2026-06-22
---

> **Decommissioned in Phase 10.** The Phase 9 search-tooling extension and repo-local Pi tooling were removed in `docs/internal/plans/phases/10-agent-session-dx.md` after follow-up evaluation showed they did not improve sustained implementation efficiency or quality.

## Phase 9: Agent search tooling

**Motivation:** Real Pi sessions show that models strongly prefer learned shell search commands (`rg`, `grep`, `find | grep`) over novel or even native search tools. If bproxy wants better agent navigation during real maintenance, the useful path is to enrich the search output agents already request.

**Goal:** Add project-local Pi tooling that preserves normal grep/rg workflows while appending bounded AST context and back-references. The agent keeps issuing familiar search commands; the extension enriches successful results after the tool runs.

**Non-goal:** This phase does not change bproxy product code, browser protocol, CLI command surface, daemon behavior, extension runtime, or public user documentation. It is developer/agent tooling for this repository.

---

## Design inputs

- Proven design: `codeindex-exploration` experiment (n=6 per condition, controlled A/B).
- Key finding: AST containers + back-references in single-block output reduce turns by 33% on investigation tasks. The mechanism is eliminating iterative grep→read→grep cycles.
- Key anti-pattern: navigation maps with "Suggested reads" encourage divergence and increase turns on audit tasks.
- Pi extension docs: project-local extensions under `.pi/extensions/*/index.ts`, `tool_result` event middleware, `isBashToolResult`, `ctx.cwd`, `ctx.signal`.
- Session evidence: models use `bash` with `rg`/`grep`; never adopt novel tools voluntarily.

---

## Architecture

```text
Agent issues familiar search
  ├─ bash: rg / grep / find | grep
  └─ native grep: Pi grep tool
        │
        ▼
Pi executes tool normally
        │
        ▼
tool_result extension hook
  1. Detect search-shaped successful result (reject scripts/heredocs)
  2. Parse match rows into file + line hits
  3. Resolve files relative to ctx.cwd and command/search path
  4. Use ast-grep to find enclosing containers
  5. Deduplicate and rank by hit density
  6. Find back-references for definitions (rg --json --fixed-strings)
  7. Append single enrichment block below original output
        │
        ▼
Agent sees: original grep output + AST context with back-refs
```

**Transparency rule:** original tool output remains verbatim at the top. Enrichment is appended after a clear separator as a single text block. Any failure returns the original result unchanged.

---

## Output format

```text
── AST context (N containers, deduplicated) ────────────────────────────

▶ service/src/config.ts:20-29 [fn loadBaseConfig] (grep hits: [20])
  │
  │ Called from:
  │   ← main (service/src/index.ts:20)
  │   ← main (service/src/index.ts:26)
  │   ← loadConfig (service/src/config.ts:32)
  │
    export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
        const port = Number.parseInt(env["BPROXY_PORT"] ?? "", 10);
        ...
    }
```

Rules:
- One entry per `{file, container.startLine, container.endLine}`
- Ranked by descending grep-hit count
- Back-references shown only when a grep hit lands on the definition line
- Callers found via `rg --json --fixed-strings` (skip imports, tests, re-definitions)
- Truncated body: head 12 + tail 5 lines for containers > 35 lines
- Single text block returned (original + enrichment concatenated)

Caps:

| Limit | Value |
|---|---:|
| enriched containers | 10 |
| lines per container | 35 |
| enrichment characters | 12,000 |
| files to scan | 12 |
| back-refs per definition | 5 |
| back-ref timeout | 2s |
| ast-grep timeout per file | 5s |

---

## Command detection (safety layer)

The extension must not enrich output from scripts or heredocs that happen to contain `grep`/`rg` text.

Rejected patterns:
- Script command prefixes: `node`, `python3`, `ruby`, `perl`, `deno`, `bun`, `ts-node`, `tsx`, `npx`
- Heredoc patterns: `<<EOF`, `node -e`, `python -c`, `ruby -e`, `perl -e`

Accepted: direct `grep`/`rg` invocations, piped commands, commands after `&&`/`;`/`|`.

---

## Supported languages

| Extension | AST container kinds |
|---|---|
| `.ts`, `.tsx` | `function_declaration`, `method_definition`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, `variable_declarator` (arrow fns only) |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `function_declaration`, `method_definition`, `class_declaration`, `variable_declarator` (arrow fns only) |
| `.py` | `function_definition`, `class_definition` |
| `.rs` | `function_item`, `impl_item`, `struct_item`, `enum_item`, `trait_item` |
| `.go` | `function_declaration`, `method_declaration`, `type_declaration` |

---

## Source layout

**Option B** — checked TypeScript source with `.pi` shim:

```text
tools/pi/context-grep/
  src/parse.ts        — grep/rg output parsing + command detection
  src/ast.ts          — ast-grep container extraction
  src/backrefs.ts     — caller lookup via rg --json
  src/enrich.ts       — enrichment pipeline + formatting
  src/index.ts        — barrel exports
  tsconfig.json       — strict typecheck for source + tests
  test/               — node:test fixtures (run via tsx)
  README.md
.pi/extensions/context-grep/
  index.ts            — thin Pi shim (imports from tools/pi/)
  tsconfig.json       — typecheck shim + source together
  types/              — Pi SDK type declarations
  README.md
```

Validation:
- `pnpm test:pi-tooling` — run tests (tsx --test)
- `pnpm typecheck:pi-tooling` — typecheck source + tests
- `pnpm typecheck:pi-shim` — typecheck Pi shim
- Extension source is excluded from product gates (`pnpm check`)

---

## Safety and quality constraints

- No strategy moved into bproxy product components. This is Pi-side developer tooling.
- Do not modify bproxy protocol or shared action types.
- Do not write temp files from the extension.
- Use `ctx.signal` for child processes; use `execFile` / argv arrays (no shell interpolation).
- Fail closed: any error returns original result unchanged.
- `pnpm check` must pass (extension excluded from product gates).

---

## Shipped implementation

### Tasks completed

1. **Layout and gates** — Option B with dedicated tsconfigs, tsx test runner, eslint/knip excludes.
2. **Parser** — native grep and bash rg/grep parsing with file resolution, single-file inference, heredoc/script rejection.
3. **AST engine** — ast-grep container extraction with per-file timeout, availability check, session-level caching.
4. **Enrichment pipeline** — hit→container mapping, deduplication, ranking, character caps, single-block output.
5. **Back-references** — `rg --json --fixed-strings` caller lookup, filters (imports, tests, re-definitions, generic names), enclosing-function resolution for callers.
6. **Safety hardening** — script prefix rejection, heredoc patterns, command detection tightening.
7. **Pi shim** — registered `tool_result` handler, uses `ctx.cwd`/`ctx.signal`, warns once if ast-grep unavailable.

### What was built and removed

A navigation-map layer (lanes, task focus, suggested reads) was implemented and then removed after A/B testing showed it increased turns by encouraging divergence. See "Experimental validation" below.

---

## Experimental validation

### Methodology

A/B tests with `pi -p` (print mode), same prompt for both conditions, single bproxy repo.

### Audit task (security review) — n=1 per condition

| Metric | No ext | With ext (v1, nav map) | With ext (v2, back-refs) |
|---|---:|---:|---:|
| Turns | 17 | 20 (+18%) | 18 (+6%) |
| Reads | 18 | 21 (+17%) | 16 (−11%) |
| Cost | $0.54 | $0.71 (+31%) | $0.69 (+28%) |

v1 (navigation map) actively hurt: it suggested more files → model explored more → more turns.
v2 (back-refs only) is neutral-to-slightly-positive on audit tasks.

### Investigation task (issue #21 compliance analysis) — n=1 per condition

| Metric | No ext | With ext (v2, back-refs) | Delta |
|---|---:|---:|---:|
| **Turns** | 36 | **20** | **−44%** |
| **Search commands** | 38 | **18** | **−53%** |
| **Bash calls** | 54 | **24** | **−56%** |
| Reads | 4 | 16 | +12 |
| Output tokens | 8,062 | 6,677 | −17% |
| **Cost** | $1.13 | **$0.87** | **−23%** |

The extension halved the grep→grep→grep cycles. The agent read more files but searched far less — enrichment provided enough structural context to skip iterative refinement.

### Alignment with codeindex experiment

The codeindex experiment (n=6, 130K-line Rust+Python codebase) showed −33% cumulative context with the same architecture. Our bproxy result (−44% turns on investigation) is consistent: the mechanism is the same (eliminating iterative search cycles via enriched output).

---

## Conclusion

The extension serves as a **passive guardrail**: every time the agent searches for code it plans to modify, it automatically sees the enclosing function and who calls it. This reduces uninformed edits without requiring the agent to adopt new tools or workflows.

**When it helps most:** investigation and implementation tasks where the agent needs to trace call chains across packages. Back-references directly answer "what else depends on this?" — the question that otherwise takes multiple grep→read cycles.

**When it's neutral:** audit/review tasks on small well-structured codebases where grep alone is already efficient.

**What was rejected and why:**
- Navigation maps with "Suggested reads" — increased turns by creating to-do lists.
- Lane classification / task-focus inference — no proven value, added complexity.
- Multi-block content return — single block is simpler and matches proven design.
- Novel LLM-visible tools — agents won't adopt them (codeindex O3 finding).

---

## Deferred / rejected

| Item | Decision |
|---|---|
| Navigation map / lanes / suggested reads | Built, tested, **removed** — increased turns on audit tasks |
| New LLM-visible `context_grep` tool | Rejected; models ignore novel tools |
| Forcing native Pi `grep` use | Rejected; session evidence shows shell search bias |
| Semantic index/search | Deferred; separate product/tooling question |
| Recursive call graph | Rejected; too large and noisy |
| Selector repair / browser strategy | Out of scope; unrelated to search tooling |

---

## Post-mortem: extension removed after A/B test

**Date:** 2026-06-22  
**Decision:** Extension removed in PR #25.  
**Analysis:** [docs/internal/journal/2026-06-22-context-grep-extension-ab-test.md](../journal/2026-06-22-context-grep-extension-ab-test.md)

A controlled A/B test (5 sessions per lane, same model, same task — issue #21 implementation) revealed that the extension reduces turns (−36%) but not cost (+2%) or wall clock, while producing architecturally inferior implementations. The enrichment shortcircuits the model's post-trained exploration loop, resulting in narrower plans that miss important code paths. Those plans propagate forward as shallower implementations that leave agent-consumers without needed feedback (no `total` in pagination, unfixed truncation bug, ADR-017 violations).

The extension retains value for one-shot investigation tasks (its original validation context) but is net-negative for sustained multi-session implementation work on this codebase.
