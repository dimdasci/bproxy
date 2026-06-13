# Element handles for read → act workflows

**Date:** 2026-06-13  
**Context:** Production browser test on BCG and McKinsey after adding `click` / `hover`.

## Observation

The largest remaining UX gap is not the absence of interaction primitives. `click` and `hover` worked on live sites.

The main friction is **targeting**:
- `elements` / `links` output is large and noisy
- follow-up actions require brittle raw selectors
- exploration-heavy tasks require too much selector juggling across commands
- multi-step read → act flows feel prototype-like even when the underlying primitives succeed

## Request

Add first-class **short-lived page-scoped element handles** for read → act workflows.

Example:

```bash
bproxy elements -s <id>
# returns items with handles like e17, e18, ...

bproxy click -s <id> --element e17
bproxy hover -s <id> --element e18
bproxy fill -s <id> --element e21 --value "..." --method paste --world isolated
```

## Non-goal

These handles are **not** native DOM attributes and must **not** be injected into the page.

Rejected shape:

```html
<button data-bproxy-id="e17">...</button>
```

Why reject it:
- mutates the page
- visible to page JavaScript
- increases detection surface
- breaks the thin-extension / honest-sensor-actuator boundary

## Proposed design

### Extension responsibilities

Keep the extension thin:
- return normal read results
- optionally include a daemon-consumable `ElementTarget`
- continue resolving explicit targets for `click` / `hover` / `fill` / `select`
- keep no long-lived cross-command element identity

### Daemon responsibilities

Make the daemon the helper hand:
- mint opaque handles such as `e17`
- store a short-lived mapping from handle → `ElementTarget`
- scope handles to `{session, tab, page}`
- invalidate on navigation / page change / TTL expiry
- resolve `--element e17` back into the normal explicit target before forwarding

Illustrative shape:

```ts
type ElementHandleEntry = {
  handle: string;
  session: SessionId;
  tab: TabHandle;
  url: string;
  pageFingerprint: string;
  target: ElementTarget;
  createdAt: number;
  hints?: {
    text?: string;
    tag?: string;
    role?: string;
  };
};
```

## Why this fits bproxy

This improves agent DX without violating the project boundary:
- extension remains lightweight
- no page-visible instrumentation
- no strategy moved into the extension
- daemon-owned short-lived state is consistent with existing session / tab / pacing ownership

In short:

> Keep the extension thin; let the daemon carry the helpful memory.

## Expected benefit

This would likely do more to close the gap toward a polished daily-driver tool than adding another raw primitive, because it directly improves:
- exploration speed
- action chaining
- selector stability
- ergonomics of real browsing tasks
