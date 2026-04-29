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
- If no WebSocket client connected → **queue the command and wait** for an extension to connect (up to the command's timeout). This absorbs MV3 service worker wakeup latency transparently — the extension may reconnect within milliseconds. If no connection is established before the timeout expires → respond with HTTP 200 + `NO_CONNECTION` error JSON.
- If WebSocket client is connected → forward the message immediately and wait.
- When WS response arrives (matched by `id`) → send as HTTP response.
- If WS response doesn't arrive within 30s → respond with `EXTENSION_TIMEOUT` error JSON.

Always HTTP 200. The `ok` field inside JSON is the real status. This keeps agent-side HTTP parsing trivial — no status code branching.

### Why queue instead of fail-fast

Chrome's Manifest V3 service workers are **not persistent** — Chrome terminates them after ~30 seconds of inactivity. When the service worker dies, the WebSocket connection drops. The next command from the agent arrives at the proxy during the gap between termination and reconnection.

If the proxy failed immediately on no connection, agents would see flaky `NO_CONNECTION` errors between every command (since agent think-time often exceeds 30s). By holding the command for a few seconds, the proxy absorbs the SW wakeup + WS reconnect cycle (~200–600ms) without the agent ever knowing it happened.

The proxy does **not** buffer multiple commands — it holds at most one pending command per HTTP request, each with its own timeout. This is not a queue in the traditional sense; it's a "wait for connection" grace period.

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
