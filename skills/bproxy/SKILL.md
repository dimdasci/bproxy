---
name: bproxy
description: >-
  Control operator's real Chrome via CLI proxy. Use when agent needs to read
  web pages, extract links/elements, fill forms, click, scroll, or screenshot —
  through a localhost daemon bridging to a Chrome extension. Requires bproxy
  daemon running and extension paired. Human stays in loop for login, CAPTCHA,
  consent, final submit.
compatibility: Node >=24, bproxy installed (npm install -g @dimdasci/bproxy), daemon running, extension paired
license: MIT
metadata:
  version: "0.7.3"
---

# bproxy

CLI → daemon → Chrome extension → real browser page.
Operator handles: login, CAPTCHA, consent, final submit.
Agent handles: navigation, reading, form filling, clicking.

## Flow: open → read → act → close

```bash
bproxy tab open --url "https://example.com"
# → { session: "m4q7z2", tab: "t1", tmpDir: "..." }

bproxy text -s m4q7z2
bproxy links -s m4q7z2          # → ln1, ln2, ln3...
bproxy elements -s m4q7z2       # → el1, el2, el3...

bproxy click -s m4q7z2 --element ln3
bproxy fill -s m4q7z2 --element el2 --value "hello" --method paste --world isolated

bproxy session close -s m4q7z2
```

## Commands (quick ref)

**Read** (non-destructive):
`text [--selector]` · `links [--selector] [--limit]` · `elements [--form]` ·
`outline` · `dom [--selector] [--depth]` · `inspect --selector` ·
`snapshot [--interactive-only]` · `screenshot [--activate] [--output-dir]`

**Act** (destructive):
`navigate --url` · `click --element/--selector` · `hover --element/--selector` ·
`scroll [--element] [--direction up|down] [--by N]` ·
`fill --element --value --method --world` · `fill-form --json` ·
`select --element --option-text` · `wait --strategy --target`

**Session/Tab**:
`tab open --url` · `tab close` · `tab list` ·
`session close` · `session resume` · `session bind --tab tN`

**Target** (one of): `--element <handle>` (preferred) · `--selector <css>` · `--route-json <json>`

Read `references/actions.md` for full params/responses.

## Fill method

| Target | Method | World |
|--------|--------|-------|
| `<input>`, `<textarea>`, React/Vue/Angular | `paste` | `isolated` |
| bare `[contenteditable]` | `direct` | `isolated` |
| rich editor (`runtimeHandle` present) | `runtime-api` | `main` |

Probe first: `elements --form` → check `runtimeHandle` field.
Read `references/fill-methods.md` when handling rich editors or shadow DOM.

## Consent & interstitials

When page shows cookie banner, login wall, or CAPTCHA:
- Cookie banners: read `references/consent.md` for CMP selector catalog + decision tree.
- Login/CAPTCHA/age gates: `require-human --reason "..."` immediately.
- After operator resolves: `session resume -s <id>`, continue.

## Gotchas

- **`TAB_NOT_VISIBLE`**: destructive actions fail on background tabs. Tab must be Chrome's active foreground tab. No standalone `tab activate` command yet — ask operator to switch, or use `navigate` to the same URL which may bring it forward.
- **Handles expire**: `el1`/`ln1` are valid only for current page state. After navigation or page change, re-read.
- **`-s` required**: every browser command needs session id. Exception: `tab open --url` auto-creates session.
- **No `auto` fill method**: agent must choose `paste`/`direct`/`runtime-api` explicitly.
- **Scroll doesn't infer containers**: `scroll` moves viewport by default. For specific scrollable element, pass `--element`. bproxy won't guess.
- **Screenshot needs visible tab**: use `--activate` to bring tab to foreground, or ask operator.
- **Cross-origin iframes**: content inside them is unreachable. Use `require-human`.
- **`SELECTOR_AMBIGUOUS`**: bproxy refuses if selector matches >1 element. Narrow the selector or use handles.

## Error recovery

| Error | Do |
|-------|-----|
| `HUMAN_REQUIRED` | Stop. Tell operator. Wait. `session resume`. |
| `ELEMENT_NOT_FOUND` / `HANDLE_STALE` | Re-read (`elements`/`links`) for fresh handles. |
| `SESSION_NOT_FOUND` | Daemon restarted. `tab open --url` for new session. |
| `TIMEOUT` | `wait --strategy selector --target <css>`, then retry. |
| `TAB_NOT_VISIBLE` | Ask operator to foreground tab, retry. |
| `NO_EXTENSION` | Extension not connected. Ask operator to check. |
| `SELECTOR_AMBIGUOUS` | Use more specific selector or element handle. |

Read `references/errors.md` for full error taxonomy + recovery patterns.
