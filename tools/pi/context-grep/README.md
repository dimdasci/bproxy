# context-grep tooling

Repo-local Pi search enrichment.

## Layout choice

This repo uses **Option B** from the Phase 9 plan:

- checked source: `tools/pi/context-grep/`
- tiny Pi shim: `.pi/extensions/context-grep/index.ts`

Why:

- keeps Pi runtime wiring small
- keeps parser/AST logic testable without loading Pi itself
- avoids pulling this repo into a new TypeScript workspace package just for Pi-only tooling

## Validation model

This tooling is intentionally kept out of the product workspaces (`cli`, `service`, `extension`, `shared`).
It does **not** participate in `pnpm check`.
Validation is instead explicit and local:

```bash
pnpm test:pi-tooling       # run tests (via tsx)
pnpm typecheck:pi-tooling  # typecheck source + tests
pnpm typecheck:pi-shim     # typecheck the Pi extension shim
```

The test suite covers:

- native Pi `grep` row parsing
- bash `rg -n` parsing
- bash `grep -rn`/single-file `grep -n` handling
- negative/path-list/unsupported-extension cases
- heredoc/script-analysis false-positive rejection
- lineText preservation in parsed hits
- path-kind and hit-kind classification
- task-focus inference
- navigation-map generation with lanes and bounds
- TypeScript container-kind validation via real `ast-grep`
- one real bproxy source-file enrichment check (`service/src/config.ts`)
- replay fixtures from June 20 session patterns

## Runtime expectations

- `ast-grep` must be on `PATH`
- Pi must trust the project to load `.pi/extensions/context-grep/`
- `/reload` picks up code changes in the shim and source

## Files

- `src/parse.ts` — bounded grep/bash parsing + path inference
- `src/ast.ts` — `ast-grep` availability + container extraction
- `src/enrich.ts` — hit→container mapping and output formatting
- `src/navigate.ts` — navigation-map generation (lanes, focus, suggested reads)
- `src/index.ts` — barrel exports
- `test/` — fixtures and node:test coverage (run with tsx)

## Supported languages

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`
