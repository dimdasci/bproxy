# bproxy — Technical Solution

Parent document: [architecture.md](../architecture.md)

Implementation details for the bproxy system: output contracts, error handling, component internals, failure modes, and build/test strategy.

---

## Contents

1. [Agent Output Contract](./01-output-contract.md) — JSON response shapes, page context, error codes, token budget, exit codes.
2. [CLI Design](./02-cli-design.md) — All commands with examples: status, navigate, click, type, text, images, elements, outline, dom, wait, screenshot, eval, tabs.
3. [Proxy Service Internals](./03-proxy-service.md) — HTTP endpoint, command queuing for SW wakeup, WebSocket server, pending request map, request log.
4. [Extension Internals](./04-extension.md) — Background service worker, SW lifecycle, content script ready-ack, CSP-proof eval via `chrome.scripting`, manifest.
5. [Page State Detection & SPA Handling](./05-page-state.md) — State machine, settle detection, busy indicators, network idle, SPA navigation, navigate two-tier wait.
6. [Failure Modes](./06-failure-modes.md) — SW termination, extension not connected, content script injection race, navigation during command, selector on wrong page, proxy not running.
7. [Timeouts](./07-timeouts.md) — Timeout boundaries and defaults.
8. [Tab Management and Screenshot Capture](./08-tab-management.md) — Sticky per-session pin, `--session` for multi-agent, no-focus-steal screenshots with `--activate` / `--debugger` opt-ins.
9. [Build & Distribution](./09-build.md) — Service, extension, CLI setup and orchestration.
10. [Testing Strategy](./10-testing.md) — Three-layer harness: Node unit, Playwright-driven extension integration, and gated anti-bot fixtures, with a per-error-code coverage matrix and CI shape.
11. [Implementation Order](./11-implementation-order.md) — Six-phase plan (Phase 0 foundations → Phase 5 multi-profile and ops). Nothing lands until it can be tested.
12. [Technical Risks](./12-risks.md) — Headline anti-bot risk, architectural risks mitigated in design, implementation and operational residuals, out-of-scope, and a Cassandra section.
