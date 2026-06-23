# Skill: Fill Method Selection

Agent guidance for choosing the correct `fill` method and execution world per target. Lives outside extension code—extension is sensor+actuator only ([ADR-017](../decisions.md#adr-017-sensoractuator-boundary), [ADR-018](../decisions.md#adr-018-agent-guidance-ownership)).

---

## State-Location Taxonomy

Every fill target falls into one of three buckets by where the page's authoritative state lives:

| Where state lives | Examples | Method | World |
|-------------------|----------|--------|-------|
| **In the DOM** | Plain `<input>`, `<textarea>`, bare `[contenteditable]` | `direct` | ISOLATED |
| **In documented editor API** | Quill (`__quill`), Lexical (`__lexicalEditor`), ProseMirror, TipTap, Slate, CodeMirror, Monaco | `runtime-api` | MAIN |
| **In framework reacting to events** | React controlled inputs, Vue `v-model`, Angular forms | `paste` | ISOLATED |

---

## Decision Tree

### Step 1: Probe the target

Call `elements` or `dom` to gather markers:

```json
{
  "selector": "...",
  "tag": "div",
  "role": "textbox",
  "hasShadowRoot": true,
  "runtimeHandle": "quill"
}
```

### Step 2: Choose method

If `runtimeHandle` is present → **`runtime-api`** (Quill, Lexical, etc.)
- Must use MAIN world: `world: 'main'`
- Requires `route` targeting (shadow-aware if needed)

Else if inside shadow DOM and editable (role="textbox", contenteditable) → **`direct`** or **`paste`**
- Prefer `direct` for plain contenteditable
- Use `paste` only if framework markers present on ancestors

Else if plain input (`<input>`, `<textarea>`) → **`paste`**
- Frameworks expect events even for native inputs

Else if bare contenteditable → **`direct`**

### Step 3: Choose world

| Method | Required World |
|--------|---------------|
| `direct` | `isolated` |
| `paste` | `isolated` |
| `runtime-api` | `main` (on-demand one-shot) |

Never guess. Always include both `method` and `world` in the request—extension validates, fails closed on mismatch.

---

## Shadow-DOM Considerations

### Open shadow roots

Use `route` targeting:

```json
{
  "target": {
    "route": {
      "hosts": [{ "selector": "#interop-outlet" }],
      "target": "[contenteditable=\"true\"]"
    }
  }
}
```

### Closed shadow roots

Explicitly out of scope per [ADR-014](../decisions.md#adr-014-shadow-dom-aware-discovery--route-based-targeting). If `route.closed === true`, consider:
1. Click-to-focus first, then use `document.activeElement`
2. Alternative light-DOM selector if available
3. Handoff to user with `require-human`

---

## Retry Guidance

### `runtime-api` fails with `EDITOR_NOT_FOUND`

- Editor may not be mounted yet—modal shell vs runtime mount timing
- Retry with progressive wait (100ms → 200ms → 400ms max 3 attempts)
- See PoC 3: target-site dialog ~101ms, editor ~409ms

### `paste` fails (framework rejects value)

- Try `direct` as fallback if the field is plain HTML
- Check if field is React controlled via `elements --form` output

### `direct` fails (value not persisted)

- Indicates framework state mismatch
- Switch to `paste` with proper event sequence

### Any method fails on shadow-DOM element

- Verify `route.hosts` chain against actual DOM
- Check if any host is closed shadow (inaccessible)

---

## Method/World Matrix

| Surface Type | Example | Method | World |
|--------------|---------|--------|-------|
| Plain HTML input | `<input name="email">` | `paste` | isolated |
| Plain textarea | `<textarea>` | `paste` | isolated |
| Bare contenteditable | `<div contenteditable>` | `direct` | isolated |
| Quill editor | `div.ql-editor` with `__quill` | `runtime-api` | main |
| Lexical editor | with `__lexicalEditor` | `runtime-api` | main |
| ProseMirror | with `pmViewDesc` or view instance | `runtime-api` | main |
| Slate editor | Slate-managed contenteditable | `runtime-api` | main |
| CodeMirror 6 | `.cm-editor` with `view` | `runtime-api` | main |
| Monaco (VS Code editor) | `.monaco-editor` | `runtime-api` | main |
| React TextAreaAutosize | wrapper textarea | `paste` | isolated |
| Vue v-model input | wrapped input | `paste` | isolated |
| Angular FormControl | reactive forms | `paste` | isolated |
| Custom React component | wrapped input with handler | `paste` | isolated |

---

## Read-Back Verification

After any fill, use `elements --form` or `dom` to verify framework accepted the value:

```bash
bproxy fill --session x '{"target": {...}, "value": "test", "method": "paste", "world": "isolated"}'
bproxy elements --session x --form  # Verify "value" field matches
```

If mismatch: the field uses custom component intercepting events before framework sees them. Try alternative method or `require-human`.

---

## Anti-Detection Considerations

- `paste` uses `inputType: "insertFromPaste"`—no `isTrusted` issue per se, but event-sequence shape is visible to handlers
- `runtime-api` produces no DOM events—cleanest signal, but requires MAIN world hygiene
- `direct` produces no events at all—use for bare contenteditable only

See [scenarios.md](../scenarios.md) for bot-signal accounting on specific flows.
