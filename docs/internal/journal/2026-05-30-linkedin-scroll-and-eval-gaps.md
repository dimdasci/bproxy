# LinkedIn Scenario 2 findings — scroll false-success and missing eval enable path

> Update 2026-05-31: the missing eval enable path from this note has now been addressed via an extension popup Eval mode control. Follow-up debugging and the current LinkedIn MAIN-world `result: null` finding are recorded in [`2026-05-31-linkedin-eval-mode-and-main-world-null-result.md`](./2026-05-31-linkedin-eval-mode-and-main-world-null-result.md).

Date: 2026-05-30
Status: proposed

## Context

During Phase 5 Scenario 2 validation against a real LinkedIn feed tab, the browser loaded successfully and `screenshot` confirmed a normal signed-in feed view in the foreground.

Session used in the run:
- session: `va52vh`
- logical tab: `t1`

## Finding 1 — `scroll` reported success without moving the page

Command run twice:

```bash
node cli/dist/bproxy.mjs scroll -s va52vh --by viewport --direction down --until-stable --timeout 1000
```

Both responses were:

```json
{
  "ok": true,
  "data": {
    "before": 0,
    "after": 0,
    "scrolledPx": 0,
    "stable": true
  },
  "page": {
    "url": "https://www.linkedin.com/feed/",
    "title": "Feed | LinkedIn",
    "state": "ready",
    "busy": false
  }
}
```

Observed real behavior:
- the viewport did **not** move;
- the operator visually confirmed the page stayed in the same place;
- LinkedIn only showed a small "New publications" badge/update signal;
- the command still returned `ok: true` and `stable: true`.

Interpretation:
- current `scroll` success semantics are too weak;
- DOM stability is being treated as success even when the viewport never changed;
- Scenario 2 therefore exposed a false-success bug in `scroll`, not merely a site quirk.

Expected hardening direction:
- require evidence of actual movement before reporting success;
- distinguish "scroll request accepted but no movement happened" from a real successful scroll;
- add a regression test for the LinkedIn-shaped case where `window.scrollBy(...)` plus DOM polling yields `stable: true` but `scrollY` remains unchanged.

## Finding 2 — `eval` exists at the CLI but has no supported enable path

Attempted command:

```bash
node cli/dist/bproxy.mjs eval -s va52vh --allow-eval --code '...'
```

Result:

```json
{
  "ok": false,
  "error": {
    "code": "EVAL_DISABLED",
    "message": "eval is disabled until an explicit allow-eval flag is wired through daemon and extension config"
  }
}
```

Interpretation:
- the CLI command exists;
- the runtime path is intentionally not wired through the daemon/service UX;
- there is no supported shipped operator path to enable eval;
- manual extension-storage hacking is not an acceptable product workflow.

This is not a hidden workaround issue; it is an intentionally deferred control-plane gap.

## Follow-up classification

- **Phase 5 in-scope blocker:** `scroll` false-success on LinkedIn Scenario 2.
- **Historical control-plane gap (now addressed on 2026-05-31):** this note originally recorded that no shipped eval-enable path existed. That is no longer true; see [`2026-05-31-linkedin-eval-mode-and-main-world-null-result.md`](./2026-05-31-linkedin-eval-mode-and-main-world-null-result.md) for the shipped popup control and the remaining real-site runtime finding.
