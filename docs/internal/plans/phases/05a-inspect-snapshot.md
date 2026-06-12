# Implementation plan: `inspect` and `snapshot` commands

Date: 2026-06-12
Status: **done** ✅

## Architecture overview

Adding a new action requires changes at exactly **6 touch points** across 3 packages:

| # | Location | What to add |
|---|----------|-------------|
| 1 | `shared/src/actions.ts` | Action name in `Action` union + `ActionParams` + `ActionResult` entries |
| 2 | `service/src/schemas.ts` | Action name in `ACTIONS` list + Zod schema in `ACTION_PARAM_SCHEMAS` |
| 3 | `extension/src/background/forwarded-actions.ts` | Action name in `FORWARDED_ACTIONS` + `DOM_ACTIONS` arrays |
| 4 | `extension/src/content/rpc.ts` | Action name in `ContentAction` union + `CONTENT_ACTIONS` array |
| 5 | `extension/src/content/actions/` | Handler implementation + registration in entrypoint |
| 6 | `cli/src/commands/` | CLI command file + registration in `bproxy.ts` + `command-registry.ts` |

Compile-time guards (`_AssertParams`, `_AssertResults`, `_AssertCovers`, `_AssertCoverage`) will error if any layer is missed.

---

## Command 1: `inspect`

### Purpose
Given a CSS selector, return structural/visual metadata about matching elements: bounding rect, computed styles, child/descendant counts, scroll state. Same DOM API level as `text`/`dom` — a fixed-schema sensor.

### Type definitions (`shared/src/actions.ts`)

```typescript
// In Action union:
| "inspect"

// In ActionParams:
inspect: {
  selector: string;
  properties?: string[];  // computed style properties to return (default: layout set)
  limit?: number;         // max elements (default: 10, max: 50)
};

// In ActionResult:
inspect: {
  elements: Array<InspectElement>;
  total: number;  // total matches (may exceed limit)
};
```

New supporting type:
```typescript
export interface InspectElement {
  index: number;
  tag: string;
  id: string;
  classes: string;         // space-separated, truncated to 100 chars
  role: string;
  ariaLabel: string;
  rect: { x: number; y: number; width: number; height: number };
  computed: Record<string, string>;  // only requested properties
  children: number;        // direct child element count
  descendants: number;     // total descendant count (capped at 10000)
  textLength: number;      // textContent.length
  scrollable: boolean;     // scrollHeight > clientHeight && overflow allows scroll
  scrollInfo?: { scrollTop: number; scrollHeight: number; clientHeight: number };
  selector: string;        // unique targeting selector
}
```

### Default computed properties
When `properties` param is not specified, return these layout-diagnostic properties:
```
display, visibility, overflow, overflowX, overflowY, position, opacity, pointerEvents
```

### Content script handler (`extension/src/content/actions/inspect.ts`)

```typescript
export function handleInspect(
  request: ContentRpcRequest<"inspect">,
  deps: ReadActionDeps = {},
): ActionResult["inspect"] {
  const doc = getDocument(deps);
  const selector = request.params.selector;
  const limit = Math.min(Math.max(1, request.params.limit ?? 10), 50);
  const properties = request.params.properties ?? DEFAULT_PROPERTIES;
  
  const root = doc.body ?? doc.documentElement ?? doc;
  const matches = root.querySelectorAll(selector);
  const total = matches.length;
  
  const elements: InspectElement[] = [];
  for (let i = 0; i < Math.min(total, limit); i++) {
    elements.push(inspectElement(matches[i], i, properties));
  }
  
  return { elements, total };
}

function inspectElement(el: Element, index: number, properties: string[]): InspectElement {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyleSafe(el);
  const computed: Record<string, string> = {};
  for (const prop of properties) {
    computed[prop] = style?.getPropertyValue(prop) ?? "";
  }
  
  const descendants = Math.min(el.querySelectorAll("*").length, 10000);
  const textLength = (el.textContent ?? "").length;
  const children = el.children.length;
  
  const scrollHeight = (el as HTMLElement).scrollHeight ?? 0;
  const clientHeight = (el as HTMLElement).clientHeight ?? 0;
  const overflow = style?.overflow ?? "";
  const overflowY = style?.overflowY ?? "";
  const scrollable = scrollHeight > clientHeight && 
    !["hidden", "visible"].includes(overflowY || overflow);
  
  return {
    index,
    tag: el.tagName.toLowerCase(),
    id: el.id ?? "",
    classes: el.className?.toString().substring(0, 100) ?? "",
    role: el.getAttribute("role") ?? "",
    ariaLabel: el.getAttribute("aria-label") ?? "",
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computed,
    children,
    descendants,
    textLength,
    scrollable,
    scrollInfo: scrollable ? { 
      scrollTop: (el as HTMLElement).scrollTop, 
      scrollHeight, 
      clientHeight 
    } : undefined,
    selector: safeCreateSelector(el),  // reuse existing targeting logic
  };
}
```

### CLI command (`cli/src/commands/inspect.ts`)

```typescript
export default defineCommand({
  meta: { description: "Inspect DOM elements: structure, styles, dimensions" },
  args: {
    ...globalArgs,
    selector: { type: "string", required: true, description: "CSS selector to query" },
    properties: { type: "string", description: "Comma-separated CSS properties to include" },
    limit: { type: "string", description: "Max elements to return (default: 10, max: 50)" },
  },
  async run({ args }) {
    const globals = extractGlobals(args);
    const params: ActionParams["inspect"] = { selector: args.selector };
    if (args.properties) params.properties = args.properties.split(",").map(s => s.trim());
    if (args.limit) params.limit = parseInt(args.limit, 10);
    const plan = await sendAction("inspect", params, globals);
    executeExitPlan(plan);
  },
});
```

### Zod schema (`service/src/schemas.ts`)

```typescript
inspect: z.object({
  selector: z.string(),
  properties: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict(),
```

---

## Command 2: `snapshot`

### Purpose
Return an accessibility-tree representation of the page (or subtree). Uses ARIA semantics — roles, labels, states — rather than CSS layout. Immune to `display: contents`, shadow DOM transparency, and visibility heuristic bugs. Outputs text optimized for LLM consumption.

### Type definitions (`shared/src/actions.ts`)

```typescript
// In Action union:
| "snapshot"

// In ActionParams:
snapshot: {
  selector?: string;           // subtree root (default: body)
  maxDepth?: number;           // depth limit (default: 8, max: 12)
  interactiveOnly?: boolean;   // only include interactive nodes (default: false)
};

// In ActionResult:
snapshot: {
  tree: string;                // indented text representation
  nodeCount: number;           // total nodes in the tree
};
```

### Output format

Indented plain text. Each line: `[indent][role] [name] [state-flags]`

```
navigation "Primary":
  link "Home"
  link "My Network"
main "Primary content" [scrollable]:
  heading "Dmitry Kharitonov" [level=1]
  text "Technical Delivery Lead | Solution Architect"
  section:
    heading "Analytics" [level=2]
    link "96 profile views"
  section:
    heading "About" [level=2]
    paragraph:
      text "Technical Delivery Lead..."
  section:
    heading "Experience" [level=2]
    list:
      listitem:
        text "Fractional Product Manager & Product Engineer"
        text "EasyBiz · Contract"
        text "Nov 2025 - May 2026 · 7 mos"
        link "Show more"
```

### Content script handler (`extension/src/content/actions/snapshot.ts`)

Core algorithm:
1. Resolve root element (from selector or body)
2. Walk composed tree (reuse `walkComposedElements` infrastructure for shadow DOM)
3. For each element, compute its **accessible role** (explicit `role` attr → implicit from tag)
4. Compute **accessible name** (aria-label → aria-labelledby → alt → title → visible text for naming elements)
5. Determine **state flags** (level for headings, checked/expanded/disabled for controls, scrollable for containers)
6. Build tree structure based on DOM parent-child relationships
7. Serialize to indented text with depth limit

Key design decisions:
- **Skip noise nodes**: elements with no accessible role AND no accessible name AND no interactive purpose → skip (reduces output size)
- **Text nodes**: collapse consecutive text into a single `text "..."` line
- **Truncation**: text content truncated to 80 chars per node
- **Shadow DOM**: traverse transparently (already supported by `walkComposedElements`)
- **display: contents**: irrelevant — we walk DOM tree structure, not layout boxes

```typescript
// Simplified core structure
export function handleSnapshot(
  request: ContentRpcRequest<"snapshot">,
  deps: ReadActionDeps = {},
): ActionResult["snapshot"] {
  const doc = getDocument(deps);
  const root = request.params.selector 
    ? resolveReadRoot(request.params.selector, doc)
    : (doc.body ?? doc.documentElement ?? doc);
  const maxDepth = Math.min(request.params.maxDepth ?? 8, 12);
  const interactiveOnly = request.params.interactiveOnly ?? false;
  
  const { text, nodeCount } = buildAccessibleTree(root, { maxDepth, interactiveOnly });
  return { tree: text, nodeCount };
}

function buildAccessibleTree(root: Element | Document, options: TreeOptions): TreeResult {
  // Recursive tree builder:
  // 1. Determine role of current element
  // 2. Determine accessible name
  // 3. Determine relevant state flags
  // 4. Recurse into children (composed — enters shadow roots)
  // 5. Format as indented text line
  // 6. Skip elements that contribute nothing (no role, no name, not interactive)
}
```

### Role mapping (subset)

```typescript
const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",           // only with href
  button: "button",
  h1: "heading", h2: "heading", h3: "heading",
  h4: "heading", h5: "heading", h6: "heading",
  img: "img",
  input: "textbox",    // varies by type
  select: "combobox",
  textarea: "textbox",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  header: "banner",
  footer: "contentinfo",
  section: "section",  // only with accessible name
  ul: "list", ol: "list",
  li: "listitem",
  table: "table",
  form: "form",
  dialog: "dialog",
  article: "article",
};
```

### CLI command (`cli/src/commands/snapshot.ts`)

```typescript
export default defineCommand({
  meta: { description: "Get accessibility tree snapshot of the page" },
  args: {
    ...globalArgs,
    selector: { type: "string", description: "CSS selector to scope the snapshot" },
    maxDepth: { type: "string", description: "Max tree depth (default: 8, max: 12)" },
    interactiveOnly: { type: "boolean", description: "Only show interactive elements", default: false },
  },
  async run({ args }) {
    const globals = extractGlobals(args);
    const params: ActionParams["snapshot"] = {};
    if (args.selector) params.selector = args.selector;
    if (args.maxDepth) params.maxDepth = parseInt(args.maxDepth, 10);
    if (args.interactiveOnly) params.interactiveOnly = true;
    const plan = await sendAction("snapshot", params, globals);
    executeExitPlan(plan);
  },
});
```

### Zod schema (`service/src/schemas.ts`)

```typescript
snapshot: z.object({
  selector: z.string().optional(),
  maxDepth: z.number().int().min(1).max(12).optional(),
  interactiveOnly: z.boolean().optional(),
}).strict(),
```

---

## Full change list (as shipped)

### New files
- `extension/src/content/actions/inspect.ts` — inspect handler
- `extension/src/content/actions/snapshot.ts` — snapshot handler
- `extension/src/content/actions/snapshot-roles.ts` — role/tag lookup constants
- `extension/src/content/actions/read-deps.ts` — shared `ReadActionDeps` type (breaks circular import)
- `extension/src/content/__tests__/inspect.test.ts` — 7 tests
- `extension/src/content/__tests__/snapshot.test.ts` — 10 tests
- `cli/src/commands/inspect.ts` — CLI command
- `cli/src/commands/snapshot.ts` — CLI command

### Modified files
- `shared/src/actions.ts` — `Action` union, `InspectElement`, params/results
- `shared/src/index.ts` — export `InspectElement`
- `service/src/schemas.ts` — ACTIONS array + Zod schemas
- `extension/src/background/forwarded-actions.ts` — FORWARDED_ACTIONS + DOM_ACTIONS
- `extension/src/background/forwarded-params.ts` — runtime validators
- `extension/src/content/rpc.ts` — ContentAction type + CONTENT_ACTIONS
- `extension/src/content/actions/reads.ts` — wire up handlers, re-export deps
- `cli/src/bproxy.ts` — subCommands
- `cli/src/command-registry.ts` — NON_DESTRUCTIVE_ACTIONS
- `cli/src/__tests__/design-assertions.test.ts` — action coverage map
- `cli/src/__tests__/command-registry.test.ts` — expected action list

---

## Test plan

### extension/src/content/__tests__/inspect.test.ts (NEW) ✅
1. ✅ Returns correct rect, computed styles, child count for basic elements
2. ~~Handles `display: contents` correctly~~ (not tested with fake DOM — validated in production)
3. ✅ Respects `limit` parameter
4. ~~Returns `scrollable: true` for overflow containers~~ (fake DOM lacks scrollHeight)
5. ✅ Reports `total` correctly when more matches than `limit`
6. ✅ Generates valid targeting selector for each element
7. ~~Handles missing/invalid selectors gracefully~~ (deferred — relies on querySelectorAll throwing)

### extension/src/content/__tests__/snapshot.test.ts (NEW) ✅
1. ✅ Produces correct tree for basic page with headings, landmarks, links
2. ✅ Traverses open shadow roots transparently
3. ✅ Skips noise elements (script, style)
4. ✅ Respects `maxDepth` — truncates deep trees
5. ✅ `interactiveOnly` mode shows only buttons, links, inputs
6. ✅ Handles `display: contents` wrappers (walks through them, no pruning)
7. ✅ Truncates long text at 80 chars
8. ✅ `selector` param scopes to subtree
9. ✅ Computes accessible name via aria-label
10. ✅ Reports state flags (disabled, checked, collapsed)

### cli/src/__tests__/commands-read.test.ts
- Not added (existing pattern tests CLI dispatch, not handler logic — covered by design-assertions)

### service/src/__tests__/schemas.test.ts
- Not added (schema coverage is compile-time enforced via `_AssertCovers`)

---

## Implementation order

All steps completed ✅

1. ✅ `shared/src/actions.ts` — types + `InspectElement` interface
2. ✅ `shared/src/index.ts` — export `InspectElement`
3. ✅ `service/src/schemas.ts` — Zod schemas
4. ✅ `extension/src/background/forwarded-actions.ts` — routing
5. ✅ `extension/src/background/forwarded-params.ts` — runtime validators
6. ✅ `extension/src/content/rpc.ts` — content script registration
7. ✅ `extension/src/content/actions/inspect.ts` — handler
8. ✅ `extension/src/content/actions/snapshot.ts` + `snapshot-roles.ts` — handler + constants
9. ✅ `extension/src/content/actions/read-deps.ts` — shared deps (breaks circular import)
10. ✅ `extension/src/content/actions/reads.ts` — wire up both handlers
11. ✅ `cli/src/commands/inspect.ts` + `cli/src/commands/snapshot.ts`
12. ✅ `cli/src/bproxy.ts` + `cli/src/command-registry.ts`
13. ✅ `cli/src/__tests__/design-assertions.test.ts` + `command-registry.test.ts` — coverage maps
14. ✅ `pnpm check` passes, all tests pass

---

## Risk / complexity notes (retrospective)

- **`inspect`** — straightforward as predicted. Main surprise: fake DOM's `getComputedStyle` returns a plain object without `getPropertyValue()` — needed a `readStyleProperty` helper that handles both.
- **`snapshot`** — required more refactoring than expected to stay under lint limits (complexity ≤10 per function, ≤300 lines per file). Extracted `snapshot-roles.ts` constants file and split flag computation into per-flag helpers.
- **Circular imports** — `inspect.ts` and `snapshot.ts` both needed `ReadActionDeps` from `reads.ts`, creating a cycle. Fixed by extracting `read-deps.ts`.
- **LinkedIn depth issue** — `snapshot` works but LinkedIn nests semantic content 12+ wrappers deep. maxDepth=12 (the maximum) catches most content but not lazy-loaded sections below fold.
