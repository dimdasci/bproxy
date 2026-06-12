# LinkedIn navigation findings — `display: contents` visibility bug

Date: 2026-06-12
Status: **resolved** (fix landed + `inspect`/`snapshot` commands implemented)

## Root cause

LinkedIn uses `display: contents` CSS on 75+ wrapper divs. These elements have zero `getBoundingClientRect()` but their children are fully visible.

bproxy's `isElementVisible()` → `hasZeroRect()` treated them as hidden → entire content subtrees (2K+ descendants, 15K+ chars) were pruned during recursive traversal.

## Fix applied

**`extension/src/content/dom-helpers.ts`** — `hasZeroRect()` now checks computed style before checking rect:

```ts
function hasZeroRect(element: Element): boolean {
  const style = getComputedStyleSafe(element);
  if (style?.display === 'contents') return false;  // layout-transparent, not hidden
  const rect = element.getBoundingClientRect();
  return Boolean(rect && rect.width <= 0 && rect.height <= 0);
}
```

**`extension/src/content/discovery.ts`** — `readValue()` skips `.value` for `<button>` elements (spec default is `""`, was preventing `textContent` fallback).

## Result

- `bproxy text` on LinkedIn profile: 282 chars → **20,791 chars** ✅
- `bproxy elements` button labels: 187 → **236** elements with text ✅

## Why `outline` and `elements` worked before the fix

`walkComposedElements` (BFS flat walker) unconditionally enqueues children before the outer loop filters by visibility. The `display: contents` div was skipped but its children were already queued.

## LinkedIn page structure

```
main [scrollable]
└── div → div (CSS grid)
    ├── section[aria-label="Primary content"]
    │   └── div (display: contents, rect=0×0, descendants=2273, textLen=15116)
    │       └── div[data-testid="lazy-column"] (flex, 792×2487)
    │           ├── profile header
    │           ├── Analytics + About + Featured (grouped in one div)
    │           ├── Activity
    │           ├── Experience + Education (grouped, lazy-loaded)
    │           └── Skills, Recommendations, Languages, Interests
    ├── aside[aria-label="Aside"]
    └── footer[aria-label="Footer"]
```

Key traits:
- Multiple visual sections grouped into single DOM containers
- Content 8-12 wrappers deep inside `display: contents` parent
- Sections below fold are lazy-loaded on scroll
- `aria-label` values are locale-dependent
- `main` is the scroll container (html/body have `overflow: hidden`)

## New diagnostic commands (implemented same day)

- **`bproxy inspect --selector "..."` ** — returns rect, computed styles, descendant count, textLength per element. Would have instantly revealed: `display=contents, rect=0×0, descendants=2273, textLen=15116`.
- **`bproxy snapshot --maxDepth 12`** — accessibility tree sensor immune to CSS layout tricks. Walks DOM structure + ARIA semantics, never checks `getBoundingClientRect()`.
