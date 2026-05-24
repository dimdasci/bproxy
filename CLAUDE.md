# Project goal

Why? To automate my browser-related tasks I need an access to a browser for agents like claude code. Playwright based solution often is blocked by cloudflare and other anti-bot solutions. 


Solution: I want to have a browser plugin that can act on my behalf and provide the CLI for agents to interact with it.

# Docs

Documentation is split into two tiers under `docs/`:

## Public tier (`docs/public/`) — rendered by the Astro site

- Landing page: docs/public/index.md — motivation, use cases, design principles.
- Architecture views (C4 diagrams + prose):
  - docs/public/views/01-context.md
  - docs/public/views/02-containers.md (canonical diagram)
  - docs/public/views/03-deployment.md
  - docs/public/views/04-session-state.md
  - docs/public/views/06-threat-model.md
  - docs/public/views/auto/ — generated component-graph SVGs.
- Solution specs (implementation guides):
  - docs/public/solution/extension.md — Chrome extension (WXT, background SW, content script).
  - docs/public/solution/service.md — proxy daemon (Fastify, auth, pacing, WS).
  - docs/public/solution/cli.md — CLI (citty, commands, client module).
  - docs/public/solution/shared.md — shared TypeScript types (protocol, actions, errors).

## Internal tier (`docs/internal/`) — project artifacts, not rendered

- Diagram: docs/internal/browser-proxy-idea.png — original idea sketch.
- Architecture: docs/internal/architecture.md — system shape, components, protocol, principles.
- Decisions: docs/internal/decisions.md — ADRs (why we chose X over Y), append-only.
- Scenarios: docs/internal/scenarios.md — driving use cases with bot-signal accounting.
- Quality gates: docs/internal/quality-gates.md — static analysis policy (tsc, Biome, ESLint, dep-cruiser, knip) and `pnpm check` surface.
- Implementation roadmap: docs/internal/plans/roadmap.md — phase order, definition of done, code-as-doc rules.
- Journal: docs/internal/journal/ — raw design thinking and pivot notes.
- Views meta-spec: docs/internal/solution/views.md — how the Astro site and sync helpers work.
