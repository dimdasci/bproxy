# 3. Proxy Service Internals

[← Index](./README.md) · Prev: [CLI Design](./02-cli-design.md) · Next: [Extension Internals →](./04-extension.md)

---

## Startup

```
bproxy service start [--port 9615] [--allow-eval] [--enable-debugger-mode]
```

Default port: `9615`. Binds to `127.0.0.1` only.

On every start the service generates a fresh **bearer token** (see [Authentication](#authentication)) and writes it to the per-user token file before opening the listener. The previous token, if any, is overwritten — old CLI processes and old extension connections will get `AUTH_REQUIRED` on their next call and re-read the file.

Logs to stderr (human-readable, not consumed by agents):
```
bproxy service listening on http://127.0.0.1:9615
token written to /run/user/1000/bproxy/token (mode 0600)
pid 28412 written to /run/user/1000/bproxy/bproxy.pid
logs: ~/.local/state/bproxy/logs/bproxy-2026-04-29.log
eval is disabled (start with --allow-eval to enable)
```

`bproxy service start` is the only entry point for the long-running daemon. Direct invocation of `node service/index.js` is not supported as a public surface — it does not write a PID file, does not redirect logs, and does not detach. The daemon and the user-facing CLI go through the same `bin` shim from [09-build.md → Root `package.json`](./09-build.md#root-packagejson).

## Service lifecycle

The daemon's lifecycle is the part of bproxy that previous designs glossed over. This section is the canonical reference for what `bproxy service start | stop | restart | status` actually do, where state lives, and how the failure modes (port conflict, stale PID, crashed daemon, multiple users) are handled.

### State directories

Same convention as the [token file](#token-file-location), reused for the rest of the daemon's runtime state. All paths are resolved by a single helper in `cli/paths.js` shared by the CLI and the daemon (owned by [09-build.md → Service installation and the daemon contract](./09-build.md#service-installation-and-the-daemon-contract)):

| Platform | Runtime state (PID, lock, token)                          | Logs                                                |
|----------|-----------------------------------------------------------|-----------------------------------------------------|
| Linux    | `$XDG_RUNTIME_DIR/bproxy/`, fallback `~/.bproxy/run/`     | `$XDG_STATE_HOME/bproxy/logs/`, fallback `~/.local/state/bproxy/logs/` |
| macOS    | `~/Library/Application Support/bproxy/`                   | `~/Library/Logs/bproxy/`                             |
| Windows  | `%LOCALAPPDATA%\bproxy\`                                  | `%LOCALAPPDATA%\bproxy\logs\`                        |

XDG split per [XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/latest/): `XDG_RUNTIME_DIR` is `0700`, per-session, and cleared on logout — exactly the lifetime we want for ephemeral runtime artefacts; `XDG_STATE_HOME` is the right place for files the user wants to keep across logout (logs survive a session). On macOS the `Library/Logs` convention is the user-facing log location surfaced by Console.app ([Apple — File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html)). On Windows we use `LOCALAPPDATA` rather than `APPDATA` because `APPDATA` is roamed by Active Directory profiles and our state is machine-local.

### PID file and lockfile

`bproxy service start` writes a single PID file, `bproxy.pid`, into the runtime directory above. The format is two lines:

```
28412
9615
```

Line 1 is the daemon's process id; line 2 is the port it bound. The CLI reads the port from this file when it needs to talk to the daemon, so a non-default `--port` does not require an environment variable on the CLI side.

The same file doubles as the lockfile. The startup sequence is:

1. Open `bproxy.pid` with `O_CREAT | O_EXCL | O_WRONLY`. On success, this is a fresh start — proceed to step 4.
2. On `EEXIST`, read the existing PID, then test whether it is alive:
   - POSIX: `process.kill(pid, 0)` — sends signal 0, which performs the permission check without actually signalling. Returns silently if the process exists, throws `ESRCH` if it does not, throws `EPERM` if it does but is owned by another user. On `ESRCH` (or, when the recorded port is also unreachable on `127.0.0.1`, on `EPERM`) the PID is stale.
   - Windows: there is no `kill -0`. We use the `tasklist` CSV interface (`tasklist /FI "PID eq 28412" /FO CSV /NH`) and parse for a match; absent → stale. This is the same pattern the npm `pidusage` module documented in 2024–2025.
3. On stale PID, **delete and recreate** the file. Document this in the `service start` log line (`reclaimed stale PID file (was pid 28412)`). On live PID, fail fast — see [Concurrent start failures](#concurrent-start-failures).
4. Write `<pid>\n<port>\n` and `fsync` before opening the listener.
5. Register `process.on('exit')` and signal handlers (`SIGINT`, `SIGTERM`) to unlink the file on clean shutdown. A crash leaves the file behind; step 2 reclaims it on the next start.

The PID file is `0600` on POSIX (mode set with the same `O_CREAT` `mode` argument). On Windows, the directory ACL inherited from `%LOCALAPPDATA%\bproxy\` is owner-only by construction — see [09-build.md → Service installation and the daemon contract](./09-build.md#service-installation-and-the-daemon-contract).

### Port discovery and `EADDRINUSE`

The default port is `9615`. The CLI reads it from `bproxy.pid` line 2 if the file exists; otherwise it defaults. `--port <N>` is honoured on `bproxy service start` and is recorded in the PID file for the CLI to pick up.

If the daemon's `listen()` call fails with `EADDRINUSE`:

1. Read the PID file's recorded port and probe whether the process listening on `9615` is one of *our* daemons (HTTP `GET /version` returns `{ "service_version": "..." }`; if the response shape matches and the response is fast, it's us). On match, the prior step's stale-PID detection got it wrong, or two `bproxy service start` were racing — emit a structured `DAEMON_ALREADY_RUNNING` and exit; the user runs `bproxy service status` to see the running pid.
2. If the listener is not us (no response, wrong shape, or `ECONNRESET`), emit a structured `PORT_IN_USE` (added to the [error code table](./06-failure-modes.md#canonical-error-code-table)) with the message *"Another process holds 127.0.0.1:9615; pass `--port <N>` or stop the other process."* **We deliberately do not auto-bump the port.** A silent bump separates the daemon from the CLI: the next CLI invocation reads `9615` (from default, or stale PID file) and gets `PROXY_NOT_RUNNING` or, worse, a different daemon. Failing loudly is the right contract; the user passes `--port` and the file records it.

### Concurrent start failures

`bproxy service start` is idempotent only in the success case (a fresh start succeeds, a re-run while the daemon is alive fails fast).

| Situation                                                                  | Outcome                                                                                                                                          |
|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| No PID file, port free                                                     | Fresh start. Token rotated, listener opens, PID file written.                                                                                    |
| Live PID file, our daemon answering on the recorded port                   | `DAEMON_ALREADY_RUNNING` (`retry: false`, `suggestedAction: "run \`bproxy service status\` for the current daemon, or \`bproxy service restart\`"`). |
| Live PID file, but the recorded port is unreachable / answers differently  | Treat as stale (`process.kill(pid, 0)` may report alive for an unrelated process that re-used the PID). Reclaim, log a warning.                  |
| Stale PID file, port free                                                  | Reclaim the PID file, fresh start. Logged as `reclaimed stale PID file`.                                                                         |
| No PID file, port held by an unrelated process                             | `PORT_IN_USE` (see above). Exit non-zero.                                                                                                        |

We do not auto-restart on these failures; the user reads the structured error and decides. Auto-restart loops on a contended port are the worst-of-both — they both spin and produce noise.

### Daemonization

`bproxy service start` runs the daemon as a detached child process. The recipe is the [Node `child_process.spawn` `detached: true` pattern](https://nodejs.org/api/child_process.html#optionsdetached) — chosen over `pm2` / `forever` because it has zero install dependencies and is documented in the official Node API. The CLI's `service start` command:

1. Resolves the daemon entry: `path.join(packageRoot, 'service/index.js')`.
2. Opens the day's log file in append mode: `fs.openSync(logPath, 'a', 0o600)`. The `logPath` is `<logDir>/bproxy-YYYY-MM-DD.log`.
3. `spawn(process.execPath, [serviceScript, ...flags], { detached: true, stdio: ['ignore', logFd, logFd], cwd: packageRoot, env: { ...process.env } })`. Using `process.execPath` ties the daemon to the same Node runtime that resolved the CLI — important for nvm/asdf/Volta installs where `node` on `PATH` may diverge from the user's intent.
4. `child.unref()` so the parent CLI can exit independently of the daemon ([Node — `subprocess.unref()`](https://nodejs.org/api/child_process.html#subprocessunref)).
5. **Wait for readiness before exiting.** The CLI polls `GET /version` against the bound port every 100 ms for up to 5 s. On success, the CLI prints the start banner (token path, PID, log path) and exits 0. On timeout, the CLI prints `DAEMON_FAILED_TO_START` with the last 20 lines of the log file and exits 1. This is what makes `bproxy service start && bproxy navigate ...` reliable in scripts: the second command does not race the daemon's listener.

The daemon itself, on startup, completes the [PID file](#pid-file-and-lockfile) handshake **before** opening the HTTP listener; the CLI's readiness probe therefore observes a binary "running or not" signal, not "starting up." On Windows, `detached: true` causes the child to run in its own console session ([Node docs](https://nodejs.org/api/child_process.html#optionsdetached)); combined with `stdio: ['ignore', logFd, logFd]` the daemon has no console window.

### `bproxy service stop`

1. Read `bproxy.pid`. If absent, print `DAEMON_NOT_RUNNING` JSON and exit non-zero. (The CLI does not retry — `service stop` against an absent daemon is the user's mistake to know about.)
2. Send `SIGTERM` (POSIX) or `process.kill(pid)` (Windows; equivalent to `TerminateProcess` for our purposes).
3. Poll `process.kill(pid, 0)` every 100 ms for up to 5 s. On exit, unlink the PID file (the daemon's own exit handler should have done this; we do it as a fallback) and exit 0.
4. On timeout, escalate to `SIGKILL` (POSIX) or `taskkill /F /PID` (Windows), wait 1 s, unlink the PID file, log `forced kill of pid <N>`, exit 0.

The two-phase stop is the standard graceful-then-forceful pattern. The 5 s grace is enough for the daemon to drain pending HTTP requests with `CANCELLED` and close the WS politely.

### `bproxy service restart`

Equivalent to `service stop` + `service start`, with one detail: the CLI reads the running daemon's `--port` and `--allow-eval` / `--enable-debugger-mode` flags from `GET /status` *before* stopping it, so the restart preserves the user's start flags. If the daemon is already gone (`DAEMON_NOT_RUNNING` from `service stop`), `service restart` falls through to a fresh `service start` with the flags the user passed on the `restart` invocation.

### Auto-restart on crash

**Out of scope for v1.** Documented as a possible follow-up: a `--supervise` flag that wraps `service start` in a watcher process that respawns the daemon on non-zero exit, with exponential backoff. We don't ship it because a crashed daemon is a bug we want the user to notice — silent respawning hides reliability problems. Users who want it can wrap `bproxy service start` in `systemd --user` (Linux), `launchctl` (macOS), or NSSM (Windows). Documented in `bproxy --help`.

### Multiple instances per machine

The current rule is **one daemon per user**, addressed by the per-user runtime directory and a single PID file. We do not support `bproxy service start --port 9616` running alongside the default daemon as a v1 feature — the CLI looks up the daemon via the single PID file, and supporting multiple PID files per user is more complexity than the use case warrants.

The intended escape hatch for the multi-Chrome-profile case is **one daemon, multiple WS clients** — see [Multi-profile WebSocket clients](#multi-profile-websocket-clients) below. A user who genuinely needs two isolated daemons (different ports, different bind interfaces) runs them under different OS users; the per-user runtime directory naturally separates them.

### Logs

Every line on the daemon's stdout/stderr lands in the day's log file, opened append-only and chmod `0600`. Format is human-readable (the same format as the existing stderr banner), prefixed with an ISO timestamp.

Rotation: the daemon checks the date at every write boundary (cheap — a `Date.now()` comparison against the current open file's date). On day rollover it `close()`s the old file descriptor and opens the next day's. **Retention: 7 days.** On startup and on day rollover, the daemon scans the log directory and unlinks files older than 7 days (`bproxy-YYYY-MM-DD.log` filenames make this a date parse, not a stat call).

We do not pull in a rotation library; the by-day approach is simple and fits the volume (a typical daemon writes < 1 MB / day). Compression and rotation count limits are not v1 concerns. This is documented as an engineering decision, not a target — if a production deployment needs more, it can pipe stderr to `journald` / `syslog` via the OS supervisor.

## `bproxy status` endpoint

The proxy exposes `GET /status` returning a structured snapshot of the running daemon. **Authenticated** with the same `Authorization: Bearer <token>` rule as `/command` and `/log` — `bproxy status` discloses extension connection state, pinned tabs per session, and pending command counts, all of which we treat as caller-private (a peer process learning that an agent is mid-`type` is information leakage).

The CLI's `bproxy status` command consumes this endpoint and prints a stable JSON envelope. The endpoint is the source of truth; the CLI does no field synthesis.

```json
{
  "ok": true,
  "data": {
    "version": "0.x.y",
    "protocolVersion": 1,
    "uptimeMs": 184302,
    "port": 9615,
    "pid": 28412,
    "evalEnabled": false,
    "debuggerModeEnabled": false,
    "extensions": [
      {
        "profileId": "p_1f3c9a",
        "profileLabel": "Work",
        "connectedAt": 1714000005000,
        "extensionVersion": "0.x.y",
        "protocolVersion": 1
      },
      {
        "profileId": "p_8b21d0",
        "profileLabel": "Personal",
        "connectedAt": 1714000010500,
        "extensionVersion": "0.x.y",
        "protocolVersion": 1
      }
    ],
    "pendingCommands": 0,
    "pinnedTabsBySession": [
      { "session": "default", "profileId": "p_1f3c9a", "tabId": 42 },
      { "session": "reviewer", "profileId": "p_8b21d0", "tabId": 87 }
    ]
  }
}
```

The shape is stable; new fields are additive. The agent uses this to confirm "the daemon and the right extensions are up before I start." `extensions` is an array, not a single object — see [Multi-profile WebSocket clients](#multi-profile-websocket-clients).

### Daemon-not-running envelope

When `bproxy status` cannot reach the daemon, the CLI must produce a structured response, not a connection-refused stack trace. The CLI catches `ECONNREFUSED` / `ENOENT` (no PID file) and emits:

```json
{
  "ok": false,
  "error": {
    "code": "DAEMON_NOT_RUNNING",
    "category": "connection",
    "retry": true,
    "retryAfterMs": null,
    "suggestedAction": "run `bproxy service start`",
    "message": "bproxy daemon is not running on 127.0.0.1:9615",
    "details": {
      "port": 9615,
      "pidFilePresent": false
    }
  }
}
```

`DAEMON_NOT_RUNNING` is added to the [canonical error table in 06-failure-modes.md](./06-failure-modes.md#canonical-error-code-table) under `connection`, `retry: true`. The CLI exits with code `1` (matching the rest of the contract: any `ok: false` is exit 1). The pre-existing `PROXY_NOT_RUNNING` code is retained as the legacy alias when the CLI's HTTP request was refused mid-call rather than on a `bproxy status` probe; both codes co-exist. New code paths emit `DAEMON_NOT_RUNNING`. See [06-failure-modes.md → Daemon-related codes](./06-failure-modes.md#daemon-related-codes) for the disambiguation rule.

### Implementation note

`/status` is read-only and runs against the in-process state — it does not hit the extension. A disconnected extension is reported as an empty `extensions` array, not as an error; this lets the agent distinguish "daemon up, extension down" from "daemon up, extension up but unresponsive." For unresponsiveness the agent issues an actual command (e.g. `bproxy navigate about:blank`), which goes through the queue-and-wait path and emits `NO_CONNECTION` or `EXTENSION_UNRESPONSIVE` as appropriate.

## Authentication

The proxy exposes `eval` and other browser-driving actions to anything that can reach `127.0.0.1:9615`. Without auth, that means **any other extension, any local process, and any web page that can trick the browser into a same-origin or DNS-rebound request**. This is unacceptable for a tool whose purpose is reliable, trustworthy automation, so the proxy is authenticated by default.

### Threat model

What auth here is meant to stop:

- **Other browser extensions** running in the same Chrome profile. They can `fetch('http://127.0.0.1:9615/command', ...)` from their own background; without auth, they reach our `eval`.
- **Malicious or compromised web pages**, including via DNS rebinding (e.g. a page that resolves a domain to `127.0.0.1` after the page loads, then issues same-origin `fetch`). See [Localhost dangers — CORS and DNS rebinding (GitHub Security Lab, 2025)](https://github.blog/security/application-security/localhost-dangers-cors-and-dns-rebinding/).
- **Other local processes** on a shared host, dev containers on host networking, or other workloads on a shared CI runner.
- **Token leakage in URLs / referer / browser DevTools history** — by never carrying the token in a query string.

What it does **not** stop, and we are explicit about:

- **Malware running as the same user.** It can read the token file directly. This is a OS-level isolation problem; an in-process auth layer cannot solve it. Users on shared hosts should rely on the OS account boundary, not on bproxy.
- **A user who pastes the token into the wrong extension.** The one-time setup flow in the extension is the only point of trust; we minimise it but cannot eliminate it. See [04-extension.md → Token setup](./04-extension.md#token-setup).
- **Attacks that compromise the extension itself** (a malicious extension update, a Chrome-level XSS into the options page). The token is no stronger than the surface that holds it.

### Token format and lifetime

- **256 bits of `crypto.randomBytes`, encoded base64url** (43 chars, no padding). Generous against any plausible online guess; trivially fits in a header.
- **One token per service instance.** Rotated on every `bproxy service start`. There is no "remember me" or long-lived token: the lifetime of the token equals the lifetime of the proxy process.
- **No DB.** The token lives in a single file and in the running proxy's memory. No other persistence.

### Token file location

| Platform | Path                                                       | Mode                                |
|----------|------------------------------------------------------------|-------------------------------------|
| Linux    | `$XDG_RUNTIME_DIR/bproxy/token`, fallback `~/.bproxy/token`| `0600` on file, `0700` on directory |
| macOS    | `~/Library/Application Support/bproxy/token`               | `0600` on file, `0700` on directory |
| Windows  | `%LOCALAPPDATA%\bproxy\token`                              | ACL: owner-only (no inherited ACEs) |

`$XDG_RUNTIME_DIR` is preferred on Linux because it is user-private (`0700`), per-session, and cleared on logout — exactly the lifetime we want for an ephemeral service token. The `~/.bproxy/token` fallback is for environments without the variable (some headless containers); it must still be `0600`. This matches the WLCG bearer-token discovery convention ([WLCG Bearer Token Discovery](https://github.com/WLCG-AuthZ-WG/bearer-token-discovery/blob/master/specification.md)).

The cross-platform path resolution and ACL setup are owned by [09-build.md](./09-build.md) at install time; this section defines the contract.

### HTTP authentication

Every request to `POST /command` and `GET /log` MUST present:

```
Authorization: Bearer <token>
```

Validation rules, in order:

1. `Host` header MUST be `127.0.0.1:<PORT>` or `localhost:<PORT>`. Any other value → 401 `AUTH_REQUIRED` with `reason: "host_mismatch"`. This defeats DNS rebinding: even if a page resolves `evil.example.com` to `127.0.0.1`, the browser sends `Host: evil.example.com`, which we reject before authentication runs.
2. `Origin` header, if present, MUST be absent or one of `null`, `chrome-extension://<our-extension-id>`. **Any browser-origin Origin (`http://...`, `https://...`) is rejected outright**, because the only legitimate browser-context caller is the extension's WebSocket on `/ws`, never `/command`.
3. `Sec-Fetch-Site`, if present, MUST be `none` or absent. Browsers always set this header on `fetch()` from a page; non-browser clients (the CLI) never do. A request that arrives with `Sec-Fetch-Site: cross-site`, `same-site`, or `same-origin` is by definition a browser-origin caller and is rejected. This is the same defense-in-depth pattern Datasette adopted in 2025 ([Datasette PR #2689 — replace token-based CSRF with Sec-Fetch-Site](https://github.com/simonw/datasette/pull/2689)) and the [Fetch Metadata Request Headers W3C spec](https://www.w3.org/TR/fetch-metadata/).
4. `Authorization: Bearer <token>` MUST match the current process token, compared with `crypto.timingSafeEqual` on equal-length buffers (length-pad the input to the expected length first, then compare; see Node's [`crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)). On mismatch → 401 `AUTH_REQUIRED` with `reason: "bad_token"`.
5. Missing `Authorization` header → 401 `AUTH_REQUIRED` with `reason: "missing_token"`.

Auth failures return HTTP 401 (the only non-200 status the proxy uses) and a structured body matching the standard error shape:

```json
{
  "ok": false,
  "error": "AUTH_REQUIRED",
  "message": "Bearer token missing or invalid",
  "retry": false,
  "hint": "Read the token from <path> and pass Authorization: Bearer <token>. The CLI does this for you."
}
```

The 401 status is the single exception to "always HTTP 200": the CLI's transport layer must distinguish "the proxy rejected my credentials" from "an action failed at the page" before any retry / queue logic runs. See [02-cli-design.md → Authentication](./02-cli-design.md#authentication).

`AUTH_REQUIRED` is added to the [error code table](./01-output-contract.md#error-codes) — handed off to task 6 to formalise in [06-failure-modes.md](./06-failure-modes.md).

### WebSocket authentication

The browser `WebSocket` constructor does not accept arbitrary headers, so `Authorization: Bearer ...` is unavailable on the WS upgrade. We therefore use the `Sec-WebSocket-Protocol` subprotocol channel — the only header a browser-side `WebSocket` lets us populate freely. This is the same approach Kubernetes added for in-browser `kubectl exec` ([kubernetes/kubernetes#47740 — token authentication via subprotocol](https://github.com/kubernetes/kubernetes/pull/47740)).

```js
new WebSocket('ws://localhost:9615/ws', [
  `bproxy.bearer.v1.${base64urlToken}`,
]);
```

Server-side rules on the WS upgrade:

1. Apply the same `Host` allowlist and `Origin` allowlist as HTTP (Origin must be `chrome-extension://<our-id>`; reject browser web origins outright). This is what stops a malicious page on `localhost.run` from completing a WS upgrade against us.
2. The `Sec-WebSocket-Protocol` request header MUST contain exactly one offered subprotocol of the form `bproxy.bearer.v1.<token>`. Extract the token portion, length-pad, `timingSafeEqual` against the current process token. On mismatch → drop the upgrade with HTTP 401 and **do not echo back any subprotocol**.
3. On success, the server selects the constant subprotocol name `bproxy.bearer.v1` (without the token suffix) in `Sec-WebSocket-Protocol` on the 101 response. The token never appears in the URL, so it is not logged in proxy access logs, browser history, or referer chains. See [websockets — Authentication](https://websockets.readthedocs.io/en/stable/topics/authentication.html) on why query-string tokens are inferior.

We deliberately reject the alternatives:

- **Token in query string** (`ws://localhost:9615/ws?token=...`): leaks into HTTP access logs and any error reporting that records the URL.
- **First-message handshake** (open the WS, then send the token as the first frame): increases protocol complexity and means the proxy must hold an unauthenticated socket open. The subprotocol approach completes auth as part of the upgrade itself.

### Eval scoping

`eval` has the largest blast radius of any action — it is arbitrary JS in the user's browser context, with the user's session cookies. Even with auth, a single mistake in token handling becomes total compromise. We therefore put `eval` behind a **second gate**:

- The proxy is started with eval **disabled by default**.
- `bproxy service start --allow-eval` enables it.
- With eval disabled, a `POST /command` with `action: "eval"` returns `EVAL_DISABLED` (a non-retryable error) **before any auth check on the body** would matter — the action is simply not in the action table.
- Non-eval commands always work as long as auth passes.

Rationale: most agent workflows do not need `eval` — `click`, `type`, `text`, `elements`, `outline`, `dom` cover the bulk. Users opting into `eval` are explicitly accepting the larger blast radius. We considered separate scoped tokens (`read-only` vs `full`) but the operational complexity does not pay for itself at the current scale; revisit if multi-agent / multi-user scenarios appear.

### Audit trail

The [request log](#request-log) records every authenticated command. As a defense-in-depth layer (not a v1 hard requirement) the entry SHOULD include:

- Whether the command was authenticated (always `true` post-v1 — recorded for forward compat with future scoped tokens).
- The TCP peer (`127.0.0.1` always, but recorded for completeness).
- Where available on the platform, the caller PID/UID resolved via `/proc/net/tcp` (Linux) or `lsof` (macOS). This is best-effort: on systems where it is not cheaply available we record `null` rather than block the request.

This is what lets a user audit, post-hoc, what an agent did. It is logged in `/log` (also auth-gated; see below), not surfaced in command output.

## HTTP endpoint

Single route: `POST /command`. Authenticated; see [Authentication](#authentication).

- Accepts the JSON envelope from [01-output-contract → Wire envelope](./01-output-contract.md#wire-envelope-cli--proxy--extension): `{ protocol_version, id, action, params, deadline, destructive }`.
- Validates `protocol_version` against `PROTOCOL_VERSION` (currently `1`); mismatch → `PROTOCOL_VERSION_MISMATCH`, no forwarding.
- If `action == "eval"` and the proxy was not started with `--allow-eval` → returns `EVAL_DISABLED` immediately.
- If no WebSocket client connected → **enqueue the command and wait** for an extension to connect (subject to the queue cap; see [Bounded offline queue](#bounded-offline-queue)). This absorbs MV3 service worker wakeup latency transparently. If no connection is established before the request's `deadline` → respond with `NO_CONNECTION`.
- If WebSocket client is connected → forward the envelope immediately and wait for a matching reply.
- When WS response arrives (matched by `id`) → send as HTTP response.
- If WS response doesn't arrive before `deadline` → respond with the most specific code per [06-failure-modes.md → Taxonomy rules](./06-failure-modes.md#taxonomy-rules) (`EXTENSION_UNRESPONSIVE` is the default when no other condition applies). The legacy `EXTENSION_TIMEOUT` bucket is deprecated and MUST NOT appear on the wire.

Always HTTP 200 **except** for 401 on auth failure. The `ok` field inside JSON is the real status for everything past the auth gate. This keeps agent-side HTTP parsing trivial — one auth-error branch up front, then JSON-only.

### Why queue instead of fail-fast

Chrome's Manifest V3 service workers are **not persistent** — Chrome terminates them after ~30 seconds of inactivity. When the service worker dies, the WebSocket connection drops. The next command from the agent arrives at the proxy during the gap between termination and reconnection.

If the proxy failed immediately on no connection, agents would see flaky `NO_CONNECTION` errors between every command (since agent think-time often exceeds 30s). By holding the command for a few seconds, the proxy absorbs the SW wakeup + WS reconnect cycle (~200–600ms) without the agent ever knowing it happened.

The proxy does **not** buffer multiple commands — it holds at most one pending command per HTTP request, each with its own timeout. This is not a queue in the traditional sense; it's a "wait for connection" grace period.

## WebSocket server

- Runs on the same port, upgrade path `/ws`.
- Authenticated on the upgrade via `Sec-WebSocket-Protocol: bproxy.bearer.v1.<token>` (see [WebSocket authentication](#websocket-authentication)). A failed upgrade returns 401 and the socket is closed; no per-frame re-auth is needed because the subprotocol value was checked before the 101 was sent.
- Accepts **one WS connection per profile**. The previous design's "one WS, period" rule does not survive contact with multi-profile Chrome — see [Multi-profile WebSocket clients](#multi-profile-websocket-clients) below.
- Ping/pong every 10s to detect dead connections.

## Multi-profile WebSocket clients

Real users run Chrome with multiple profiles (Work + Personal is the common case). Each profile gets its own extension installation, its own `chrome.storage`, and its own tab namespace — Chrome does not share tab ids across profiles. The token, however, is per-machine, so both profiles' extensions can authenticate against the same daemon. Without per-profile addressing the proxy ends up with two WS clients answering for the same `tabId: 42` — one for a Work tab, one for a Personal tab — and a `click` for tab 42 is ambiguous.

The proxy supports this case by treating WS clients as a **map keyed by profile identity**, not as a single slot. The complete model:

### Profile identity announced on connect

Every extension, on the first frame after the WS opens, sends a `hello` frame:

```jsonc
{
  "protocol_version": 1,
  "type": "hello",
  "extensionId": "abcdefghijklmnopabcdefghijklmnop",
  "extensionVersion": "0.x.y",
  "profileId": "p_1f3c9a",
  "profileLabel": "Work"
}
```

Where the values come from (extension side, owned by [04-extension.md](./04-extension.md)):

- `extensionId` — `chrome.runtime.id`. Constant per extension installation; same across profiles only if both profiles installed the same extension package, which is the common case for sideload from the same path.
- `profileId` — a 64-bit random UUID minted on first SW startup and persisted in `chrome.storage.local` under `bproxyProfileId`. It survives extension reloads and Chrome restarts; it is reset only if the user clears extension storage. We deliberately do **not** use `chrome.identity.getProfileUserInfo` as the primary identifier — that API returns the signed-in Google account email and obfuscated gaia id ([chrome.identity reference](https://developer.chrome.com/docs/extensions/reference/api/identity)), which is empty on profiles that are not signed into Google and is therefore not a valid identity for the case we are trying to address. A persisted UUID is the right primitive for "this is the same profile across SW restarts."
- `profileLabel` — the user-supplied label set in the options page (free-form string, max 32 chars; defaults to "default"). The user types "Work" or "Personal" once, the daemon shows it in `bproxy status` and `bproxy tab list`.

The proxy validates the `hello` frame's `protocol_version` and stores the entry in `extensionsByProfileId: Map<profileId, { ws, hello, connectedAt }>`. If a second WS arrives for the same `profileId` (extension reload, manual refresh) the old WS is dropped and the new one wins — the [replay on reconnect](#replay-on-reconnect) path runs as before, scoped to the matching profile's pending entries.

### Per-profile dispatch

The proxy's pending map is now keyed by `(profileId, id)` rather than `id` alone. Every command flowing through `POST /command` carries an explicit or inferred `profileId` from the [tab resolver](#tab-resolver-and-profile-binding); the dispatcher forwards on the WS for that profile.

If the dispatcher resolves a command to a `profileId` whose WS is not connected, the existing queue-and-wait path runs (see [Why queue instead of fail-fast](#why-queue-instead-of-fail-fast)) — the only change is that the wait is per-profile, so a Work command does not block on a Personal extension waking up.

### Tab resolver and profile binding

The session pin from [08-tab-management.md](./08-tab-management.md) is extended to be **profile-bound**: a session pin records `(profileId, tabId)` instead of `tabId` alone. The detail and the wire shape are owned by [08-tab-management.md → Profile-bound sessions](./08-tab-management.md#profile-bound-sessions); the proxy's contract here is:

- The proxy receives the session name on every command and looks up `(profileId, tabId)` from its session-state — but **the session state lives in the SW**, not in the proxy (consistent with the existing "the SW is authoritative for pin state" rule). The proxy therefore tags the outbound envelope with the resolved `profileId` and forwards on that profile's WS.
- The first time a session is used, the proxy auto-binds it to whichever profile was the source of the first explicit `tab pin` / `tab open` / `navigate` (whose response carries the SW's resolved `profileId`). On all subsequent commands the proxy enforces the binding: a command tagged with `--session reviewer` whose target tab is in a different profile returns `WRONG_PROFILE` (`retry: false`, [added to the failure-mode taxonomy](./06-failure-modes.md#canonical-error-code-table)).
- The user can rebind a session explicitly with `bproxy session bind <session> <profileId>` (see [02-cli-design.md → `bproxy session`](./02-cli-design.md#bproxy-session)). This is the escape hatch for the "session bound to wrong profile" mistake.

The single-extension-per-profile invariant is critical: if a user has bproxy installed in two profiles simultaneously and both auto-bind to `--session default`, first-writer-wins is unsafe (the Personal profile silently inherits Work's pin, or vice versa). Auto-bind therefore commits to the first profile that issues a self-pinning command for a session and thereafter rejects others with `WRONG_PROFILE` until the user runs `session bind` or uses a different session name.

### Status visibility

`GET /status` returns the full `extensions` array (one entry per connected profile) and the full `pinnedTabsBySession` array (one entry per session, with its `profileId`). `bproxy tab list` returns the union of tabs from every connected profile, with a `profile` column on every row — see [08-tab-management.md → `tab list` with profiles](./08-tab-management.md#tab-list-with-profiles).

## Pending request map

```
Map<id, {
  envelope,           // original request envelope, kept verbatim for replay
  state,              // 'queued' | 'in-flight' | 'awaiting-ack'
  resolve, reject,    // HTTP response
  deadlineTimer,      // fires the absolute deadline from the envelope
  attempts            // number of times we have forwarded this id over WS
}>
```

Keyed by command `id`. When a WS reply arrives, look up `id`, call `resolve`, clear the deadline timer, drop the entry. The state field is what makes [replay](#replay-on-reconnect) safe.

### Request lifecycle (proxy side)

The proxy and extension both track the same lifecycle, with the proxy owning the first half and the extension owning the second:

```
                  ┌─ proxy owns ──────────────┐ ┌── extension owns ──┐
HTTP arrives ──▶ queued ──▶ in-flight ──▶ awaiting-ack ──▶ done
                 (no WS)    (sent on WS)   (extension          (HTTP
                                            confirmed it has    reply
                                            the id, may or      written)
                                            may not have run)
```

Transitions:

- `queued → in-flight`: WS becomes available and the proxy writes the envelope.
- `in-flight → awaiting-ack`: extension sends an `ack` frame for the id (purely a transport receipt; means "the request landed in `chrome.storage.session.pending`"). At this point a reconnect must **not** silently re-deliver, because the extension already owns the request — see below.
- `awaiting-ack → done`: a `result` frame arrives with `ok` and `data`/`error`.
- Any state → `done` with the deadline-specific code (`EXTENSION_UNRESPONSIVE` / `WAIT_TIMEOUT` / `NAVIGATED_DURING_ACTION` / `FRAME_DETACHED` / `RESTRICTED_URL`) per [06-failure-modes.md → Taxonomy rules](./06-failure-modes.md#taxonomy-rules) when the deadline fires.
- Any state → `done` with `CANCELLED`: client HTTP socket closes (Ctrl-C / agent timeout) — see [Cancellation](#cancellation).

The `ack` is cheap (one small frame, no payload beyond the id) and pays for itself by letting the proxy distinguish "extension never saw this" from "extension saw it and is working on it." Without it, the proxy cannot make a safe replay decision on reconnect.

## Replay on reconnect

The single hardest reliability bug pre-fix was: WS drops mid-flight, SW respawns and connects fresh, the new SW has no memory of the in-flight `id`, the proxy keeps waiting until the deadline. Combined with naïve retries that reuse the same logical command but a fresh `id`, destructive actions could fire twice.

The fix is symmetrical: the proxy replays based on lifecycle state, the extension's dedupe table (see [04-extension.md](./04-extension.md#dedupe-table-and-request-lifecycle)) makes the replay safe.

When the WS connection is replaced — either because the old socket closed, the heartbeat declared it dead, or a new socket connected and won the slot — the proxy walks its pending map:

| Pending entry state | Action on WS replace                                                                                          |
|---------------------|---------------------------------------------------------------------------------------------------------------|
| `queued`            | Re-forward on the new socket as soon as it's ready. The extension has never seen this id — no dedupe risk.    |
| `in-flight`         | Re-forward on the new socket. The extension's dedupe table will either return the cached result (if the previous SW completed it before dying) or run it (if it never started). Either way, at-most-once per id. |
| `awaiting-ack`      | Same as `in-flight`. The extension is the source of truth; if it has the id in `pending` it will resume, if it has the id in `done` it will replay the cached response. |

The proxy does not distinguish destructive vs non-destructive actions on replay — it always re-forwards. Safety comes from the extension dedupe table keyed on `id`, not from policy at the proxy. This keeps the proxy a dumb relay (per [architecture.md](../architecture.md)).

After a WS replace, the proxy increments `attempts` on each replayed entry. If `attempts > 3` we stop replaying that id and fail it with `EXTENSION_UNRESPONSIVE` so a wedged extension can't trap the agent indefinitely.

The extension may also volunteer "catch-up" frames on connect: for each id in its `done` cache that the proxy might still be waiting on, the extension sends the cached response immediately after the WS opens. The proxy drains these against its pending map first, then replays anything that wasn't covered. This is the same `last_seen_id` / catch-up pattern used by Phoenix Channels on rejoin ([Phoenix — Channels guide](https://hexdocs.pm/phoenix/channels.html), [phoenixframework/phoenix#576 — message replay discussion](https://github.com/phoenixframework/phoenix/issues/576)).

## Bounded offline queue

The proxy must hold pending HTTP requests while the SW is asleep / reconnecting (the previous task's lifecycle work showed this can be up to ~30 s in the worst case). It cannot hold them indefinitely — agents kicked off in parallel could otherwise pin proxy memory and starve real requests.

| Knob                  | Value | Rationale                                                                                                  |
|-----------------------|-------|------------------------------------------------------------------------------------------------------------|
| `MAX_PENDING`         | 64    | Per-process cap on pending entries (queued + in-flight + awaiting-ack combined). Each entry is < 1 KB plus the original HTTP socket; 64 fits comfortably in tens of KB and saturates one extension's serial-tab capacity. |
| Behaviour at the cap  | reject newest | New `POST /command` returns `QUEUE_FULL` immediately (`retry: true`). Backpressure is the agent's signal to slow down. |
| Per-id replacement    | yes   | If a new request arrives with an `id` already in the pending map, treat it as a duplicate of the existing entry: do not enqueue a second time, but attach the new HTTP response handle so both callers receive the same reply. This is the proxy-side mirror of dedupe and is what makes "client retries with the same id" cheap. |
| Idle eviction         | `deadline` | The deadline timer is the only eviction trigger. The cap protects against bursts; the deadline protects against permanently stuck entries. |

We deliberately do **not** drop oldest. Dropping the head while the head's HTTP caller is still waiting would surface as a confusing `EXTENSION_UNRESPONSIVE` to an agent that did nothing wrong; rejecting the newest with `QUEUE_FULL` puts the load shedding decision on the caller, where it belongs. This matches the AWS-recommended posture of returning a retryable error rather than silently re-ordering ([AWS — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)).

## Concurrency

The proxy can hold many pending entries, but the extension can only act on one tab-affecting command at a time per tab. Two `click`s on the same tab in parallel are a category error — the second has no defined ordering relative to the first.

Rule: **the proxy may dispatch up to `MAX_INFLIGHT_PER_TAB = 1` per tab; further requests for the same tab queue at the proxy until the in-flight one acks `done`.** "Tab" here is the resolved target tab id from [tab management](./08-tab-management.md). Requests for *different* tabs run in parallel, capped only by `MAX_PENDING` overall.

`screenshot` is special-cased: it must run alone within the tab because it needs `chrome.tabs.update(tabId, { active: true })`. The serializer treats `screenshot` as tab-affecting.

`tabs`, `tab`, `status` are pure metadata reads against `chrome.tabs.*` — they bypass the per-tab serializer.

## Cancellation

When the CLI's HTTP socket closes before the proxy has produced a response (Ctrl-C, agent timeout, dead pipe), the proxy:

1. Marks the entry `state = 'cancelled'` and clears its deadline timer.
2. Sends a `cancel` frame on the WS: `{ "protocol_version": 1, "type": "cancel", "id": "..." }`.
3. Does **not** remove the entry from the pending map until the extension acknowledges or the original deadline elapses. This way a late `result` frame still fits in the dedupe story; the response is logged and discarded.

The extension is not required to actually stop in-flight work — `click` and `eval` are not cleanly cancellable. The cancel frame is a hint: if the action has not yet started, drop it; if it is already running, finish but do not re-execute on subsequent replays. The HTTP caller has already seen `CANCELLED` regardless.

This trade-off is explicit: in-flight destructive actions may complete after the agent thinks it cancelled. The agent should treat a `CANCELLED` reply on a destructive action the same way it treats any retry — assume the action *might* have happened, and use page-state observation (e.g. `bproxy text` on the destination) to confirm.

## Request log

Every command is appended to an in-memory ring buffer (last 100 entries):

```json
{
  "id": "...", "action": "click", "params": {...},
  "at": "ISO", "ms": 142, "ok": true,
  "attempts": 1, "replay": false, "destructive": true
}
```

`attempts` is the number of times the proxy forwarded the envelope on the WS (≥ 2 means a reconnect-replay happened). `replay` is `true` when the extension answered from its dedupe cache rather than re-running the action. Together they let an operator confirm at-most-once was preserved.

Exposed via `GET /log` for debugging. **Same `Authorization: Bearer <token>` requirement as `/command`** — the log contains action names, params (which can include selectors hinting at user activity), and timing data, all of which we treat as caller-private. Not consumed by agents.

## Protocol versioning

The proxy exposes `GET /version` returning `{ "protocol_version": 1, "service_version": "x.y.z" }`. **`/version` is intentionally unauthenticated** — it is the one endpoint a misconfigured CLI must be able to hit before discovering it has the wrong token, and it leaks nothing beyond "a proxy is here, at version X." The CLI hits this on cold start (cached for the process lifetime) to fail fast on a CLI/proxy version skew. The extension sends `protocol_version` on its first WS frame after connect; mismatch causes the proxy to close the WS and surface `PROTOCOL_VERSION_MISMATCH` to any pending entries.

The version is bumped only on incompatible envelope changes. Adding optional fields is not a bump.
