<p align="center">
  <img src="assets/brand/cable.svg" width="48" height="48" alt="bproxy logo">
</p>

# bproxy

A proxy between your code agent and your real browser.

bproxy lets coding agents read pages, fill forms, and click through tasks inside your signed-in Chrome session — without exposing an automation handle to the page. A Chrome extension executes a narrow set of commands; a localhost daemon paces and scopes them; a CLI gives the agent a one-shot interface. Login, CAPTCHA, consent screens, and final submits stay yours.

The motivation, design principles, scenarios, and architecture live in the documentation site. The README is a quick orientation — the docs are the source of truth.

**Documentation: https://dimdasci.github.io/bproxy/**

```text
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

## For users

Install the CLI and daemon from npm:

```bash
npm install -g @dimdasci/bproxy
```

The Chrome extension is currently a manual unpacked install pending a Chrome Web Store listing — download the matching zip from [GitHub Releases](https://github.com/dimdasci/bproxy/releases/latest) and load the extracted folder via `chrome://extensions` with Developer mode on.

The [Install guide](https://dimdasci.github.io/bproxy/guide/install/) walks through both steps end to end. [Usage](https://dimdasci.github.io/bproxy/guide/usage/) is the CLI command reference, and [Upgrade](https://dimdasci.github.io/bproxy/guide/upgrade/) covers version bumps.

## For developers

bproxy is a TypeScript monorepo with three runtime workspaces (`cli`, `service`, `extension`) and a shared protocol package (`shared`). The contracts that govern how they fit together — actions, errors, sessions, tabs, write methods — are documented in the [Solution Specs](https://dimdasci.github.io/bproxy/solution/cli/), and the system shape is captured in the [Architecture views](https://dimdasci.github.io/bproxy/views/02-containers/). Internal artifacts (ADRs, phase plans, journal entries) live under [`docs/internal/`](docs/internal/) in this repository.

## License

[MIT](LICENSE)
