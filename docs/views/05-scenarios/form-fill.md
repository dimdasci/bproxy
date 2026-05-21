---
title: "Scenario: Job Application Form Fill"
layer: behavior
sources:
  - cli/src/**
  - service/src/**
  - extension/src/**
  - docs/scenarios.md
relatedAdrs: [ADR-007, ADR-009, ADR-013, ADR-014, ADR-017, ADR-018]
related: [01-context, 02-containers, 04-session-state]
---

Sequence view for [Scenario 3 — Job application form fill](../../scenarios.md#scenario-3--job-application-form-fill). The agent reads form structure, fills fields with explicit method/world, handles custom dropdowns, and hands off file uploads to the human. The user submits.

```mermaid
sequenceDiagram
    participant Agent
    participant CLI as bproxy CLI
    participant Daemon
    participant Extension as Extension SW
    participant CS as Content Script
    participant Page as Application Form
    participant User

    Note over Agent: Session bound to application tab

    Agent->>CLI: bproxy elements --form
    CLI->>Daemon: POST / {action: "elements", params: {form: true}}
    Daemon->>Extension: WS forward
    Extension->>CS: chrome.scripting → read form elements
    CS->>Page: scan inputs, selects, textareas
    CS-->>Extension: {elements: [{tag, type, label, selector, ...}]}
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0, form structure

    Note over Agent: LLM maps candidate fields to targets

    Agent->>CLI: bproxy fill-form --json '{"fields":[...]}'
    CLI->>Daemon: POST / {action: "fill-form", destructive: true}
    Note over Daemon: Pacing delay per field (0.5-2s)
    Daemon->>Extension: WS forward
    Extension->>CS: chrome.scripting → fill fields
    loop Each field in batch
        CS->>Page: focus → set value → dispatch paste events
        Note over CS: inputType: "insertFromPaste"
        Page-->>CS: framework state updated
    end
    CS-->>Extension: {results: [{filled: true, verifiedValue}...]}
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0, fill results

    Agent->>CLI: bproxy select --selector ".role-dropdown" --option-text "Engineer"
    CLI->>Daemon: POST / {action: "select", destructive: true}
    Daemon->>Extension: WS forward
    Extension->>CS: chrome.scripting → open menu, click option
    CS->>Page: click trigger → wait menu → click matching option
    CS-->>Extension: {selected: true, optionText: "Engineer"}
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0, selection confirmed

    Agent->>CLI: bproxy require-human --reason "Attach resume" --for-attach "#resume"
    CLI->>Daemon: POST / {action: "require-human", destructive: true}
    Daemon->>Extension: WS forward
    Extension->>CS: show notification/highlight field
    Note over Daemon: Session paused (HUMAN_REQUIRED)
    Extension-->>Daemon: {resumed: false} → error HUMAN_REQUIRED
    Daemon-->>CLI: ok: false, error: HUMAN_REQUIRED
    CLI-->>Agent: exit 1, HUMAN_REQUIRED

    Note over User: Attaches file, reviews form

    User->>CLI: bproxy session resume
    CLI->>Daemon: POST / {action: "session.resume"}
    Note over Daemon: Handled locally, clears pause
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0

    Agent->>CLI: bproxy elements --form
    CLI->>Daemon: POST / {action: "elements"}
    Daemon->>Extension: WS forward
    Extension->>CS: re-read form state
    CS-->>Extension: verified values
    Extension-->>Daemon: ok
    Daemon-->>CLI: ok
    CLI-->>Agent: exit 0, verified form state

    Note over Agent: Report "form filled, please review and submit"
    Note over User: Reviews and clicks Submit (isTrusted: true)
```

## Key observations

- **Paste, not typing** — `fill-form` uses `inputType: "insertFromPaste"` events. No keystroke cadence to fingerprint.
- **Explicit method/world** — the CLI requires `method` and `world` per field. It never invents or falls back to another method.
- **Custom dropdowns via `select`** — click trigger, wait for menu, click option text. Works on React-Select, Select2, and standard `<select>`.
- **File upload handoff** — `require-human` pauses the session. The daemon refuses all forwarded actions until `session resume`.
- **User submits** — the human's click is `isTrusted: true`, sidestepping reCAPTCHA v3 scoring of the fill behaviour.
- **Read-back verification** — `elements --form` after fill confirms framework state accepted the values.
- **Shadow-DOM targets** — `--route-json` can target fields inside shadow roots (ADR-014).
- **No MAIN-world shim** — paste-flavored events fire from ISOLATED world. MAIN world (`--world main`) only used for `runtime-api` method on specific editor frameworks.
