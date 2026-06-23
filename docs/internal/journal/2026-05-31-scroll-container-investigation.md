# Scroll container investigation — authenticated feed

> **Course correction (2026-06-12):** This investigation is now considered a documented deviation from the intended bproxy path. The useful finding is not “teach bproxy to infer the right scroll container”; it is that page-structure investigation and scroll-target choice belong to the agent, with normal browser debugging tools available when needed. bproxy should expose explicit scroll actuator primitives and honest movement/no-op reporting, not generalized page-layout heuristics.

Date: 2026-05-31
Status: superseded by course correction on 2026-06-12

## Context

Following the scroll false-success bug documented in
`the 2026-05-30 scroll/eval findings note`, this session investigated why
`window.scrollBy()` has no effect on the target site and what the correct approach to
finding the real scroll container is.

## Finding 1 — `window.scrollBy()` is never the right target on the authenticated feed page

the target site's feed page does not scroll at the window/viewport level.
`window.scrollY` stays at 0 regardless of how many times `window.scrollBy()` is
called. The actual scroll container is a `<main id="workspace">` element deep in
the React tree.

Confirmed via `dev-browser --connect http://localhost:9222` + `page.evaluate()`:

```
<main id="workspace">
  overflowY:    scroll
  scrollHeight: 5479
  clientHeight: 1020
```

This is not a the target site quirk — it is the standard pattern for any React SPA that
uses a persistent nav/sidebar layout: `overflow: hidden` on `<html>` and
`<body>`, a full-height scrollable `<main>` or equivalent container div.

## Finding 2 — the correct algorithm is `elementFromPoint` + ancestor walk

`document.elementFromPoint(innerWidth/2, innerHeight/2)` returns the leaf element
at the center of the viewport. Walking up its ancestor chain with
`getComputedStyle(el).overflowY` and `el.scrollHeight > el.clientHeight` finds
the real scroll container.

On the target site this walk went through 15 ancestors (IMG → FIGURE → A → … → MAIN)
before finding `<main id="workspace">`.

This approach is correct because:
- The element at the center of the viewport is guaranteed to be inside the scroll
  container that owns the main content.
- The walk is O(depth), not O(DOM size) — no subtree scanning needed.

Walking **down** from `body` (the approach implemented during this session) is
wrong. Many elements have `scrollHeight > clientHeight` when their overflow is
`visible` or `hidden` — content spills out but the element cannot be scrolled.
Checking `overflowY: scroll|auto` is necessary, but even then a downward walk
hits the wrong container first on pages with multiple scrollable regions.

## Finding 3 — pages can have multiple scroll containers

`elementFromPoint` returns one point, which belongs to one scroll container. On
the target site there are at least: the main feed (`<main id="workspace">`), the
messaging panel, comment threads inside posts. If the center point lands inside
one of the smaller containers, the ancestor walk returns that container instead of
the main feed.

No universal heuristic resolves ambiguity across all pages. The practical design
is:
- Default: `elementFromPoint(innerWidth/2, innerHeight/2)` + ancestor walk —
  handles the common case where main content occupies the center of the viewport.
- Explicit: agent supplies a CSS selector for the scroll container when the
  default heuristic is insufficient.

The `scroll` action API should expose this as an optional `--container` (or
`--selector`) parameter.

## Finding 4 — backgrounded tab prevents React from rendering the feed

When the tab opened by `tab open` is not the active foreground tab in Chrome,
the target site's JavaScript does not render feed posts. `text` returned only 268 chars
(skip-navigation links) even after 8 seconds, while a screenshot of the already-
loaded tab in the same Chrome window showed a full feed. The content script and
the screenshot were targeting different tabs.

Any smoke run or diagnostic that reads page content must ensure the target tab is
the active foreground tab before reading.

## Finding 5 — `dev-browser` is the right tool for DOM investigation

`dev-browser --connect http://localhost:9222` with `page.evaluate()` gives direct
access to `getComputedStyle`, `scrollHeight`, `clientHeight`, and
`elementFromPoint` in the real page context. This answered in one script what
would have taken many bproxy commands to approximate (and still would not have
been conclusive without computed style data).

Use `dev-browser` first when investigating page structure or diagnosing why a
content-script action is not behaving as expected.

## Superseded implementation direction

The original implementation direction in this note was to replace the existing fallback with `elementFromPoint` + ancestor walk and an optional container selector. That direction is now partially rejected.

Corrected conclusion:

- bproxy should not infer the “right” scroll container with generalized page-layout heuristics;
- the agent should choose whether to scroll the viewport/document, a specific container, a modal, a panel, or another target;
- browser debugging tools such as CDP are the right place for page-structure investigation;
- bproxy should provide explicit scroll primitives and return honest before/after movement data;
- false success (`ok: true` with no movement) still needs to be fixed.
