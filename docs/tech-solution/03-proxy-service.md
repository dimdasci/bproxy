# 3. Proxy Service Internals

[← Index](./README.md) · Prev: [CLI Design](./02-cli-design.md) · Next: [Extension Internals →](./04-extension.md)

---

## Startup

```
node service/index.js [--port 9615]
```

Default port: `9615`. Binds to `127.0.0.1` only.

Logs to stderr (human-readable, not consumed by agents):
```
bproxy service listening on http://127.0.0.1:9615
```

## HTTP endpoint

Single route: `POST /command`

- Accepts JSON body: `{ id, action, params }`.
- If no WebSocket client connected → respond immediately with HTTP 200 + `NO_CONNECTION` error JSON.
- Otherwise, forwards the message over WebSocket and waits.
- When WS response arrives (matched by `id`) → send as HTTP response.
- If WS response doesn't arrive within 30s → respond with `EXTENSION_TIMEOUT` error JSON.

Always HTTP 200. The `ok` field inside JSON is the real status. This keeps agent-side HTTP parsing trivial — no status code branching.

## WebSocket server

- Runs on the same port, upgrade path `/ws`.
- Accepts exactly one connection at a time. If a second extension connects, the old connection is dropped (new one wins). This handles extension reloads gracefully.
- Ping/pong every 10s to detect dead connections.

## Pending request map

```
Map<string, { resolve, reject, timer }>
```

Keyed by command `id`. When a WS message arrives, look up `id`, call `resolve`, clear the timer. Simple.

## Request log

Every command is appended to an in-memory ring buffer (last 100 entries):

```json
{ "id": "...", "action": "click", "params": {...}, "at": "ISO", "ms": 142, "ok": true }
```

Exposed via `GET /log` for debugging. Not consumed by agents.
