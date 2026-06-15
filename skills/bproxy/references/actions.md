# Actions Reference

## Read (non-destructive)

| Action | Syntax | Key params | Returns |
|--------|--------|------------|---------|
| `text` | `text [-s] [--selector css]` | selector (default: body) | `{ text }` |
| `links` | `links [-s] [--selector] [--limit N]` | selector?, limit? | `{ links: [{ text, href, handle?, ... }] }` |
| `images` | `images [-s] [--selector]` | selector? | `{ images: [{ src, alt, width, height }] }` |
| `elements` | `elements [-s] [--form]` | form? | `{ elements: [{ tag, type?, label?, value?, handle?, selector, runtimeHandle?, ... }] }` |
| `outline` | `outline [-s]` | — | `{ landmarks, headings }` |
| `dom` | `dom [-s] [--selector] [--depth N]` | selector?, depth (default:3) | `{ html }` |
| `inspect` | `inspect [-s] --selector [--properties] [--limit]` | selector, properties?, limit? | `{ elements: [{ rect, scroll, styles }] }` |
| `snapshot` | `snapshot [-s] [--selector] [--max-depth] [--interactive-only]` | selector?, maxDepth?, interactiveOnly? | `{ tree }` |
| `screenshot` | `screenshot [-s] [--activate] [--output-dir] [--debugger]` | activate?, outputDir? | `{ format, file, size }` |

## Write (destructive)

| Action | Syntax | Key params | Returns |
|--------|--------|------------|---------|
| `navigate` | `navigate [-s] --url <url>` | url | `{ url, title, loadTime }` |
| `click` | `click [-s] --element/--selector` | target | `{ clicked, disappeared, stable }` |
| `hover` | `hover [-s] --element/--selector` | target | `{ hovered, stable, elapsed }` |
| `scroll` | `scroll [-s] [--element] [--direction] [--by]` | target?, direction?, by? | `{ moved, before, after, scrolledPx }` |
| `fill` | `fill [-s] --element --value --method --world` | target, value, method, world | `{ filled, verifiedValue }` |
| `fill-form` | `fill-form [-s] --json '{fields:[...]}'` | fields[] | `{ results[] }` |
| `select` | `select [-s] --element --option-text` | trigger, optionText | `{ selected, optionText }` |
| `wait` | `wait [-s] --strategy --target [--timeout]` | strategy (selector/url/navigation), target | `{ matched, elapsed }` |
| `require-human` | `require-human [-s] --reason "..."` | reason | pauses session |

## Tab/Session

| Action | Syntax | Notes |
|--------|--------|-------|
| `tab open` | `tab open --url <url> [-s]` | Auto-creates session if `-s` omitted. Returns `{ session, tab, tmpDir }` |
| `tab close` | `tab close [-s] [--tab tN]` | |
| `tab list` | `tab list [-s]` | Session-scoped, daemon-local |
| `tab pin` | `tab pin [-s] [--tab tN]` | |
| `session create` | `session create [--label]` | Returns `{ session, tmpDir }` |
| `session bind` | `session bind [-s] --tab tN [--pacing human\|fast]` | Switch active tab |
| `session resume` | `session resume [-s]` | Clear paused state |
| `session close` | `session close [-s]` | Closes all tabs, destroys session |

## Debug

| Action | Syntax | Notes |
|--------|--------|-------|
| `debug status` | `debug status` | Full daemon/WS/session state |
| `debug last` | `debug last [--count N]` | Daemon ring buffer (last 200) |
| `debug log` | `debug log [--id] [--limit]` | Extension ring buffer |
