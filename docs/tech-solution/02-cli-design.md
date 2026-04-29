# 2. CLI Design

[← Index](./README.md) · Prev: [Output Contract](./01-output-contract.md) · Next: [Proxy Service →](./03-proxy-service.md)

---

## Commands

```
bproxy status                        # connection health check
bproxy navigate <url>                # go to URL, wait for load
bproxy click <selector>              # click element
bproxy type <selector> <text>        # clear field, type text
bproxy text [selector]               # read text (default: body)
bproxy images [selector]             # list images with src and alt
bproxy elements                      # list interactive elements
bproxy outline                       # page structure: landmarks + headings
bproxy dom [selector] [--depth N]    # simplified DOM subtree
bproxy screenshot                    # capture visible viewport
bproxy wait [strategy]               # wait for page to be ready
bproxy eval <code>                   # run JS in page context
bproxy tabs                          # list open tabs
bproxy tab <id>                      # switch target tab
```

## `bproxy status`

Returns system health. Agent should call this first if unsure.

```json
{
  "ok": true,
  "data": {
    "proxy": true,
    "extension": true,
    "tab": { "id": 42, "url": "https://example.com", "title": "Example" }
  }
}
```

If extension is disconnected:

```json
{
  "ok": true,
  "data": {
    "proxy": true,
    "extension": false,
    "tab": null
  }
}
```

This is `ok: true` because the command itself succeeded — the proxy answered. The agent reads `extension: false` and knows to wait.

## `bproxy elements`

Returns a flat numbered list of interactive elements visible on the page. This is the primary discovery mechanism for agents that don't know the DOM.

```json
{
  "ok": true,
  "data": {
    "elements": [
      { "index": 1, "tag": "a",      "text": "Sign In",       "selector": "#nav-signin" },
      { "index": 2, "tag": "input",  "text": "",              "selector": "input[name='email']", "placeholder": "Email address" },
      { "index": 3, "tag": "button", "text": "Subscribe",     "selector": ".subscribe-btn" },
      { "index": 4, "tag": "a",      "text": "Documentation", "selector": "a[href='/docs']" }
    ]
  }
}
```

Rules for element collection:
- Only visible, non-hidden elements.
- Tags: `a`, `button`, `input`, `select`, `textarea`, and any element with `role="button"` or `onclick`.
- `selector` is auto-generated with this priority fallback:
  1. `#id` — only if the ID is truly unique on the page (skip duplicate IDs, common in real HTML).
  2. `[data-testid="..."]` — test IDs are the most stable selectors on modern apps.
  3. `[name="..."]` — form element names.
  4. `[aria-label="..."]` — accessibility labels, stable across redesigns.
  5. Shortest unique CSS path — prefer tag + class combos over deeply nested positional paths. Avoid React/Angular dynamic IDs (e.g., `r-abc123`, `ng-c1234`).
- `text` is trimmed, max 80 chars.
- Cap at 200 elements. If more, return `"truncated": true` and suggest the agent narrow scope with `bproxy elements <selector>` (scoped to a container).

## `bproxy images`

Returns a flat list of images on the page. Agents use this to understand visual content, find logos, product images, captchas, or any image-based information.

```json
{
  "ok": true,
  "data": {
    "images": [
      { "index": 1, "src": "https://example.com/logo.png", "alt": "Company Logo", "width": 200, "height": 60, "selector": "img.logo" },
      { "index": 2, "src": "https://example.com/hero.jpg", "alt": "", "width": 1200, "height": 400, "selector": "img.hero-banner" },
      { "index": 3, "src": "https://example.com/chart.png", "alt": "Q4 Revenue Chart", "width": 600, "height": 300, "selector": ".report img:nth-of-type(1)" }
    ]
  }
}
```

Rules for image collection:
- Only visible images with a resolved `src` (skip broken, hidden, or tracking pixels).
- Filter out images smaller than 10×10 px (spacers, trackers).
- `src` is the fully resolved absolute URL.
- `alt` is returned as-is (empty string if missing — agents should note this).
- `width` and `height` are the rendered dimensions, not the natural size.
- `selector` is auto-generated, same strategy as `elements`.
- Optional `[selector]` param scopes the scan to a container: `bproxy images ".product-gallery"`.
- Cap at 100 images. If more, return `"truncated": true`.

## `bproxy outline`

Returns the semantic structure of the page — landmarks and heading hierarchy. This is the agent's first step on an unknown page: understand the layout before interacting.

```json
{
  "ok": true,
  "data": {
    "title": "Acme Corp — Pricing",
    "url": "https://acme.com/pricing",
    "regions": [
      { "tag": "header", "role": "banner",        "selector": "header",       "summary": "Acme Corp logo, nav links" },
      { "tag": "nav",    "role": "navigation",    "selector": "nav.main-nav", "summary": "Home, Products, Pricing, Blog, Contact" },
      { "tag": "main",   "role": "main",          "selector": "main",         "summary": "h1: Pricing Plans, 3 sections" },
      { "tag": "aside",  "role": "complementary", "selector": "aside.faq",    "summary": "h2: FAQ, 5 items" },
      { "tag": "footer", "role": "contentinfo",   "selector": "footer",       "summary": "Copyright, legal links" }
    ],
    "headings": [
      { "level": 1, "text": "Pricing Plans",    "selector": "main h1" },
      { "level": 2, "text": "Starter",          "selector": "#plan-starter h2" },
      { "level": 2, "text": "Professional",     "selector": "#plan-pro h2" },
      { "level": 2, "text": "Enterprise",       "selector": "#plan-enterprise h2" },
      { "level": 2, "text": "FAQ",              "selector": "aside.faq h2" }
    ]
  }
}
```

Region detection:
- **Semantic HTML5 elements**: `<header>`, `<nav>`, `<main>`, `<aside>`, `<article>`, `<section>`, `<footer>`.
- **ARIA landmarks**: any element with `role` attribute (`banner`, `navigation`, `main`, `complementary`, `contentinfo`, `search`, `form`).
- **Fallback heuristics** for pages with no semantic markup: scan for common IDs/classes (`#nav`, `#header`, `.sidebar`, `#content`, `#main`, `.footer`, `#menu`). Report these as regions with `"tag": "div"` and the matched class/id as selector.
- `summary` is auto-generated: first heading inside the region (if any) + first 60 chars of text content + child element count. Keeps the agent oriented without fetching full text.
- Headings (h1–h6) are always collected regardless of landmark quality. Even pages with no landmarks have headings.

Typical agent workflow:
```
1. bproxy outline           → "nav is in nav.main-nav, content is in main"
2. bproxy text main         → get the body copy
3. bproxy elements nav      → get all nav links
```

## `bproxy dom`

Returns a simplified DOM subtree for a given selector at a controlled depth. Used when `outline` doesn't give enough detail — the agent needs to see the shape of a specific region.

```
bproxy dom [selector] [--depth N]
```

Defaults: `selector` = `body`, `depth` = 1.

```json
{
  "ok": true,
  "data": {
    "tree": [
      { "tag": "main", "selector": "main", "children": [
        { "tag": "div", "class": "hero",   "selector": "div.hero",   "text": "Pricing Plans — Choose the plan that...", "childCount": 2 },
        { "tag": "div", "class": "plans",  "selector": "div.plans",  "text": "",                                        "childCount": 3 },
        { "tag": "div", "class": "compare","selector": "div.compare","text": "Compare Features",                          "childCount": 1 }
      ]}
    ]
  }
}
```

Rules:
- At each level, show: `tag`, `class` (if any), `id` (if any), `selector`, `text` (first 80 chars of direct text content, not children), `childCount`.
- At the maximum depth, children are counted (`childCount`) but not expanded. This is the token control mechanism.
- `--depth 0` returns just the selected element's metadata (no children expanded).
- `--depth 1` (default) shows immediate children.
- `--depth 2` shows children and grandchildren. Rarely needed — use scoped selectors instead.
- Skip invisible elements (`display: none`, `visibility: hidden`).
- Skip `<script>`, `<style>`, `<link>`, `<meta>` — structural noise.
- Cap at 500 nodes total in the response. If exceeded, return `"truncated": true`.

This is a progressive disclosure tool. The agent zooms in step by step:
```
1. bproxy dom --depth 1             → see top-level body structure
2. bproxy dom "div.plans" --depth 1  → see what's inside the plans section
3. bproxy text "div.plans > div:nth-child(2)"  → read a specific plan
```

## `bproxy wait`

Explicitly waits for the page to reach a desired state. The agent calls this after actions that trigger async changes — clicking a SPA link, submitting a form, or any action where content loads dynamically.

```
bproxy wait                          # default: wait for DOM to settle
bproxy wait --network                # wait for network idle
bproxy wait --selector ".results"    # wait for element to appear
bproxy wait --hidden ".spinner"      # wait for element to disappear
bproxy wait --state ready            # wait for state to become "ready"
```

Strategies:

| Strategy              | What it waits for                                           | Timeout |
|-----------------------|-------------------------------------------------------------|---------|
| (default / `settle`)  | No DOM mutations for 500ms                                  | 10s     |
| `--network`           | Zero pending fetch/XHR requests for 500ms                   | 30s     |
| `--selector <sel>`    | Element matching selector exists and is visible             | 10s     |
| `--hidden <sel>`      | Element matching selector is gone or invisible              | 10s     |
| `--state ready`       | `page.state` becomes `"ready"` (settle + no busy signals)   | 30s     |

Strategies can be combined: `bproxy wait --network --selector ".results"` waits for both conditions.

Success response:

```json
{
  "ok": true,
  "data": { "waited": 1230, "strategy": "settle" },
  "page": { "url": "...", "title": "...", "state": "ready", "busy": false }
}
```

`waited` is the time in milliseconds the command blocked. Helps the agent gauge page responsiveness.

Timeout response:

```json
{
  "ok": false,
  "error": "WAIT_TIMEOUT",
  "message": "Page did not settle within 10000ms",
  "retry": true,
  "hint": "Page may have continuous updates (animations, live feeds). Use --selector to wait for specific content instead.",
  "page": { "url": "...", "title": "...", "state": "settling", "busy": true }
}
```

The `page` block is included even on timeout — the agent can see what state the page is in and decide whether to retry, try a different strategy, or proceed anyway.

Typical SPA workflow:
```
1. bproxy click "a[href='/dashboard']"   → triggers SPA navigation
   → response includes page.state: "settling"
2. bproxy wait                            → blocks until DOM settles
3. bproxy outline                         → read the new page structure
```

## `bproxy help`

```
bproxy — browser control for coding agents

Commands:
  status                       Check proxy and extension connection
  navigate <url>               Navigate to URL
  click <selector>             Click an element
  type <selector> <text>       Type into an input field
  text [selector]              Extract text content (default: body)
  images [selector]            List images with src and alt text
  elements [selector]          List interactive elements
  outline                      Page structure: landmarks + headings
  dom [selector] [--depth N]   Simplified DOM subtree (default depth: 1)
  wait [strategy]              Wait for page ready (settle, --network, --selector, --hidden)
  screenshot                   Capture visible viewport as base64 PNG
  eval <code>                  Execute JavaScript in page context
  tabs                         List open tabs
  tab <id>                     Switch active target tab

All commands return JSON to stdout.
Errors include an "error" code and "retry" boolean.
```

Printed to stdout, exit 0. Short enough that an agent can consume it in one shot.

## Implementation

The CLI is a single executable Node.js script. It:

1. Parses `process.argv` into `action` + `params`.
2. Sends `POST http://localhost:<PORT>/command` with JSON body `{ id, action, params }`.
3. Prints the response JSON to stdout.
4. Exits with code 0 or 1.

Connection errors (proxy not running) are caught and formatted as JSON with `PROXY_NOT_RUNNING` error code, not as stack traces.

Timeout: the CLI sets a 30s HTTP timeout (60s for `navigate`). If exceeded, it prints `EXTENSION_TIMEOUT` error and exits 1.
