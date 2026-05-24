---
title: Architecture Views
---

Implementation spec for the visual architecture artifact and its rendering wrapper. A small static site built with [Astro Starlight](https://starlight.astro.build) renders a curated set of [Mermaid](https://mermaid.js.org) diagrams plus the existing prose docs. Two helper scripts keep the artifact discoverable when code or decisions change.

**Decisions that constrain this:** [ADR-005](../decisions.md#adr-005-typescript-as-project-language) (TypeScript), [ADR-009](../decisions.md#adr-009-observability-as-a-first-class-design-constraint) (every artifact independently inspectable), [ADR-012](../decisions.md#adr-012-static-analysis-stack) (dep-cruiser already in the stack — reused for auto-derived component graphs).

**Follow-up ADRs (this spec implies, to be appended to `decisions.md`):**
- Site generator — Astro Starlight (rationale: typed content collections align with sync helpers; TS-native; Mermaid rendered via inline remark plugin + CDN, no Playwright)
- Diagram notation — Mermaid in markdown, with `flowchart` + subgraphs used in place of the experimental `C4Container` syntax
- Layering spine — C4 model (Context / Container / Component / Code), with Diátaxis as the broader site IA

## Purpose

The artifact exists to:

1. Provide a **layered perception** of bproxy: System Context → Containers → Components → Code, traversable in order.
2. Be **presentable** — open the local site, project the screen, walk a viewer through the system without scrolling past unrelated prose.
3. Be an **onboarding entry point** — one navigable path that lands a new contributor on the right page in five minutes.
4. Stay **discoverable when code or decisions evolve** — helper scripts surface the views whose declared sources changed in a branch, so the author updates the right ones before merging.

The artifact is a wrapper. The existing prose docs (`architecture.md`, `decisions.md`, `scenarios.md`, `solution/*.md`) remain the source of truth for narrative; the views site renders both, leading with the visual layer.

## Project Layout

```
views/                              # new workspace (TS, Astro Starlight)
├── package.json                    # deps: astro, @astrojs/starlight, zod
├── astro.config.mjs                # Starlight config; content sourced from ../docs
├── tsconfig.json
├── src/
│   ├── content.config.ts           # Astro content collections (docs + views)
│   ├── lib/
│   │   └── view-schema.ts          # Zod schema for view frontmatter (load-bearing; imports raw `zod`)
│   ├── components/                 # Starlight overrides (breadcrumb hook, ADR footer)
│   └── styles/                     # minimal theme tweaks
└── scripts/
    ├── audit.ts                    # `pnpm views:audit` — drift detection
    └── regen.ts                    # `pnpm views:regen` — component-graph regeneration

docs/views/                         # content: the six curated views
├── 01-context.md                   # C4 L1
├── 02-containers.md                # C4 L2 — the canonical bproxy diagram
├── 03-deployment.md                # C4 deployment + trust boundaries
├── 04-session-state.md             # behavior: daemon session lifecycle
├── 05-scenarios/                   # one sequence diagram per scenario
│   ├── google-research.md
│   ├── linkedin-snapshot.md
│   └── form-fill.md
├── 06-threat-model.md              # DFD + STRIDE notes
└── auto/                           # generated SVGs (component graphs)
    ├── daemon-components.svg       # via dependency-cruiser
    ├── extension-components.svg
    └── cli-components.svg
```

The Astro app reads `../docs/` so the existing markdown structure stays the canonical source. No duplication, no re-export step.

## Diagram Set

The artifact maintains exactly **six curated diagrams** plus an auto-derived component layer. The ceiling is intentional — if a candidate seventh diagram duplicates prose, the prose stays and the diagram is dropped.

| # | File | Diagram | Notation | Source-of-truth |
|---|---|---|---|---|
| 01 | `docs/views/01-context.md` | C4 System Context | Mermaid `flowchart` | Intent (hand-edited) |
| 02 | `docs/views/02-containers.md` | C4 Container view | Mermaid `flowchart` w/ subgraphs | Intent (hand-edited) |
| 03 | `docs/views/03-deployment.md` | C4 Deployment | Mermaid `flowchart` w/ subgraphs | Intent (hand-edited) |
| 04 | `docs/views/04-session-state.md` | Daemon session state | Mermaid `stateDiagram-v2` | Intent (hand-edited) |
| 05 | `docs/views/05-scenarios/*.md` | Round-trip sequence per scenario | Mermaid `sequenceDiagram` | Intent (hand-edited) |
| 06 | `docs/views/06-threat-model.md` | DFD + STRIDE annotations | Mermaid `flowchart` w/ trust-boundary subgraph | Intent (hand-edited) |
| — | `docs/views/auto/*.svg` | Per-workspace component dep graphs | SVG from `dependency-cruiser` | Code (regenerated) |

The Container diagram (02) is the canonical artifact. Most navigation flows through it: its nodes are clickable and drill into the auto-derived component graphs.

**Implementation status:** the table above is the target end-state. Phase 0.7 requires only `02-containers.md`; the other five curated intent diagrams are added incrementally in follow-up PRs.

## Layering Model

C4 as the spine, populated for bproxy:

- **C1 (Context)** — Code Agent, Developer, bproxy, Web Page
- **C2 (Containers)** — CLI, Daemon, Extension (with Background SW, Content Script, Popup as nested boundary)
- **C3 (Components)** — Daemon internals (auth, pacing, ws-hub, pending-map, sessions), Extension internals (tab-router, frame-table, dispatch, read primitives, write methods)
- **C4 (Code)** — file-level dependency graphs per workspace, generated, not hand-drawn

Cross-cutting indexes (not layers, linked from layers): Protocol envelope (in `architecture.md`), Actions catalog (in `architecture.md`), ADRs (in `decisions.md`), Scenarios (in `scenarios.md`).

Diátaxis applied to the site IA at large:
- `docs/views/` + `architecture.md` → **explanation**
- `solution/*.md` → **reference**
- `scenarios.md` + `docs/views/05-scenarios/` → **how-to**
- _(gap)_ → **tutorial** — added once the daemon exists and a first end-to-end walkthrough is real

## Content Collection Schema

The frontmatter of each view file is **load-bearing**. Two consumers read it:
1. Starlight at build time (validates, generates sidebar, renders ADR footer)
2. `views:audit` at lint time (compares declared `sources` to the diff)

A single Zod schema covers both. To make it importable from a plain Node script (the audit CLI), it lives in its own file that imports `zod` directly — not from `astro:content`, which only resolves inside an Astro build.

```typescript
// views/src/lib/view-schema.ts
import { z } from 'zod';

export const viewSchema = z.object({
  layer: z.enum(['c1', 'c2', 'c3', 'c4', 'behavior', 'threat']),
  sources: z.array(z.string()).min(1),  // glob patterns vs repo root
  relatedAdrs: z.array(z.string().regex(/^ADR-\d{3}$/)).optional(),
  related: z.array(z.string()).optional(),  // sibling view slugs
});

export type View = z.infer<typeof viewSchema>;
```

The Astro content config imports the same schema:

```typescript
// views/src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { viewSchema } from './lib/view-schema';

export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: ['**/*.{md,mdx}', '!views/**'], base: '../docs' }),
    schema: docsSchema(),
  }),
  views: defineCollection({
    loader: glob({ pattern: '**/*.md', base: '../docs/views' }),
    schema: docsSchema({ extend: viewSchema }),
  }),
};
```

Example frontmatter (`docs/views/02-containers.md`):

```markdown
---
title: Containers
layer: c2
sources:
  - shared/protocol/**
  - service/src/**
  - extension/src/**
  - cli/src/**
relatedAdrs: [ADR-003, ADR-008, ADR-010, ADR-013, ADR-017]
related: [01-context, 03-deployment]
---
```

Build fails on malformed frontmatter — typos in `sourcse:` or invalid ADR refs are caught before merge.

## Diagram Conventions

### Mermaid in fenced blocks

Diagrams live as ```` ```mermaid ```` fenced blocks inside the view's markdown file. An inline remark plugin (12 lines, zero new deps) converts them to `<pre class="mermaid">` blocks at build time; Mermaid's CDN ESM bundle renders them client-side at runtime. Source stays in the file — agents reading raw markdown see the diagram source, not just rendered output.

`rehype-mermaid` was evaluated and rejected: it carries `mermaid-isomorphic` as a hard dependency, which in turn lists `playwright` as a peer dependency unconditionally — even for strategies that never invoke Playwright. Playwright is not permitted in this project.

### Use `flowchart`, not `C4Container`

Mermaid's `C4Container` family is marked experimental and renders inconsistently. Use `flowchart` with named subgraphs to express the same Container shape; the C4 vocabulary lives in node labels and arrow captions, not in syntax.

Example (Container view):

```mermaid
flowchart LR
  Agent([Code Agent])
  User([Developer])

  subgraph bproxy ["bproxy"]
    CLI["CLI<br/><i>citty</i>"]
    Daemon["Daemon<br/><i>Fastify, HTTP+WS</i>"]
    subgraph Ext ["Chrome Extension (WXT, MV3)"]
      BG["Background SW"]
      CS["Content Script<br/><i>ISOLATED world</i>"]
      Popup["Popup<br/><i>Pairing UI</i>"]
    end
  end

  Page[("Web Page")]

  Agent -- "shell" --> CLI
  CLI -- "POST / (HTTP+Bearer)" --> Daemon
  BG <-- "persistent WS" --> Daemon
  BG -- "chrome.scripting" --> CS
  CS -- "DOM read/write" --> Page

  click Daemon "/views/auto/daemon-components" "Daemon — Components"
  click Ext "/views/auto/extension-components" "Extension — Components"
```

### Native drill-down via `click`

Mermaid's `click NodeID "url" "tooltip"` syntax makes diagram nodes navigable. Container nodes link to their component sub-graphs in `docs/views/auto/`. No custom code; no glue.

## Writing a View Page

Rules distilled from rework. Each view page follows the same rhythm:

1. **Lead paragraph** above the diagram. One short paragraph in plain English. Names what the page shows and what it deliberately doesn't; points further questions to the linked pages at the bottom. No bold.
2. **Self-contained diagram.** Title in the Mermaid `---title---` frontmatter; legend subgraph at the bottom; colour and shape encoding consistent with the legend. The SVG must still make sense if extracted on its own.
3. **Numbered figure caption** immediately beneath the diagram, in regular-weight prose. Form: `Figure N. [what the figure shows] — [notation note if any].` This is what a reader (human or agent) gets without rendering the diagram.
4. **Closing paragraphs** naming what the reader should walk away with. Connected thoughts read as paragraphs, not bullets. Emphasis comes from being the first sentence of a paragraph, not from typography.

Editorial style:

- **Audience first.** Readers can follow diagrams logically but are not fluent in C4 vocabulary. Avoid notation jargon (`stereotype`, `system under design`, `discriminated union`) in prose; let the diagram carry the notation and let the prose translate it.
- **One emphasis device per element.** Bold or italic, never both. Do not bold the first words of every bullet — alternating weight reads as a zebra, not as emphasis.
- **Edges describe purpose, not protocol.** Labels say what the relationship is for (*controls browser session*), not how it is implemented (*via localhost daemon + extension*). Implementation belongs to the next layer.
- **Each layer answers its own question and defers the others.** Internal structure, technology choices, deployment, and security consequences each have their own page; do not borrow content from the next layer down to "complete" the picture.
- **Cross-page links use the target's title, not its file slug.** Write `[Containers](./02-containers.md)`, not `[02-containers](./02-containers.md)`. The slug is a filesystem detail; the reader sees the title in the sidebar, breadcrumbs, and browser tab, and the link text must match.

## Sync Helpers

Two CLI scripts exposed as workspace tasks. Both advisory — neither fails CI.

### `pnpm views:audit`

**File:** `views/scripts/audit.ts`

Given a diff (default: `git diff --name-only origin/main...HEAD`), reports which views' declared `sources` were touched and whether the view file itself was touched in the same branch.

```
$ pnpm views:audit

Changed files in this branch:
  shared/protocol/envelope.ts
  service/src/auth.ts
  service/src/pacing.ts

Views potentially affected:
  ⚠ 02-containers     touched-sources: 2  view-touched: no
                       sources match: service/src/**
                       → consider reviewing for accuracy

  ⚠ 04-session-state  touched-sources: 1  view-touched: no
                       sources match: service/src/auth.ts (via service/src/**)
                       → consider reviewing for accuracy

  ✓ 03-deployment     touched-sources: 0  view-touched: no
  ✓ 06-threat-model   touched-sources: 1  view-touched: yes

Hint: run `pnpm views:regen` if any component graph under docs/views/auto/ is stale.
```

The audit imports `viewSchema` from `views/src/lib/view-schema.ts` and validates every parsed frontmatter through `safeParse`. Parse failures surface in the report with the offending file path and Zod field path (e.g., `02-containers.md: sources — Required`); the audit still exits 0 (advisory contract preserved), but malformed frontmatter shows up loudly instead of silently passing.

Frontmatter is parsed with `js-yaml`, not a hand-rolled extractor — single source of truth requires a real YAML reader.

Glob matching: minimatch against repo-relative paths.

### `pnpm views:regen`

**File:** `views/scripts/regen.ts`

Runs `dependency-cruiser` per workspace (`cli`, `service`, `extension`) and emits SVG into `docs/views/auto/`. Configurable depth and clustering via `dependency-cruiser`'s standard options; defaults are tuned to component-level granularity (single-file leaves, package boundaries as clusters).

```
$ pnpm views:regen

Regenerating component graphs:
  cli         → docs/views/auto/cli-components.svg          (12 modules)
  service     → docs/views/auto/service-components.svg      (28 modules)
  extension   → docs/views/auto/extension-components.svg    (19 modules)

Done. Commit the SVGs if they changed.
```

Idempotent. Designed to be run before commit, not by CI.

## Interactivity

Stock Starlight features plus Mermaid native — no custom widgets in v1.

| Mechanism | Provided by | Behavior |
|---|---|---|
| Sidebar navigation | Starlight | Auto-generated from content collection, ordered by filename prefix (`01-`, `02-`, …). The sidebar **is** the layer ladder. |
| Clickable diagram nodes | Mermaid `click` syntax | Container nodes link to component sub-graphs; component-graph nodes link to ADRs where relevant. |
| Breadcrumbs | Starlight built-in | Shows layer path at top of each view. |
| Prev / next | Starlight built-in | Footer arrows traverse the sidebar order. |
| ADR cross-links | Custom Starlight component | A small `<RelatedAdrs />` component reads `relatedAdrs` from frontmatter and renders "Decisions behind this view: ADR-007, ADR-013…" as live links to `decisions.md`. |

Not in v1: pan/zoom on diagrams, fullscreen overlay, search-within-diagram, per-view dark/light theming overrides. All add weight; none required by the goals.

## Deployment

| Stage | Command | Surface |
|---|---|---|
| Development | `pnpm docs:dev` | Starlight dev server on `localhost:4321`. Hot-reloads on edits to `docs/**` and `views/src/**`. |
| Build | `pnpm docs:build` | Static `views/dist/` directory. |
| CI | `pnpm docs:build` runs on every PR | Catches frontmatter schema violations and broken intra-site links. Mermaid rendering issues are surfaced in local `docs:dev` / preview runtime checks. Does **not** publish. |
| Public hosting | _(deferred)_ | When bproxy goes public, add a GitHub Pages workflow that publishes `views/dist/` on merge to `main`. No decision required now. |

## Failure Modes

| Failure | Surface |
|---|---|
| Mermaid syntax error in a view | Page renders with Mermaid runtime error in `docs:dev` / preview. CI build may still pass in `pre-mermaid` mode. |
| Malformed view frontmatter (missing field, wrong type) | Build fails via Zod with field path. |
| `relatedAdrs` references a non-existent ADR | _(not enforced in v1)_ — add a custom integration if it becomes a real problem. |
| `views:audit` reports nothing changed but author knows otherwise | The `sources` glob is wrong. Update the frontmatter — that's the maintenance loop. |
| Auto-generated component graph differs from committed SVG | _(not enforced in v1)_ — the user runs `views:regen` and commits the result. |

## Testing

Light. The artifact is content, not behavior.

- **Schema tests** (`vitest`): construct view frontmatter fixtures, verify Zod accepts/rejects.
- **Audit tests** (`vitest`): given fake diffs and fake view frontmatter, verify the audit identifies the right affected views.
- **Regen smoke test**: run `views:regen` in CI, verify it exits 0 and writes the expected files. SVG content is not snapshot-tested (layout is noisy).

No tests on Starlight itself — it's an upstream dependency.

## Development

```bash
cd views
pnpm dev          # alias for `pnpm docs:dev` — Starlight on localhost:4321
pnpm build        # alias for `pnpm docs:build`
pnpm audit        # alias for `pnpm views:audit`
pnpm regen        # alias for `pnpm views:regen`
pnpm test         # vitest on schema + audit logic
```

## Out of Scope (v1)

- Live/runtime introspection of the daemon or extension. The artifact is design-time documentation; observability of the running system is covered by `debug.*` actions (see [service.md](./service.md) and [architecture.md](../architecture.md)).
- Likec4, Structurizr, or any DSL-driven multi-view system. Considered and rejected: a single-source-of-truth DSL fights the "render markdown" framing; Likec4's static export goes through headless Chromium with Playwright (no native vector renderer), and its embed path requires React + PandaCSS as peer dependencies. The MCP-queryable benefit is mostly achievable by parsing Mermaid sources or a small manifest, without inheriting the toolchain.
- Visual editing inside the browser. The artifact is git-versioned text.
- Auto-generation of intent diagrams (Context / Container / Deployment / Session State / Sequences / Threat Model). These encode decisions, not code shape.
- Public hosting. The site builds in CI as a correctness gate; deployment is deferred.

## Related

- [architecture.md](../architecture.md) — system shape and protocol (rendered by this site)
- [decisions.md](../decisions.md) — ADRs (cross-linked from each view's footer)
- [scenarios.md](../scenarios.md) — driving use cases (one sequence diagram per scenario lives under `docs/views/05-scenarios/`)
- [solution/extension.md](./extension.md), [solution/service.md](./service.md), [solution/cli.md](./cli.md), [solution/shared.md](./shared.md) — sibling component specs (rendered by this site)
- [quality-gates.md](../quality-gates.md) — defines `pnpm check`; the views audit/regen scripts are independent of it (advisory, not blocking)
