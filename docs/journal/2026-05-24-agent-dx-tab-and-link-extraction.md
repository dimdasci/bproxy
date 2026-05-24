# Agent DX — tab bootstrap and link extraction friction

Date: 2026-05-24
Status: proposed

## Context

A paired extension and running daemon were used from the CLI to perform a real agent workflow:

1. Open Google in a browser tab.
2. Search for recent `"solution architect"` job postings.
3. Read the Google results page.
4. Extract the result URLs using bproxy commands.

The core architecture worked: daemon/extension pairing was stable, browser actions were forwarded successfully, and the agent could use `navigate`, `text`, `outline`, and `dom` to complete the task.

## Finding

The workflow was successful, but the developer experience exposed several agent-facing rough edges.

### Fresh tab bootstrap is confusing

`tab list` and `tab open` are currently forwarded actions, so they require the current session to already be bound to a tab. A fresh session starts unbound, which creates a chicken-and-egg problem: the agent needs `tab list` or `tab open` to discover or create the tab it should bind to, but those commands fail until a binding exists.

The workaround used during the workflow was:

```bash
./cli/dist/bproxy.mjs session bind --tab-id 1
./cli/dist/bproxy.mjs tab list
./cli/dist/bproxy.mjs tab open --url https://google.com
./cli/dist/bproxy.mjs session bind --tab-id 482553746
```

This is confusing because `1` was only a daemon-side placeholder binding. Chrome later returned the actual opaque tab id, such as `482553746`, and the session had to be rebound to that real tab.

### Raw Chrome tab ids are surprising

The real browser tab ids are Chrome-assigned opaque integers. They can be large values, not human-friendly ordinals like `1`, `2`, or `3`. That is technically correct, but the current CLI help and first-run flow do not explain the distinction between:

- the daemon's `session -> tabId` pointer, and
- Chrome's actual tab ids returned by `tab list` / `tab open`.

### Link extraction requires too much manual plumbing

To answer "give me a list of URLs from this page", the agent had to:

1. Use `outline` to identify result titles.
2. Use repeated `dom --selector "#rso > div:nth-child(N) .yuRUbf" --depth 20` calls.
3. Parse returned HTML externally with shell/Node to collect `href` values.

This worked, but it is not an ideal agent primitive. Search and research workflows frequently need structured links.

### `elements` failed on Google

`elements` failed because selector generation produced an invalid CSS selector from an `aria-label` containing a newline:

```text
Invalid selector a[aria-label="Google Account: ... \n ..."]
```

This blocks the most natural "show me the interactive elements" path on a common page. Selector generation should escape attribute values correctly or fall back to safer route-based targets when labels contain newlines, quotes, or other special CSS characters.

## Request for improvement

### 1. Allow `tab list` without a bound session

`tab list` should require a connected extension, but not a bound session.

Expected fresh-session behavior:

```bash
bproxy tab list
```

returns all browser tabs, enabling the agent to choose one and then call `session bind`.

### 2. Allow `tab open` without a bound session

Opening a new tab does not conceptually need an existing target tab.

Expected behavior:

```bash
bproxy tab open --url https://google.com
```

returns the actual Chrome tab id:

```json
{
  "ok": true,
  "data": {
    "tabId": 482553746,
    "url": "https://google.com"
  }
}
```

### 3. Add `--bind` to `tab open`

Common agent flow should be one command:

```bash
bproxy tab open --url https://google.com --bind
```

Expected behavior:

- open the tab;
- bind the current session to the new tab;
- return both the new tab id and the binding state.

Example response:

```json
{
  "ok": true,
  "data": {
    "tabId": 482553746,
    "bound": true,
    "session": "default"
  }
}
```

Then the happy path becomes:

```bash
bproxy tab open --url https://google.com --bind
bproxy text
```

### 4. Add a first-class `links` command

Add a structured URL extraction command for common research pages:

```bash
bproxy links [--selector "#search"] [--visible-only] [--limit N]
```

Example response:

```json
{
  "links": [
    {
      "text": "Solution Architect - Vodafone",
      "href": "https://vodafone.eightfold.ai/careers/job/...",
      "selector": "...",
      "route": {}
    }
  ]
}
```

This would avoid external HTML parsing and make page research much easier for agents.

### 5. Harden generated selectors

Fix selector generation used by `elements` so attribute values are escaped safely. If a stable CSS selector cannot be generated, return a route-based target or another safe identifier instead of failing the entire command.

## Suggested success criteria

A fresh paired bproxy setup should support this workflow without fake tab ids, manual rebinding, or external HTML parsing:

```bash
bproxy tab open --url https://google.com --bind
bproxy navigate --url "https://www.google.com/search?q=solution+architect+jobs&tbs=qdr:w"
bproxy text
bproxy links --selector "#search"
```

## Priority

High developer-experience impact for agent usage. The underlying browser automation works; the biggest wins are making first-run tab targeting and common extraction workflows compose naturally.
