---
title: Deployment
layer: c3
sources:
  - service/src/**
  - extension/src/**
  - docs/architecture.md
  - docs/solution/service.md
  - docs/solution/extension.md
relatedAdrs: [ADR-001, ADR-010, ADR-011, ADR-016]
related: [02-containers, 06-threat-model]
---

Where the bproxy runtime pieces actually live. This view focuses on **machine/process placement and trust boundaries**, not action routing.

```mermaid
flowchart TB
  subgraph host ["Developer machine"]
    Agent["Code Agent process"]
    CLI["CLI process"]

    subgraph daemonHost ["Localhost only"]
      Daemon["bproxy daemon\n127.0.0.1:9615"]
    end

    subgraph stateDir ["BPROXY_HOME / ~/.bproxy"]
      Token["token"]
      ExtToken["extension-token"]
      Logs["logs/"]
      Lock["bproxy.pid + port"]
    end

    subgraph browser ["Chrome profile"]
      Popup["Extension popup"]
      BG["Background service worker"]
      CS["Runtime content script\nISOLATED world"]
      Storage["chrome.storage\nlocal + session"]
      Tab[("Real browser tab")]
    end
  end

  Site[("Remote website")]

  Agent --> CLI
  CLI -- "HTTP + bearer" --> Daemon
  Popup -- "POST /pair/claim" --> Daemon
  BG -- "WS + extension token" --> Daemon
  Daemon -. reads/writes .-> Token
  Daemon -. reads/writes .-> ExtToken
  Daemon -. writes .-> Logs
  Daemon -. reads/writes .-> Lock
  Popup -. writes .-> Storage
  BG -. reads/writes .-> Storage
  BG --> CS
  CS --> Tab
  Tab --> Site
```

## What this picture tells you

- **Everything control-plane stays local.** CLI, daemon, extension, token files, and extension storage all live on the developer's machine.
- **The daemon is loopback-only.** Its network surface is intentionally `127.0.0.1`, not a LAN or internet-exposed service.
- **Browser execution happens inside the real profile.** The extension acts inside Chrome rather than driving a separate automation browser.
- **Two persistence domains exist.** Daemon credentials/state files live under `BPROXY_HOME`; extension bootstrap and caches live in Chrome storage.
- **Only the browser tab talks to the remote site.** Control traffic is local; normal web traffic leaves the machine through the user's browser session.

## See also

- [02-containers](./02-containers.md) — logical runtime responsibilities and protocols.
- [06-threat-model](./06-threat-model.md) — the security properties of the same boundaries.
- [solution/service.md](../solution/service.md) and [solution/extension.md](../solution/extension.md) — normative runtime details.
