<p align="center">
  <img src="assets/brand/cable.svg" width="48" height="48" alt="bproxy logo">
</p>

# bproxy

Browser proxy for code agents. A localhost daemon bridges a CLI to a Chrome extension running in your real browser, so coding agents can navigate, read, and fill pages from the same session you're already signed into.

Playwright-style automation gets blocked by Cloudflare, Datadome, and friends because it runs in a detectable automated browser. bproxy keeps the agent out of the page entirely: real Chrome, real cookies, real fingerprint. The default mode (**read mode**) has no MAIN-world presence — no wrapped globals, no MutationObserver, no history patches. URL-driven navigation, ISOLATED-world DOM reads, paste-flavored writes. Interstitials (CAPTCHAs, sign-in walls) hand control back to you via a structured `HUMAN_REQUIRED` signal.

## Status

Design phase — no code yet. The repository currently contains the architecture, decisions, and solution specs that will drive implementation.

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
