# Actions Reference

All protocol commands require `-n <nick>` (6 chars, `/^[a-z][a-z0-9]{5}$/`).
Browser/session-bound commands require `-s <session>` except noted.
Stdout: exactly one JSON object.

## Read (non-destructive)

| Action | Syntax | Returns / notes |
|--------|--------|-----------------|
| `text` | `text -n <nick> -s <id> [--selector css] [--after S] [--limit-chars N]` | `{ text, markerFound?, markerOffset? }`. `--after`/`--limit-chars` are CLI-local output transforms. |
| `links` | `links -n <nick> -s <id> [--selector css] [--visible-only] [--limit N] [--href-contains S] [--offset N]` | `{ links:[{ text, href, handle?, ... }], total, capped? }`. Hrefs normalized absolute. Filter is case-sensitive substring before limit; offset paginates matches. |
| `images` | `images -n <nick> -s <id> [--selector css]` | `{ images:[{ src, alt, width, height }] }` |
| `elements` | `elements -n <nick> -s <id> [--form]` | `{ elements:[{ tag, type?, label?, value?, handle?, selector, runtimeHandle?, ... }] }` |
| `outline` | `outline -n <nick> -s <id>` | `{ landmarks, headings }` |
| `dom` | `dom -n <nick> -s <id> [--selector css] [--depth N]` | `{ html }` |
| `inspect` | `inspect -n <nick> -s <id> --selector css [--properties p1,p2] [--limit N]` | `{ elements, total }` with rect/styles/scroll info |
| `snapshot` | `snapshot -n <nick> -s <id> [--selector css] [--max-depth N] [--interactive-only]` | `{ tree, nodeCount }` |
| `screenshot` | `screenshot -n <nick> -s <id> [--activate] [--output-dir dir] [--debugger]` | CLI writes file, returns `{ format, file, size }` |

## Act (destructive unless `wait`)

| Action | Syntax | Returns / notes |
|--------|--------|-----------------|
| `navigate` | `navigate -n <nick> -s <id> --url <url>` | `{ url, title, loadTime }` |
| `click` | `click -n <nick> -s <id> --element elN\|lnN` or `--selector css` | `{ clicked, disappeared, stable }` |
| `hover` | `hover -n <nick> -s <id> --element elN\|lnN` or `--selector css` | `{ hovered, stable, elapsed }` |
| `scroll` | `scroll -n <nick> -s <id> [--element elN\|lnN] [--direction up\|down] [--by N]` | `{ moved, before, after, scrolledPx, stable }`. No container inference. |
| `fill` | `fill -n <nick> -s <id> --element elN --value V --method direct\|paste\|runtime-api --world isolated\|main` | `{ filled, verifiedValue }` |
| `fill-form` | `fill-form -n <nick> -s <id> --json '{"fields":[...]}'` | `{ results:[...] }` |
| `select` | `select -n <nick> -s <id> --element elN --option-text T` | `{ selected, optionText }` |
| `wait` | `wait -n <nick> -s <id> --strategy selector\|url\|navigation --target T [--timeout ms]` | `{ matched, elapsed }`; non-destructive |
| `require-human` | `require-human -n <nick> -s <id> --reason "..."` | pauses session until `session resume` |

Targets: `--element` preferred. Use `--route-json` for open shadow roots. Selectors must be unambiguous.

## Tab/session

| Action | Syntax | Notes |
|--------|--------|-------|
| `tab open` | `tab open -n <nick> --url <url> [-s <id>]` | If `-s` omitted, auto-creates session. Returns `{ session, tab, tmpDir, ownerHash }`. |
| `tab list` | `tab list -n <nick> -s <id>` | Session-scoped, daemon-local. |
| `tab activate` | `tab activate -n <nick> -s <id> [--tab tN]` | Foregrounds tab and focuses window. Destructive. |
| `tab close` | `tab close -n <nick> -s <id> [--tab tN]` | Closes tab. |
| `tab pin` | `tab pin -n <nick> -s <id> [--tab tN]` | Pins tab. |
| `tab unpin` | `tab unpin -n <nick> -s <id> [--tab tN]` | Unpins tab. |
| `session create` | `session create -n <nick> [--label text]` | No `-s`. Returns `{ session, tmpDir, ownerHash }`. |
| `session list` | `session list -n <nick>` | No `-s`. Only your nick's sessions. |
| `session bind` | `session bind -n <nick> -s <id> --tab tN [--pacing human\|fast]` | Changes bound tab / pacing. |
| `session resume` | `session resume -n <nick> -s <id>` | Clears paused state. |
| `session close` | `session close -n <nick> -s <id>` | Closes all session tabs, deletes session/tmpDir. |

## Debug

| Action | Syntax | Notes |
|--------|--------|-------|
| `debug status` / `status` | `debug status -n <nick>` | No `-s`. Nick-scoped daemon/WS/session state. |
| `debug last` | `debug last -n <nick> [--count N]` | No `-s`. Nick-scoped daemon ring buffer. |
| `debug log` | `debug log -n <nick> -s <id> [--id ID] [--limit N]` | Extension ring buffer for live nick-scoped session. |
