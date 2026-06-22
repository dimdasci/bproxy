# context-grep Pi extension

Project-local Pi extension that appends bounded AST context and a navigation map to successful `bash` `rg`/`grep` results and native Pi `grep` results.

## Enable

1. Trust this project in Pi.
2. Ensure `ast-grep` is installed and on `PATH`.
3. Start Pi in this repo and run `/reload`.

Pi auto-discovers `.pi/extensions/context-grep/index.ts` after trust.

## Disable

- Start Pi with `--no-extensions`, or
- rename/remove `.pi/extensions/context-grep/`, then `/reload`.

## Behavior

- Original search output stays at the top unchanged.
- A navigation map is appended when enough hits exist (lanes, task focus, suggested reads).
- AST context is appended when parsing and `ast-grep` succeed.
- Unsupported files, path-list searches, and internal failures fall back to the original result.
- If `ast-grep` is unavailable, the extension warns once per session and then stays passive.
- Script/heredoc commands containing `grep`/`rg` text are correctly rejected.

## Supported file extensions

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`

## Source + tests

Checked TypeScript source lives under `tools/pi/context-grep/`.

- Core: `tools/pi/context-grep/src/`
- Tests: `tools/pi/context-grep/test/`
- Run: `pnpm test:pi-tooling`
- Typecheck: `pnpm typecheck:pi-tooling`
