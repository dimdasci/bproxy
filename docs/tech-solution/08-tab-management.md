# 8. Tab Management

[← Index](./README.md) · Prev: [Timeouts](./07-timeouts.md) · Next: [Build & Distribution →](./09-build.md)

---

## Default: active tab

All commands target the currently active tab in the last focused Chrome window. This matches user intuition — "the tab I'm looking at."

## Explicit tab targeting

```
bproxy tabs
```

```json
{
  "ok": true,
  "data": {
    "tabs": [
      { "id": 42, "url": "https://example.com", "title": "Example", "active": true },
      { "id": 87, "url": "https://github.com", "title": "GitHub", "active": false }
    ]
  }
}
```

```
bproxy tab 87
```

Pins all subsequent commands to tab 87 until the next `bproxy tab` call or until that tab closes. Stored in the proxy service as in-memory state (not persisted).
