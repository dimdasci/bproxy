---
title: Usage
sidebar:
  order: 2
---

Quick-start guide showing the core bproxy workflow: open, read, act, close.

## Start the daemon

```bash
bproxy service start
```

If this is your first time, pair the extension (see [Install](./install.md)).

## Pick an agent nick

Every protocol command needs an explicit agent nickname:

```text
-n <nick>
```

Generate one nick per task and reuse it. It must be 6 lowercase alphanumeric characters, start with a letter, and match `/^[a-z][a-z0-9]{5}$/`. Examples below use `<nick>` as a placeholder.

Service lifecycle commands (`service start|stop|status|restart|install|uninstall`) and `doctor` do not need a user nick.

## Open a tab

```bash
bproxy tab open --url https://example.com -n <nick>
```

Response:

```json
{
  "ok": true,
  "data": {
    "session": "m4q7z2",
    "tab": "t1",
    "bound": true,
    "url": "https://example.com",
    "tmpDir": "/home/user/.bproxy/tmp/sessions/m4q7z2",
    "ownerHash": "a3f7c012"
  }
}
```

This auto-creates a session and binds it to logical tab `t1`. Use `-n <nick> -s m4q7z2` for later commands in this session.

## Read the page

**Get page text:**

```bash
bproxy text -n <nick> -s m4q7z2
```

Extract from a marker in CLI output:

```bash
bproxy text -n <nick> -s m4q7z2 --after "Main content" --limit-chars 4000
```

When `--after` is used, output data includes `markerFound` and, when found, `markerOffset`. If the marker is missing, bproxy emits the full text with `markerFound:false`.

**Get links:**

```bash
bproxy links -n <nick> -s m4q7z2 --limit 50
```

Response includes structured links with handles for easy targeting:

```json
{
  "ok": true,
  "data": {
    "links": [
      { "text": "More information...", "href": "https://www.iana.org/...", "handle": "ln1" }
    ],
    "total": 42
  }
}
```

Filter and paginate large link sets:

```bash
bproxy links -n <nick> -s m4q7z2 --href-contains "/in/" --limit 25 --offset 50
```

`--href-contains` is a case-sensitive substring match on normalized absolute hrefs. `--offset` skips matching links before the returned slice. If the page hits the collection safety cap, data includes `capped:true`.

**Get interactive elements:**

```bash
bproxy elements -n <nick> -s m4q7z2 --form
```

## Activate before destructive actions

Destructive actions require the target tab to be visible. If a tab is backgrounded, run:

```bash
bproxy tab activate -n <nick> -s m4q7z2
```

This foregrounds the bound tab and focuses its Chrome window. No other command auto-activates hidden tabs, except `screenshot --activate` for screenshots only.

## Click a link or element

Use the handle returned by `links` or `elements`:

```bash
bproxy click -n <nick> -s m4q7z2 --element ln1
```

Or target by CSS selector:

```bash
bproxy click -n <nick> -s m4q7z2 --selector 'a[href="/about"]'
```

## Fill a form

```bash
bproxy fill -n <nick> -s m4q7z2 --element el2 --value "hello@example.com" --method paste --world isolated
```

The `--method` flag is required. Choose based on the target:

| Target type | Method | World |
|-------------|--------|-------|
| Plain `<input>`, `<textarea>` | `paste` | `isolated` |
| Bare `[contenteditable]` | `direct` | `isolated` |
| Rich editor (Quill, Lexical, etc.) | `runtime-api` | `main` |

For richer editors, first run `bproxy elements -n <nick> -s m4q7z2 --form` and use any returned `runtimeHandle` to choose `runtime-api` + `main`.

## Scroll

```bash
bproxy scroll -n <nick> -s m4q7z2 --direction down
```

Scroll a specific element:

```bash
bproxy scroll -n <nick> -s m4q7z2 --element el5 --direction down
```

bproxy does not infer page-specific scroll containers. Pass the element you want scrolled, or omit target to scroll the viewport/document.

## Navigate to a URL

```bash
bproxy navigate -n <nick> -s m4q7z2 --url https://example.com/page2
```

## Handle human-required situations

When the agent encounters a CAPTCHA, login wall, or consent screen, bproxy returns:

```json
{
  "ok": false,
  "error": {
    "code": "HUMAN_REQUIRED",
    "category": "policy",
    "retry": "conditional",
    "message": "CAPTCHA detected",
    "suggestedAction": "resolve the interstitial in the browser, then resume the session"
  }
}
```

The human resolves the situation in the browser, then:

```bash
bproxy session resume -n <nick> -s m4q7z2
```

## Close the session

```bash
bproxy session close -n <nick> -s m4q7z2
```

This closes all tabs owned by the session and cleans up temporary artifacts.

## Stop the daemon

```bash
bproxy service stop
```

## Command reference

Protocol commands below need `-n <nick>`; session-bound commands also need `-s id` unless noted.

| Command | Description |
|---------|-------------|
| `tab open -n nick --url <url>` | Open tab; auto-create session if `-s` omitted |
| `tab activate -n nick -s id [--tab tN]` | Foreground session tab and focus window |
| `tab list -n nick -s id` | List session tabs |
| `tab close -n nick -s id [--tab tN]` | Close tab |
| `tab pin -n nick -s id [--tab tN]` / `tab unpin ...` | Pin/unpin tab |
| `text -n nick -s id [--selector] [--after S] [--limit-chars N]` | Extract page text; optional CLI-local slicing |
| `links -n nick -s id [--selector] [--visible-only] [--limit N] [--href-contains S] [--offset N]` | Extract structured links with `total` / optional `capped` |
| `images -n nick -s id [--selector]` | Extract visible images |
| `elements -n nick -s id [--form]` | List interactive elements |
| `outline -n nick -s id` | Landmarks + headings |
| `dom -n nick -s id [--selector] [--depth N]` | Simplified DOM subtree |
| `inspect -n nick -s id --selector <css>` | Layout, scroll info, computed styles |
| `snapshot -n nick -s id` | Accessible DOM tree |
| `click -n nick -s id --element <handle>` | Click an element |
| `hover -n nick -s id --element <handle>` | Hover an element |
| `scroll -n nick -s id [--direction] [--element]` | Scroll viewport or explicit element |
| `fill -n nick -s id --element <handle> --value <v> --method <m> --world <w>` | Fill a field |
| `fill-form -n nick -s id --json <fields>` | Bulk fill in one round-trip |
| `select -n nick -s id --element <handle> --option-text <text>` | Select dropdown option |
| `navigate -n nick -s id --url <url>` | Navigate to URL |
| `screenshot -n nick -s id [--activate] [--output-dir]` | Capture visible tab to file |
| `wait -n nick -s id --strategy <s> --target <t>` | Wait for condition |
| `require-human -n nick -s id --reason <r>` | Signal human needed |
| `session create -n nick [--label]` | Create session without tab; no `-s` |
| `session list -n nick` | List this nick's active sessions; no `-s` |
| `session bind -n nick -s id --tab tN [--pacing human\|fast]` | Bind session to tab / pacing |
| `session unbind -n nick -s id` | Unbind session |
| `session resume -n nick -s id` | Resume paused session |
| `session close -n nick -s id` | Close session + tabs |
| `debug status -n nick` / `status -n nick` | Nick-scoped daemon/session status; no `-s` |
| `debug last -n nick [--count N]` | Nick-scoped daemon traces; no `-s` |
| `debug log -n nick -s id [--id ID] [--limit N]` | Extension trace ring buffer |
| `service start\|stop\|status\|restart` | Daemon lifecycle; no nick |
| `service install\|uninstall` | Register/remove login service; no nick |
| `doctor` | Validate operational chain; no user nick |
| `--version` | Print version + protocol |
