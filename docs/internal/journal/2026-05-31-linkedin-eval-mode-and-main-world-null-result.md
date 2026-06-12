# LinkedIn eval debugging — popup enable path shipped, MAIN-world result is `null` on LinkedIn

> **Course correction (2026-06-12):** This investigation is now considered a documented deviation from the intended bproxy path. The useful finding is not “replace string eval with debugger-backed eval”; it is that arbitrary page evaluation does not belong in bproxy at all. Page/runtime investigation should use normal browser debugging tools such as Chrome DevTools Protocol. bproxy should remain a thin sensor/actuator bridge and the `eval` command should be removed.

Date: 2026-05-31
Status: superseded by course correction on 2026-06-12

## Context

Phase 5 Scenario 2 needed `eval` as a debugging/inspection tool before reworking scroll on LinkedIn.

The previous blocker was that `eval` existed at the CLI, but there was no shipped operator path to enable it. Work on 2026-05-31 focused on:

1. shipping an extension popup control for eval mode;
2. making `EVAL_DISABLED` actionable for the agent;
3. using built-in observability to debug real LinkedIn eval behavior;
4. instrumenting the MAIN-world eval path to show what Chrome actually returned.

All validation in this note used smoke daemons started via `scripts/smoke/daemon.ts`, so commands had to target the printed `BPROXY_HOME` with `--home <path>`. Looking only at the default `~/.bproxy` state dir is misleading during smoke runs.

## Shipped popup enable path

Implemented in the extension popup:

- popup now shows an always-visible **Eval mode** section;
- it contains a checkbox: **Enable eval mode**;
- the checkbox is disabled until the extension is paired;
- the hint text explains that eval allows arbitrary JavaScript in the page **MAIN world**;
- the flag is stored by the extension, not the daemon.

Implementation shape:

- pairing state is inferred from extension bootstrap storage;
- eval mode is stored in extension config storage;
- the popup writes the flag directly into extension storage.

This keeps eval control browser-local and operator-driven.

## Agent-facing error improvement

`EVAL_DISABLED` was changed from an internal/deferred message to an actionable one.

New behavior:

- `message`: `Eval mode is off in the browser extension.`
- `suggestedAction`: `Ask a human to open the bproxy extension popup, enable Eval mode, then retry with --allow-eval.`

This makes the failure understandable to an agent without extra project context.

## Real-system validation and debugging sequence

### Step 1 — verify the enable path works at all

A control run against `https://example.com/` succeeded after enabling eval mode in the popup.

Observed result:
- `tab open` succeeded;
- `eval --allow-eval --code 'return { href: location.href, title: document.title, sum: 1 + 1 }'` succeeded;
- returned structured data from MAIN world.

Conclusion:
- popup enable path works;
- CLI `--allow-eval` guard works;
- extension-side flag gate works;
- the nominal eval path is not globally broken.

This was only a control check, not evidence that eval works on real hostile apps.

### Step 2 — run LinkedIn eval

Command shape used repeatedly:

```bash
node cli/dist/bproxy.mjs tab open --url https://www.linkedin.com/ --home <smoke-home>
node cli/dist/bproxy.mjs eval -s <session> --allow-eval --code 'return 1+1' --home <smoke-home>
```

Initial real-site result after popup enablement:

```json
{
  "ok": false,
  "error": {
    "code": "SCRIPT_ERROR",
    "message": "MAIN-world eval failed"
  }
}
```

This proved only that the request reached the eval path and failed somewhere inside the extension/browser path.

### Step 3 — check built-in observability

#### `debug.last`

Expected value:
- daemon request lifecycle entries for `tab.open` and `eval`.

Actual result from the smoke daemon:

```json
{
  "ok": true,
  "data": { "requests": [] }
}
```

Conclusion:
- `debug.last` did not help for this smoke run;
- it returned no useful daemon request history.

#### `debug.log`

Confirmed by code inspection and live use:
- `debug.log` is implemented;
- it is forwarded to the extension;
- it reads the extension trace ring buffer.

Querying `debug.log` by failed request id showed:
- action: `eval`;
- result: `error`;
- replay: `false`;
- extension received the request;
- the failure happened quickly inside the extension path.

Conclusion:
- routing/daemon connectivity was not the problem;
- the failure was inside the extension MAIN-world execution path.

## MAIN-world eval instrumentation work

### Instrumentation 1 — preserve page-thrown eval error details

`injectedEval` was changed to preserve thrown error details instead of collapsing everything to the generic `MAIN-world eval failed` message.

Goal:
- if the page threw something meaningful (for example an `EvalError`), return its `name` and `message`.

This was useful, but it did **not** explain the LinkedIn failure because the next LinkedIn run produced a different error.

### Finding — wrapper error before page-level diagnostics

After the first instrumentation change, LinkedIn eval returned:

```json
{
  "ok": false,
  "error": {
    "code": "SCRIPT_ERROR",
    "message": "Cannot read properties of null (reading 'ok')",
    "details": { "name": "TypeError" }
  }
}
```

Interpretation:
- this was **not** a useful page-level eval error;
- it was an extension wrapper error;
- the background expected a structured result object with `.ok`, but the received value was `null`.

This shifted the debugging question from “what did LinkedIn throw?” to “what did `chrome.scripting.executeScript(...)` actually return?”

### Instrumentation 2 — expose raw `executeScript` response shape

`main-world.ts` was instrumented to report raw `executeScript` response details when the returned value is malformed.

Diagnostic fields added include:
- `executions`
- `executionsLength`
- `firstExecution`
- `hasResultField`
- `firstResult`
- `firstResultType`
- `firstResultObjectKeys`
- `firstResultPreview`

This was the right diagnostic step because it observes the real browser boundary instead of guessing.

### Temporary bug introduced during instrumentation

A `debugName` field was accidentally passed through to `chrome.scripting.executeScript(...)`.

That produced this real Chrome error:

```json
{
  "ok": false,
  "error": {
    "code": "SCRIPT_ERROR",
    "message": "Error in invocation of scripting.executeScript(scripting.ScriptInjection injection, optional function callback): Error at parameter 'injection': Unexpected property: 'debugName'.",
    "details": { "name": "TypeError" }
  }
}
```

This was fixed by stripping `debugName` before calling the Chrome API.

## Real LinkedIn result after malformed-result diagnostics

After reloading the rebuilt extension and repeating the smoke run, LinkedIn eval first returned a malformed MAIN-world result diagnostic:

```json
{
  "ok": false,
  "error": {
    "code": "SCRIPT_ERROR",
    "message": "MAIN-world eval returned an unexpected executeScript result",
    "details": {
      "executions": [
        {
          "documentId": "DF92C8A2F58C6120CCDDDCA7D03691B1",
          "frameId": 0,
          "result": null
        }
      ],
      "executionsLength": 1,
      "hasFirstExecution": true,
      "firstExecution": {
        "documentId": "DF92C8A2F58C6120CCDDDCA7D03691B1",
        "frameId": 0,
        "result": null
      },
      "hasResultField": true,
      "firstResult": null,
      "firstResultType": "null",
      "firstResultPreview": null
    }
  }
}
```

A follow-up probe was then added: when eval returns a malformed/null result, the extension runs a second MAIN-world function that does **not** use string evaluation and simply returns a structured object.

After reloading again and repeating the smoke run, LinkedIn eval returned:

```json
{
  "ok": false,
  "error": {
    "code": "SCRIPT_ERROR",
    "message": "MAIN-world eval returned null while a non-eval MAIN-world probe succeeded. This page may block string evaluation for extension-injected MAIN-world code (for example via CSP).",
    "details": {
      "executions": [
        {
          "documentId": "E82C801D6D20CBE9CF07811489733EAF",
          "frameId": 0,
          "result": null
        }
      ],
      "probe": {
        "ok": true,
        "result": { "probe": true, "value": 2 },
        "page": {
          "url": "https://www.linkedin.com/",
          "title": "Feed | LinkedIn",
          "readyState": "interactive",
          "busyHint": true
        }
      }
    }
  }
}
```

Interpretation:
- MAIN-world injection itself works on LinkedIn;
- returning structured objects from MAIN world works on LinkedIn;
- the broken part is specifically the string-evaluation path used by the current `eval` implementation.

## Cross-check with Dev Browser on Chrome port 9222

To distinguish page behavior from extension behavior, the same real Chrome was inspected through a second agent/browser tool: `dev-browser --connect http://localhost:9222`.

What was done:
- listed tabs via `browser.listPages()` to confirm the CDP connection worked;
- opened a fresh LinkedIn page through Dev Browser;
- ran plain page evaluation: `page.evaluate(() => 1 + 1)`;
- ran function-constructor evaluation: `page.evaluate(() => Function("return 1+1")())`;
- ran a wrapped version that imitated the extension's `injectedEval` shape and returned `{ ok, result, page }`.

Observed result on the real LinkedIn feed page:
- direct evaluation returned `2`;
- `Function("return 1+1")()` also returned `2`;
- the wrapped object `{ ok: true, result: 2, page: ... }` was returned successfully.

Interpretation:
- LinkedIn does not simply reject `Function(...)` in all contexts;
- the page-level JavaScript logic used by `injectedEval` works when executed through CDP/Playwright evaluation;
- the current failure is therefore narrower: it is specific to the extension-side `chrome.scripting.executeScript(..., world: "MAIN")` path or to a difference between extension injection and CDP evaluation.

This does **not** prove the extension path is unaffected by CSP or page policy differences. It only proves that the same page can evaluate the same JavaScript through DevTools/CDP while the extension MAIN-world path still returns `result: null`.

## Docs search and realistic solution options

A follow-up search in real docs with bproxy focused on recent Chrome extension guidance around:
- `chrome.scripting.executeScript`
- `chrome.debugger`
- extension sandboxing / `eval` / `new Function`

What the docs suggest:

- `chrome.scripting.executeScript` is designed for injecting **files** or **function variables** into `ISOLATED` or `MAIN` world. It is a good fit for predefined probes, not a first-class API for arbitrary code strings.
- Chrome's `debugger` API is an alternate transport for the Chrome DevTools Protocol and exposes the `Runtime` domain. This is the extension-side path closest to what DevTools and `dev-browser --connect http://localhost:9222` use.
- Chrome's sandboxing docs recommend sandboxed iframes/pages when an extension truly needs `eval`/`new Function`, but that solution is for safely executing code away from extension privileges. It does **not** solve page-runtime inspection in the target tab's MAIN world.

## What is now known

1. **Eval enablement is no longer blocked by product UX.**
   The extension popup now provides a shipped operator path.

2. **Agent guidance is good enough for the disabled case.**
   `EVAL_DISABLED` now tells the agent to ask a human to enable eval mode in the popup.

3. **The daemon path is not the current problem.**
   `debug.log` confirmed the request reaches the extension and fails there.

4. **`debug.last` was not useful in this smoke run.**
   It returned an empty request list.

5. **The current LinkedIn failure is now much narrower.**
   A non-eval MAIN-world probe succeeds on LinkedIn, so MAIN-world injection and structured return values are working.

6. **The broken part is specifically the current string-eval mechanism.**
   The failing path is the current `Function(code)`-style evaluation inside extension-injected MAIN-world code.

7. **The current eval implementation is not reliable enough for real-site debugging.**
   It works on friendly pages, but not on at least one important real target.

## Superseded follow-up direction

The original follow-up direction in this note was to replace string eval with debugger-backed eval via `chrome.debugger` / CDP. That direction is now rejected.

Corrected conclusion:

- do **not** continue hardening arbitrary eval inside bproxy;
- do **not** add a debugger-backed `eval` command;
- use normal browser debugging tools, such as Chrome DevTools Protocol, when page/runtime investigation is needed;
- keep bproxy focused on explicit read and actuator primitives;
- keep MAIN-world execution only for narrow product actions such as `runtime-api` writes, not arbitrary code execution.

## Phase 5 relevance

This work resolves the earlier “no shipped eval enable path” control-plane gap noted on 2026-05-30.

What remains open is not enablement, but the replacement of the current unreliable string-eval implementation with a more realistic real-site debugging path. The proposed direction is debugger-backed eval via CDP in a separate implementation step.
