# 1. Agent Output Contract

[← Index](./README.md) · Next: [CLI Design →](./02-cli-design.md)

---

Every CLI command writes exactly one JSON object to stdout and exits. No extra text, no stderr mixing, no human formatting. Agents parse one line and move on.

## Success shape

```json
{
  "ok": true,
  "data": { ... }
}
```

`data` varies per action. Fields are kept minimal — no filler, no echo of the request.

Every response from a content-script action includes a `page` context block (see below).

## Error shape

```json
{
  "ok": false,
  "error": "SELECTOR_NOT_FOUND",
  "message": "No element matches '#submit-btn'",
  "retry": false
}
```

| Field     | Type    | Purpose                                          |
|-----------|---------|--------------------------------------------------|
| `ok`      | bool    | Single branch point for the agent                |
| `error`   | string  | Machine-readable error code (see Error codes)    |
| `message` | string  | One-line human/agent explanation                  |
| `retry`   | bool    | `true` = transient, try again. `false` = don't.  |
| `hint`    | string? | Optional. Actionable suggestion for the agent.   |

## Page context on every response

Every command that touches the page (`click`, `type`, `text`, `elements`, `images`, `outline`, `dom`, `eval`, `wait`) appends a `page` block to the response:

```json
{
  "ok": true,
  "data": { "text": "..." },
  "page": {
    "url": "https://app.example.com/dashboard",
    "title": "Dashboard",
    "state": "ready",
    "busy": false
  }
}
```

| Field   | Type   | Values / Meaning                                                                                              |
|---------|--------|---------------------------------------------------------------------------------------------------------------|
| `url`   | string | Current `location.href` — detects SPA navigations the agent didn't initiate.                                  |
| `title` | string | Current `document.title`.                                                                                     |
| `state` | string | `"loading"` · `"settling"` · `"ready"` (see [Page State Detection](./05-page-state.md) for detection logic). |
| `busy`  | bool   | `true` if loading indicators detected (spinners, skeletons, `aria-busy`).                                     |

This is cheap (4 fields, ~100 tokens) and gives the agent situational awareness on every call. The agent doesn't need to poll `status` to know where it is or whether the page is still loading.

When `state` is `"settling"` or `busy` is `true`, the agent knows to `bproxy wait` before reading content.

## Token budget

Agent output is consumed by LLMs. Every extra token costs money and context window.

Rules:
- No redundant fields. Don't echo the command back.
- `text` action: return `{ "ok": true, "data": { "text": "..." } }` — not wrapped in metadata the agent didn't ask for.
- `screenshot` action: return `{ "ok": true, "data": { "image": "<base64>" } }` — just the payload.
- `elements` action: flat list, numbered, one line per element. No nesting, no full attribute dumps.
- Text content is truncated at 10,000 chars with a `"truncated": true` flag. The agent can use `eval` for full extraction if needed.

## Error codes

Fixed vocabulary. Agents can `switch` on these.

| Code                   | Retry | Meaning                                              |
|------------------------|-------|------------------------------------------------------|
| `NO_CONNECTION`        | true  | Proxy can't reach the extension. Browser not open?   |
| `EXTENSION_TIMEOUT`    | true  | Extension didn't respond within the deadline.        |
| `TAB_NOT_AVAILABLE`    | true  | No active tab, or tab is a chrome:// page.           |
| `SELECTOR_NOT_FOUND`   | false | CSS selector matched zero elements.                  |
| `SELECTOR_AMBIGUOUS`   | false | CSS selector matched multiple elements (for click).  |
| `NAVIGATION_FAILED`    | false | URL couldn't be loaded (ERR_NAME_NOT_RESOLVED etc).  |
| `EVAL_ERROR`           | false | JS execution threw an exception.                     |
| `WAIT_TIMEOUT`         | true  | Page didn't reach desired state within deadline.     |
| `PROXY_NOT_RUNNING`    | true  | CLI couldn't connect to the proxy service.           |
| `INVALID_COMMAND`      | false | Unknown action or missing required params.           |

When `retry` is `true`, the `hint` field tells the agent what to check:

```json
{
  "ok": false,
  "error": "NO_CONNECTION",
  "message": "No browser extension connected",
  "retry": true,
  "hint": "Ensure the browser is open and the bproxy extension is loaded. Then retry."
}
```

When `retry` is `false`, the error is the agent's to fix (wrong selector, bad JS, etc).

## Exit codes

- `0` — success (`ok: true`)
- `1` — command error (`ok: false`, infrastructure or action failure)
- `2` — CLI usage error (wrong args, printed before any JSON)

Exit code `2` is the only case where output is not JSON — it prints a usage line to stderr. This only happens if the agent calls `bproxy` with malformed syntax.
