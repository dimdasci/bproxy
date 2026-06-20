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
  version: "0.8.0"
---

# bproxy

CLI → daemon → Chrome extension → real browser page.
Operator handles: login, CAPTCHA, consent, final submit.
Agent handles: navigation, reading, form filling, clicking.

## Required: agent nickname (`--nick` / `-n`)

Every protocol command requires `-n <nick>`. Generate your nick **once at the start of your task** and reuse it for all commands.

**How to generate:** pick 6 random lowercase alphanumeric characters, starting with a letter. Pattern: `/^[a-z][a-z0-9]{5}$/`. Example generation: pick a random letter a-z, then 5 random chars from a-z0-9. Do not reuse nicks from documentation or examples.

**Why:** sessions are scoped to nick. Your nick is your namespace — only you can see and command sessions you created. Using someone else's nick means you'll either fail with `SESSION_SCOPE_MISMATCH` or collide with their sessions.

**Rules:**
- Generate once per task, reuse for all commands in that task.
- No environment variable — explicit on every call.
- Do not hardcode nicks from examples or documentation.

## Flow: open → read → act → close

```bash
# Generate your nick first (6 random lowercase alphanum, starts with letter)
# Then use it consistently:

bproxy tab open --url "https://example.com" -n <nick>
# → { session: "m4q7z2", tab: "t1", tmpDir: "...", ownerHash: "a3f7c012" }

bproxy text -n <nick> -s m4q7z2
bproxy links -n <nick> -s m4q7z2          # → ln1, ln2, ln3...
bproxy elements -n <nick> -s m4q7z2       # → el1, el2, el3...

bproxy click -n <nick> -s m4q7z2 --element ln3
bproxy fill -n <nick> -s m4q7z2 --element el2 --value "hello" --method paste --world isolated

bproxy session close -n <nick> -s m4q7z2
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
`session create` · `session close` · `session resume` · `session bind --tab tN`

**All commands require** `-n <nick>` and `-s <session>` (except `tab open --url` which can auto-create session, and `session create`/`session list`/`debug status`/`debug last` which don't need `-s`).

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
- After operator resolves: `session resume -n <nick> -s <id>`, continue.

## Gotchas

- **`--nick` is mandatory**: missing or invalid nick → exit 2, command never reaches daemon.
- **Generate your own nick**: do not copy nicks from docs/examples. Generate a random one.
- **`TAB_NOT_VISIBLE`**: destructive actions fail on background tabs. Tab must be Chrome's active foreground tab. No standalone `tab activate` command yet — ask operator to switch, or use `navigate` to the same URL which may bring it forward.
- **Handles expire**: `el1`/`ln1` are valid only for current page state. After navigation or page change, re-read.
- **`-s` required**: every browser command needs session id. Exception: `tab open --url` auto-creates session.
- **No `auto` fill method**: agent must choose `paste`/`direct`/`runtime-api` explicitly.
- **Scroll doesn't infer containers**: `scroll` moves viewport by default. For specific scrollable element, pass `--element`. bproxy won't guess.
- **Screenshot needs visible tab**: use `--activate` to bring tab to foreground, or ask operator.
- **Cross-origin iframes**: content inside them is unreachable. Use `require-human`.
- **`SELECTOR_AMBIGUOUS`**: bproxy refuses if selector matches >1 element. Narrow the selector or use handles.
- **Pacing is enforced**: daemon adds delay between commands (900ms minimum). Don't try to batch rapidly — it will be rejected.

## Error recovery

| Error | Do |
|-------|-----|
| `HUMAN_REQUIRED` | Stop. Tell operator. Wait. `session resume`. |
| `ELEMENT_NOT_FOUND` / `HANDLE_STALE` | Re-read (`elements`/`links`) for fresh handles. |
| `SESSION_NOT_FOUND` | Session permanently gone. `tab open --url` for new session. **Do not retry.** |
| `SESSION_SCOPE_MISMATCH` | Session belongs to another agent. Check your `--nick`. **Do not retry.** |
| `RATE_LIMITED` | Too fast. Wait the `retryAfter` ms from details, then retry. |
| `METRONOME_DETECTED` | Fixed-interval pattern detected. **Do not retry.** Vary your timing. |
| `TIMEOUT` | `wait --strategy selector --target <css>`, then retry. |
| `TAB_NOT_VISIBLE` | Ask operator to foreground tab, retry. |
| `NO_EXTENSION` | Extension not connected. Ask operator to check. |
| `SELECTOR_AMBIGUOUS` | Use more specific selector or element handle. |

Read `references/errors.md` for full error taxonomy + recovery patterns.
