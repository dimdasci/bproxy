# @bproxy/views

Astro Starlight site that renders bproxy's architecture views and existing prose docs. Plus two advisory sync helpers (`views:audit`, `views:regen`) that surface drift between the artifact and the codebase.

**Spec:** [`docs/internal/solution/views.md`](../docs/internal/solution/views.md)
**Decisions:** [ADR-019](../docs/internal/decisions.md#adr-019-architecture-views-toolchain--astro-starlight--mermaid--advisory-sync-helpers), [ADR-020](../docs/internal/decisions.md#adr-020-architecture-views-layering--c4-spine-with-diátaxis-ia)

## Local development

```bash
pnpm install                 # from repo root
pnpm docs:dev                # Astro dev server on http://localhost:4321
pnpm docs:build              # Static build to views/dist/
```

## Sync helpers

```bash
pnpm views:audit             # Report which views' declared sources changed in this branch
pnpm views:regen             # Regenerate component dep-graphs (no-op until source code exists)
```
