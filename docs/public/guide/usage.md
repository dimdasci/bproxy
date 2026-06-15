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

## Open a tab

```bash
bproxy tab open --url https://example.com
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
    "tmpDir": "/home/user/.bproxy/tmp/sessions/m4q7z2"
  }
}
```

This auto-creates a session (e.g., `m4q7z2`) and binds it to logical tab `t1`. Use `-s m4q7z2` for all subsequent commands in this session.

## Read the page

**Get page text:**

```bash
bproxy text -s m4q7z2
```

**Get links:**

```bash
bproxy links -s m4q7z2
```

Response includes structured links with handles for easy targeting:

```json
{
  "ok": true,
  "data": {
    "links": [
      { "text": "More information...", "href": "https://www.iana.org/...", "handle": "ln1" }
    ]
  }
}
```

**Get interactive elements:**

```bash
bproxy elements -s m4q7z2
```

## Click a link or element

Use the handle returned by `links` or `elements`:

```bash
bproxy click -s m4q7z2 --element ln1
```

Or target by CSS selector:

```bash
bproxy click -s m4q7z2 --selector 'a[href="/about"]'
```

## Fill a form

```bash
bproxy fill -s m4q7z2 --element el2 --value "hello@example.com" --method paste --world isolated
```

The `--method` flag is required. Choose based on the target:

| Target type | Method | World |
|-------------|--------|-------|
| Plain `<input>`, `<textarea>` | `paste` | `isolated` |
| Bare `[contenteditable]` | `direct` | `isolated` |
| Rich editor (Quill, Lexical, etc.) | `runtime-api` | `main` |

For richer editors, first run `bproxy elements -s m4q7z2 --form` and use any returned `runtimeHandle` to choose `runtime-api` + `main`.

## Scroll

```bash
bproxy scroll -s m4q7z2 --direction down
```

Scroll a specific element:

```bash
bproxy scroll -s m4q7z2 --element el5 --direction down
```

## Navigate to a URL

```bash
bproxy navigate -s m4q7z2 --url https://example.com/page2
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
    "suggestedAction": "resolve the interstitial in the browser, then `bproxy session resume`"
  }
}
```

The human resolves the situation in the browser, then:

```bash
bproxy session resume -s m4q7z2
```

## Close the session

```bash
bproxy session close -s m4q7z2
```

This closes all tabs owned by the session and cleans up temporary artifacts.

## Stop the daemon

```bash
bproxy service stop
```

## Command reference

| Command | Description |
|---------|-------------|
| `tab open --url <url>` | Open tab, auto-create session |
| `text -s id [--selector]` | Extract page text |
| `links -s id [--selector] [--limit N]` | Extract structured links |
| `elements -s id [--form]` | List interactive elements |
| `outline -s id` | Landmarks + headings |
| `dom -s id [--selector] [--depth N]` | Simplified DOM subtree |
| `inspect -s id --selector <css>` | Layout, scroll info, computed styles |
| `snapshot -s id` | Accessible DOM tree |
| `click -s id --element <handle>` | Click an element |
| `hover -s id --element <handle>` | Hover an element |
| `scroll -s id [--direction] [--element]` | Scroll viewport or element |
| `fill -s id --element <handle> --value <v> --method <m> --world <w>` | Fill a field |
| `fill-form -s id --json <fields>` | Bulk fill in one round-trip |
| `select -s id --element <handle> --option-text <text>` | Select dropdown option |
| `navigate -s id --url <url>` | Navigate to URL |
| `screenshot -s id [--output-dir]` | Capture visible tab |
| `wait -s id --strategy <s> --target <t>` | Wait for condition |
| `require-human -s id --reason <r>` | Signal human needed |
| `session create [--label]` | Create session without tab |
| `session list` | List active sessions |
| `session resume -s id` | Resume paused session |
| `session close -s id` | Close session + tabs |
| `service start [--port]` | Start daemon |
| `service stop` | Stop daemon |
| `service status` | Daemon status (token-free) |
| `service install` | Register auto-start |
| `service uninstall` | Remove auto-start |
| `doctor` | Validate full operational chain |
| `--version` | Print version + protocol |
