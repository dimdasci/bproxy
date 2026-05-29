---
title: Phase 1 — Shared Types & Workspace Scaffold
---

**Goal:** Ship `@bproxy/shared` (the domain model every later layer imports) and the full monorepo tooling surface (`pnpm check`). Wire the dependency-cruiser execution backend that Phase 0.7 left as a stub in `views:regen`.

**Strategy:** Scaffold first, types second, tooling third, views integration last. Each task is ≤1 day. The workspace skeleton and quality-gate tooling are delivered alongside the types because Phase 2 (Daemon) needs both from day one — shipping them separately would create a start-of-phase scramble.

**Spec:** `docs/public/solution/shared.md` (types), [docs/quality-gates.md](../../quality-gates.md) (tooling).
**Roadmap entry:** [Phase 1 in roadmap.md](../roadmap.md#phase-1--shared-types-and-workspace-scaffold).

---

## Locked outcomes for this phase

1. **pnpm workspace declares five packages:** `shared/`, `service/`, `extension/`, `cli/`, `views/`. The latter three (`service/`, `extension/`, `cli/`) are stub packages — `package.json` + empty `src/` + `tsconfig.json` only. They exist so dependency-cruiser rules and knip can be configured against the real workspace graph.
2. **`@bproxy/shared` compiles** with the full `Action` discriminated union, `BproxyRequest`/`BproxyResponse` envelopes, error taxonomy, pacing config types, and all supporting types from `docs/solution/shared.md`. A compile-time guard at the bottom of `actions.ts` fails the type-check if any `Action` is missing from `ActionParams` or `ActionResult`.
3. **`pnpm check` passes from a clean checkout** — type-check, Biome format, ESLint lint, dependency-cruiser arch rules, knip dead-code. Per `docs/quality-gates.md`. The type-check step (`tsc --noEmit`) is the proof of correctness for a types-only package — no vitest in `shared/`.
4. **`views:regen` is wired to dependency-cruiser.** Running `pnpm views:regen` scans `shared/src/` and emits `docs/views/auto/shared-components.svg`. The three stub packages produce no output (no source files beyond stubs).
5. **`02-containers.md` frontmatter `sources` globs cover `shared/src/**`** — the audit correctly reports the Container view as affected when shared types change.

## Inputs

- Types spec: `docs/public/solution/shared.md`
- Quality gates: [`docs/quality-gates.md`](../../quality-gates.md)
- Views spec: [`docs/solution/views.md`](../../solution/views.md) — `views:regen` execution backend
- Phase 0.7 regen stub: `views/scripts/regen.ts` — `runDependencyCruiser` to implement
- Architecture actions table: [`docs/architecture.md` § Actions](../../architecture.md#actions)

## File structure introduced/modified this phase

```
.
├── pnpm-workspace.yaml              # MODIFIED — add shared, service, extension, cli
├── package.json                     # MODIFIED — add check/typecheck/format/lint/arch/deadcode scripts
├── biome.json                       # NEW — format-only config
├── eslint.config.js                 # NEW — ESLint v9 flat config
├── .dependency-cruiser.cjs          # NEW — architecture rules
├── knip.json                        # NEW — dead-code/dep hygiene config
├── shared/
│   ├── package.json                 # NEW — @bproxy/shared
│   ├── tsconfig.json                # NEW — extends root tsconfig.base.json
│   ├── README.md                    # NEW
│   └── src/
│       ├── index.ts                 # NEW — re-exports
│       ├── protocol.ts              # NEW — BproxyRequest, BproxyResponse, PageState
│       ├── actions.ts               # NEW — Action union, ActionParams, ActionResult, compile-time guard
│       ├── errors.ts                # NEW — ErrorCode, BproxyError
│       └── sessions.ts              # NEW — PacingMode, SessionInfo, TabInfo
├── service/
│   ├── package.json                 # NEW — stub
│   ├── tsconfig.json                # NEW — stub
│   └── src/                         # NEW — empty (created for workspace to exist)
├── extension/
│   ├── package.json                 # NEW — stub
│   ├── tsconfig.json                # NEW — stub
│   └── src/                         # NEW — empty
├── cli/
│   ├── package.json                 # NEW — stub
│   ├── tsconfig.json                # NEW — stub
│   └── src/                         # NEW — empty
├── views/scripts/regen.ts           # MODIFIED — wire runDependencyCruiser
├── docs/views/auto/
│   └── shared-components.svg        # NEW — generated
└── .github/workflows/ci.yml         # NEW — pnpm check on every PR
```

---

## Task 1: Expand workspace and create stub packages

**Purpose:** Every later task needs the workspace graph to exist. Stub packages let dep-cruiser and knip see the real structure from the start.

- [ ] **Step 1: Update `pnpm-workspace.yaml`**

```yaml
packages:
  - shared
  - service
  - extension
  - cli
  - views
```

- [ ] **Step 2: Create `shared/package.json`**

```json
{
  "name": "@bproxy/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 3: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `shared/src/index.ts`** (placeholder)

```typescript
export {};
```

- [ ] **Step 5: Create stub `service/`, `extension/`, `cli/`**

Each gets: `package.json` (name `@bproxy/<name>`, version `0.1.0`, private, type module, `typecheck` script), `tsconfig.json` (extends root), empty `src/` with a `.gitkeep`.

Stub `package.json` pattern (example for service):
```json
{
  "name": "@bproxy/service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 6: Run `pnpm install` — verify clean resolution**

- [ ] **Step 7: Verify `pnpm -r typecheck` passes** (all stubs compile)

---

## Task 2: Implement `@bproxy/shared` — protocol envelope

**Files:** `shared/src/protocol.ts`, update `shared/src/index.ts`

**Purpose:** The request/response envelope that every message uses. Forward-references `Action`, `ActionParams`, `ActionResult` from `./actions` and `BproxyError` from `./errors` — those files are created in the next tasks. The protocol module compiles once all dependees exist.

- [ ] **Step 1: Write `shared/src/protocol.ts`**

Implement `BproxyRequest`, `BproxySuccessResponse`, `BproxyErrorResponse`, `BproxyResponse`, and `PageState` exactly as specified in `docs/solution/shared.md § Protocol Envelope`.

- [ ] **Step 2: Update `shared/src/index.ts`** to re-export from `./protocol`.

---

## Task 3: Implement `@bproxy/shared` — actions

**Files:** `shared/src/actions.ts`, update `shared/src/index.ts`

**Purpose:** The `Action` discriminated union, `ActionParams`, `ActionResult`, and all supporting types (`ElementTarget`, `ElementRoute`, `FillMethod`, `ExecutionWorld`, `ElementInfo`, `Landmark`, `Heading`, `TraceEntry`, `DaemonRequestTrace`). This is the load-bearing contract — every CLI command, daemon dispatcher, and extension handler is shaped by it.

- [ ] **Step 1: Write `shared/src/actions.ts`**

Implement every type exactly as specified in `docs/solution/shared.md § Actions — Discriminated Union` and `§ Supporting Types`. Every action in the [architecture actions table](../../architecture.md#actions) must appear in the union.

At the bottom of the file, add a compile-time exhaustiveness guard:

```typescript
// Compile-time guard: every Action must have ActionParams and ActionResult entries.
// If this line errors, a new Action was added without updating both interfaces.
type _AssertParams = { [A in Action]: ActionParams[A] };
type _AssertResults = { [A in Action]: ActionResult[A] };
```

This makes `tsc --noEmit` fail if someone adds a member to `Action` without adding the corresponding `ActionParams` and `ActionResult` entries. No test runner needed — the compiler is the assertion.

- [ ] **Step 2: Update `shared/src/index.ts`** to re-export from `./actions`.

---

## Task 4: Implement `@bproxy/shared` — errors

**Files:** `shared/src/errors.ts`, update `shared/src/index.ts`

**Purpose:** The error taxonomy: `ErrorCode`, `ErrorCategory`, `RetryHint`, `BproxyError`. Must align with the error envelope shape shown in `docs/architecture.md § Protocol`.

- [ ] **Step 1: Write `shared/src/errors.ts`**

Implement exactly as specified in `docs/solution/shared.md § Error Taxonomy`.

- [ ] **Step 2: Update `shared/src/index.ts`** to re-export from `./errors`.

---

## Task 5: Implement `@bproxy/shared` — sessions

**Files:** `shared/src/sessions.ts`, update `shared/src/index.ts`

**Purpose:** Session and pacing types: `PacingMode`, `PacingConfig`, `PACING_PRESETS` (the one runtime value — a const object that inlines at compile), `SessionInfo`, `TabInfo`.

- [ ] **Step 1: Write `shared/src/sessions.ts`**

Implement exactly as specified in `docs/solution/shared.md § Session Types`.

- [ ] **Step 2: Update `shared/src/index.ts`** to re-export from `./sessions`.

- [ ] **Step 3: Verify `shared/` compiles** — `pnpm --filter @bproxy/shared typecheck` exits 0.

---

## Task 6: Quality-gate tooling — Biome, ESLint, dependency-cruiser, knip

**Purpose:** Install and configure the five-tool static analysis stack from `docs/quality-gates.md`. Wire `pnpm check` as the umbrella command. For `shared/`, `pnpm typecheck` (which runs `tsc --noEmit`) is the correctness proof — the compile-time guard in `actions.ts` means a missing `ActionParams` or `ActionResult` entry is a type-check failure, not a test failure. This task is intentionally one unit because the tools are interdependent (ESLint and Biome must not overlap; dep-cruiser rules reference the workspace graph; knip needs entry points).

- [ ] **Step 1: Install root devDependencies**

```bash
pnpm add -Dw @biomejs/biome eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-sonarjs dependency-cruiser knip typescript
```

- [ ] **Step 2: Write `biome.json`** (format only — lint rules disabled per quality-gates.md)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/.astro/**", "**/.output/**", "docs/views/auto/**"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": false
  }
}
```

> Note: indent style and line width are initial choices — adjust in step 9 if the existing codebase uses spaces. The key constraint is that Biome handles format only; ESLint handles lint.

- [ ] **Step 3: Write `eslint.config.js`** (ESLint v9 flat config)

```javascript
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.astro/**', '**/.output/**', 'poc/**', 'docs/**', 'views/scripts/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs,
    },
    rules: {
      // typescript-eslint recommended-type-checked (subset — key rules)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      // sonarjs
      'sonarjs/cognitive-complexity': ['error', 15],

      // built-in complexity and size
      'complexity': ['error', 10],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'no-warning-comments': ['error', { terms: ['TODO', 'FIXME', 'XXX'] }],
    },
  },
];
```

- [ ] **Step 4: Write `.dependency-cruiser.cjs`**

```javascript
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'shared-no-imports',
      comment: 'shared/ must not import from any other workspace',
      severity: 'error',
      from: { path: '^shared/src' },
      to: { path: '^(service|extension|cli|views)/' },
    },
    {
      name: 'cli-only-shared',
      comment: 'cli/ may import only from shared/',
      severity: 'error',
      from: { path: '^cli/src' },
      to: { path: '^(service|extension|views)/' },
    },
    {
      name: 'service-only-shared',
      comment: 'service/ may import only from shared/',
      severity: 'error',
      from: { path: '^service/src' },
      to: { path: '^(cli|extension|views)/' },
    },
    {
      name: 'extension-only-shared',
      comment: 'extension/ may import only from shared/',
      severity: 'error',
      from: { path: '^extension/src' },
      to: { path: '^(cli|service|views)/' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'No orphan modules',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '__tests__'] },
      to: {},
    },
    {
      name: 'no-test-imports-in-prod',
      comment: 'Production code must not import test files',
      severity: 'error',
      from: { pathNot: '__tests__' },
      to: { path: '__tests__' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
```

- [ ] **Step 5: Write `knip.json`**

```json
{
  "workspaces": {
    "shared": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    },
    "service": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    },
    "extension": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    },
    "cli": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    },
    "views": {
      "entry": ["src/content.config.ts", "scripts/audit.ts", "scripts/regen.ts"],
      "project": ["src/**/*.ts", "scripts/**/*.ts"],
      "ignoreDependencies": ["@astrojs/starlight", "astro"]
    }
  }
}
```

- [ ] **Step 6: Update root `package.json` scripts**

Add the quality-gate commands per `docs/quality-gates.md`:

```json
{
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "format": "biome format .",
    "format:fix": "biome format --write .",
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "arch": "depcruise --config .dependency-cruiser.cjs shared/src service/src cli/src extension/src",
    "deadcode": "knip",
    "check": "pnpm typecheck && pnpm format && pnpm lint && pnpm arch && pnpm deadcode",
    "test": "pnpm -r test",
    "docs:dev": "pnpm --filter views dev",
    "docs:build": "pnpm --filter views build && bash views/scripts/assert-no-md-links.sh",
    "views:audit": "pnpm --filter views run audit",
    "views:regen": "pnpm --filter views regen"
  }
}
```

- [ ] **Step 7: Run `pnpm install`**

- [ ] **Step 8: Run `pnpm format` — fix any format violations, then `pnpm format` passes**

- [ ] **Step 9: Run `pnpm check`** — all five gates pass. Iterate on config until clean.

> **Expected issues to resolve:** knip may flag stub `.gitkeep` files or empty entry points; ESLint may need ignore patterns for `.astro` files or test files; Biome indent style may need aligning with existing code (views/ uses tabs? spaces?). Resolve each inline — the goal is a green `pnpm check`.

---

## Task 7: Wire `views:regen` to dependency-cruiser

**Files:** `views/scripts/regen.ts`, `views/package.json`

**Purpose:** Replace the Phase 0.7 stub `runDependencyCruiser` with a real invocation. After this task, `pnpm views:regen` scans any workspace that has source files and emits SVG into `docs/views/auto/`.

- [ ] **Step 1: Add `dependency-cruiser` as a devDependency of `views/`** (or rely on the root installation — check which approach dep-cruiser supports for monorepo invocation).

- [ ] **Step 2: Implement `runDependencyCruiser` in `views/scripts/regen.ts`**

Replace the stub with:
1. Ensure `docs/views/auto/` exists (`mkdirSync` recursive).
2. Invoke `npx depcruise --output-type dot <sourceDir>` to get the Graphviz DOT.
3. If `dot` (Graphviz) is available, pipe through `dot -Tsvg` and write to the output path. If `dot` is not available, write the DOT source as `.dot` instead and print a warning suggesting `brew install graphviz`.
4. Respect the `.dependency-cruiser.cjs` config from the repo root.

- [ ] **Step 3: Run `pnpm views:regen`**

Expected: `shared/` is the only workspace with source files. Output:
```
Regenerating component graphs:
  · shared → docs/views/auto/shared-components.svg
  · service: no source files
  · extension: no source files
  · cli: no source files
Done. Commit any SVGs that changed.
```

Verify `docs/views/auto/shared-components.svg` exists and contains a valid SVG.

- [ ] **Step 4: Update `views/scripts/regen.test.ts`** if the interface changed (it shouldn't — `planRegen` is pure; only the CLI wrapper changed).

- [ ] **Step 5: Run `pnpm --filter views test`** — existing regen tests still pass.

---

## Task 8: Views integration — update Container view sources

**Files:** `docs/views/02-containers.md`

**Purpose:** The Container view's `sources` frontmatter already includes `shared/**`. Verify the audit correctly reports it as affected when shared types change, and that the auto-generated component graph for `shared/` is discoverable from the site.

- [ ] **Step 1: Verify `views:audit` reports `02-containers` as affected**

Create a temporary change to a shared source file and run:
```bash
pnpm views:audit HEAD
```
Expected: `02-containers` listed as affected (source glob `shared/**` matches).

- [ ] **Step 2: Verify `docs:build` still passes** with the new workspaces and generated SVG.

```bash
pnpm docs:build
```

- [ ] **Step 3: Verify generated SVGs are renderable in the site**

If the auto-generated SVGs should be viewable in the Starlight site, confirm the `docs/views/auto/` directory is accessible. (Per `docs/solution/views.md`, these are SVGs linked from Container diagram nodes via Mermaid `click` syntax — the links won't resolve until the SVGs are served. For now, verify the files exist and the site builds.)

---

## Task 9: Package README and doc updates

**Files:** `shared/README.md`, `docs/plans/roadmap.md`

**Purpose:** Per the layer definition of done: documented.

- [ ] **Step 1: Write `shared/README.md`**

Purpose (1 paragraph), public API (link to `src/index.ts`), how to develop, how to test.

```markdown
# @bproxy/shared

The domain model shared by CLI, daemon, and extension. Types only — no runtime code except `PACING_PRESETS` (a const object that inlines at compile time).

## Public API

Single entry point: [`src/index.ts`](./src/index.ts). Re-exports from:
- `protocol.ts` — `BproxyRequest`, `BproxyResponse`, `PageState`
- `actions.ts` — `Action`, `ActionParams`, `ActionResult`, supporting types
- `errors.ts` — `ErrorCode`, `BproxyError`
- `sessions.ts` — `PacingMode`, `PACING_PRESETS`, `SessionInfo`, `TabInfo`

## Development

```bash
pnpm --filter @bproxy/shared typecheck   # type-check (the only correctness gate for a types-only package)
```
```

- [ ] **Step 2: Update `docs/plans/roadmap.md`** — mark Phase 1 as ✅ Done.

---

## Task 10: CI workflow — `pnpm check` on every PR

**Files:** `.github/workflows/ci.yml` (new), `.github/workflows/docs.yml` (keep as-is or merge)

**Purpose:** Run `pnpm check` (all five gates) plus `pnpm test` on every PR and push to main. The existing `docs.yml` workflow covers docs-only paths; this new workflow covers the full codebase.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          run_install: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm test
```

- [ ] **Step 2: Verify locally that the CI sequence passes**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

---

## Task 11: Final verification

**Purpose:** Walk the definition-of-done checklist from the roadmap.

- [ ] **Functional:** every interface consumed by later layers is implemented.
  - `Action` union covers all actions from the architecture table.
  - `BproxyRequest` and `BproxyResponse` envelopes are generic over `Action`.
  - `BproxyError` covers the full error taxonomy.
  - `PACING_PRESETS` is the only runtime value.

- [ ] **Design-asserted:** at least one test or static check confirms a design constraint.
  - Compile-time guard in `actions.ts` — `tsc --noEmit` fails if any `Action` is missing from `ActionParams` or `ActionResult`.
  - Dependency-cruiser asserts `shared/` imports from no other workspace.

- [ ] **Documented:** `shared/README.md` committed; `docs/solution/shared.md` still matches reality.

- [ ] **Static gates pass:** `pnpm check` succeeds from a clean checkout.

- [ ] **Views integration:**
  - `pnpm views:regen` produces `docs/views/auto/shared-components.svg`.
  - `pnpm views:audit` reports `02-containers` when `shared/` files change.
  - `pnpm docs:build` passes.

- [ ] **No stray TODO/FIXME/XXX:**
  ```bash
  grep -rnE "TODO|FIXME|XXX" shared/ service/ extension/ cli/ .dependency-cruiser.cjs eslint.config.js biome.json knip.json 2>/dev/null
  ```

- [ ] **Phase 1 done.** Phase 2 (Daemon) is unblocked.

---

## Out of scope (this phase)

- **Runtime code in `shared/`.** Types only (plus `PACING_PRESETS`). Validation functions (e.g., Zod schemas for runtime parsing of requests) are deferred to Phase 2, where the daemon is the first consumer.
- **Runtime tests in `shared/`.** The package has no runtime behaviour; `tsc --noEmit` is the correctness proof. Vitest arrives in Phase 2 when the daemon has behaviour to test.
- **Implementation code in `service/`, `extension/`, `cli/`.** These are stubs — `package.json` + `tsconfig.json` + empty `src/`. Phase 2+ fills them.
- **Pre-commit hooks.** Deferred to Phase 5 per `docs/quality-gates.md`.
- **Drift detection between `architecture.md` actions table and `Action` type union.** Accept drift risk; revisit at Phase 4 when all three consumers exist and the action list has been stress-tested.
- **Additional curated views** (Context, Deployment, Session State, Threat Model). These land in evolutionary PRs independent of production phases. Slot 05 scenario views are intentionally absent.
- **Auto-generated component graphs for service/extension/cli.** No source code yet. `views:regen` will pick them up automatically when Phase 2+ adds code.
