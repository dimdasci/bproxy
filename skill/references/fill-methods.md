# Fill Method Selection

Agent guidance for choosing the correct `fill` method and execution world per target.

## State-Location Taxonomy

Every fill target falls into one of three buckets by where the page's authoritative state lives:

| Where state lives | Examples | Method | World |
|-------------------|----------|--------|-------|
| **In the DOM** | Plain `<input>`, `<textarea>`, bare `[contenteditable]` | `direct` | `isolated` |
| **In documented editor API** | Quill, Lexical, ProseMirror, TipTap, Slate, CodeMirror, Monaco | `runtime-api` | `main` |
| **In framework reacting to events** | React controlled inputs, Vue `v-model`, Angular forms | `paste` | `isolated` |

## Decision Tree

### Step 1: Probe the target

Call `elements --form` to gather markers:

```bash
bproxy elements -s <id> --tab t1 --form
```

Look for these fields in the response:

```json
{
  "tag": "div",
  "role": "textbox",
  "hasShadowRoot": true,
  "runtimeHandle": "quill",
  "handle": "el3"
}
```

### Step 2: Choose method

1. If `runtimeHandle` is present → **`runtime-api`** + `main`
2. Else if plain `<input>` or `<textarea>` → **`paste`** + `isolated`
3. Else if bare `[contenteditable]` → **`direct`** + `isolated`
4. If inside shadow DOM and editable → **`direct`** (prefer) or **`paste`** (if framework markers on ancestors)

### Step 3: Execute

```bash
# Example: runtime-api for Quill editor
bproxy fill -s <id> --tab t1 --element el3 --value "Content here" --method runtime-api --world main

# Example: paste for React input
bproxy fill -s <id> --tab t1 --element el1 --value "user@example.com" --method paste --world isolated

# Example: direct for bare contenteditable
bproxy fill -s <id> --tab t1 --element el5 --value "Plain text" --method direct --world isolated
```

## Method/World Matrix

| Surface Type | Example | Method | World |
|--------------|---------|--------|-------|
| Plain HTML input | `<input name="email">` | `paste` | `isolated` |
| Plain textarea | `<textarea>` | `paste` | `isolated` |
| Bare contenteditable | `<div contenteditable>` | `direct` | `isolated` |
| Quill editor | `div.ql-editor` with `runtimeHandle: "quill"` | `runtime-api` | `main` |
| Lexical editor | with `runtimeHandle: "lexical"` | `runtime-api` | `main` |
| ProseMirror/TipTap | with `runtimeHandle: "prosemirror"` | `runtime-api` | `main` |
| Slate editor | with `runtimeHandle: "slate"` | `runtime-api` | `main` |
| CodeMirror 6 | with `runtimeHandle: "codemirror"` | `runtime-api` | `main` |
| Monaco (VS Code) | with `runtimeHandle: "monaco"` | `runtime-api` | `main` |
| React input | wrapped with handler | `paste` | `isolated` |
| Vue v-model input | wrapped input | `paste` | `isolated` |
| Angular FormControl | reactive forms | `paste` | `isolated` |

## Shadow-DOM Targeting

For elements inside open shadow roots, use `--route-json`:

```bash
bproxy fill -s <id> --tab t1 --route-json '{"hosts":[{"selector":"#shadow-host"}],"target":"input.inner"}' \
  --value "text" --method paste --world isolated
```

Closed shadow roots are out of scope — use `require-human` if the target is inaccessible.

## Retry Guidance

### `runtime-api` fails with script error

- Editor may not be mounted yet (modal animation, lazy load)
- Wait briefly: `bproxy wait -s <id> --tab t1 --strategy selector --target ".ql-editor"`
- Retry the fill

### `paste` fails (value not accepted)

- Check if the field is bare contenteditable → try `direct`
- Verify the element is focused/visible

### `direct` fails (value reverted)

- Indicates framework controls the state
- Switch to `paste`

### Any method fails on shadow-DOM element

- Verify the route chain with `inspect`
- Check if shadow root is closed (inaccessible)

## Read-Back Verification

After filling, verify the value was accepted:

```bash
bproxy elements -s <id> --tab t1 --form
# Check that the element's "value" field matches what you wrote
```

If mismatch: try an alternative method or use `require-human`.
