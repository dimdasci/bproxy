# Actions Reference

All commands require `-n <nick>` (agent nickname, 6 chars, e.g. `halbot`).
All browser commands require `-s <session>` except where noted.

## Read (non-destructive)

| Action | Syntax | Key params | Returns |
|--------|--------|------------|---------|
| `text` | `text -n <nick> -s <id> [--selector css]` | selector (default: body) | `{ text }` |
| `links` | `links -n <nick> -s <id> [--selector] [--limit N]` | selector?, limit? | `{ links: [{ text, href, handle?, ... }] }` |
| `images` | `images -n <nick> -s <id> [--selector]` | selector? | `{ images: [{ src, alt, width, height }] }` |
| `elements` | `elements -n <nick> -s <id> [--form]` | form? | `{ elements: [{ tag, type?, label?, value?, handle?, selector, runtimeHandle?, ... }] }` |
| `outline` | `outline -n <nick> -s <id>` | — | `{ landmarks, headings }` |
| `dom` | `dom -n <nick> -s <id> [--selector] [--depth N]` | selector?, depth (default:3) | `{ html }` |
| `inspect` | `inspect -n <nick> -s <id> --selector [--properties] [--limit]` | selector, properties?, limit? | `{ elements: [{ rect, scroll, styles }] }` |
| `snapshot` | `snapshot -n <nick> -s <id> [--selector] [--max-depth] [--interactive-only]` | selector?, maxDepth?, interactiveOnly? | `{ tree }` |
| `screenshot` | `screenshot -n <nick> -s <id> [--activate] [--output-dir] [--debugger]` | activate?, outputDir? | `{ format, file, size }` |

## Write (destructive)

| Action | Syntax | Key params | Returns |
|--------|--------|------------|---------|
| `navigate` | `navigate -n <nick> -s <id> --url <url>` | url | `{ url, title, loadTime }` |
| `click` | `click -n <nick> -s <id> --element/--selector` | target | `{ clicked, disappeared, stable }` |
| `hover` | `hover -n <nick> -s <id> --element/--selector` | target | `{ hovered, stable, elapsed }` |
| `scroll` | `scroll -n <nick> -s <id> [--element] [--direction] [--by]` | target?, direction?, by? | `{ moved, before, after, scrolledPx }` |
| `fill` | `fill -n <nick> -s <id> --element --value --method --world` | target, value, method, world | `{ filled, verifiedValue }` |
| `fill-form` | `fill-form -n <nick> -s <id> --json '{fields:[...]}'` | fields[] | `{ results[] }` |
| `select` | `select -n <nick> -s <id> --element --option-text` | trigger, optionText | `{ selected, optionText }` |
| `wait` | `wait -n <nick> -s <id> --strategy --target [--timeout]` | strategy (selector/url/navigation), target | `{ matched, elapsed }` |
| `require-human` | `require-human -n <nick> -s <id> --reason "..."` | reason | pauses session |

## Tab/Session

| Action | Syntax | Notes |
|--------|--------|-------|
| `tab open` | `tab open -n <nick> --url <url> [-s]` | Auto-creates session if `-s` omitted. Returns `{ session, tab, tmpDir, ownerHash }` |
| `tab close` | `tab close -n <nick> -s <id> [--tab tN]` | |
| `tab list` | `tab list -n <nick> -s <id>` | Session-scoped, daemon-local |
| `tab pin` | `tab pin -n <nick> -s <id> [--tab tN]` | |
| `session create` | `session create -n <nick> [--label]` | Returns `{ session, tmpDir, ownerHash }`. No `-s` needed. |
| `session list` | `session list -n <nick>` | Returns only sessions owned by this nick. No `-s` needed. |
| `session bind` | `session bind -n <nick> -s <id> --tab tN [--pacing human\|fast]` | Switch active tab |
| `session resume` | `session resume -n <nick> -s <id>` | Clear paused state |
| `session close` | `session close -n <nick> -s <id>` | Closes all tabs, destroys session |

## Debug

| Action | Syntax | Notes |
|--------|--------|-------|
| `debug status` | `debug status -n <nick>` | Daemon/WS/session state (nick-scoped). No `-s` needed. |
| `debug last` | `debug last -n <nick> [--count N]` | Daemon ring buffer, nick-scoped. No `-s` needed. |
| `debug log` | `debug log -n <nick> -s <id> [--id] [--limit]` | Extension ring buffer, nick-scoped |
