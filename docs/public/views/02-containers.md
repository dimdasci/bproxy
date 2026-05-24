---
title: Containers
layer: c2
sources:
  - shared/**
  - service/src/**
  - extension/src/**
  - cli/src/**
  - docs/architecture.md
relatedAdrs: [ADR-003, ADR-008, ADR-010, ADR-013, ADR-017]
related: [01-context, 03-deployment]
---

This page zooms one level inside bproxy and shows the three runtime processes it is built from — where each one runs and how they talk to each other. The diagram is the canonical bproxy picture: every later view either drills into one of the boxes (a component view) or follows a slice of behaviour that crosses them (a sequence or state view). How bproxy uses these pieces in concrete scenarios, and the trust boundaries between them, belong to the other pages linked at the bottom.

```mermaid
---
title: bproxy — Containers
---
flowchart TB
  Agent["<b>Code Agent</b><br/><i>[External Software System]</i><br/>Automates tasks via bproxy commands"]
  Operator(["<b>Operator</b><br/><i>[Person]</i><br/>Owns the browser session and runs bproxy"])

  subgraph bproxy ["bproxy"]
    CLI["<b>CLI</b><br/><i>[Container: TypeScript + citty]</i><br/>Translates agent commands into protocol requests"]
    Daemon["<b>Daemon</b><br/><i>[Container: Node.js + Fastify, HTTP + WS]</i><br/>Routes requests, enforces auth and pacing, owns session state"]
    subgraph Ext ["Chrome Extension — [Container: WXT, MV3]"]
      BG["<b>Background SW</b><br/><i>[Service worker]</i><br/>Maintains the daemon WS link and dispatches actions"]
      CS["<b>Content Script</b><br/><i>[ISOLATED world]</i><br/>Reads and writes the page DOM on behalf of the SW"]
      Popup["<b>Popup</b><br/><i>[Pairing UI]</i><br/>Captures the pairing code from the operator"]
    end
  end

  Page["<b>Web Page</b><br/><i>[External Software System]</i><br/>The target site the operator is browsing"]

  Agent -- "issues commands to" --> CLI
  CLI -- "sends action requests to<br/>[HTTPS, Bearer]" --> Daemon
  Daemon -- "forwards actions to<br/>[WebSocket]" --> BG
  BG -- "returns results to<br/>[WebSocket]" --> Daemon
  BG -- "dispatches actions into<br/>[chrome.scripting]" --> CS
  CS -- "reads and modifies" --> Page
  Operator -- "pairs the extension via" --> Popup
  Popup -- "claims a pairing code from<br/>[HTTPS]" --> Daemon

  click CLI "../auto/cli-components.svg" "Inside the CLI — component view" _blank
  click Daemon "../auto/service-components.svg" "Inside the Daemon — component view" _blank
  click Ext "../auto/extension-components.svg" "Inside the Extension — component view" _blank

  Page ~~~ Legend

  subgraph Legend["Legend"]
    direction LR
    LP(["Person"]):::person
    LC["Container"]:::system
    LE["External<br/>system"]:::external
    LP ~~~ LC ~~~ LE
  end

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef system fill:#1168bd,color:#fff,stroke:#0b4884;
  classDef external fill:#999999,color:#fff,stroke:#6b6b6b;
  class Operator person;
  class CLI,Daemon,BG,CS,Popup system;
  class Agent,Page external;
```

Figure 2. Container view of bproxy — the three runtime processes (CLI, Daemon, Chrome Extension) inside the bproxy boundary and how they communicate with the agent, the operator, and the target page.

## What this picture tells you

bproxy is three processes that live in three different places. The CLI sits in the agent's shell — a stable, one-shot command surface that any code agent can call. The Daemon runs on the operator's machine as a long-running localhost service that routes requests, enforces authentication and pacing, and owns session state. The Chrome Extension lives inside the browser itself; it is the only piece of bproxy that can actually drive a Chrome session.

This split is not arbitrary — each capability is locked to a particular runtime. Only an extension can touch the operator's browser. But Chrome can suspend an MV3 service worker at any moment, so the extension cannot be where agent commands arrive; it would miss them. The Daemon bridges the two sides: it is always running, holds the queue of pending requests, and reconciles service-worker restarts by replaying outstanding work over a persistent WebSocket.

The agent's view of the web is always indirect. The Content Script is the only piece that ever touches a page's DOM, and it does so inside the operator's real Chrome profile — there is no headless browser, no automated context, no separate identity. Two separate authentication tokens protect the two daemon-facing routes: one for any HTTP client (the CLI, or another agent-side tool), and a second for the extension's WebSocket link. Pairing the extension is an operator action through the popup — the CLI cannot pair the extension on the agent's behalf.

## See also

- [Context](./01-context.md) — what bproxy is from the outside, the people and external systems it interacts with.
- [Deployment](./03-deployment.md) — where these processes run on the operator's machine and which trust boundaries separate them.
- [Session state](./04-session-state.md) — the state machine the daemon uses to gate every forwarded action.
- [Threat model](./06-threat-model.md) — DFD and STRIDE notes for these containers and the wires between them.

To drill inside any container, click its node in the diagram above; the auto-generated component graphs live under [`views/auto/`](./auto/) and are refreshed by `pnpm views:regen`.
