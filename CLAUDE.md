# Project goal

Why? To automate my browser-related tasks I need an access to a browser for agents like claude code. Playwright based solution often is blocked by cloudflare and other anti-bot solutions. 


Solution: I want to have a browser plugin that can act on my behalf and provide the CLI for agents to interact with it.

# Docs

- Diagram: docs/browser-proxy-idea.png shows the idea of how it works.
- Architecture: docs/architecture.md — system shape, components, protocol, principles.
- Decisions: docs/decisions.md — ADRs (why we chose X over Y), append-only.
- Scenarios: docs/scenarios.md — driving use cases with bot-signal accounting.
- Solution specs (implementation guides):
  - docs/solution/extension.md — Chrome extension (WXT, background SW, content script).
  - docs/solution/service.md — proxy daemon (Fastify, auth, pacing, WS).
  - docs/solution/cli.md — CLI (citty, commands, client module).
  - docs/solution/shared.md — shared TypeScript types (protocol, actions, errors).
- Implementation roadmap: docs/plans/roadmap.md — phase order, definition of done, code-as-doc rules.
- Quality gates: docs/quality-gates.md — static analysis policy (tsc, Biome, ESLint, dep-cruiser, knip) and `pnpm check` surface.
- Journal: docs/journal/ — raw design thinking and pivot notes.