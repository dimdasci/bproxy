---
title: "Scenario: Google Topic Research"
layer: behavior
sources:
  - cli/src/**
  - service/src/**
  - extension/src/**
  - docs/scenarios.md
relatedAdrs: [ADR-006, ADR-009, ADR-017]
related: [01-context, 02-containers, 04-session-state]
---

Sequence view for [Scenario 1 — Google topic research](../../scenarios.md#scenario-1--google-topic-research). The agent performs URL-driven search, reads SERPs, and compiles a shortlist. No synthetic events are dispatched.

```mermaid
sequenceDiagram
    participant Agent
    participant CLI as bproxy CLI
    participant Daemon
    participant Extension as Extension SW
    participant CS as Content Script
    participant Page as Google SERP

    Note over Agent: Plan search queries (no browser)

    Agent->>CLI: bproxy navigate --url "google.com/search?q=..."
    CLI->>Daemon: POST / {action: "navigate", params: {url}}
    Daemon->>Extension: WS forward {target.tabId}
    Extension->>CS: chrome.scripting → navigate
    CS->>Page: window.location = url
    Page-->>CS: page loaded
    CS-->>Extension: {url, title, loadTime}
    Extension-->>Daemon: BproxyResponse ok:true
    Daemon-->>CLI: HTTP 200 JSON
    CLI-->>Agent: exit 0, JSON stdout

    Agent->>CLI: bproxy text --selector "main"
    CLI->>Daemon: POST / {action: "text", params: {selector}}
    Daemon->>Extension: WS forward
    Extension->>CS: chrome.scripting → read text
    CS->>Page: document.querySelector("main").innerText
    CS-->>Extension: {text: "...SERP content..."}
    Extension-->>Daemon: BproxyResponse ok:true
    Daemon-->>CLI: HTTP 200 JSON
    CLI-->>Agent: exit 0, extracted text

    Note over Agent: Extract results, paginate via URL (&start=10)

    Agent->>CLI: bproxy navigate --url "...&start=10"
    CLI->>Daemon: POST / (next page)
    Daemon->>Extension: WS forward
    Extension->>CS: navigate
    CS-->>Extension: ok
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0

    Agent->>CLI: bproxy text --selector "main"
    CLI->>Daemon: POST /
    Daemon->>Extension: WS forward
    Extension->>CS: read text
    CS-->>Extension: text
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0

    Note over Agent: Compile shortlist (pure LLM work)
```

## Key observations

- **Zero synthetic events** — navigation is URL-driven, reads are ISOLATED-world DOM access.
- **Pacing is daemon-enforced** — the CLI's `--timeout` sets the deadline; the daemon's per-session pacing delays between navigations.
- **HUMAN_REQUIRED** triggers on CAPTCHA/sign-out — the agent would receive exit `1` with error code `HUMAN_REQUIRED` and halt.
- **Request correlation** — each CLI invocation generates a `crypto.randomUUID()` id that flows through daemon logs and extension trace buffer.
