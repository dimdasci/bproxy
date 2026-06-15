# bproxy agent notes

## What this is

bproxy lets coding agents use the operator's real Chrome session without Playwright/headless control.

```text
Agent -> CLI -> localhost daemon -> Chrome extension -> real page
```

Human stays in loop: login, CAPTCHA, consent, final submit.

## Non-negotiables

- Extension = sensor/actuator only. No strategy, selector repair, auto method choice, fallback chains, modal solving, retry policy.
- ISOLATED world by default. MAIN world only for one-shot `fill(method="runtime-api")`.
- No arbitrary page eval. No `MutationObserver`. No generalized scroll-container inference.
- Daemon owns: auth, sessions, logical tabs, pacing, pause state, dispatch, pending map, element-handle aliases.
- CLI = one shot: one command -> one daemon POST -> one JSON object on stdout. Diagnostics go stderr.
- `shared` types are the protocol. Action/wire changes must update all consumers.
- Temp files stay under `BPROXY_HOME`. No `/tmp`, no `os.tmpdir()` in prod or tests.
- Security findings/hotspots: fix in code/tests. Don't suppress or mark safe in scanner UI.

## Docs: read + precedence

For non-trivial changes, read relevant docs first. If docs/code conflict, precedence is:

1. `docs/internal/decisions.md` — ADRs; mandatory.
2. `docs/internal/architecture.md` — system shape + action catalog.
3. `docs/internal/quality-gates.md` — quality policy.
4. `docs/public/solution/*.md` — component specs.
5. `docs/public/views/*.md`, `docs/public/index.md` — public tech docs.
6. Code.

If code violates ADR/architecture, stop and report drift before editing.

Fast map:

| Need | Read |
|---|---|
| intent / principles | `docs/public/index.md` |
| canonical diagram | `docs/public/views/02-containers.md` |
| protocol/actions/errors | `docs/public/solution/shared.md` |
| daemon/auth/session/WS | `docs/public/solution/service.md` |
| extension/MV3/content script | `docs/public/solution/extension.md` |
| CLI/output/exit codes | `docs/public/solution/cli.md` |
| roadmap / phase logs | `docs/internal/plans/roadmap.md` |
| raw findings | `docs/internal/journal/` |

Don't rewrite journal history unless asked.

Phase files in `docs/internal/plans/phases/`: active phase may be tactical; closed phase should be durable log only — intent, inputs, major changes, shipped outcome, deferred/rejected, validation.

## Build / checks

Baseline: Node `>=24`, pnpm `9.15.0`, TypeScript monorepo.

Workspace imports:

```text
cli       -> shared only
service   -> shared only
extension -> shared only
shared    -> no workspace imports
```

Commands:

```bash
pnpm check       # typecheck + format + lint + arch + deadcode
pnpm test        # all tests
pnpm docs:build  # public docs build
pnpm views:audit
pnpm views:regen

pnpm --filter @bproxy/cli test
pnpm --filter @bproxy/service test
pnpm --filter @bproxy/extension test
```

`pnpm check` is CI gate. Don't claim done with relevant gates failing.

## Generated files

- Don't hand-edit `docs/public/views/auto/*.svg`.
- Regenerate with `pnpm views:regen`.
- `views/public/views/auto/` is ignored build staging.

## Husky footgun

Husky v9 treats first arg as install dir. These create junk folders (`--version/_`, `--help/_`):

```bash
husky --version
husky --help
```

Don't run them. Use:

```bash
pnpm list husky
pnpm why husky
node -e "console.log(require('./node_modules/husky/package.json').version)"
```

Refresh hooks:

```bash
pnpm prepare
pnpm exec husky   # no args
```
