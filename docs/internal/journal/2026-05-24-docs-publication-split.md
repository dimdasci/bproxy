# Handoff — splitting published docs from project artifacts

## The decision we're heading toward

Restructure the repo so the Astro/Starlight site sources from a folder that contains **only published documentation**, while project artifacts (drafts, plans, journal, design rationale) live in a sibling folder the site never reads.

Currently `docs/` mixes both. The Astro site reads `docs/` directly, and the sidebar config in `views/astro.config.mjs` hand-filters which files become published pages. Result: every new doc raises an artifact-vs-publication question, cross-refs between the two tiers go stale, and the filesystem has no rule — only the sidebar enforces the boundary.

A cleaner shape would replace sidebar-based filtering with a filesystem boundary: cross-refs inside the published tier always resolve; refs from published into artifacts get caught by the build. **Concrete folder structure, file moves, and migration sequence are still to be agreed** — see open questions.

## What's already done (context)

- Five view pages in `docs/views/` polished to outside-reader quality (C4 conventions, plain prose, no zebra) — branch `plan/phase-4-cli`, last commit `3f19630`.
- Page-writing rules codified in `docs/solution/views.md` under *"Writing a View Page"*.
- These five views are the core of what the published site will surface.

## Confirmed in conversation

- The `docs/views/05-scenarios/` folder should be deleted (user approved). Examples may return later.
- The README (`docs/index.md`) should be rewritten to use motivation from `architecture.md` and the use-cases framing from `scenarios.md`. Plain English, no bold zebra, per the codified rules.
- `architecture.md`, `scenarios.md`, `plans/`, `journal/`, and the docs-site meta-spec (`solution/views.md`) are **project artifacts** that belong in the repo but should not be surfaced in the published site.
- A sidebar-only filter (hide off-scope docs but keep them in `docs/`) is the **workaround**, not the fix. The structural split is the fix. The user has not yet agreed to the specific shape of that split.

## Open questions to settle at the start of the new session

- **Folder structure** — what's the destination layout? Names matter (e.g. `project-notes/`, `artifacts/`, `internal/`, `design-notes/`, something else). What lives where? Does the split mirror the proposed sketch or differ from it?
- **Which docs are "published" vs "artifact"?** Clear cases: views, solution specs (CLI/Daemon/Extension/Shared), README → published. Architecture.md, scenarios.md, plans, journal → artifact. Less clear: ADRs (source of truth AND useful to outsiders?), quality-gates (engineering policy AND outside-readable?), the docs-site meta-spec.
- **Migration sequence** — one cohesive commit, or split into smaller commits (e.g. file moves first, then content rewrites)?
- **Cross-ref cleanup** — `quality-gates.md` and `decisions.md` currently reference docs that would become artifacts. Strategy: drop links but keep prose? Soften references? Inline the necessary content?
- **Sources-frontmatter cleanup** — the view pages' `sources:` frontmatter currently lists `docs/architecture.md` and `docs/scenarios.md` as inputs. If those become artifacts, should the frontmatter still track them as live sources?
- **Symlink** — `views/src/content/docs/` currently symlinks to `../../../docs`. After any restructure, does it still resolve correctly? Verify on first build.
- **Governance** — should there be a build-time check that flags links from the published tier into the artifact tier? Or rely on review discipline?

## Useful files to read at the start of the new session

- `docs/solution/views.md` — current codified page-writing rules (may move during the restructure).
- `views/astro.config.mjs` — sidebar config; current state shows what's surfaced today.
- `docs/index.md` — current README; broken-launcher list that the user wants rewritten with motivation + use cases.
- `docs/architecture.md` and `docs/scenarios.md` — the sources the README rewrite will draw from.
- `docs/views/01-context.md`, `02-containers.md`, `03-deployment.md`, `04-session-state.md`, `06-threat-model.md` — the polished published views, as reference for tone and structure.

## Resolution (2026-05-24)

The decisions below close every open question above. Implementation follows in separate commits.

### Folder layout

`docs/` is split into two sibling tiers, both visible on GitHub but distinct in role:

- `docs/public/` — rendered by the Astro site. Read by bproxy users and by developers wanting the big-picture overview. Layered C4 narrative, plain prose, no project-side jargon.
- `docs/internal/` — project artifacts. Read by bproxy developers only. ADRs, plans, journal, architecture detail, scenarios, quality gates, the views meta-spec. All internal cross-links preserved verbatim.

The filesystem boundary replaces sidebar-based filtering. Naming chosen over alternatives (`dev-docs/`, root-level `internal/`) to keep the repo root tidy and group all documentation under a single umbrella.

### Tier contents

**Published (`docs/public/`):**

- `index.md` — landing: motivation (from `architecture.md`) + use-cases framing (from `scenarios.md`) + a "How it's shaped" section listing 5–7 shape-defining design principles in plain prose. No separate `principles.md`.
- `views/01-context.md` through `06-threat-model.md` — the five C4/behaviour/threat views, already polished. Slot 05 (scenario sequence diagrams) is dropped; may return as an appendix later if it earns its keep.
- `views/auto/` — generated component-graph SVGs from `dependency-cruiser`.
- `solution/cli.md`, `service.md`, `extension.md`, `shared.md` — implementation specs (reference tier).

**Project artifacts (`docs/internal/`):**

- `architecture.md`, `decisions.md`, `scenarios.md`, `quality-gates.md` — kept verbatim. All internal links preserved.
- `plans/`, `journal/` — kept as-is.
- `solution/views.md` — meta-spec for the views site; updated in this session to describe the split.

### Cross-tier rules

- **Public → internal in rendered output: forbidden.** Readers must not be bounced into project-only documents.
- **Public → internal in source files (frontmatter, sources lists): forbidden.** Public-tier source files reference no internal identifiers or paths. No `relatedAdrs:` ADR numbers; no `sources:` entries pointing into `docs/internal/`.
- **Internal → public: fine.** Internal artifacts may freely reference the public surfaces they shape.
- **Internal → internal: unchanged.** Existing artifact-to-artifact links preserved.
- **Public → GitHub repository URL: documented exception.** `index.md` may link to the repo for readers wanting the audit trail.

### ADR footer dropped

The `<RelatedAdrs />` component was speced in `views.md` but never wired into any layout (dead code in `views/src/components/`). Formally dropped:

- Component file to be deleted.
- `relatedAdrs:` removed from `viewSchema` and from every view's frontmatter.
- View pages name their shaping principles in prose (*"the extension is a thin sensor+actuator…"*); ADR identifiers are jargon to public readers.
- The ADR ledger remains in `docs/internal/decisions.md` for developer trace.

The earlier reverse-lookup convenience (grep `relatedAdrs:` to find views affected by an ADR change) is given up deliberately, in favour of the cleaner structural rule that public source files carry no internal coupling.

### Quality gates not republished

Engineering policy stays internal. One sentence in a building/contributing section is sufficient if it needs public acknowledgement at all.

### Migration sequence

Suggested order; can be staged or bundled depending on review appetite:

1. Move artifact files into `docs/internal/`. Sibling paths preserve most internal links automatically.
2. Move published files into `docs/public/`: `views/` (minus `05-scenarios/`), `solution/*.md`, `index.md`.
3. Delete `docs/views/05-scenarios/`.
4. Update `views/astro.config.mjs` (content base → `../docs/public/`) and re-target the `views/src/content/docs/` symlink.
5. Strip `relatedAdrs:` from public view frontmatter; remove from `viewSchema`; delete `views/src/components/RelatedAdrs.astro`.
6. Rewrite `docs/public/index.md` — motivation + use cases + design principles in plain prose, replacing the current broken-launcher list.
7. Verify `pnpm docs:build`; fix any frontmatter or link issues surfaced.
8. Update `CLAUDE.md` path references (`docs/architecture.md` → `docs/internal/architecture.md`, etc.).

### Possibly worth doing later

- Promote the publication-split decision to a formal ADR (e.g., ADR-021). The journal carries the rationale today; an ADR would make it grep-able from the audit trail.
- Extend `views:audit` to flag any `sources:` glob or rendered link that points into `docs/internal/`. The structural guarantee is currently review-enforced; automation is cheap if drift turns out to be a real problem.
