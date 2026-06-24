---
name: bproxy
description: >-
  Control operator's real Chrome via CLI proxy. Use when agent needs to read
  pages, extract links/elements, fill forms, click, scroll, activate tabs, or
  screenshot through a localhost daemon + Chrome extension. Requires daemon
  running and extension paired. Human stays in loop for login, CAPTCHA,
  consent, final submit.
compatibility: Node >=24, bproxy installed (npm install -g @dimdasci/bproxy), daemon running, extension paired
license: MIT
metadata:
  version: "0.9.2"
---

# bproxy

CLI → daemon → Chrome extension → operator's real Chrome.
Operator: login, CAPTCHA, consent, final submit. Agent: read, prepare, act only when explicit.

## Nick required

Every protocol command needs `-n <nick>`. Generate once per task, reuse.

- Format: `/^[a-z][a-z0-9]{5}$/` (6 chars, starts letter). Example algorithm: random `a-z` + 5 random `a-z0-9`.
- Do not copy docs/examples nicks.
- Nick scopes sessions. Wrong nick → `SESSION_SCOPE_MISMATCH` or invisible session.
- No env default. Pass `-n` every time.

## Basic flow

```bash
bproxy tab open --url "https://example.com" -n <nick>
# -> { session:"m4q7z2", tab:"t1", tmpDir:"...", ownerHash:"..." }

bproxy text -n <nick> -s m4q7z2
bproxy links -n <nick> -s m4q7z2 --limit 50          # -> ln1, ln2...
bproxy elements -n <nick> -s m4q7z2 --form           # -> el1, el2...

bproxy tab activate -n <nick> -s m4q7z2              # foreground before destructive work if needed
bproxy click -n <nick> -s m4q7z2 --element ln3
bproxy fill -n <nick> -s m4q7z2 --element el2 --value "hello" --method paste --world isolated

bproxy session close -n <nick> -s m4q7z2
```

## Quick commands

**Read:**
`text [--selector] [--after MARKER] [--limit-chars N]` ·
`links [--selector] [--visible-only] [--limit N] [--href-contains S] [--offset N]` ·
`elements [--form]` · `outline` · `dom [--selector] [--depth]` ·
`inspect --selector` · `snapshot [--interactive-only]` ·
`screenshot [--activate] [--output-dir]`

**Act:**
`navigate --url` · `tab activate [--tab tN]` ·
`click --element/--selector` · `hover --element/--selector` ·
`scroll [--element] [--direction up|down] [--by N]` ·
`fill --element --value --method --world` · `fill-form --json` ·
`select --element --option-text` · `wait --strategy --target` ·
`require-human --reason`

**Session/tab:**
`tab open --url` · `tab list` · `tab close [--tab]` · `tab pin [--tab]` · `tab unpin [--tab]` ·
`session create` · `session list` · `session bind --tab tN [--pacing human|fast]` ·
`session resume` · `session close`

`-s <session>` required for browser/session-bound commands. Exceptions: `tab open` may auto-create; `session create/list`, `debug status/last` need no `-s`.

Target exactly one: `--element <elN|lnN>` preferred, or `--selector <css>`, or `--route-json <json>`.
Full table: `references/actions.md`.

## Phase 10 DX notes

- `tab activate` exists. Use it before destructive commands when tab is background. No hidden auto-activation elsewhere.
- `links --href-contains S` filters normalized absolute hrefs, case-sensitive, before limit.
- `links --offset N --limit M` paginates. Result includes `total` and maybe `capped:true`.
- For big pages, page links in chunks; stdout is still one valid JSON object.
- `text --after MARKER` slices CLI output from marker, inclusive. `--limit-chars N` caps text. If marker missing, full text plus `markerFound:false`.

## Fill method

Probe first: `elements --form`, check `runtimeHandle`.

| Target | Method | World |
|--------|--------|-------|
| `<input>`, `<textarea>`, framework controlled | `paste` | `isolated` |
| bare `[contenteditable]` | `direct` | `isolated` |
| rich editor with `runtimeHandle` | `runtime-api` | `main` |

No `auto`. Extension only executes your chosen method. More: `references/fill-methods.md`.

## Human handoff

Cookie banner: use `references/consent.md` selector catalog.  
Login/CAPTCHA/age gate/cross-origin iframe: stop and call:

```bash
bproxy require-human -n <nick> -s <id> --reason "describe blocker"
# after operator resolves
bproxy session resume -n <nick> -s <id>
```

## Gotchas

- Handles `elN`/`lnN` expire on navigation/page change/re-read. Re-read for fresh handles.
- Destructive actions need visible tab. Use `tab activate`; `screenshot --activate` only affects screenshot.
- `scroll` moves viewport unless you pass explicit target. No container guessing.
- `SELECTOR_AMBIGUOUS`: narrow selector or use handle.
- `tmpDir` is session scratch under `BPROXY_HOME`; copy artifacts before `session close`.
- Pacing/rate guards enforced per nick. Avoid fixed-interval loops; respect `retryAfter`.
- No arbitrary eval. Use browser devtools/CDP outside bproxy for runtime investigation.

## Error recovery

| Error | Do |
|-------|----|
| `HUMAN_REQUIRED` | Stop, tell operator, then `session resume`. |
| `ELEMENT_NOT_FOUND` / `ELEMENT_HANDLE_STALE` | Re-read `elements`/`links`. |
| `SESSION_NOT_FOUND` | Gone forever. Open new session. Do not retry old id. |
| `SESSION_SCOPE_MISMATCH` | Wrong nick/session. Do not retry. |
| `RATE_LIMITED` | Wait `details.retryAfter`, retry once. |
| `METRONOME_DETECTED` | Stop fixed loop. Do not retry same pattern. |
| `TAB_NOT_VISIBLE` | `tab activate`, then retry. |
| `NO_EXTENSION` | Ask operator to check extension/pairing. |

Full taxonomy: `references/errors.md`.
