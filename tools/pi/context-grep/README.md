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
pnpm test:pi-tooling
```

That suite covers:

- native Pi `grep` row parsing
- bash `rg -n` parsing
- bash `grep -rn`/single-file `grep -n` handling
- negative/path-list/unsupported-extension cases
- TypeScript container-kind validation via real `ast-grep`
- one real bproxy source-file enrichment check (`service/src/config.ts`)

## Runtime expectations

- `ast-grep` must be on `PATH`
- Pi must trust the project to load `.pi/extensions/context-grep/`
- `/reload` picks up code changes in the shim and source

## Files

- `src/parse.mjs` — bounded grep/bash parsing + path inference
- `src/ast.mjs` — `ast-grep` availability + container extraction
- `src/enrich.mjs` — hit→container mapping and output formatting
- `test/` — fixtures and node:test coverage
