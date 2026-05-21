---
title: "Scenario: LinkedIn Daily Feed Snapshot"
layer: behavior
sources:
  - cli/src/**
  - service/src/**
  - extension/src/**
  - docs/scenarios.md
relatedAdrs: [ADR-006, ADR-009, ADR-013, ADR-017]
related: [01-context, 02-containers, 04-session-state]
---

Sequence view for [Scenario 2 — LinkedIn daily feed snapshot](../../scenarios.md#scenario-2--linkedin-daily-feed-snapshot). The agent scrolls the feed, reads lazy-loaded posts, and compiles a digest. Scroll is the only write-like action; all reads are ISOLATED-world DOM access.

```mermaid
sequenceDiagram
    participant Agent
    participant CLI as bproxy CLI
    participant Daemon
    participant Extension as Extension SW
    participant CS as Content Script
    participant Page as LinkedIn Feed

    Note over Agent: Session already bound to LinkedIn tab

    Agent->>CLI: bproxy text --selector "[data-id^='urn:li:activity']"
    CLI->>Daemon: POST / {action: "text"}
    Daemon->>Extension: WS forward {target.tabId}
    Extension->>CS: chrome.scripting → read
    CS->>Page: querySelectorAll visible posts
    CS-->>Extension: {text: "...first 6-8 posts..."}
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0, feed text

    Note over Agent: Extract URNs, authors, truncated bodies

    loop Scroll cycle (up to 5 times)
        Agent->>CLI: bproxy scroll --direction down --until-stable
        CLI->>Daemon: POST / {action: "scroll", destructive: true}
        Note over Daemon: Pacing delay (4-8s with jitter)
        Daemon->>Extension: WS forward
        Extension->>CS: chrome.scripting → scroll
        CS->>Page: window.scrollBy({top, behavior:'smooth'})
        Note over CS: Poll DOM until new posts stable
        CS-->>Extension: {before: 8, after: 16, scrolledPx: 800, stable: true}
        Extension-->>Daemon: ok
        Daemon-->>CLI: ok
        CLI-->>Agent: exit 0, scroll result

        Agent->>CLI: bproxy text --selector "[data-id^='urn:li:activity']"
        CLI->>Daemon: POST / {action: "text"}
        Daemon->>Extension: WS forward
        Extension->>CS: read new posts
        CS-->>Extension: text
        Extension-->>Daemon: ok
        Daemon-->>CLI: ok
        CLI-->>Agent: exit 0, new posts
    end

    Note over Agent: ~30 posts collected

    Agent->>CLI: bproxy debug last --count 10
    CLI->>Daemon: POST / {action: "debug.last"}
    Note over Daemon: Handled daemon-locally
    Daemon-->>CLI: {requests: [...last 10...]}
    CLI-->>Agent: exit 0, request history

    Note over Agent: Compile digest (pure LLM work)
```

## Key observations

- **Scroll is the only "write"** — classified as destructive, but produces no synthetic user events (uses `window.scrollBy` with native smooth behaviour).
- **DOM polling, not MutationObserver** — the content script polls for new `[data-id]` elements after each scroll, never installs listeners.
- **Pacing is daemon-enforced** — 4–8 seconds between scrolls with jitter, configured via `session bind --pacing human`.
- **Feed truncation accepted** — the agent captures truncated bodies; full-body retrieval (via permalink) is on-demand later.
- **`debug.last`** — daemon-local, does not require extension; lets the agent inspect its own recent commands.
- **HUMAN_REQUIRED** — if LinkedIn shows a challenge during scrolling, the daemon pauses the session and all subsequent commands return the error until `session resume`.
