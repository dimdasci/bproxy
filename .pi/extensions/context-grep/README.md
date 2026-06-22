# context-grep Pi extension

Project-local Pi extension that enriches `bash` `rg`/`grep` results with AST context and back-references. The agent searches as usual; the extension transparently appends enclosing functions and their callers.

## How it helps

Every time the agent greps for code it plans to modify, it automatically sees:
- The enclosing function/class (not just the matched line)
- Who calls that function ("Called from: ← callerName (file:line)")

This reduces iterative grep→read→grep cycles by ~44% on investigation tasks (measured via A/B testing).

## Enable

1. Trust this project in Pi.
2. Ensure `ast-grep` is installed and on `PATH`.
3. Start Pi in this repo — auto-discovered, or `/reload`.

## Disable

- `pi --no-extensions`, or
- Remove `.pi/extensions/context-grep/`, then `/reload`.

## Output format

```text
── AST context (N containers, deduplicated) ────────────────────────────

▶ service/src/config.ts:20-29 [fn loadBaseConfig] (grep hits: [20])
  │
  │ Called from:
  │   ← main (service/src/index.ts:20)
  │   ← loadConfig (service/src/config.ts:32)
  │
    export function loadBaseConfig(env) {
        ...
    }
```

## Behavior

- Original search output stays at top unchanged.
- AST context appended when ast-grep finds enclosing containers.
- Back-references added when a grep hit lands on a function definition line.
- Script/heredoc commands correctly rejected (no false enrichment).
- If `ast-grep` unavailable: warns once, stays passive.
- Any error: returns original result unchanged.

## Supported file extensions

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`

## Source + tests

Checked TypeScript source: `tools/pi/context-grep/`

```bash
pnpm test:pi-tooling       # run tests
pnpm typecheck:pi-tooling  # typecheck source + tests
pnpm typecheck:pi-shim     # typecheck Pi shim
```
