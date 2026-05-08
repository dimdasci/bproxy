# bproxy — Quality Gates

> **Status:** Active. Owns the static-analysis policy enforced in CI.
> **Decision:** [ADR-012: Static analysis stack](./decisions.md#adr-012-static-analysis-stack).

This document captures the concrete tools, configurations, thresholds, and commands that protect bproxy's code structure and complexity from degradation. Every layer's [definition of done](./plans/roadmap.md#layer-pattern-definition-of-done) requires `pnpm check` to pass.

## Tools at a glance

| Concern | Tool | Command |
|---|---|---|
| Type checking | `tsc --noEmit` per workspace | `pnpm typecheck` |
| Format | Biome v2 | `pnpm format` (check) · `pnpm format:fix` |
| Lint | ESLint v9 + plugins | `pnpm lint` (check) · `pnpm lint:fix` |
| Architecture rules | dependency-cruiser | `pnpm arch` |
| Dead code & dep hygiene | knip | `pnpm deadcode` |
| **All five together** | — | **`pnpm check`** |

`pnpm check` is the umbrella. CI runs it; developers run it locally before pushing. Each step is also runnable on its own during active development.

## Type checking

Each workspace's `tsconfig.json` extends a root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

`exactOptionalPropertyTypes` is intentionally **not** enabled — third-party type interactions remain painful in 2026.

## Lint rules (ESLint v9)

Plugins:

- `@typescript-eslint` — recommended-type-checked rules.
- `eslint-plugin-sonarjs` — `cognitive-complexity`, `no-duplicate-string`, `no-identical-functions`.
- Built-in size, depth, and shape rules.

Thresholds:

| Rule | Limit | Rationale |
|---|---|---|
| `cognitive-complexity` (sonarjs) | 15 | Higher signal than cyclomatic — flags genuinely hard-to-follow functions. |
| `complexity` | 10 | Cyclomatic backstop. |
| `max-lines` (per file) | 300 | Pressure to split modules; not law. |
| `max-lines-per-function` | 60 | Same. |
| `max-depth` | 4 | Nesting indicates flow complexity. |
| `no-warning-comments` | error on `TODO` / `FIXME` / `XXX` | Matches the "no commented-out code or TODOs in committed work" rule from the roadmap. |

CI runs ESLint with `--max-warnings 0`. No silent warnings.

## Architecture rules (dependency-cruiser)

Rules mirror `docs/architecture.md`:

- `cli` may import only from `shared`.
- `extension` may import only from `shared`.
- `service` may import only from `shared`.
- `shared` may not import from any other workspace.
- No circular dependencies, anywhere.
- No orphan modules.
- Test files may import production code; production code may not import test files.

The ruleset lives at `.dependency-cruiser.cjs` in the repo root. **Updates to this file must be made together with any matching change to `docs/architecture.md`** — drift is the failure mode.

## Dead code and dependency hygiene (knip)

`knip.json` per workspace, with WXT and tsup entry points configured under `entry` to prevent false positives. Failures:

- Unused exports.
- Unused files.
- Unused dependencies in `package.json`.
- Undeclared dependencies (imported but not in `package.json`).

## Format (Biome)

Biome handles formatting only. Lint rules deliberately disabled to avoid double configuration with ESLint.

## Commands (pnpm scripts)

Root `package.json` defines the canonical command surface:

```jsonc
{
  "scripts": {
    "typecheck":  "pnpm -r typecheck",
    "format":     "biome format .",
    "format:fix": "biome format --write .",
    "lint":       "eslint . --max-warnings 0",
    "lint:fix":   "eslint . --fix",
    "arch":       "depcruise --config .dependency-cruiser.cjs .",
    "deadcode":   "knip",
    "check":      "pnpm typecheck && pnpm format && pnpm lint && pnpm arch && pnpm deadcode"
  }
}
```

Each workspace package defines its own `typecheck` script (`tsc --noEmit`); the root `typecheck` fans out via `pnpm -r typecheck`.

## When gates run

| Stage | Behaviour |
|---|---|
| During active development | Run `pnpm <step>` or `pnpm check` on demand. No auto-run on save or on commit. |
| CI (every PR and push to main) | `pnpm check` runs the full suite. Failures block merge. No auto-fix in CI. |
| Pre-commit hooks | **Deferred to Phase 5** (integration & hardening). Pre-commit machinery during active development is friction; introduce it once the codebase stabilizes. |

## When to relax a rule

- **Per-file disable** (`/* eslint-disable */`, `// eslint-disable-next-line`, etc.): allowed but tracked. A growing count is itself a complexity signal — review quarterly.
- **Threshold raised globally:** requires a one-line entry in this doc explaining why. No silent threshold drift.
- **dependency-cruiser allowed exceptions:** must come with a corresponding update to `docs/architecture.md`. The architecture doc is the source of truth; rules follow it.

## What we deliberately don't gate

- **Code duplication** (jscpd, simian). Run quarterly as an audit, not as a CI gate. Threshold-based duplication gating tends to produce perverse refactors.
- **Test coverage percentage.** Gate behaviour with tests, not metrics.
- **Bundle size.** Track for the extension build later, not as a structural concern.
