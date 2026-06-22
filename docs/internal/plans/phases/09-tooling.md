---
title: "Phase 9: Agent search tooling"
status: In progress
date: 2026-06-22
---

## Phase 9: Agent search tooling

**Motivation:** Real Pi sessions show that models strongly prefer learned shell search commands (`rg`, `grep`, `find | grep`) over novel or even native search tools. In this session and the codeindex experiment logs, search activity was recorded as `toolName: "bash"`; native Pi `grep` records (`toolName: "grep"`) were absent. If bproxy wants better agent navigation during real maintenance, the useful path is to enrich the search output agents already request.

**Goal:** Add project-local Pi tooling that preserves normal grep/rg workflows while appending bounded AST context. The agent should keep issuing familiar search commands; the extension enriches successful results after the tool runs.

**Non-goal:** This phase does not change bproxy product code, browser protocol, CLI command surface, daemon behavior, extension runtime, or public user documentation. It is developer/agent tooling for this repository.

---

## Design inputs

- Exploratory design: `context_grep Extension — Design Document` from the codeindex exploration project.
- Pi extension docs: project-local extensions under `.pi/extensions/*/index.ts`, `tool_result` event middleware, `isGrepToolResult`, `isBashToolResult`, `ctx.cwd`, and `ctx.signal`.
- Pi built-in `grep` implementation: native grep directly spawns `rg --json`, parses match events, formats `file:line: text` rows, and truncates to 50KB.
- Pi built-in `bash` implementation: shell commands are opaque to Pi; stdout/stderr are accumulated, tail-truncated, and may be written to a Pi temp file by the harness.
- Session evidence: models used `bash` with `rg`/`grep`; therefore bash-result enrichment is mandatory, native-grep enrichment is a compatibility path.

---

## Scope

### In scope

- Project-local Pi extension for search-result enrichment.
- `tool_result` interception for:
  - native Pi `grep` results (`isGrepToolResult`)
  - bash `rg` / `grep` results (`isBashToolResult`)
- AST context extraction with `ast-grep` CLI.
- Conservative parsing, deduplication, ranking, and output caps.
- Tests or fixtures for parser/enrichment behavior before routine use.
- Documentation for enabling, disabling, and troubleshooting the extension.

### Out of scope

- A novel LLM-visible tool such as `context_grep`.
- Blocking or rewriting tool calls before execution.
- Replacing Pi's native `grep` implementation.
- General semantic search or indexing.
- Codebase-wide call graph construction.
- Any browser automation behavior or bproxy protocol change.
- Any dependency on `/tmp`, `os.tmpdir()`, or bproxy production temp semantics.

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
  1. Identify search-shaped successful result
  2. Parse match rows into file + line hits
  3. Resolve files relative to ctx.cwd and command/search path
  4. Use ast-grep to find enclosing containers
  5. Deduplicate and rank containers
  6. Append bounded AST context below original output
        │
        ▼
Agent sees original output first + enriched section
```

Transparency rule: the original tool output remains verbatim at the top. Enrichment is appended after a clear separator. Any failure returns the original result unchanged.

---

## Source layout decision

Before writing code, choose one of these layouts and document the trade-off in the phase closeout:

### Option A — committed project-local extension

```text
.pi/extensions/context-grep/
  index.ts
  enrich.ts
  README.md
```

Pros: Pi auto-discovers it; `/reload` works; zero runtime setup once the project is trusted.

Risk: root format/lint/typecheck tooling may include `.pi/**/*.ts`. If this path is committed, the phase must either make the extension pass repository gates or explicitly configure the gates to treat `.pi/extensions` as Pi runtime tooling rather than product code.

### Option B — checked source with `.pi` shim

```text
tools/pi/context-grep/
  src/index.ts
  src/enrich.ts
  test/...
.pi/extensions/context-grep/index.ts   # small shim
```

Pros: tests and type checking can be explicit; `.pi` stays small; source ownership is clearer.

Risk: more setup and possibly a new dev-only dependency on Pi extension types.

**Initial preference:** Option B if the extension is committed and expected to evolve; Option A only for a quick local prototype.

---

## Result detection

### Native Pi grep

Use `isGrepToolResult(event)`. Parse text rows produced by Pi grep:

```text
path/to/file.ts:42: matched line
path/to/file.ts-41- context line
```

Rules:
- parse only match rows matching `file:line:`
- ignore context rows matching `file-line-`
- ignore `No matches found`
- use `event.input.path` and `ctx.cwd` to resolve relative paths
- preserve `event.details` unchanged

### Bash grep / rg

Use `isBashToolResult(event)`, then require both:

1. command contains a likely search executable (`rg`, `grep`, or a grep pipeline)
2. output has parseable match rows

Supported shapes:

| Shape | Example | Handling |
|---|---|---|
| `file:line:text` | `src/foo.ts:12: const x = ...` | direct parse |
| absolute `file:line:text` | `/repo/src/foo.ts:12: ...` | direct parse |
| `line:text` from single-file `grep -n` | `12: const x = ...` | infer file from command |
| path list (`grep -l`) | `src/foo.ts` | skip |
| arbitrary JSON/log rows | `session.jsonl:128:{...}` | parse only if extension supported; otherwise skip |

Skip enrichment when:
- result is an error
- fewer than two match rows are parseable, unless single-file `grep -n` gives a clear file path
- output is a path list with no line numbers
- file extension is unsupported
- files cannot be resolved on disk

Command parsing is best-effort only. Do not build a shell parser. Prefer output-based parsing, with small command-aware helpers for single-file `grep -n` and search-root resolution.

---

## AST context engine

Use `ast-grep` via `execFile`, never shell interpolation.

```bash
ast-grep run --kind '<kind selector>' --json <file>
```

Startup/session behavior:
- lazily check `ast-grep --version` or first execution failure
- notify once in TUI/RPC if unavailable
- disable enrichment for the session when unavailable
- never fail the original tool result because `ast-grep` failed

Initial language map:

| Extension | Candidate AST containers |
|---|---|
| `.ts`, `.tsx` | `function_declaration`, `method_definition`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, validated arrow-function container kind |
| `.js`, `.jsx` | `function_declaration`, `method_definition`, `class_declaration`, validated arrow-function container kind |
| `.py` | `function_definition`, `class_definition` |
| `.rs` | `function_item`, `impl_item`, `struct_item`, `enum_item`, `trait_item` |
| `.go` | `function_declaration`, `method_declaration`, `type_declaration` |

Validation task: create fixtures for TypeScript function declarations, class methods, exported const arrow functions, interfaces/types, and nested blocks. Adjust container kinds based on actual `ast-grep` output before enabling by default.

---

## Enrichment format

Append to original output:

```text

── AST context (N containers, deduplicated) ────────────────────────────

▶ service/src/foo.ts:10-42 [fn handleRequest] (grep hits: [12, 31])
    async function handleRequest(...) {
      ...
    }
```

Formatting rules:
- one entry per `{file, container.startLine, container.endLine}`
- sort by descending grep-hit count, then file path, then start line
- display paths relative to `ctx.cwd` when possible
- include hit line numbers from grep output
- truncate long containers with head/tail body display
- keep original output at top exactly as Pi produced it

Caps:

| Limit | Value |
|---|---:|
| enriched containers | 10 |
| lines per container | 35 |
| enrichment characters | 12,000 |
| ast-grep timeout per file | 5s |
| total enrichment timeout | bounded by `ctx.signal`; target under 1s for normal results |

---

## Real-session findings: June 20 bproxy replay

A replay of the June 19/20 bproxy Pi session (`2026-06-19T21-33-12-116Z_019ee1cd-5a33-7425-ba76-379df580b36d.jsonl`) found 49 grep-shaped bash commands. The base AST-context extension would have helped orientation, but only modestly reduced turns by itself.

Key findings:

- **Search intent varied by lifecycle stage.** Many searches were not production-code navigation. They targeted failing tests, Sonar findings, docs/skill examples, version metadata, imports/exports, and CI output.
- **Tests are sometimes primary.** Commands such as `grep -n "\.sort()" service/src/__tests__/nick-scoping.test.ts` were driven by Sonar/test failures. A fixed "production before tests" ranking would be wrong.
- **Docs/config searches need non-AST handling.** Searches like `grep -rn "\-s " skills/bproxy/ | grep -v "\-n"` are valuable but Markdown-oriented; AST containers add little.
- **Top-level hits matter.** Import/export/type re-export issues in `service/src/lifecycle.ts` needed top-level file context, not only enclosing functions.
- **Broad query terms create false positives.** Searches combining exact targets with broad terms (`instanceSalt|randomBytes|ownerHash|computeOwnerHash`) need query-aware ranking so exact domain terms win over incidental hits.
- **Bash detection needs tightening.** During this review, a Node script that analyzed session logs was itself enriched because its command text contained `rg|grep` and its output had `file:line:` rows. The extension must avoid enriching heredoc/script-analysis commands unless the executed shell command is actually search-shaped.

Conclusion: the next iteration should add a deterministic **task-aware navigation map**, not a domain-specific implementation map. The map should organize results into lanes, infer likely task focus from command/output signals, suggest files to read next, and remain transparent that it is heuristic.

---

## Next iteration: task-aware navigation map

Append a bounded map before AST context when enough evidence exists:

```text

── Navigation map ─────────────────────────────
Likely focus: tests
Reason: command targets __tests__/ and output references Sonar/failure lines

Primary candidates:
1. service/src/__tests__/nick-scoping.test.ts:73 [test] sort() Sonar finding

Implementation candidates:
2. service/src/routes/session-actions.ts:25 [fn validateSession]

Contracts / types:
3. shared/src/sessions.ts:11 [fn isValidNick]

Suggested reads:
- service/src/__tests__/nick-scoping.test.ts — failing/behavioral entrypoint
- service/src/routes/session-actions.ts — implementation under test
- shared/src/sessions.ts — validation contract
```

Generic lanes:

| Lane | Signals |
|---|---|
| Primary candidates | Highest-scoring entries for inferred task focus |
| Definitions / contracts | type/interface/class/function declarations, exported constants, schema/error contracts |
| Implementation candidates | production functions/methods/classes containing matches |
| Tests / behavior specs | `__tests__`, `test`, `spec`, assertion/failure output |
| Docs / config | Markdown, JSON/YAML/TOML/package metadata, skill docs |
| Diagnostics / build output | compiler, linter, CI, Sonar, stack trace, command failure rows |

Task-focus signals:

| Signal | Preferred focus |
|---|---|
| command path includes `__tests__`, `.test.`, `.spec.` | tests first |
| output contains `FAIL`, `AssertionError`, `expected`, `Sonar`, `rule`, `tsc`, `eslint`, `Biome` | diagnostics/tests first |
| query resembles an identifier/type name | definitions/contracts first |
| query resembles an error code/string literal | emitters plus tests |
| matches are Markdown/config/package files | docs/config first |
| matches span many files/packages | diversify by package/file before repeating containers |

Navigation-map constraints:

- Do not hard-code bproxy-specific roles such as "CLI request envelope" or "Privacy/log correlation".
- Use portable signals: path kind, AST kind, export/declaration shape, matched line text, command shape, and output diagnostics.
- Keep map deterministic and bounded: max 8 rows, max 6 suggested reads, max 3,000 chars.
- Preserve original output first; append navigation map, then AST context.
- If focus inference is weak, omit `Likely focus` and show lane order as neutral.
- If map generation fails, omit it and keep AST context/original output behavior.

Implementation notes:

- Extend parsed hits with `lineText` and enough source metadata for file-level/top-level mapping.
- Add top-level context entries for imports, exports, constants, and package/config files when no AST container applies.
- Add `classifyPathKind(filePath)` returning `production | test | docs | config | generated | fixture`.
- Add `classifyHitKind(hit, container)` returning `definition | reference | assertion | diagnostic | config | docs`.
- Add `inferTaskFocus({ command, text, hits })` using only deterministic signals.
- Add `buildNavigationMap(entries, cwd, focus)` in `enrich.mjs` before `buildAppendix`.
- Add suggested-read selection from top entries with diversity by path/package.
- Tighten `isSearchCommand(command)` so heredocs and inline Node/Python scripts are not treated as shell search commands merely because they contain `grep` text.

## Back-references

Back-references are deferred until base enrichment and navigation-map output are reliable.

Phase 9 may include a second task group for bounded back-references only after parser and AST-container fixtures pass.

Rules when implemented:
- only add callers when a grep hit lands on the definition line
- search with `rg --json --fixed-strings`, not shell `grep`
- skip tests by default for caller summaries
- max 5 callers per definition
- max 5 definitions per tool result
- timeout around 2s total for caller lookup
- format as a compact `Called from:` block

Do not implement recursive call graphs.

---

## Safety and quality constraints

- No strategy is moved into bproxy product components. This is Pi-side developer tooling.
- Do not modify bproxy protocol or shared action types.
- Do not write temp files from the extension. If diagnostic artifacts become necessary, write only under a documented project/tooling directory, not system temp.
- Do not run arbitrary page code; this phase is unrelated to browser/page execution.
- Use `ctx.signal` for child processes where supported.
- Use `execFile` / argv arrays for `ast-grep` and any internal `rg` calls.
- Avoid adding project dependencies until source layout is decided.
- If committed TS source is included in repository checks, `pnpm check` must pass.

---

## Implementation tasks

### 1. Layout and gate decision

- [x] Choose source layout: checked `tools/pi/context-grep` source with `.pi/extensions/context-grep/index.ts` shim.
- [x] Decide whether extension source participates in `pnpm check`.
- [x] If it participates, add only necessary dev dependencies and typecheck config.
- [x] If it is excluded, document why this is Pi runtime tooling and how it is validated.

Current state: Option B is implemented. Core source is validated by `pnpm test:pi-tooling`; the Pi shim has explicit `typecheck:pi-shim` and `lint:pi-shim` scripts. `.pi/extensions/**` is excluded from normal product gates, while `pnpm test` includes `test:pi-tooling`.

### 2. Core parser fixtures

- [x] Add fixtures for native Pi grep output (`file:line:` plus `file-line-` context rows).
- [x] Add fixtures for bash `rg -n` output.
- [x] Add fixtures for bash `grep -rn` output.
- [x] Add fixtures for single-file `grep -n` output with file inferred from command.
- [x] Add negative fixtures for `grep -l`, path lists, no matches, unsupported file extensions, and truncated non-code logs.

### 3. AST container mapping

- [x] Implement file-resolution helpers relative to `ctx.cwd`, native grep search path, and bash command search roots.
- [x] Implement `ast-grep` availability check and once-per-session warning.
- [x] Implement `getContainers(file, signal)` with per-file timeout and JSON validation.
- [x] Validate TypeScript container kinds against bproxy source fixtures.
- [x] Cache containers per file for one tool result.

### 4. Enrichment pipeline

- [x] Implement native grep enrichment path.
- [x] Implement bash grep/rg enrichment path.
- [x] Map hits to the smallest enclosing container.
- [x] Deduplicate by container.
- [x] Rank by hit density.
- [x] Apply line and character caps.
- [x] Preserve original result content and details.
- [x] Fail closed to original output on any internal error.

### 5. Iteration 2 readiness hardening

These tasks must happen before adding larger navigation-map output. The current implementation is a useful base, but false positives and sparse replay coverage would make iteration 2 noisy if left unfixed.

- [x] Tighten bash search detection to avoid heredoc/script-analysis false positives.
- [x] Add a dedicated negative fixture for inline Node/Python/heredoc commands whose script text contains `grep`/`rg` but whose executed shell command is not a direct search command.
- [x] Add a dedicated `grep -rn` parser fixture, even though it currently shares the `file:line:text` parser path.
- [x] Preserve matched line text in parsed hits so downstream ranking can inspect the actual matched source line.
- [x] Add replay fixtures from the June 20 session before changing ranking: Sonar test sort, lifecycle type re-export, skills docs `-s` without `-n`, ownerHash/randomBytes broad query, and heredoc/script-analysis false positive.
- [x] Keep `pnpm test:pi-tooling`, `typecheck:pi-shim`, and `lint:pi-shim` passing after each hardening step.

### 6. Navigation-map iteration

- [x] Add path-kind classification for production, tests, docs, config, generated, and fixtures.
- [x] Add hit-kind classification for definitions, references, assertions, diagnostics, docs, and config.
- [x] Add deterministic task-focus inference from command/output signals.
- [x] Add top-level/file-level entries for imports, exports, constants, and non-code files.
- [x] Generate bounded lane-based navigation map before AST context.
- [x] Generate bounded suggested reads with reason strings.

### 7. Pi extension entrypoint

- [x] Register one `tool_result` handler.
- [x] Use `isGrepToolResult(event)` for native grep.
- [x] Use `isBashToolResult(event)` for bash search.
- [x] Respect `event.isError`.
- [x] Use `ctx.cwd`, not `process.cwd()`.
- [x] Use `ctx.signal` for child work.
- [x] Add `/reload`-friendly README instructions.

Current state: Pi loads `.pi/extensions/context-grep/index.ts`; the earlier parse failure was fixed and validated with an explicit Pi startup smoke test.

### 8. Back-reference follow-up (optional after base validation)

- [ ] Implement bounded `rg --json --fixed-strings` caller lookup.
- [ ] Filter definition lines, imports, comments-only rows, and tests.
- [ ] Map caller hits to enclosing containers.
- [ ] Add compact `Called from:` formatting.
- [ ] Add fixtures for Python and TypeScript definitions.

### 9. Real-session validation

- [x] Replay representative outputs from the June 19/20 bproxy session log.
- [ ] Replay representative outputs from the current bproxy session log after navigation-map implementation.
- [ ] Replay representative outputs from `A-run1.jsonl`.
- [x] Validate a real bproxy search such as `rg "Session" service/src -n`.
- [ ] Validate native Pi grep manually if the model can be induced to call it, or with a controlled test extension/tool invocation.
- [x] Confirm unsupported log/json searches do not produce noisy enrichment.
- [x] Confirm heredoc/script-analysis commands are not enriched accidentally.
- [x] Confirm missing `ast-grep` degrades to original output.

---

## Definition of done

- The extension enriches normal `bash` `rg` / `grep` results used by agents in real sessions.
- Native Pi `grep` results are enriched when present.
- Original search output is preserved verbatim before appended sections.
- Navigation-map output is lane-based, task-aware, deterministic, bounded, and not bproxy-specific.
- AST context remains available after the navigation map for supported code files.
- Enrichment is bounded, deterministic, and gracefully disabled on errors.
- Parser, navigation-map, and AST-container fixtures cover the known output shapes.
- Documentation explains install/enable/disable/reload and `ast-grep` dependency expectations.
- Relevant gates pass for whatever source layout is chosen.

---

## Deferred / rejected

| Item | Decision |
|---|---|
| New LLM-visible `context_grep` tool | Rejected for this phase; models ignore novel tools. |
| Forcing native Pi `grep` use | Rejected; session evidence shows shell search bias. |
| Semantic index/search | Deferred; separate product/tooling question. |
| Recursive call graph | Rejected; too large and noisy for tool-result enrichment. |
| Selector repair / browser strategy | Out of scope; unrelated to search tooling and violates existing bproxy boundaries if placed in product code. |
