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

### 1. Treat sessions as daemon-generated capability handles

A session should be the top-level scope for browser access, not a friendly implicit name. Browser actions should not silently use `default`, because accidentally running two agents against the same daemon would make them share tab state and pause/pacing state.

The daemon should generate short, unguessable session ids, for example:

```text
ses_m4q8z2kf
```

Rules:

- session ids are daemon-generated only;
- user/agent-selected names such as `1`, `test`, `research`, or `default` are not accepted as authority-bearing session ids;
- an optional human label may exist separately (`--label research`), but it is not the identifier used for authorization/scope;
- sessions live in daemon memory and should support explicit close and/or idle TTL;
- all tabs, bindings, pacing, pause state, and browser actions are scoped to one session.

Possible explicit start:

```bash
bproxy session create
```

Example response:

```json
{
  "ok": true,
  "data": {
    "session": "ses_m4q8z2kf"
  }
}
```

`tab open` may also create a new session when no session is supplied, but then the returned session id must be used for later commands.

### 2. Hide real Chrome tab ids behind daemon-owned logical tab handles

The CLI/agent should never operate on Chrome's real tab ids. The daemon should translate between session-scoped logical tab handles and browser tab ids internally:

```text
session ses_m4q8z2kf
  tab t1 -> Chrome tab 482553746  # internal only
```

The extension may still receive the real Chrome tab id over the daemon↔extension protocol, but the CLI response should expose only logical handles:

```json
{
  "ok": true,
  "data": {
    "session": "ses_m4q8z2kf",
    "tab": "t1",
    "url": "https://google.com"
  }
}
```

This makes tab ids a daemon-owned implementation detail and prevents agents from targeting arbitrary existing browser tabs by guessing or reusing Chrome ids.

### 3. Make `tab open` create/bind a session-owned tab

Opening a tab should be the normal authority-granting operation. It should:

1. require a connected extension;
2. create a real Chrome tab;
3. store the real tab id in the daemon under the current/new session;
4. create a logical tab handle such as `t1`;
5. make that tab the session's current binding by default;
6. return the session id and logical tab handle, not the Chrome id.

Example fresh flow:

```bash
bproxy tab open --url https://google.com
```

Example response:

```json
{
  "ok": true,
  "data": {
    "session": "ses_m4q8z2kf",
    "tab": "t1",
    "bound": true,
    "url": "https://google.com"
  }
}
```

Then later commands must carry the returned session id:

```bash
bproxy --session ses_m4q8z2kf text
```

### 4. Scope `tab list` to session-owned tabs only

`tab list` must not expose the operator's existing browser tabs. It should return only tabs opened by bproxy within the supplied session:

```bash
bproxy --session ses_m4q8z2kf tab list
```

Example response:

```json
{
  "ok": true,
  "data": {
    "session": "ses_m4q8z2kf",
    "tabs": [
      {
        "tab": "t1",
        "url": "https://www.google.com/",
        "title": "Google",
        "bound": true
      }
    ]
  }
}
```

Existing browser tabs remain private unless a future explicit human-approved adoption flow is added. Such an adoption flow should still return only a logical tab handle.

### 5. Bind sessions to logical tabs, not browser ids

`session.bind` should move the session's current binding to one of its own logical tabs:

```bash
bproxy --session ses_m4q8z2kf session bind --tab t1
```

It should not accept raw Chrome tab ids. A tab handle from another session should be rejected.

### 6. Add a first-class `links` command

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

### 7. Harden generated selectors

Fix selector generation used by `elements` so attribute values are escaped safely. If a stable CSS selector cannot be generated, return a route-based target or another safe identifier instead of failing the entire command.

## Suggested success criteria

A fresh paired bproxy setup should support this workflow without fake tab ids, raw Chrome ids, implicit shared `default` state, manual rebinding, or external HTML parsing:

```bash
bproxy tab open --url https://google.com
# -> returns session ses_m4q8z2kf and tab t1; t1 is bound by default

bproxy --session ses_m4q8z2kf navigate --url "https://www.google.com/search?q=solution+architect+jobs&tbs=qdr:w"
bproxy --session ses_m4q8z2kf text
bproxy --session ses_m4q8z2kf links --selector "#search"
bproxy --session ses_m4q8z2kf session close
```

Additional checks:

- `tab list` for `ses_m4q8z2kf` shows only tabs opened/adopted in that session;
- operator-opened browser tabs are not visible through normal agent commands;
- real Chrome tab ids appear only in daemon/extension internals or debug output, not normal CLI responses;
- a typo or guessed short name does not create/steal another browser-control session.

## Priority

High developer-experience and safety impact for agent usage. The underlying browser automation works; the biggest wins are making first-run tab targeting, session scoping, and common extraction workflows compose naturally without exposing the operator's broader browser state.
