# context-grep tooling

Repo-local Pi search enrichment — AST context + back-references for grep results.

## Architecture

Based on the proven codeindex-exploration experiment design:
- Parse grep output → find enclosing AST containers → find callers → format single block
- No navigation maps, no suggested reads, no lane classification (these were tested and removed — they increased turns)

## Layout

**Option B** from Phase 9 plan:

- Checked source: `tools/pi/context-grep/`
- Pi shim: `.pi/extensions/context-grep/index.ts`

## Validation

```bash
pnpm test:pi-tooling       # run tests (via tsx)
pnpm typecheck:pi-tooling  # typecheck source + tests
pnpm typecheck:pi-shim     # typecheck the Pi extension shim
```

Extension source is excluded from product gates (`pnpm check`).

## Runtime expectations

- `ast-grep` on PATH
- `rg` on PATH (for back-references)
- Pi must trust the project
- `/reload` picks up changes

## Files

```
src/
  parse.ts      — grep/rg output parsing + command detection (safety layer)
  ast.ts        — ast-grep container extraction + availability check
  backrefs.ts   — caller lookup via rg --json --fixed-strings
  enrich.ts     — enrichment pipeline: parse → containers → back-refs → format
  index.ts      — barrel exports
test/
  context-grep.test.ts   — parser, AST, back-refs, enrichment tests
  iteration2.test.ts     — hardening tests (heredoc rejection, lineText)
  fixtures/              — TypeScript fixtures for ast-grep validation
```

## Supported languages

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`

## Measured impact

| Task type | Turns (no ext → with ext) | Effect |
|---|---|---|
| Investigation (trace call chains) | 36 → 20 (−44%) | Strong positive |
| Audit (comprehensive review) | 17 → 18 (neutral) | No harm |

The extension acts as a passive guardrail: agents see call chains automatically, reducing uninformed edits.
