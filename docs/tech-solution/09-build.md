# 9. Build & Distribution

[← Index](./README.md) · Prev: [Tab Management](./08-tab-management.md) · Next: [Testing Strategy →](./10-testing.md)

---

## Service

```
cd service && npm install
node index.js
```

Single dependency: `ws`. No build step. No transpilation.

## Extension

No build step. Load unpacked in Chrome via `chrome://extensions` → "Load unpacked" → select `extension/` directory.

For distribution: `zip -r bproxy-extension.zip extension/`.

## CLI

Single file: `cli/bproxy`. Made executable with `chmod +x`.

Install globally via symlink or add to PATH:

```
ln -s $(pwd)/cli/bproxy /usr/local/bin/bproxy
```

## Root orchestration

A root `package.json` with scripts:

```json
{
  "scripts": {
    "start": "node service/index.js",
    "test": "node test/run.js"
  }
}
```

No monorepo tooling. No workspaces. Three directories, one repo.
