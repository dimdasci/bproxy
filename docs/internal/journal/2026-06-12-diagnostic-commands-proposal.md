# Diagnostic commands: `inspect` and `snapshot`

Date: 2026-06-12
Status: **implemented** ✅

## Context

LinkedIn investigation revealed that when bproxy sensors fail (e.g., `text` returning 282 chars instead of 20K), agents had no way to self-diagnose. Required dev-browser/CDP as a second tool.

## Decision

Implement two fixed-schema sensors (aligned with ADR-024 — no arbitrary code execution):

| Command | Purpose | ADR-024 fit |
|---------|---------|-------------|
| `inspect` | CSS selector → structural metadata (rect, styles, descendants) | Same pattern as `text`/`dom` — selector in, fixed schema out |
| `snapshot` | Accessibility tree representation | Sensor immune to CSS tricks |
| ~~`evaluate`~~ | ~~Arbitrary JS~~ | **Rejected** — belongs to dev-browser/CDP |

## What was implemented

### `inspect`

```bash
bproxy inspect --selector "section > div" --properties "display,overflow" --limit 5 -s <id>
```

Returns per element: tag, id, classes, role, ariaLabel, rect, computed styles, children count, descendants count, textLength, scrollable flag, scroll info, targeting selector.

Diagnostic power: `{display: "contents", rect: {width:0, height:0}, descendants: 2273, textLength: 15116}` immediately reveals layout-transparent wrapper vs truly hidden element.

### `snapshot`

```bash
bproxy snapshot --selector "main" --maxDepth 12 --interactiveOnly -s <id>
```

Returns indented text tree using ARIA roles/names/states. Example output:
```
navigation "Primary":
  link "Home"
main [scrollable]:
  heading "Dashboard" [level=1]
  section "About":
    heading "About" [level=2]
    text "Technical Delivery Lead..."
```

Immune to `display: contents`, shadow DOM transparency, and visibility heuristic bugs — walks DOM structure + ARIA semantics, never checks bounding rects.

## Implementation

6 touch points per action (compile-time guards at each layer):

```
shared/actions.ts → service/schemas.ts → extension/forwarded-actions.ts → 
extension/rpc.ts → extension/actions/*.ts → cli/commands/*.ts
```

New files: `inspect.ts`, `snapshot.ts`, `snapshot-roles.ts`, `read-deps.ts` (extension); `inspect.ts`, `snapshot.ts` (CLI); 2 test files (17 tests total).

## Validated in production

Tested against live LinkedIn profile and job search — both commands work end-to-end through the full bproxy stack (CLI → daemon → WebSocket → extension → content script → response).
