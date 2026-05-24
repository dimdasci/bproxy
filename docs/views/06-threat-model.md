---
title: Threat model
layer: threat
sources:
  - shared/src/protocol.ts
  - shared/src/actions.ts
  - service/src/auth.ts
  - service/src/lifecycle.ts
  - service/src/pairing.ts
  - service/src/config.ts
  - service/src/pending.ts
  - service/src/dispatch.ts
  - service/src/routes/ws.ts
  - extension/wxt.config.ts
  - extension/src/background/*.ts
  - extension/src/content/*.ts
  - extension/src/content/actions/*.ts
  - extension/src/entrypoints/background.ts
  - extension/src/entrypoints/content.ts
  - extension/src/entrypoints/popup/*.ts
  - extension/src/entrypoints/popup/*.html
relatedAdrs: [ADR-001, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016]
related: [02-containers, 04-session-state]
---

This page describes the security shape of bproxy as it ships today — the trust boundaries between processes and files, the credentials that cross each boundary, and the STRIDE-class threats each boundary mitigates. The view documents current code and configuration; speculative changes and out-of-scope hardening are listed near the bottom.

```mermaid
---
title: bproxy — Threat model
---
flowchart TB
  subgraph fs ["File-system boundary (user, mode 0600)"]
    Token["~/.bproxy/token<br/>daemon bearer"]
    ExtToken["~/.bproxy/extension-token<br/>WS auth (restart-transparent)"]
    PidLock["~/.bproxy/bproxy.pid<br/>single-daemon lock"]
    Logs["~/.bproxy/logs/YYYY-MM-DD.log"]
  end

  subgraph host ["Localhost boundary (127.0.0.1 only)"]
    CLI["CLI process"]
    Daemon["Daemon (Fastify)<br/>127.0.0.1:9615"]
  end

  subgraph extOrigin ["Extension origin (chrome-extension://)"]
    BG["Background SW"]
    Popup["Pairing popup"]
    CS["Runtime content script<br/>ISOLATED world"]
    Trace["chrome.storage.session<br/>trace / dedupe / injected tabs"]
    Bootstrap["chrome.storage.local<br/>bootstrap + config flags"]
  end

  Page["Web page"]

  CLI -- "(1) POST /<br/>Authorization: Bearer {daemon-token}" --> Daemon
  Popup -- "(2) POST /pair/claim<br/>one-time code · Origin: chrome-extension://" --> Daemon
  BG <-- "(3) GET /ws<br/>Sec-WebSocket-Protocol: bproxy.v1, auth.{extension-token}" --> Daemon
  BG -- "(4) chrome.scripting.executeScript" --> CS
  CS -- "(5) DOM read/write" --> Page

  CLI -. "0600 + owner check" .-> Token
  Daemon -. writes .-> Token
  Daemon -. writes .-> ExtToken
  Daemon -. writes .-> PidLock
  Daemon -. writes .-> Logs
  Popup -. writes .-> Bootstrap
  BG -. reads .-> Bootstrap
  BG -. reads/writes .-> Trace

  classDef boundary stroke:#dc2626,stroke-width:2px,stroke-dasharray:4 2;
  class fs,host,extOrigin boundary;
```

Figure 5. Data-flow diagram with trust boundaries — the three dashed-red enclosures (filesystem, localhost, extension origin) bound material that the daemon and extension protect; numbered edges (1)–(5) anchor the STRIDE entries below.

## STRIDE — daemon and transport

| Class | Threat | Mitigation | Anchor |
|---|---|---|---|
| Spoofing | Another process binds the daemon port for the same user | PID lockfile per `BPROXY_HOME`; `start` exits non-zero when the lock points at a live PID | `lifecycle.ts:startDetached`; Gap E *"start fails cleanly when daemon already running"* |
| Spoofing | Other-user process reads the daemon token | Token file mode `0600` + owner UID check; daemon refuses to start (and CLI must refuse to use) any token with wrong mode/owner | `lifecycle.ts:assertOwnerMode600` (`INSECURE_TOKEN_FILE`); Gap E *"token file is created and readable only by owner"* |
| Spoofing | Cross-site fetch from a malicious page reaches the daemon | Three-layer header gate at `onRequest`: Host pinned to `127.0.0.1:port` / `localhost:port`; Origin must be absent (CLI) or `chrome-extension://*` (popup/WS); `Sec-Fetch-Site` rejected unless `none` / `same-origin` | `auth.ts:checkHost/checkOrigin/checkFetchSite`; Gap C negative tests |
| Spoofing | Wrong extension instance claims the pairing code | One-time consumption + 5-min TTL + constant-time compare + `chrome-extension://` Origin required; single-active-token policy invalidates previously claimed extension tokens | `pairing.ts`; `auth.ts:checkOrigin('pair')`; [service spec § Pairing bootstrap route](../solution/service.md#pairing-bootstrap-route-post-pairclaim) |
| Tampering | Daemon token file is replaced by another user | Owner check rejects tokens whose `st.uid` differs from `process.getuid()` | `lifecycle.ts:assertOwnerMode600` |
| Repudiation | "Did command X run? When? Through which client?" | Every lifecycle event carries request `id`: `received` → `pacing_wait?` → `forwarded` → `response` (or `timeout` / `replay`) | daemon observability suites |
| Information disclosure | Daemon API exposed beyond localhost | Bind host fixed to `127.0.0.1`; Host header verified at the auth gate even if a proxy rewrites it | `config.ts`; `auth.ts:checkHost` |
| Information disclosure | Token leaks via insecure file mode | Read-side preflight on every token load fails closed with `INSECURE_TOKEN_FILE` / `INSECURE_EXTENSION_TOKEN_FILE` | `lifecycle.ts:assertOwnerMode600`; Gap E file-semantics tests |
| Denial of service | Unbounded pending-request map | Hard cap of 100 in-flight requests → `OVERLOADED` | `pending.ts`; `pending.test.ts` |
| Denial of service | Head-of-line blocking across tabs | Per-tab FIFO queue, parallel across tabs | `dispatch.ts:withTabLock`; `dispatch.test.ts` |
| Denial of service | Pairing-code brute force | One-time consumption + 5-min TTL + constant-time compare; full per-source limiter is deferred | `pairing.ts` |
| Elevation of privilege | Extension token grants command issuance | Two-token model: bearer auth only valid on `POST /`; subprotocol auth only valid on `GET /ws`; tokens never cross routes | `auth.ts:checkCommandAuth/checkWsAuth` |
| Elevation of privilege | Pairing endpoint accepts CLI bearer | `POST /pair/claim` is body-auth only (pairing code) and requires `chrome-extension://` Origin | [service spec § Auth Gate](../solution/service.md#auth-gate) |

## Extension surface

| Surface | Risk | Shipped mitigation |
|---|---|---|
| Bootstrap token in extension storage | Long-lived WS auth material could leak through loose storage handling | Popup validates payload shape before write; bootstrap is stored as one atomic `chrome.storage.local` record; daemon still limits auth to localhost WS with subprotocol token |
| Runtime content script | Page-visible extension presence or broad ambient listeners | No declarative `content_scripts`; runtime script is injected only on first command per tab; content host keeps one `chrome.runtime.onMessage` listener and no page-global hooks |
| MAIN-world execution | Page learns about the extension or receives raw extension errors/stacks | MAIN world is one-shot only via `chrome.scripting.executeScript({ world: "MAIN" })`; injected functions catch/normalize errors and contain no identifying literals ([ADR-013](../decisions.md#adr-013-main-world-runtime-api-writes), [ADR-015](../decisions.md#adr-015-main-world-hygiene-contract)) |
| Trace / dedupe ring buffer | `debug.log` could expose stale or over-broad extension data | Trace is bounded in `chrome.storage.session`, queryable only through authenticated daemon forwarding, filtered by `id`/`limit`, and stamped with `extensionVersion` |
| Polling / DOM settle | High-signal instrumentation or bundle hygiene regressions | No `MutationObserver`; jittered polling only; Task 16 scans the production artifact to keep `MutationObserver` out of shipped output |
| Screenshot escalation | `chrome.debugger` would widen capability and show a user-visible Chrome banner | Normal screenshots use `captureVisibleTab`; debugger screenshots remain gated behind `DEBUGGER_DISABLED`, with no `debugger` permission in the manifest today |
| Web-accessible resources | Deterministic extension-resource probing by pages or scanners | `web_accessible_resources` is absent by default; build hook strips WXT's empty array stub so the manifest stays default-deny ([ADR-016](../decisions.md#adr-016-web_accessible_resources-default-deny)) |
| Hidden-tab destructive actions | Writing to a background tab may produce misleading state or bot-signal issues | Content polling checks `document.visibilityState` and destructive actions bail with `TAB_NOT_VISIBLE` unless future protocol metadata explicitly opts into user-initiated hidden-tab behavior |

## Still out of scope

- Process-level sandboxing of the daemon (e.g. `seccomp`, App Sandbox profile)
- Enforced pairing-code rate limiting beyond the current structural plumbing
- Cross-host operation or TLS; bproxy remains localhost-only
- Closed shadow-root support
- A shipped opt-in path for `chrome.debugger` screenshots
- A daemon/CLI control path that enables `eval`; default behavior remains `EVAL_DISABLED`

## See also

- [Containers](./02-containers.md) — the runtime processes and wire protocols whose boundaries this view analyses.
- [Deployment](./03-deployment.md) — where each process and state file lives on the operator's machine.
- [Session state](./04-session-state.md) — daemon pause/bind gating that sits behind the transport.

For normative implementation details, see [Proxy Daemon](../solution/service.md) and [Browser Extension](../solution/extension.md).
