# Solution: Proxy Daemon (Service)

Implementation spec for the localhost proxy daemon. Built with [Fastify](https://fastify.dev) + [`@fastify/websocket`](https://github.com/fastify/fastify-websocket).

**Decisions that constrain this:** [ADR-003](../decisions.md#adr-003-service-framework--fastify) (Fastify), [ADR-008](../decisions.md#adr-008-websocket-over-native-messaging) (WebSocket).

## Project Layout

```
service/
├── package.json              # deps: fastify, @fastify/websocket
├── tsconfig.json
└── src/
    ├── index.ts              # entry: build server, register plugins, listen
    ├── auth.ts               # onRequest hook: four-layer gate
    ├── routes/
    │   ├── command.ts        # POST / — CLI command intake
    │   ├── pair.ts           # POST /pair/claim — one-time pairing claim
    │   └── ws.ts             # GET /ws — extension WebSocket upgrade
    ├── dispatch.ts           # route command to correct WS client + tab
    ├── pacing.ts             # per-session delay enforcement
    ├── pending.ts            # pending-request map, timeout, replay-on-reconnect
    ├── sessions.ts           # session state management
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

## HTTP Route: `POST /`

`debug.*` actions are handled here as first-class protocol actions:
- `debug.last`: read/parse daemon lifecycle log and return last N request traces.
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

## WebSocket Route: `GET /ws`

**File:** `src/routes/ws.ts`

Extension connects here. Multiple clients supported (one per Chrome profile).

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
    // Response from extension — resolve the pending promise
    pending.resolve(msg.id, msg);
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  // App-level heartbeat
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

Configurable per session via `bproxy session bind --pacing fast|human|custom`.

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
interface Session {
  name: string;
  tabId: number | null;         // pinned tab
  pacing: SessionPacing;
  paused: boolean;              // true after HUMAN_REQUIRED
  pauseReason?: string;
}
```

Sessions are created implicitly on first command with `--session <name>`. Bound to a tab via `bproxy session bind` or implicitly on first `navigate`.

## Lifecycle

**File:** `src/lifecycle.ts`

### Startup (`bproxy service start`)

1. Check lockfile `~/.bproxy/bproxy.pid` — if process alive, exit with "already running".
2. Generate daemon token (32 bytes, crypto random, hex-encoded). Write to `~/.bproxy/token` with mode `0600`.
   - If token file exists with wrong owner or mode, refuse start (fail closed) unless an explicit repair flag is provided.
3. Generate one-time pairing code (human-readable, e.g. `ABCD-EFGH`), TTL 5 minutes, single-use.
4. Fork self as detached child (`child_process.spawn` with `detached: true`, `stdio: 'ignore'`).
5. Parent writes PID to lockfile, exits 0.
6. Child: build Fastify server, listen, write port to `~/.bproxy/port`.

At startup CLI prints machine-readable output including `pairingCode`. Extension popup claims the code—no CLI involvement. See [extension.md](../solution/extension.md) § Pairing.

### Shutdown (`bproxy service stop`)

1. Read PID from lockfile.
2. Send `SIGTERM`.
3. Daemon catches `SIGTERM` → `fastify.close()` → drains connections → exits.
4. CLI removes lockfile.

### Logs

Day-rotated to `~/.bproxy/logs/YYYY-MM-DD.log`. Fastify's built-in pino logger, configured with file transport.

### State directory

```
~/.bproxy/
├── bproxy.pid          # PID of running daemon
├── port                # port number (for CLI to find)
├── token               # daemon bearer token for CLI HTTP auth (mode 0600)
└── logs/
    └── 2026-05-08.log
```

Canonical path on all platforms: `~/.bproxy`.

## Error Responses

The daemon wraps extension errors and adds its own:

| Code | Category | When |
|---|---|---|
| `NO_EXTENSION` | transport | No WS client connected |
| `TIMEOUT` | transport | Deadline exceeded, extension didn't respond |
| `OVERLOADED` | transport | Pending map full |
| `TAB_NOT_FOUND` | target | Session's pinned tab was closed |
| `HUMAN_REQUIRED` | policy | Extension detected interstitial (passthrough) |
| `PACING_VIOLATION` | policy | Internal — shouldn't surface (pacing is enforced, not rejected) |
| `PAIRING_CODE_INVALID` | policy | Pair claim used unknown code |
| `PAIRING_CODE_EXPIRED` | policy | Pair claim used expired code |
| `PAIRING_CODE_CONSUMED` | policy | Pair claim reused one-time code |
| `PAIRING_RATE_LIMITED` | transport | Too many claim attempts |

## Observability

The daemon is the central point of visibility — all requests flow through it.

### Log Format

Structured JSON via Fastify's pino logger. Every log line includes the request `id` when applicable.

```
{"level":"info","id":"01HZX9C2K8","action":"scroll","session":"default","event":"received","ts":1714000027000}
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

Or use `bproxy debug last` which reads the daemon log and returns the last N requests with their full lifecycle.

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
