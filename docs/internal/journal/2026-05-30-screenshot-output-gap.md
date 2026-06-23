# Screenshot output gap during real scenario validation

Date: 2026-05-30
Status: proposed

## Context

During Phase 5 real-system validation, `screenshot` was used to confirm the actual page state before continuing Scenario 1 (Google SERP) and Scenario 2 (authenticated feed).

The command succeeded, but the CLI returned the image only as a large base64 string inside protocol JSON.

## Finding

The current screenshot UX is incomplete for operator-guided QA and scenario validation.

What worked:
- the browser captured a correct image;
- the daemon/extension/CLI round-trip succeeded;
- the screenshot was sufficient once decoded into a PNG.

What did not work well:
- the CLI did not produce a directly inspectable image file;
- the operator/agent had to perform an extra base64 decode step outside bproxy;
- this makes screenshot verification awkward in exactly the workflows where screenshots are most useful: real-site smoke checks, human-in-the-loop debugging, and manual scenario validation.

In practice, the screenshot command is not complete as an operator tool if the normal outcome is a large base64 blob that must be converted manually before anyone can view it.

## Requested improvement

Add a Phase 5 task to harden screenshot UX.

Desired contract:
- the screenshot command accepts a destination folder;
- bproxy writes the captured image into that folder;
- the visible CLI result is a filename or path, not an inlined base64 payload.

Example shape:

```bash
bproxy screenshot -s <session> --output-dir ./tmp/screens
```

Example result:

```json
{
  "ok": true,
  "data": {
    "format": "png",
    "file": "./tmp/screens/screenshot-2026-05-30T12-34-56.789Z.png"
  }
}
```

Possible implementation note:
- the daemon↔extension wire may still use base64 internally if that remains the simplest transport;
- the agent-facing CLI contract should materialize the file and return file metadata/path.

## Why this belongs in Phase 5

Phase 5 is already the integration-hardening phase and includes real-system scenario validation. Screenshot inspection is part of that validation loop. Requiring manual post-processing outside bproxy undermines the goal of a workflow-safe tool.

## Follow-up

Add a new Phase 5 plan task for screenshot file-output UX and include it in final verification.