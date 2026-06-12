# LinkedIn navigation with bproxy

Date: 2026-06-12 (updated after inspect/snapshot implementation)

## Quick reference

| Goal | Command |
|------|---------|
| Navigate | `bproxy navigate --url "https://www.linkedin.com/..." -s <id>` |
| Page map | `bproxy outline -s <id>` |
| Full text | `bproxy text -s <id>` (14K+ chars on profiles) |
| Scoped text | `bproxy text --selector "section[aria-label='Primary content']" -s <id>` |
| Acc. tree | `bproxy snapshot --selector "section[aria-label='Primary content']" --maxDepth 12 -s <id>` |
| Diagnose layout | `bproxy inspect --selector "section > div" -s <id>` |
| Links | `bproxy links -s <id>` |
| Elements | `bproxy elements -s <id>` |
| Scroll | `bproxy scroll --direction down -s <id>` |
| Screenshot | `bproxy screenshot -s <id>` |

## Key patterns

### Scroll container

LinkedIn sets `overflow: hidden` on html/body. The scroll container is `main` (it auto-detects). Standard viewport scroll works via bproxy.

### Lazy loading

Sections below the fold load on scroll. Scroll down and re-check with `outline` to confirm sections appeared before reading them.

### Deep wrapper nesting

LinkedIn nests content 8-12 div wrappers deep inside `display: contents` parents. When using `snapshot`:
- Use `--maxDepth 12` to reach semantic elements
- Scope to `section[aria-label='Primary content']` to avoid wasting depth on page chrome

### Diagnosing extraction issues

If `text` returns suspiciously little content, use `inspect` to diagnose:

```bash
bproxy inspect --selector "section[aria-label='Primary content'] > div" -s <id>
```

Look for: `display=contents` + `rect=0x0` + high `descendants`/`textLength` → the wrapper is layout-transparent, not hidden.

### Locale dependency

`aria-label` values are locale-dependent ("Primary content" in English, "Contenido principal" in Spanish). Use `outline` to discover actual headings, don't hardcode labels.

## LinkedIn DOM structure

```
main [scrollable]
└── div
    └── div (CSS grid)
        ├── section[aria-label="Primary content"]
        │   └── div (display: contents)        ← zero rect, but 2K+ descendants
        │       └── div[data-testid="lazy-column"] (flex, actual content)
        │           ├── profile header
        │           ├── Analytics + About + Featured (grouped)
        │           ├── Activity
        │           ├── Experience + Education (grouped, lazy-loaded)
        │           └── Skills, Recommendations, etc.
        ├── aside[aria-label="Aside"]
        └── footer[aria-label="Footer"]
```

Multiple visual sections are grouped into single DOM containers.

## Example workflows

### Read a profile

```bash
bproxy navigate --url "https://www.linkedin.com/in/<slug>/" -s <id>
bproxy outline -s <id>                    # see loaded sections
bproxy scroll --direction down -s <id>    # load lazy content
bproxy text -s <id>                       # full text (14K+ chars)
```

### Search and open a job posting

```bash
bproxy navigate --url "https://www.linkedin.com/jobs/search/?keywords=delivery%20lead" -s <id>
bproxy links -s <id>                      # find /jobs/view/ links
bproxy navigate --url "<job-url>" -s <id>
bproxy text --selector "section[aria-label='Primary content']" -s <id>
```

### Diagnose a broken page

```bash
bproxy outline -s <id>                    # shows 10+ headings?
bproxy text -s <id>                       # <500 chars? → something wrong
bproxy inspect --selector "main > *" -s <id>  # check display, descendants, textLength
bproxy snapshot --maxDepth 12 -s <id>     # CSS-immune semantic view
```
