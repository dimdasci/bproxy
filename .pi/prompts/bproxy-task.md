---
description: Start a bproxy task with architecture-aware documentation loading
argument-hint: "[task]"
---

You are working on bproxy.

Task:
$ARGUMENTS

Before changing code, build project context from documentation. Be token-efficient: read the minimum docs needed for this task, but do not skip mandatory architecture/decision context.

## Required documentation loading

1. Always read:
   - `docs/internal/architecture.md` — top-level architecture, component boundaries, protocol shape.
   - `docs/internal/decisions.md` — ADRs are mandatory constraints. Extract the ADRs relevant to this task.
   - `docs/internal/quality-gates.md` — quality methodology and required checks.

2. Read public entry/context:
   - `docs/public/index.md` — product intent, human-in-the-loop model, design principles.
   - `docs/public/views/02-containers.md` — canonical runtime/container diagram.

3. Read solution specs only for components touched:
   - CLI changes: `docs/public/solution/cli.md`
   - Daemon/service changes: `docs/public/solution/service.md`
   - Extension changes: `docs/public/solution/extension.md`
   - Shared protocol/types changes: `docs/public/solution/shared.md`

4. Read additional views when relevant:
   - `docs/public/views/01-context.md` — product boundary / operator-agent-browser relationships.
   - `docs/public/views/03-deployment.md` — local process layout, state files, tokens, Chrome profile, storage.
   - `docs/public/views/04-session-state.md` — sessions, logical tabs, pause/resume, handles.
   - `docs/public/views/06-threat-model.md` — auth, token handling, extension exposure, localhost/security boundaries.
   - Do not inspect generated `docs/public/views/auto/*.svg` unless explicitly needed.

## Precedence

When docs, code, or assumptions conflict, use this order:

1. `docs/internal/decisions.md`
2. `docs/internal/architecture.md`
3. `docs/internal/quality-gates.md`
4. `docs/public/solution/*.md`
5. `docs/public/views/*.md` and `docs/public/index.md`
6. Existing code

If code disagrees with an ADR or architecture spec, stop and call out the drift before editing.

## Core invariants to preserve

- Extension is a thin sensor/actuator layer; no strategy, auto-selection, retry chains, or hidden fallbacks.
- ISOLATED world by default; MAIN world only for one-shot `runtime-api` writes.
- No arbitrary page eval, no `MutationObserver`, no scroll-container inference.
- Daemon owns sessions, logical tabs, pacing, pause state, auth, dispatch, pending requests, and element-handle aliases.
- CLI is one-shot: one command, one daemon POST, one JSON object on stdout.
- Shared types define the protocol contract; update all consumers when actions/types change.
- Temporary files belong under `BPROXY_HOME`; do not use `/tmp` or `os.tmpdir()`.
- Security findings must be remediated in code/tests, not suppressed in scanner UI.

## Before editing

Report briefly:

- docs read
- relevant ADRs
- components/files likely touched
- quality gate command(s) you will run

Then implement the task.
