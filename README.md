> **Status:** Not released. Implementation is in progress; use from the repository only while integration hardening continues.

<p align="center">
  <img src="assets/brand/cable.svg" width="48" height="48" alt="bproxy logo">
</p>

# bproxy

bproxy is a proxy between a code agent and your real browser. A Chrome extension executes constrained commands inside your signed-in session, a localhost daemon paces and scopes those commands, and a CLI gives the agent a clean one-shot interface.

It is built for human-in-the-loop research and form-work workflows: you provide direction, the agent handles mechanical collection and copy-paste relief. Login, CAPTCHA, consent screens, and final submits stay yours. No browser automation protocol touches the page.

## Implementation status

Shared types, the localhost daemon, the Chrome extension, and the CLI have initial working implementations. The next phase is integration hardening against the documented scenarios.

```
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

![Architecture overview](docs/internal/browser-proxy-idea.png)

## Documentation

Documentation lives under `docs/` in two tiers:

**Public** (`docs/public/`) — the rendered site, readable by users and newcomers:
- [Introduction](docs/public/index.md) — motivation, use cases, design principles
- [Architecture views](docs/public/views/) — C4 diagrams (Context, Containers, Deployment, Session State, Threat Model)
- [Solution specs](docs/public/solution/) — implementation contracts for extension, daemon, CLI, and shared types

**Internal** (`docs/internal/`) — project artifacts for contributors:
- [Architecture](docs/internal/architecture.md) — system shape, components, protocol, principles
- [Decisions](docs/internal/decisions.md) — ADRs (why we chose X over Y), append-only
- [Scenarios](docs/internal/scenarios.md) — driving use cases with bot-signal accounting
- [Plans](docs/internal/plans/) — roadmap and per-phase work breakdowns
- [Journal](docs/internal/journal/) — raw design thinking and pivot notes

## License

[MIT](LICENSE)
