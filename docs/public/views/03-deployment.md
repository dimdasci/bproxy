---
title: Deployment
layer: deployment
sources:
  - service/src/**
  - extension/src/**
  - docs/architecture.md
  - docs/solution/service.md
  - docs/solution/extension.md
relatedAdrs: [ADR-001, ADR-010, ADR-011, ADR-016]
related: [02-containers, 06-threat-model]
---

This page shows where each piece of bproxy actually runs — what machine hosts it, what process boundary contains it, and what files it persists on disk. The arrows show what crosses each boundary and over what wire, but not the sequence of events on those wires; behaviour, internal component structure, and concrete scenarios live in the other pages linked at the bottom.

```mermaid
---
title: bproxy — Deployment
---
flowchart TB
  Operator(["<b>Operator</b><br/><i>[Person]</i><br/>Owns the browser session and runs bproxy"])

  subgraph host ["Operator's machine — [Deployment Node: macOS / Linux]"]
    Agent["<b>Code Agent</b><br/><i>[External Software System]</i><br/>Process invoking the CLI"]
    CLI["<b>CLI</b><br/><i>[Process: Node.js + citty]</i><br/>One-shot command, spawned per invocation"]
    Daemon["<b>bproxy daemon</b><br/><i>[Process: Node.js + Fastify, bound to 127.0.0.1:9615]</i><br/>Long-running localhost service, routes and paces requests"]

    subgraph stateDir ["BPROXY_HOME / ~/.bproxy — [Deployment Node: Filesystem, mode 0700]"]
      Token["<b>token</b><br/><i>[State file, 0600]</i><br/>Daemon bearer for HTTP clients"]
      ExtToken["<b>extension-token</b><br/><i>[State file, 0600]</i><br/>Bearer for the extension's WebSocket"]
      Logs["<b>logs/</b><br/><i>[State directory]</i><br/>Structured request logs"]
      Lock["<b>bproxy.pid + port</b><br/><i>[State files]</i><br/>Lifecycle handles"]
    end

    subgraph browser ["Chrome profile — [Deployment Node: Chrome browser, operator-owned]"]
      Popup["<b>Extension popup</b><br/><i>[Process: HTML page]</i><br/>Pairing UI"]
      BG["<b>Background service worker</b><br/><i>[Process: MV3 service worker]</i><br/>Holds the daemon WS link and dispatches actions"]
      CS["<b>Runtime content script</b><br/><i>[Process: ISOLATED-world script]</i><br/>Reads and writes the page DOM"]
      Storage["<b>chrome.storage</b><br/><i>[State: local + session]</i><br/>Extension token and per-session caches"]
      Tab["<b>Real browser tab</b><br/><i>[Browsing context]</i><br/>Operator's signed-in session"]
    end
  end

  Site["<b>Remote website</b><br/><i>[External Software System]</i><br/>Target site reachable over the public internet"]

  Operator ~~~ Agent
  Operator -- "pairs the extension via" --> Popup
  Agent -- "invokes" --> CLI
  CLI -- "sends action requests to<br/>[HTTPS, Bearer]" --> Daemon
  Popup -- "claims a pairing code from<br/>[HTTPS]" --> Daemon
  BG -- "maintains action link with<br/>[WebSocket, extension token]" --> Daemon
  Daemon -. "reads and writes" .-> Token
  Daemon -. "reads and writes" .-> ExtToken
  Daemon -. "writes" .-> Logs
  Daemon -. "reads and writes" .-> Lock
  Popup -. "writes" .-> Storage
  BG -. "reads and writes" .-> Storage
  BG -- "dispatches actions into" --> CS
  CS -- "reads and modifies" --> Tab
  Tab -- "loads and submits to" --> Site

  Site ~~~ Legend

  subgraph Legend["Legend"]
    direction LR
    LP(["Person"]):::person
    LC["Container<br/>instance"]:::system
    LS["State<br/>file"]:::state
    LE["External<br/>system"]:::external
    LP ~~~ LC ~~~ LS ~~~ LE
  end

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef system fill:#1168bd,color:#fff,stroke:#0b4884;
  classDef state fill:#5d7da3,color:#fff,stroke:#3e577a;
  classDef external fill:#999999,color:#fff,stroke:#6b6b6b;
  class Operator person;
  class CLI,Daemon,BG,CS,Popup system;
  class Token,ExtToken,Logs,Lock,Storage state;
  class Agent,Tab,Site external;
```

Figure 3. Deployment view of bproxy — where each runtime process lives on the operator's machine, what state the daemon and the extension own, and how the agent and the operator reach the system from outside the boundary.

## What this picture tells you

Every bproxy runtime piece lives on the operator's own machine. The CLI is short-lived — spawned per invocation, gone after a single command. The daemon is a long-running localhost service whose network surface is bound to `127.0.0.1` by design, not a LAN address and not an internet endpoint. The Chrome extension runs inside the operator's existing Chrome profile, not in a separate automation browser. The whole control plane stops at the machine boundary.

State is split into two domains, each tied to the process that owns it. The daemon writes its bearer tokens, lifecycle handles, and structured logs under `BPROXY_HOME` (defaulting to `~/.bproxy`), with the directory and the credential files locked down to the operator. The extension keeps its bootstrap token and per-session caches in `chrome.storage`, scoped to the Chrome profile. Neither side reads the other's domain — the only thing they share is the authenticated WebSocket between the daemon and the background service worker.

Only the browser tab reaches the public internet, and it does so as the operator's regular browsing traffic. The CLI never makes outbound calls; neither does the daemon. The content script reads and writes the page's DOM but does not initiate network requests outside the page's own context. From a remote server's point of view, every request looks like the operator browsing normally — same cookies, same identity, same fingerprint.

## See also

- [Context](./01-context.md) — bproxy seen from the outside, the people and external systems it interacts with.
- [Containers](./02-containers.md) — the same processes from a logical perspective: their responsibilities and the protocols between them.
- [Session state](./04-session-state.md) — the behaviour the daemon imposes on every forwarded action.
- [Threat model](./06-threat-model.md) — the security properties of these placements and the wires between them.

For normative implementation details on the daemon and the extension, see [Proxy Daemon](../solution/service.md) and [Browser Extension](../solution/extension.md).
