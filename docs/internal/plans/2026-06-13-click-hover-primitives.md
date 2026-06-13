# Temporary increment plan — click and hover interaction primitives

**Date:** 2026-06-13  
**Branch:** `feature/click-hover-primitives`  
**Status:** Temporary planning artifact for this increment  
**Scope:** Add explicit `click` and `hover` actuator primitives. Do **not** add `type` in this increment.

## Prerequisite reading before implementation

Read these documents before changing code:

- [`docs/internal/decisions.md`](../decisions.md) — current ADR set, especially ADR-001, ADR-006, ADR-007, ADR-014, ADR-017, and ADR-024.
- [`docs/internal/architecture.md`](../architecture.md) — architecture principles and action catalog.
- [`docs/public/index.md`](../../public/index.md) — public problem statement and design principles.
- [`docs/public/views/02-containers.md`](../../public/views/02-containers.md) — canonical container view.
- [`docs/public/views/06-threat-model.md`](../../public/views/06-threat-model.md) — extension/security surface constraints.
- [`docs/public/solution/shared.md`](../../public/solution/shared.md) — shared action contract.
- [`docs/public/solution/cli.md`](../../public/solution/cli.md) — CLI command and destructive-action contract.
- [`docs/public/solution/service.md`](../../public/solution/service.md) — daemon routing, schema, pacing, and session contract.
- [`docs/public/solution/extension.md`](../../public/solution/extension.md) — extension execution model and DOM-action handling.

## Boundary decision

The journal request is accepted only for `click` and `hover`.

- `click` is a narrow actuator: resolve one agent-supplied target, assert it is visible/actionable, activate it, and report what happened.
- `hover` is a narrow actuator: resolve one agent-supplied target, assert it is visible/actionable, dispatch hover-shaped events, wait briefly using existing bounded jittered polling, and report completion.
- `type` is intentionally excluded because it would weaken ADR-007's three-method write contract and introduce synthetic key-event write semantics.

Non-goals:

- No generic `dismiss` / cookie-banner solver.
- No click-by-text search, modal detection, or element-choice strategy inside the extension.
- No arbitrary eval.
- No MAIN-world execution.
- No `MutationObserver`.
- No retry/escalation chain or fallback from `click` to another method.

## Proposed protocol contract

Add two shared actions:

```ts
export type Action = ... | "click" | "hover" | ...;

interface ActionParams {
  click: { target: ElementTarget };
  hover: { target: ElementTarget };
}

interface ActionResult {
  click: {
    clicked: true;
    disappeared: boolean;
    stable: boolean;
  };
  hover: {
    hovered: true;
    stable: boolean;
    elapsed: number;
  };
}
```

Notes:

- Both use the existing `ElementTarget` contract (`selector` or `route`) and therefore inherit open-shadow-root targeting.
- A target that disappears after `click` is a successful result, not an error.
- `stable: false` means the action was dispatched but the page did not settle within the small bounded wait; it is not a protocol error.
- Errors remain reserved for pre-dispatch failures such as `ELEMENT_NOT_FOUND`, `ELEMENT_NOT_ACTIONABLE`, `TAB_NOT_VISIBLE`, or unexpected `SCRIPT_ERROR`.

## Implementation tasks

### 1. Document the boundary first

- [ ] Add ADR-026: **Explicit click/hover actuator primitives**.
  - Accept `click` and `hover` as sensor/actuator-compatible primitives.
  - Explicitly reject `type` for now as a write-contract expansion.
  - Record constraints: explicit target only, no strategy, no eval, no MAIN world, no MutationObserver.
- [ ] Update `docs/internal/architecture.md` action table and principles.
- [ ] Update public docs:
  - [ ] `docs/public/index.md` — narrow interface becomes read, scroll, fill, select, click, hover, navigate.
  - [ ] `docs/public/solution/shared.md` — action params/results.
  - [ ] `docs/public/solution/cli.md` — command surface and destructive classification.
  - [ ] `docs/public/solution/service.md` — schema/routing/pacing updates.
  - [ ] `docs/public/solution/extension.md` — DOM action handling and event semantics.
  - [ ] `docs/public/views/02-containers.md` / `06-threat-model.md` only if wording needs capability-surface clarification.

### 2. Shared protocol types

Files:

- `shared/src/actions.ts`
- `shared/src/index.ts` if exports need adjustment
- shared tests / compile assertions

Tasks:

- [ ] Add `"click"` and `"hover"` to `Action`.
- [ ] Add `ActionParams.click` and `ActionParams.hover` using `ElementTarget`.
- [ ] Add `ActionResult.click` and `ActionResult.hover`.
- [ ] Add or update compile-time assertions so missing consumers fail loudly.

### 3. Daemon schema, routing, and pacing

Files:

- `service/src/schemas.ts`
- `service/src/pacing.ts`
- `shared/src/sessions.ts`
- daemon tests under `service/src/__tests__/`

Tasks:

- [ ] Add `click` and `hover` to `ACTIONS`.
- [ ] Add strict Zod schemas:
  - `click: { target: elementTarget }`
  - `hover: { target: elementTarget }`
- [ ] Add an `interaction` pacing bucket to `PacingConfig` and `PACING_PRESETS`, or intentionally map both actions to the existing `fill` pacing bucket if the increment should stay smaller.
  - Preferred: add `interaction` with human defaults close to fill pacing, e.g. `500–2000ms`, and fast defaults `100–400ms`.
- [ ] Update `pacingKey` so `click` and `hover` are daemon-paced.
- [ ] Keep routing unchanged: both actions are forwarded DOM actions and require a bound visible tab.
- [ ] Update schema and pacing tests.

### 4. CLI commands

Files:

- `cli/src/commands/click.ts` — new
- `cli/src/commands/hover.ts` — new
- `cli/src/bproxy.ts`
- `cli/src/command-registry.ts`
- CLI tests under `cli/src/__tests__/`

Command shape:

```bash
bproxy click --selector <css>
bproxy click --route-json '<json>'
bproxy hover --selector <css>
bproxy hover --route-json '<json>'
```

Tasks:

- [ ] Parse targets with existing `targets.ts`, matching `fill` / `select` target rules.
- [ ] Use `sendAction("click", { target }, globals)` and same for `hover`.
- [ ] Register commands at the top level.
- [ ] Mark both as destructive in `command-registry.ts`.
- [ ] Add command parsing/output tests.
- [ ] Update action coverage tests.

### 5. Extension background and content routing

Files:

- `extension/src/background/forwarded-actions.ts`
- `extension/src/content/rpc.ts`
- `extension/src/entrypoints/content.ts`
- `extension/src/content/actions/interactions.ts` — new
- `extension/src/content/events.ts`
- extension tests under `extension/src/content/__tests__/` and `extension/src/background/__tests__/`

Tasks:

- [ ] Add `click` and `hover` to forwarded DOM action sets.
- [ ] Add `click` and `hover` to `ContentAction`, `CONTENT_ACTIONS`, and RPC handler typing.
- [ ] Register interaction handlers in the content entrypoint.
- [ ] Implement `handleClick`:
  1. Assert `document.visibilityState !== "hidden"`; otherwise `TAB_NOT_VISIBLE`.
  2. Resolve the supplied `ElementTarget`.
  3. Assert visible/actionable using existing visibility helpers.
  4. Focus the element when possible.
  5. Dispatch a click-shaped activation sequence using browser-safe event constructors/fallbacks.
  6. Use a short bounded jittered settle wait; never use `MutationObserver`.
  7. Return `{ clicked: true, disappeared: !element.isConnected, stable }`.
- [ ] Implement `handleHover`:
  1. Assert visible tab.
  2. Resolve target.
  3. Assert visible/actionable.
  4. Dispatch pointer/mouse hover events at the element center.
  5. Use existing `pollUntilStable` + `subtreeSignature` for a short bounded jittered wait.
  6. Return `{ hovered: true, stable, elapsed }`.
- [ ] Keep all execution in ISOLATED world.
- [ ] Ensure target disappearance after click is not converted into an error by post-action verification.

Event semantics note:

- Prefer explicit, honest synthetic DOM events and/or existing `HTMLElement.click()` behavior where needed for default activation.
- Do not pretend events are trusted; they will be `isTrusted=false`.
- Do not add fake typing/key events.

### 6. Tests

Shared:

- [ ] Action union, params, results compile coverage.

Daemon:

- [ ] `schemas.test.ts` accepts valid `click` / `hover` requests and rejects malformed targets.
- [ ] `pacing.test.ts` verifies both actions are paced.
- [ ] Round-trip/dispatch tests cover forwarded action acceptance.

CLI:

- [ ] `click` and `hover` require exactly one target.
- [ ] Commands send correct action names and params.
- [ ] `command-registry` classifies both as destructive.

Extension content:

- [ ] `click` succeeds on visible target.
- [ ] `click` returns `disappeared: true` when the target removes itself during activation.
- [ ] `click` fails with `ELEMENT_NOT_ACTIONABLE` for hidden target.
- [ ] `click` fails with `TAB_NOT_VISIBLE` for hidden document.
- [ ] `hover` dispatches expected hover event sequence.
- [ ] `hover` uses bounded polling and does not require `MutationObserver`.
- [ ] RPC rejects malformed action params through existing daemon schema; content handler assumes typed params.

Build/security assertions:

- [ ] Existing production bundle assertion still proves no `MutationObserver` is present.
- [ ] No new `web_accessible_resources`.
- [ ] No new MAIN-world action path.

### 7. Validation commands

Run after implementation:

```bash
pnpm --filter @bproxy/shared typecheck
pnpm --filter @bproxy/service test
pnpm --filter @bproxy/cli test
pnpm --filter @bproxy/extension test
pnpm check
```

If time permits, run a smoke test against a local fixture with:

- a dismissible modal button;
- an accordion/show-more button;
- a hover-revealed menu/tooltip.

## Acceptance criteria

- `bproxy click --selector ...` activates a visible target and reports success even when the target disappears after activation.
- `bproxy hover --selector ...` triggers hover-dependent UI without using `MutationObserver`.
- Both actions support `--selector` and `--route-json`.
- Both actions are daemon-paced and marked destructive.
- No `type` command/action exists.
- Documentation and ADRs explain why `click`/`hover` fit the sensor/actuator boundary and why `type` remains out of scope.
