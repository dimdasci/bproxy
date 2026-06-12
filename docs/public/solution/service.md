---
title: Proxy Daemon
---

Implementation spec for the localhost proxy daemon. Built with [Fastify](https://fastify.dev) + [`@fastify/websocket`](https://github.com/fastify/fastify-websocket).

**Decisions that constrain this:** ADR-003 (Fastify), ADR-008 (WebSocket).

## Project Layout

```
service/
├── package.json              # deps: fastify, @fastify/websocket
├── tsconfig.json
└── src/
    ├── index.ts              # entry: start/stop/status CLI
    ├── server.ts             # buildServer() — Fastify setup, object graph, route registration
    ├── auth.ts               # onRequest hook: four-layer gate
    ├── routes/
    │   ├── command.ts        # POST / — CLI command intake + trace emission
    │   ├── pair.ts           # POST /pair/claim — one-time pairing claim
    │   ├── ws.ts             # GET /ws — extension WebSocket upgrade
    │   ├── session-actions.ts # daemon-local session.* handlers
    │   ├── tab-actions.ts    # tab.* forwarding with session scoping
    │   ├── responses.ts      # error envelope builders
    │   └── types.ts          # CommandRouteDeps interface
    ├── clients.ts            # WS client registry
    ├── config.ts             # env-based configuration
    ├── debug-actions.ts      # debug.status / debug.last handlers
    ├── dispatch.ts           # route command to correct WS client + tab
    ├── logger.ts             # structured JSON logger (pino-compatible)
    ├── pacing.ts             # per-session delay enforcement
    ├── pairing.ts            # pairing code generation and validation
    ├── pairing-file.ts       # pairing.json file I/O
    ├── pending.ts            # pending-request map, timeout, replay-on-reconnect
    ├── schemas.ts            # Zod schemas for ActionParams validation
    ├── session-identifiers.ts # SessionId + TabHandle generation
    ├── sessions.ts           # session registry (create, bind, close, tab ownership)
    └── lifecycle.ts          # PID file, lockfile, daemonize, log rotation, token gen
```

Bundled with `tsup` → single `dist/index.mjs`. Started as detached child by `bproxy service start`.

## Server Setup

```typescript
// src/index.ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { authHook } from './auth';
import { commandRoute } from './routes/command';
import { wsRoute } from './routes/ws';
import { pairRoute } from './routes/pair';

const app = Fastify({ logger: true });

await app.register(websocket);

// Auth gate runs for both HTTP and WS upgrade
// MUST stay on `onRequest` (not `preValidation`) so unauthenticated
// requests are rejected before body parsing/validation.
app.addHook('onRequest', authHook);

// Routes
app.register(commandRoute);
app.register(pairRoute);
app.register(wsRoute);

await app.listen({ host: '127.0.0.1', port: config.port });
```

## Auth Gate

**File:** `src/auth.ts`

Four-layer check on every request, with **route-specific** token requirements.

Token model:
- **Daemon token** (`~/.bproxy/token`) authenticates CLI→daemon HTTP calls (`POST /`)
- **Pairing code** authenticates popup→daemon `POST /pair/claim` (no daemon token)
- **Extension token** (issued during pairing) authenticates WS upgrade (`GET /ws`)

1. **Host header** — must be `127.0.0.1:{port}` or `localhost:{port}`. Rejects proxy-forwarded.
2. **Origin header** — if present, must be `chrome-extension://{extension-id}` (WS/popup) or absent (CLI). Rejects cross-site.
3. **Sec-Fetch-Site** — if present, must be `none` or `same-origin`. Rejects cross-site.
4. **Auth secret (route-specific):**
   - **HTTP `POST /`** → `Authorization: Bearer {daemonToken}`
   - **HTTP `POST /pair/claim`** → pairing code in body (no bearer token)
   - **WS `GET /ws`** → `Sec-WebSocket-Protocol: bproxy.v1, auth.{base64url(extensionToken)}`

**Security invariant:** daemon token secrecy is enforced by OS file ownership and mode. CLI must fail closed if token owner/mode is unsafe.

Failure at any layer → 401, connection closed.

**Ordering contract (normative):** for header-auth routes (`POST /`, `GET /ws`), auth is evaluated at `onRequest`, before body parsing, schema validation, and route logic. If auth fails, daemon returns `401` even when the payload body is malformed or schema-invalid.

`POST /pair/claim` is body-auth for pairing code, so Host/Origin/Sec-Fetch-Site checks run at `onRequest`, while code validation runs after body parse.

## HTTP Route: `POST /`

`debug.*` actions are handled here as first-class protocol actions:
- `debug.last`: return last N request traces from the daemon's in-memory ring buffer.
- `debug.status`: return daemon + WS + session state snapshot.
- `debug.log`: proxy request to extension and return ring-buffer entries.


**File:** `src/routes/command.ts`

Receives CLI commands. Single route, single method.

```typescript
app.post('/', {
  schema: {
    body: BproxyRequestSchema,  // JSON Schema from shared types
    response: { 200: BproxyResponseSchema }
  }
}, async (request, reply) => {
  const cmd = request.body as BproxyRequest;

  // 1. Enforce pacing (may delay before proceeding)
  await pacing.waitForSlot(cmd.session, cmd.action);

  // 2. Find target WS client for this session's tab
  const client = dispatch.resolveClient(cmd.session);
  if (!client) return reply.code(502).send(noExtensionError(cmd));

  // 3. Forward to extension, await response (with deadline)
  const result = await dispatch.send(client, cmd);

  // 4. Return to CLI
  return result;
});
```

The route is synchronous from the CLI's perspective: POST blocks until the extension responds or deadline expires.

**Status precedence (normative):** for `POST /`, auth failure (`401`) takes precedence over request-body parse/schema failures (`400`).

## Action Routing and Session Contract

### Session authority

Daemon is the source of truth for session state (tab ownership, pacing, paused, pauseReason).
This state is in-memory only and resets on daemon restart.

### Routing matrix

| Action family | Handled by daemon | Forwarded to extension |
|---|---:|---:|
| `debug.last`, `debug.status` | ✅ | ❌ |
| `session.create`, `session.list`, `session.bind`, `session.unbind`, `session.resume`, `session.close` | ✅ | ❌ (session.close forwards tab.close sub-requests) |
| `tab.list` | ✅ (reads session tab registry) | ❌ |
| `debug.log` | ❌ | ✅ |
| browser and tab actions (`navigate`, `text`, `links`, `inspect`, `snapshot`, `fill`, `tab.open`, `tab.close`, `tab.pin`, `tab.unpin`, ...) | ❌ | ✅ |

### `session.*` semantics

- `session.create` — generates a new 6-character base32 `SessionId` with default pacing; returns `{ session, label? }`.
- `session.list` — returns daemon's current in-memory session snapshot.
- `session.bind` — binds a session to a logical `TabHandle`. Rebinding is immediate: the very next forwarded command resolves the new tab.
- `session.unbind` — clears tab binding; idempotent.
- `session.resume` — clears paused state/reason; idempotent.
- `session.close` — closes all Chrome tabs owned by the session (forwards `tab.close` per tab), then destroys the session. Returns `{ session, closedTabs }`.

### Preconditions and error precedence

- `session.*` actions do **not** require WS connection and do **not** require a bound tab.
- Forwarded actions require a connected WS client and a bound tab.
- Error precedence for forwarded actions (normative, evaluated in this order):
  1. `NO_EXTENSION` when no WS client is connected.
  2. `HUMAN_REQUIRED` when the session is `paused` — daemon refuses the action without forwarding. Refusal carries the recorded `pauseReason`.
  3. `TAB_NOT_FOUND` when WS exists but session has no bound tab (or pinned tab is gone).
  4. Otherwise, the request is wrapped as a `BproxyForwardedRequest` (CLI envelope + `target.tabId` resolved from session state) and sent to the extension.

### Forwarded request shape

Daemon→extension messages carry a daemon-owned `target.tabId`. The CLI HTTP input is the bare `BproxyRequest` (no target); the daemon wraps it as `BproxyForwardedRequest = BproxyRequest & { target: { tabId: number } }` at the dispatch site. `session.*`, `debug.last`, and `debug.status` are handled daemon-locally and never carry `target`. Rebinding (`session.bind` with a new `tabId`) is immediate: the very next forwarded request picks up the new tab.

### Pause/resume contract

When the extension returns a `HUMAN_REQUIRED` error envelope to a forwarded action, the daemon mutates session state to `paused = true` and records the extension-supplied `error.message` as `pauseReason`. While paused, every forwarded action (`debug.log`, browser actions, `tab.*`) is refused with `HUMAN_REQUIRED` by the daemon-side gate above and never reaches the WS; daemon-local actions (`session.*`, `debug.last`, `debug.status`) remain available. `session.resume` clears the paused state and reason. `session.unbind` from `paused` also clears both the tab binding and the pause flag.

## Pairing Bootstrap Route: `POST /pair/claim`

**File:** `src/routes/pair.ts`

Extension popup calls this to claim pairing code and receive bootstrap payload. **No daemon token required** — the pairing code itself is the auth factor for this route.

Request:

```json
{
  "code": "ABCD-EFGH"
}
```

Response (200):

```json
{
  "ok": true,
  "data": {
    "extensionToken": "base64urlEncodedToken...",
    "wsUrl": "ws://127.0.0.1:9615/ws",
    "protocolVersion": 1,
    "issuedAt": 1714000000000,
    "expiresAt": 1714000300000,
    "nonce": "01J..."
  }
}
```

Validation/security checks:
- pairing code exists, not expired (TTL 5 min), not already consumed
- code compare is constant-time
- per-source rate limit (e.g. 5/min)
- claim consumes code atomically (one-time)
- bootstrap payload nonce is unique (extension enforces single accept)

**No daemon bearer token required** — pairing code is the auth factor for this route.

**Origin handling:** Popup `fetch` from `chrome-extension://` origin is expected and allowed.

Failure codes:
- `PAIRING_CODE_INVALID`
- `PAIRING_CODE_EXPIRED`
- `PAIRING_CODE_CONSUMED`
- `PAIRING_RATE_LIMITED`

Token activation contract:
- The `extensionToken` returned by successful `POST /pair/claim` becomes WS-auth valid immediately.
- Token lifecycle policy is **single-active-token**: daemon accepts only the latest claimed token and invalidates previously accepted extension tokens.
- Active extension token is persisted at `~/.bproxy/extension-token` (mode `0600`, owner-checked) so daemon restart is transparent: extension can reconnect with the same token without re-pairing.

## WebSocket Route: `GET /ws`

**File:** `src/routes/ws.ts`

Extension connects here. Multiple clients are supported (for example one per Chrome profile), as long as they authenticate with the currently active extension token. In addition to WS-level `ping`, the daemon now answers the extension's app-level `{ type: "ping" }` messages with `{ type: "pong" }` so the MV3 service worker can detect stale-but-not-yet-closed sockets.

```typescript
app.get('/ws', { websocket: true }, (socket, request) => {
  // socket is a WebSocket instance
  // WS auth is validated during upgrade from Sec-WebSocket-Protocol.
  // Expected: `bproxy.v1` + `auth.{base64url(token)}`
  // If valid, server negotiates and echoes only `bproxy.v1`.

  // Register client
  clients.add(socket);

  // Replay pending requests for this client's tabs
  pending.replayForClient(socket);

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    // Extension app-level heartbeat.
    if (msg?.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
      return;
    }

    // Response from extension — resolve the pending promise.
    if (typeof msg?.id === 'string') {
      pending.resolveById(msg.id, msg);
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  // Transport heartbeat.
  const heartbeat = setInterval(() => socket.ping(), 20_000);
  socket.on('close', () => clearInterval(heartbeat));
});
```

## Dispatch

Routing rule for debug actions:
- `debug.last` and `debug.status` are daemon-local (no WS required).
- `debug.log` targets extension background SW (requires WS client).


**File:** `src/dispatch.ts`

Routes a command to the correct WebSocket client and resolves when the extension responds.

```typescript
interface PendingEntry {
  id: string;
  resolve: (result: BproxyResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cmd: BproxyRequest;
}

// Send command to extension, return promise that resolves on response
function send(client: WebSocket, cmd: BproxyRequest): Promise<BproxyResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(cmd.id);
      reject(new TimeoutError(cmd));
    }, cmd.deadline - Date.now());

    pending.set(cmd.id, { id: cmd.id, resolve, reject, timer, cmd });
    client.send(JSON.stringify(cmd));
  });
}
```

### Per-tab serialization

Commands targeting the same tab are serialized (queue, not parallel). Prevents race conditions where two commands compete for the same content script.

## Pacing Engine

**File:** `src/pacing.ts`

Per-session delay enforcement. The agent cannot bypass it — pacing is daemon-side.

```typescript
interface SessionPacing {
  navigate: { min: number; max: number };  // ms between navigations
  scroll: { min: number; max: number };    // ms between scrolls
  fill: { min: number; max: number };      // ms between field fills
  lastAction: number;                       // timestamp of last action in this session
}

async function waitForSlot(session: string, action: string): Promise<void> {
  const config = sessions.getPacing(session);
  const delay = randomInRange(config[action].min, config[action].max);
  const elapsed = Date.now() - config.lastAction;
  if (elapsed < delay) {
    await sleep(delay - elapsed);
  }
  config.lastAction = Date.now();
}
```

Default pacing (human mode):
- Navigate: 1500–4000ms
- Scroll: 4000–8000ms
- Fill (per field): 500–2000ms

Configurable per session via `bproxy session bind --pacing human|fast`. Per-session config overrides (arbitrary `PacingConfig` literal) are deferred to a later phase.

## Pending Request Map

**File:** `src/pending.ts`

Bounded map of in-flight requests. Features:

- **Timeout** — each entry has a timer based on `cmd.deadline`. On expiry, resolve with timeout error.
- **Replay on reconnect** — when a WS client reconnects, pending requests for its tabs are re-sent. Extension's dedupe table prevents re-execution.
- **Bounded size** — max 100 pending. Reject with `OVERLOADED` if full (shouldn't happen in practice).
- **Idempotency** — if a request with the same `id` arrives while one is pending, return the existing promise (client retry).

## Session State

**File:** `src/sessions.ts`

```typescript
interface InternalSession extends SessionInfo {
  // SessionInfo fields: id, label?, tab (bound handle or null), pacing, paused, pauseReason?
  lastActionAt: Record<string, number>;       // pacing timestamps per action category
  tabs: Map<TabHandle, InternalTabInfo>;       // logical handle → tab metadata + Chrome id
  nextTabOrdinal: number;                     // counter for generating t1, t2, ...
}

interface InternalTabInfo extends TabInfo {
  chromeTabId: number;   // internal Chrome tab id, never exposed in protocol
}
```

Sessions are created explicitly via `session.create` or implicitly via `tab open` (which auto-creates when `-s` is omitted). Bound to a tab via `session.bind --tab tN` or automatically on `tab open`. Raw Chrome tab ids are internal — only logical `TabHandle` values appear in protocol responses.

## Lifecycle

**File:** `src/lifecycle.ts`

### Startup (`bproxy service start`)

Lifecycle is scoped to the selected state directory (`BPROXY_HOME`, default `~/.bproxy`). Exactly one daemon instance is allowed per state directory.

1. Read lockfile `~/.bproxy/bproxy.pid`.
2. If PID exists and process is alive, fail cleanly with non-zero exit (already running).
3. If PID exists but process is dead, treat as stale lock, remove stale state, continue.
4. Generate daemon token (32 bytes, crypto random, hex-encoded). Write to `~/.bproxy/token` with mode `0600`.
   - If token file exists with wrong owner or mode, refuse start (fail closed).
5. Load active extension token from `~/.bproxy/extension-token` (owner + mode `0600` required).
   - If present, WS auth is immediately available after restart (no re-pair required).
   - If absent, daemon still starts and waits for a pairing claim.
6. Generate one-time pairing code (human-readable, e.g. `ABCD-EFGH`), TTL 5 minutes, single-use.
7. Fork self as detached child (`child_process.spawn` with `detached: true`, `stdio: 'ignore'`).
8. Parent writes child PID to lockfile and exits 0.
9. Child builds Fastify server, listens, then writes `~/.bproxy/port`.

**Readiness boundary:** startup is considered ready when the daemon process is alive and `~/.bproxy/port` contains a valid bound port. `status` must report `running: true` at this point.

At startup CLI prints machine-readable output including `pairingCode`. Extension popup claims the code when first pairing or when rotating/recovering extension auth. See [extension.md](../solution/extension.md) § Pairing.

The daemon writes `pairing.json` (mode `0600`) atomically before the port file, containing `{pairingCode, pairingExpiresAt, issuedAt}`. The detached parent reads this file after readiness to build the start output JSON. The daemon removes `pairing.json` when the code is claimed or on shutdown.

Debugger control-plane wiring is deferred. The service binary does **not** accept `--enable-debugger-mode` flags. Extension `DEBUGGER_DISABLED` policy responses are passed through to the CLI unchanged. Arbitrary page eval is out of scope for bproxy.

### Shutdown (`bproxy service stop`)

1. Read PID from lockfile.
2. If PID is alive, send `SIGTERM`.
3. Daemon catches `SIGTERM` → `fastify.close()` → drains connections → exits.
4. Remove lockfile and transient files (`port`, daemon token) best-effort.

**Status truth model:** `status` returns `running: false` when lockfile is missing, PID is invalid, or PID is not alive (even if stale files remain).

### Logs

Day-rotated to `~/.bproxy/logs/YYYY-MM-DD.log`. Fastify's built-in pino logger, configured with file transport.

### State directory

```
~/.bproxy/
├── bproxy.pid          # PID of running daemon
├── port                # port number (for CLI to find)
├── token               # daemon bearer token for CLI HTTP auth (mode 0600)
├── extension-token     # active extension WS auth token (mode 0600)
├── pairing.json        # pairing metadata for detached start (mode 0600, transient)
└── logs/
    └── 2026-05-08.log
```

Canonical path on all platforms: `~/.bproxy`.

### Lifecycle JSON output contract

The service binary emits stable JSON on stdout for each lifecycle command:

**`start`** — success:
```json
{"running":true,"pid":123,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}
```

**`stop`** — success:
```json
{"running":false}
```

**`status`** — daemon running:
```json
{"running":true,"pid":123,"port":9615}
```

**`status`** — daemon not running:
```json
{"running":false}
```

Lifecycle failures write plain text to stderr and exit non-zero.

### Pairing metadata file (`pairing.json`)

Written atomically by the foreground daemon (mode `0600`) immediately after issuing a pairing code. The detached parent reads it to include pairing info in the `start` output.

**Retention:** removed on the earliest of:
- Successful pairing-code claim (extension token activated)
- Daemon shutdown (SIGTERM/SIGINT cleanup)
- Stale-state cleanup on next start

The parent process reading the file does **not** delete it. The daemon owns the lifecycle of this file.

### Extension-token preservation

`stop` removes transient daemon state (`bproxy.pid`, `port`, `token`, `pairing.json`) but preserves `extension-token` for transparent extension reconnect after restart.

## Error Responses

The daemon wraps extension errors and adds its own:

| Code | Category | When |
|---|---|---|
| `NO_EXTENSION` | transport | No WS client connected |
| `TIMEOUT` | transport | Deadline exceeded, extension didn't respond |
| `OVERLOADED` | transport | Pending map full |
| `SESSION_REQUIRED` | policy | Browser-control command sent without `-s` |
| `INVALID_SESSION_ID` | target | Session id doesn't match `/^[a-z2-7]{6}$/` |
| `SESSION_NOT_FOUND` | target | Session id not in daemon registry |
| `TAB_NOT_FOUND` | target | Session has no bound tab |
| `TAB_HANDLE_NOT_FOUND` | target | Logical tab handle not registered in any session |
| `TAB_NOT_IN_SESSION` | target | Tab exists but belongs to another session |
| `HUMAN_REQUIRED` | policy | Session is paused (interstitial detected) |
| `PAIRING_CODE_INVALID` | policy | Pair claim used unknown code |
| `PAIRING_CODE_EXPIRED` | policy | Pair claim used expired code |
| `PAIRING_CODE_CONSUMED` | policy | Pair claim reused one-time code |
| `PAIRING_RATE_LIMITED` | transport | Too many claim attempts |

## Observability

The daemon is the central point of visibility — all requests flow through it.

### Log Format

Structured JSON via Fastify's pino logger. Every log line includes the request `id` when applicable.

```
{"level":"info","id":"01HZX9C2K8","action":"scroll","session":"m4q7z2","event":"received","ts":1714000027000}
{"level":"info","id":"01HZX9C2K8","event":"pacing_wait","delay_ms":2400}
{"level":"info","id":"01HZX9C2K8","event":"forwarded","ws_client":"client-1","tab":1234}
{"level":"info","id":"01HZX9C2K8","event":"response","ok":true,"elapsed_ms":377}
```

### Lifecycle Events Logged

| Event | When | Fields |
|---|---|---|
| `received` | HTTP POST arrives | `id`, `action`, `session`, `destructive` |
| `pacing_wait` | Before forwarding, delay enforced | `id`, `delay_ms` |
| `forwarded` | Sent to extension via WS | `id`, `ws_client`, `tab` |
| `response` | Extension replied | `id`, `ok`, `elapsed_ms`, `error_code?` |
| `timeout` | Deadline expired | `id`, `elapsed_ms` |
| `replay` | Re-sent after WS reconnect | `id`, `ws_client` |
| `ws_connect` | Extension WS client connected | `ws_client`, `remote` |
| `ws_disconnect` | Extension WS client dropped | `ws_client`, `reason` |
| `pacing_config` | Session pacing changed | `session`, `mode` |

### Log Verbosity

Default level: `info` (shows all lifecycle events above). Set via `BPROXY_LOG_LEVEL` env var.

- `info` — request lifecycle, connections, errors. Enough to debug most issues.
- `debug` — adds full request/response payloads (large, but useful for protocol bugs).
- `warn` — only errors and unexpected conditions.

### Querying

Logs are plain JSON lines in `~/.bproxy/logs/YYYY-MM-DD.log`. Grep by `id`:

```bash
grep '01HZX9C2K8' ~/.bproxy/logs/2026-05-08.log
```

Or use `bproxy debug last` which returns the last N request traces from the daemon's in-memory ring buffer (capacity 200). Each trace records `{ id, action, session, receivedAt, elapsedMs, ok, errorCode? }`. The ring buffer is populated on every command response and survives across requests but resets on daemon restart.

## Testing

Unit tests with Vitest:
- Auth gate (accept/reject scenarios)
- Pacing engine (delay enforcement, jitter)
- Pending map (timeout, replay, dedup)
- Dispatch (serialization, client resolution)

Integration tests:
- Start daemon, connect mock WS client, send commands, verify round-trip.

## Development

```bash
cd service
pnpm dev        # tsup --watch + nodemon
pnpm build      # tsup → dist/index.mjs
pnpm test       # vitest
```
