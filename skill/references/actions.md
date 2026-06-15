# Actions Reference

Complete action catalog for bproxy. Each action is a single CLI command that maps to one daemon POST and one JSON response.

## Read actions (non-destructive)

### `text`

Extract page text content.

```bash
bproxy text -s <id> [--selector <css>]
```

**Params:** `selector` (default: `body`)
**Response:** `{ text: string }`

### `links`

Extract structured visible links.

```bash
bproxy links -s <id> [--selector <css>] [--visible-only] [--limit N]
```

**Params:** `selector?`, `visibleOnly?` (set by `--visible-only`), `limit?`
**Response:** `{ links: LinkInfo[] }`

Each link: `{ text, href, handle?, title?, rel?, targetAttr?, visible? }`

### `images`

Extract visible images.

```bash
bproxy images -s <id> [--selector <css>]
```

**Params:** `selector?`
**Response:** `{ images: ImageInfo[] }`

### `elements`

List interactive elements with metadata.

```bash
bproxy elements -s <id> [--form]
```

**Params:** `form?` (filter to form fields only)
**Response:** `{ elements: ElementInfo[] }`

Each element: `{ tag, type?, label?, value?, placeholder?, required?, role?, handle?, selector, route?, hasShadowRoot?, runtimeHandle?, options? }`

### `outline`

Page landmarks and heading hierarchy.

```bash
bproxy outline -s <id>
```

**Response:** `{ landmarks: Landmark[], headings: Heading[] }`

### `dom`

Simplified DOM subtree.

```bash
bproxy dom -s <id> [--selector <css>] [--depth N]
```

**Params:** `selector?`, `depth?` (default: 3)
**Response:** `{ html: string }`

### `inspect`

Computed styles, layout, and scroll info.

```bash
bproxy inspect -s <id> --selector <css> [--properties <list>] [--limit N]
```

**Params:** `selector`, `properties?`, `limit?`
**Response:** `{ elements: InspectElement[] }`

### `snapshot`

Accessible DOM tree serialization.

```bash
bproxy snapshot -s <id> [--selector <css>] [--max-depth N] [--interactive-only]
```

**Params:** `selector?`, `maxDepth?`, `interactiveOnly?`
**Response:** `{ tree: string }`

### `screenshot`

Capture the visible tab area.

```bash
bproxy screenshot -s <id> [--output-dir <dir>] [--activate] [--debugger]
```

**Response (with --output-dir or default tmpDir):** `{ format: "png", file: "/path/to/file.png", size: 12345 }`

## Write actions (destructive)

### `navigate`

Navigate to a URL and wait for load.

```bash
bproxy navigate -s <id> --url <url>
```

**Params:** `url`
**Response:** `{ url, title, loadTime }`

### `click`

Click a resolved element target.

```bash
bproxy click -s <id> --element <handle>
bproxy click -s <id> --selector <css>
```

**Params:** `target` (ElementTarget or handle)
**Response:** `{ clicked: true, disappeared: boolean, stable: boolean }`

### `hover`

Hover a resolved element target.

```bash
bproxy hover -s <id> --element <handle>
```

**Params:** `target`
**Response:** `{ hovered: true, stable: boolean, elapsed: number }`

### `scroll`

Scroll viewport or specific element.

```bash
bproxy scroll -s <id> [--element <handle>] [--direction up|down] [--by N]
```

**Params:** `target?`, `direction?`, `by?`
**Response:** `{ moved: boolean, before: number, after: number, scrolledPx: number }`

### `fill`

Fill a single field.

```bash
bproxy fill -s <id> --element <handle> --value <v> --method <direct|paste|runtime-api> --world <isolated|main>
```

**Params:** `target`, `value`, `method`, `world`
**Response:** `{ filled: boolean, verifiedValue: string }`

### `fill-form`

Bulk fill multiple fields in one round-trip.

```bash
bproxy fill-form -s <id> --json '{"fields":[...]}'
```

**Params:** `fields: { target, value, method, world }[]`
**Response:** `{ results: { target, filled: boolean, verifiedValue: string }[] }`

### `select`

Select a dropdown option.

```bash
bproxy select -s <id> --element <handle> --option-text <text>
```

**Params:** `trigger`, `optionText`
**Response:** `{ selected: boolean, optionText: string }`

### `wait`

Wait for a condition before proceeding.

```bash
bproxy wait -s <id> --strategy <selector|url|navigation> --target <value> [--timeout N]
```

**Params:** `strategy`, `target`, `timeout?`
**Response:** `{ matched: boolean, elapsed: number }`

### `require-human`

Signal that human intervention is needed.

```bash
bproxy require-human -s <id> --reason "CAPTCHA detected"
```

**Params:** `reason`, `forAttach?`
**Response:** pauses the session; resumes on `session resume`

## Tab management

### `tab.open`

```bash
bproxy tab open --url <url> [-s <id>]
```

Creates a new tab (and optionally a new session). Returns `{ session, tab, bound, url, tmpDir }`.

### `tab.close`

```bash
bproxy tab close -s <id> [--tab tN]
```

### `tab.list`

```bash
bproxy tab list -s <id>
```

Returns only tabs owned by the session. Daemon-local (no extension needed).

## Session management

### `session.create`

```bash
bproxy session create [--label <text>]
```

### `session.list`

```bash
bproxy session list
```

### `session.bind`

```bash
bproxy session bind -s <id> --tab tN [--pacing human|fast]
```

### `session.resume`

```bash
bproxy session resume -s <id>
```

### `session.close`

```bash
bproxy session close -s <id>
```

## Debug commands

### `debug.status`

```bash
bproxy debug status
```

Full system state: daemon, WS clients, sessions, tab ownership, paused state.

### `debug.last`

```bash
bproxy debug last [--count N]
```

Daemon trace ring buffer (last N requests).

### `debug.log`

```bash
bproxy debug log [--id <requestId>] [--limit N]
```

Extension ring buffer query.
