---
name: bproxy
description: >-
  Control the operator's real Chrome browser for web research, form filling,
  and page interaction. Use when you need to read web pages, extract links,
  fill forms, click elements, or scroll — all through a running bproxy daemon
  that proxies commands to a Chrome extension. Requires bproxy installed and
  daemon running.
compatibility: Node >=24, bproxy installed (npm install -g @dimdasci/bproxy), daemon running (bproxy service start), extension paired
license: MIT
metadata:
  version: "0.7.0"
---

# bproxy — Browser Proxy for Code Agents

Control the operator's real Chrome browser through a CLI. The operator stays in the loop for login, CAPTCHA, consent, and final submit. You handle mechanical collection, form filling, and navigation.

## Setup verification

Before using bproxy commands, verify the system is operational:

```bash
bproxy doctor
```

Expected: all checks show `"ok": true`. If the daemon is not running:

```bash
bproxy service start
```

If the extension is not paired, the operator must enter the pairing code shown in the terminal into the Chrome extension popup.

## Core workflow pattern

Every bproxy session follows: **open → read → act → close**.

```bash
# 1. Open a tab (auto-creates session)
bproxy tab open --url "https://example.com"
# Returns: { "data": { "session": "m4q7z2", "tab": "t1", ... } }

# 2. Read the page
bproxy text -s m4q7z2
bproxy links -s m4q7z2

# 3. Act on what you found
bproxy click -s m4q7z2 --element ln3
bproxy fill -s m4q7z2 --element el2 --value "hello" --method paste --world isolated

# 4. Close when done
bproxy session close -s m4q7z2
```

## Command reference

### Tab and session lifecycle

| Command | Description |
|---------|-------------|
| `bproxy tab open --url <url>` | Open tab, auto-create session. Returns `session` id + `tab` handle. |
| `bproxy navigate -s <id> --url <url>` | Navigate existing tab to a new URL. |
| `bproxy session close -s <id>` | Close all session tabs and clean up. |
| `bproxy session resume -s <id>` | Resume after human resolves an interstitial. |
| `bproxy session create [--label <text>]` | Create session without opening a tab. |

### Reading pages

| Command | Description |
|---------|-------------|
| `bproxy text -s <id> [--selector <css>]` | Extract page text (default: `body`). |
| `bproxy links -s <id> [--selector <css>] [--limit N]` | Structured visible links with handles. |
| `bproxy elements -s <id> [--form]` | Interactive elements with handles + metadata. |
| `bproxy outline -s <id>` | Landmarks + heading hierarchy. |
| `bproxy dom -s <id> [--selector <css>] [--depth N]` | Simplified DOM subtree. |
| `bproxy inspect -s <id> --selector <css>` | Layout rects, scroll info, computed styles. |
| `bproxy snapshot -s <id>` | Accessible DOM tree (text-based). |

### Acting on elements

| Command | Description |
|---------|-------------|
| `bproxy click -s <id> --element <handle>` | Click an element. |
| `bproxy hover -s <id> --element <handle>` | Hover an element. |
| `bproxy scroll -s <id> [--element <handle>] --direction <up\|down>` | Scroll viewport or element. |
| `bproxy fill -s <id> --element <handle> --value <v> --method <m> --world <w>` | Fill a field. |
| `bproxy fill-form -s <id> --json '<fields>'` | Bulk fill multiple fields. |
| `bproxy select -s <id> --element <handle> --option-text <text>` | Select dropdown option. |
| `bproxy screenshot -s <id> [--output-dir <dir>]` | Capture visible tab to file. |

### Targeting

Commands accept one of:
- `--element <handle>` — use handles from `links` (`ln1`, `ln2`) or `elements` (`el1`, `el2`)
- `--selector <css>` — explicit CSS selector
- `--route-json <json>` — shadow-DOM route (advanced)

Prefer `--element` with handles returned by read commands — they're short-lived but reliable for the current page state.

## Session management

- Every browser command requires `-s <id>` (the 6-character session handle)
- Exception: `tab open --url` auto-creates a session if `-s` is omitted
- To switch tabs in a multi-tab session, run `bproxy session bind -s <id> --tab tN`; subsequent commands target the bound tab
- Sessions are independent — one agent can run multiple sessions concurrently

## Fill method selection

The `--method` flag is required for `fill`. Choose based on the target:

| Target type | Method | World | When to use |
|-------------|--------|-------|-------------|
| Plain `<input>`, `<textarea>` | `paste` | `isolated` | Most standard form fields |
| Bare `[contenteditable]` | `direct` | `isolated` | Simple editable divs |
| Rich editor (Quill, Lexical, ProseMirror, Monaco, etc.) | `runtime-api` | `main` | When `elements` shows `runtimeHandle` |

**Decision tree:**
1. Call `elements --form` to probe the target
2. If `runtimeHandle` is present → `runtime-api` + `main`
3. If plain `<input>`/`<textarea>` → `paste` + `isolated`
4. If bare `[contenteditable]` → `direct` + `isolated`

See `references/fill-methods.md` for detailed guidance.

## Error handling

### `HUMAN_REQUIRED`

The page shows a CAPTCHA, login wall, or consent screen. Stop all automation and inform the operator:

```
The page requires human intervention: CAPTCHA detected.
Please resolve it in the browser, then I'll run: bproxy session resume -s <id>
```

Wait for the operator to confirm, then resume.

### `ELEMENT_NOT_FOUND`

The selector or handle didn't match. The page may have changed. Re-read with `elements` or `links` to get fresh handles.

### `SESSION_NOT_FOUND`

The session was closed or the daemon restarted. Create a new session with `tab open --url`.

### `ELEMENT_HANDLE_STALE`

The page navigated since the handle was minted. Re-read to get fresh handles for the current page.

### `TIMEOUT`

The daemon or extension didn't respond in time. The page may be loading slowly. Try `wait --strategy selector --target <css>` before retrying.

### General error pattern

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "category": "transport|target|policy|execution",
    "retry": "safe|conditional|never",
    "message": "Human-readable description",
    "suggestedAction": "What to do next"
  }
}
```

- `retry: "safe"` — retry immediately
- `retry: "conditional"` — retry after addressing the condition (re-read, wait, ask human)
- `retry: "never"` — the request shape is wrong; fix the command

## Output contract

- **stdout** — exactly one JSON object per command
- **Exit 0** — success (`"ok": true`)
- **Exit 1** — protocol error (`"ok": false`, error JSON on stdout)
- **Exit 2** — CLI/config failure (message on stderr, no stdout JSON)
