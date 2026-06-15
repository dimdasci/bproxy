# Fill Method Selection

## Decision tree

```
elements --form → inspect target:
  ├─ runtimeHandle present? → runtime-api + main
  ├─ <input> or <textarea>? → paste + isolated
  └─ [contenteditable]?     → direct + isolated
```

## Method matrix

| Surface | Method | World |
|---------|--------|-------|
| `<input>`, `<textarea>` | `paste` | `isolated` |
| React/Vue/Angular controlled input | `paste` | `isolated` |
| bare `[contenteditable]` | `direct` | `isolated` |
| Quill (`runtimeHandle: "quill"`) | `runtime-api` | `main` |
| Lexical (`runtimeHandle: "lexical"`) | `runtime-api` | `main` |
| ProseMirror/TipTap (`runtimeHandle: "prosemirror"`) | `runtime-api` | `main` |
| Slate (`runtimeHandle: "slate"`) | `runtime-api` | `main` |
| CodeMirror 6 (`runtimeHandle: "codemirror"`) | `runtime-api` | `main` |
| Monaco (`runtimeHandle: "monaco"`) | `runtime-api` | `main` |

## Shadow DOM targets

Use `--route-json` for elements inside open shadow roots:

```bash
bproxy fill -s <id> --route-json '{"hosts":[{"selector":"#shadow-host"}],"target":"input.inner"}' \
  --value "text" --method paste --world isolated
```

Closed shadow roots → unreachable → `require-human`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `runtime-api` script error | Editor not mounted yet. `wait --strategy selector --target ".ql-editor"`, retry. |
| `paste` value not accepted | Target may be bare contenteditable → try `direct`. |
| `direct` value reverts | Framework controls state → switch to `paste`. |
| Value mismatch after fill | `elements --form` to verify. Try alt method or `require-human`. |
