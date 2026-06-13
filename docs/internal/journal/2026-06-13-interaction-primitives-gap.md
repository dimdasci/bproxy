# Interaction primitives gap — click, dismiss, activate

**Date:** 2026-06-13  
**Context:** Production test after Sonar tech-debt cleanup. Task: read BCG LinkedIn posts and homepage, compare messaging.

## Observation

Reading worked flawlessly — `text`, `links`, `elements`, `scroll` are reliable and agent-friendly. But a cookie consent modal on bcg.com exposed a gap: bproxy has no native way to click an arbitrary visible element.

The workaround was to abuse `select` (designed for dropdowns) for its side-effect of clicking a trigger element. This "worked" but:
- Returned an error because the modal self-destructed and broke the response channel
- Required knowledge of internal implementation to know the click fires before the option poll
- An autonomous agent would interpret the error as failure

## What's needed

Keeping bproxy as a **light sensor/actuator** (not a browser automation framework), the minimal interaction primitives for real-world information discovery are:

| Primitive | Purpose | Examples |
|-----------|---------|----------|
| **click** | Activate any visible element | Dismiss modals, expand accordions, follow links without navigation, toggle tabs |
| **hover** | Trigger hover-dependent content | Tooltips, mega-menus, preview cards |
| **type** | Keystroke-level input (distinct from fill) | Search boxes that filter on keyup, autocomplete triggers |

### Design constraints (sensor/actuator principle)

- **click** should be a single action: resolve target → assert visible → dispatch pointer/click events → return success/failure. If the element disappears post-click, that's success, not an error.
- **hover** dispatches mouseenter/mouseover, waits briefly for DOM mutation, returns.
- **type** sends individual keydown/keypress/keyup events character by character (for cases where `fill` value-setting is blocked or the UI reacts per-keystroke).
- All three accept the same targeting as `fill`/`select`: `--selector` or `--route-json` for shadow DOM.
- None should carry "smart" retry logic or multi-step flows — the agent orchestrates sequences.

### Why not extend `fill` or `select`?

- `fill` semantics = "set a form field's value." Overloading it to mean "click" breaks agent expectations.
- `select` semantics = "choose from a dropdown." Using it for arbitrary clicks is a hack that produces confusing errors.
- Distinct verbs (`click`, `hover`, `type`) map 1:1 to agent intent, making tool-use decisions trivial.

## Priority

**click** alone would resolve 90% of the interaction gap encountered in real browsing tasks (cookie banners, "show more" buttons, tab panels, accordion expanders). `hover` and `type` are lower priority but round out the set for complex information discovery.
