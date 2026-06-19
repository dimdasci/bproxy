---
title: "Phase 8: Agent nickname session scoping"
status: Active
date: 2026-06-19
issue: "#22"
adr: ADR-030
---

## Phase 8: Agent nickname session scoping

**Motivation:** Issue #22 revealed that any CLI caller sharing `BPROXY_HOME` can enumerate and command any active session. In multi-agent orchestration (supervisor + sub-agents), a buggy agent can accidentally interfere with another agent's session — sending commands to a closed or wrong session indefinitely. The current auth model (single daemon token per OS user) provides no isolation between concurrent agents.

**Decision:** [ADR-030](../decisions.md#adr-030-agent-nickname-session-scoping). Add a required agent namespace — the **nick** — that scopes session visibility and command authority.

---

## Design (resolved)

### Nick format and flag

- **Flag:** `--nick` / `-n`, required on every protocol command.
- **Format:** `/^[a-z][a-z0-9]{5}$/` — starts with a letter, exactly 6 lowercase alphanumeric characters.
- **No environment variable.** Explicit on every invocation. No implicit defaults.

### Wire

New required field `nick` in `BproxyRequest` envelope:
```json
{
  "protocol_version": 1,
  "id": "...",
  "action": "scroll",
  "nick": "halbot",
  "session": "m4q7z2",
  "params": { ... },
  "deadline": ...,
  "destructive": true
}
```

**Breaking change:** Adding `nick` as required to `BproxyRequest` is a protocol-level breaking change. All existing tests across cli, service, and shared that construct or validate requests must be updated. The `protocol_version` remains `1` (this is a pre-1.0 project; semver applies at the package level, not the wire protocol version).

### Session ownership

- Daemon stamps `owner: nick` on session creation (`session.create`, `tab.open` auto-create).
- Ownership is immutable for the session lifetime.
- Every command referencing a session validates `session.owner === request.nick`.

### Scoping rules

- `session list` returns only sessions where `owner === request.nick`.
- `debug.status`, `debug.last` are nick-scoped — return only the requesting nick's data.
- `debug.log` is nick-scoped — daemon filters entries by `entry.session` → session owner match (see "debug.log scoping" below).
- `debug.last` and `debug.log` are **bounded live diagnostic surfaces**, not durable history APIs. Once a session is closed and removed from daemon memory, entries for that session are excluded from these API responses.
- Historical visibility lives in daemon structured log files under `BPROXY_HOME/logs/`, correlated via `ownerHash`.
- No unscoped operator surface via API. Operator uses daemon log files for full visibility.

### Nick privacy — ownerHash

- Raw nick **never** appears in persisted output (log files) or API responses.
- Daemon logs emit `ownerHash`: 8 hex chars from `sha256(instanceSalt + nick)`.
- `instanceSalt`: random bytes generated at daemon startup, held in memory only, never persisted, regenerated on restart.
- `session.create` and `tab.open` responses include `ownerHash` (not raw nick) so the agent knows its own hash for log correlation.

```json
{"session":"m4q7z2","tab":"t1","ownerHash":"a3f7c012","tmpDir":"..."}
```

### debug.log scoping

The extension's `TraceEntry` currently lacks a `session` field. The extension already receives `session` in every `BproxyForwardedRequest` but discards it at trace-append time.

**Fix:** Add `session?: string` to `TraceEntry` (shared type). Extension stores the session from the forwarded request when appending. Optional field for backward compatibility with old ring buffer entries.

**Daemon filtering:** When `debug.log` response returns from the extension, daemon filters entries:
- Entry has `session` → check `sessions.get(entry.session)?.owner === request.nick` → include if match
- Entry has `session` but session is closed → exclude
- Entry lacks `session` (old format) → exclude

This is intentional. `debug.log` is a bounded live trace surface. Closing a session closes API visibility into that session's extension trace as well. Historical investigation happens through daemon structured log files using `ownerHash`, not through `debug.log`.

### debug.last scoping

`debug.last` is also a bounded live surface, not a durable history API. The daemon filters trace entries by live session ownership:
- Entry session resolves to a live session whose `owner === request.nick` → include
- Entry session is closed / no longer resolvable → exclude

This keeps the API surface strictly scoped to currently-owned live sessions. Historical cross-session diagnostics remain available only through daemon structured log files.

### Error contract

**New error: `SESSION_SCOPE_MISMATCH`**

| Field | Value |
|-------|-------|
| `code` | `SESSION_SCOPE_MISMATCH` |
| `category` | `policy` |
| `retry` | `never` |
| `message` | `"Session '{id}' does not belong to this agent"` |
| `suggestedAction` | `"This session belongs to another agent. Create your own session with 'bproxy tab open --url ... -n {nick}' or check that you are using the correct --nick value."` |

**Enriched `SESSION_NOT_FOUND`**

| Field | Current | New |
|-------|---------|-----|
| `retry` | `"conditional"` | `"never"` |
| `suggestedAction` | *(absent)* | `"Session '{id}' is permanently closed or never existed. Do not retry. Create a new session with 'bproxy tab open --url ... -n {nick}'. If you need historical diagnostics, inspect BPROXY_HOME/logs/ and correlate entries with your ownerHash."` |

**New error: `RATE_LIMITED`**

| Field | Value |
|-------|-------|
| `code` | `RATE_LIMITED` |
| `category` | `policy` |
| `retry` | `safe` |
| `message` | `"Rate limit exceeded for this agent."` |
| `suggestedAction` | `"Slow down. Wait at least {retryAfter}ms before the next command."` |
| `details` | `{ "retryAfter": <ms> }` |

Used for both minimum interval violations and per-minute rate cap exceeded.

**New error: `METRONOME_DETECTED`**

| Field | Value |
|-------|-------|
| `code` | `METRONOME_DETECTED` |
| `category` | `policy` |
| `retry` | `never` |
| `message` | `"Request timing is too regular. Three consecutive commands arrived at equal intervals (~{N}ms). This pattern is detectable as automation."` |
| `suggestedAction` | `"Do not write scripts or programs to call bproxy in a loop. Control each bproxy command directly — read the result, decide what to do next, then act. If you absolutely must use programmatic control, add random variance to timing. A human does not operate a browser with fixed intervals."` |

### No transfer, no sharing

No grant/transfer verb. Delegation = spawn sub-agent with the same nick.

---

## Daemon-side safety guards

Four mechanisms address the runaway-agent failure mode that nick scoping alone does not cover (an agent hammering its own session):

### Minimum interval (burst guard)

Hard floor on inter-request timing per nick. Any command arriving less than the configured minimum (default 900ms) after the previous command from the same nick is rejected immediately. Humans cannot think, read output, and decide in under 900ms.

Returns `RATE_LIMITED` with `retryAfter` set to remaining milliseconds until the minimum interval passes.

### Metronome detection

The daemon tracks inter-request arrival times per nick. If N consecutive command intervals are equal (within ±tolerance), the Nth command is rejected. This prevents agents from writing scripts that call bproxy in a loop with fixed delays.

**Rules:**
- Track last N+1 arrival timestamps per nick (N = `consecutiveEqual` from config, default 3)
- Intervals compared pairwise: `|interval[i] - interval[i-1]| / interval[i-1] < tolerance`
- Only checked for intervals between `minInterval` (900ms) and `maxIntervalMs` (default 60s). Intervals above `maxIntervalMs` are not suspicious at human timescales.
- **Reset rule:** Streak clears after a rejection OR after any interval that breaks the pattern (non-equal or outside the checked range). The next request starts a fresh tracking window.

### Error-path rate limiting

When the daemon returns an error (any error), it injects a jittered delay (configurable min/max, default 500ms–2s) before responding. This makes runaway loops self-throttling — an agent ignoring `retry: "never"` physically cannot exceed ~1 req/s on error paths.

### Per-nick activity rate cap

Sliding window counter at request ingress. If a nick exceeds the configured requests/minute (default 60), respond with `RATE_LIMITED` error including `retryAfter`.

### Ingress check ordering

All guards execute in this order at request ingress:

```
1. Nick validation (format check) → 400 on malformed
2. Minimum interval check → RATE_LIMITED if too fast
3. Per-nick rate cap → RATE_LIMITED if exceeded
4. Metronome detection → METRONOME_DETECTED if pattern found
5. Session validation (exists, owner matches) → SESSION_NOT_FOUND / SESSION_SCOPE_MISMATCH
6. Pacing (existing, for forwarded actions only) → jittered delay
7. Dispatch
```

Error-path delay is applied at response time (step 7 failure or steps 2–5 rejection), not at ingress.

### Safety guard precedence over pacing mode

`minInterval` is an **absolute ingress floor**. Session pacing mode (`human` / `fast`) may add delay above that floor, but it may not reduce the interval below it.

Concretely:
- `fast` means lower daemon-added pacing than `human`
- `fast` does **not** mean sub-`minInterval`
- no command may execute faster than `safety.minInterval.ms`, regardless of pacing mode

---

## Configuration

All daemon policy parameters are configurable via `BPROXY_HOME/config.json`. The file is optional — daemon uses hardcoded defaults if absent. Loaded once at startup; restart to apply changes.

```json
{
  "pacing": {
    "human": {
      "navigate": { "min": 1500, "max": 4000 },
      "scroll": { "min": 4000, "max": 8000 },
      "interaction": { "min": 1200, "max": 2500 },
      "fill": { "min": 1200, "max": 2500 }
    },
    "fast": {
      "navigate": { "min": 900, "max": 1400 },
      "scroll": { "min": 900, "max": 1600 },
      "interaction": { "min": 900, "max": 1200 },
      "fill": { "min": 900, "max": 1200 }
    }
  },
  "safety": {
    "minInterval": {
      "ms": 900
    },
    "rateCap": {
      "requestsPerMinute": 60
    },
    "errorDelay": {
      "minMs": 500,
      "maxMs": 2000
    },
    "metronome": {
      "tolerance": 0.10,
      "consecutiveEqual": 3,
      "maxIntervalMs": 60000
    }
  }
}
```

### Config semantics

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `pacing.human.navigate` | `1500–4000` | Delay range for `navigate` in human mode |
| `pacing.human.scroll` | `4000–8000` | Delay range for `scroll` in human mode |
| `pacing.human.interaction` | `1200–2500` | Delay range for `click` / `hover` in human mode |
| `pacing.human.fill` | `1200–2500` | Delay range for `fill` / `fill-form` in human mode |
| `pacing.fast.navigate` | `900–1400` | Delay range for `navigate` in fast mode |
| `pacing.fast.scroll` | `900–1600` | Delay range for `scroll` in fast mode |
| `pacing.fast.interaction` | `900–1200` | Delay range for `click` / `hover` in fast mode |
| `pacing.fast.fill` | `900–1200` | Delay range for `fill` / `fill-form` in fast mode |
| `safety.minInterval.ms` | `900` | Absolute minimum ms between consecutive requests from same nick |
| `safety.rateCap.requestsPerMinute` | `60` | Max requests per nick per sliding minute |
| `safety.errorDelay.minMs` | `500` | Minimum jittered delay before error response |
| `safety.errorDelay.maxMs` | `2000` | Maximum jittered delay before error response |
| `safety.metronome.tolerance` | `0.10` | Interval equality threshold (±10%) |
| `safety.metronome.consecutiveEqual` | `3` | How many equal intervals before rejection |
| `safety.metronome.maxIntervalMs` | `60000` | Skip metronome check for intervals above this |

### Startup validation

Daemon startup fails with a meaningful configuration error if:
- config shape contains unknown keys
- any value has the wrong type
- any `{ min, max }` pacing pair has `min > max`
- any pacing minimum is below `safety.minInterval.ms`
- any pacing maximum is below `safety.minInterval.ms`
- `safety.errorDelay.minMs > safety.errorDelay.maxMs`
- safety numeric values are non-positive or otherwise nonsensical

This fail-closed rule is intentional: misconfigured pacing must not silently undercut the ingress safety floor.

The daemon logs the active configuration at startup (`info` level) so the operator can verify what's in effect.

---

## CLI UX examples

```bash
# Bootstrap: open a tab, session auto-created under "halbot"
bproxy tab open --url https://example.com -n halbot
# → {"session":"m4q7z2","tab":"t1","ownerHash":"a3f7c012","tmpDir":"..."}

# Create session explicitly
bproxy session create -n halbot --label research
# → {"session":"p7k2qm","label":"research","ownerHash":"a3f7c012","tmpDir":"..."}

# Normal commands
bproxy text -n halbot -s m4q7z2
bproxy scroll -n halbot -s m4q7z2 --direction down
bproxy click -n halbot -s m4q7z2 --element el3
bproxy session list -n halbot
# → only sessions owned by "halbot"

# Lower-added-delay mode; still cannot bypass safety.minInterval.ms
bproxy session bind -n halbot -s m4q7z2 --tab t1 --pacing fast

# Wrong nick → immediate terminal error
bproxy text -n bobcat -s m4q7z2
# → {"ok":false,"error":{"code":"SESSION_SCOPE_MISMATCH","retry":"never",
#    "suggestedAction":"This session belongs to another agent..."}}

# Session closed → terminal error with guidance
bproxy scroll -n halbot -s m4q7z2
# → {"ok":false,"error":{"code":"SESSION_NOT_FOUND","retry":"never",
#    "suggestedAction":"Session 'm4q7z2' is permanently closed..."}}

# Too fast (< 900ms since last command) → rate limited
bproxy text -n halbot -s m4q7z2
# → {"ok":false,"error":{"code":"RATE_LIMITED","retry":"safe",
#    "details":{"retryAfter":450}}}

# Metronome pattern detected
bproxy scroll -n halbot -s m4q7z2  # at t=0
bproxy scroll -n halbot -s m4q7z2  # at t=5000
bproxy scroll -n halbot -s m4q7z2  # at t=10000
bproxy scroll -n halbot -s m4q7z2  # at t=15000 → rejected
# → {"ok":false,"error":{"code":"METRONOME_DETECTED","retry":"never",
#    "suggestedAction":"Do not write scripts or programs to call bproxy..."}}

# Missing nick → exit 2 (CLI validation, never reaches daemon)
bproxy text -s m4q7z2
# stderr: "Missing required --nick (-n). Every command requires an agent nickname."
```

---

## Implementation tasks

### 1. Shared types (`shared/`)

- [x] Add `Nick` branded type + `isValidNick()` validation (`/^[a-z][a-z0-9]{5}$/`)
- [x] Add `nick` field to `BproxyRequest` type (required)
- [x] Add `session?: string` field to `TraceEntry` type
- [x] Add `SESSION_SCOPE_MISMATCH`, `METRONOME_DETECTED`, `RATE_LIMITED` to `ErrorCode`
- [x] Update `SESSION_NOT_FOUND` documentation/comments: retry is now `"never"`

### 2. CLI (`cli/`)

- [x] Add `--nick` / `-n` to `globalArgs` (required, string)
- [x] Validate nick format at `extractGlobals()` → exit 2 on invalid/missing
- [x] Wire `nick` into `sendAction` → `BproxyRequest` envelope
- [x] Update all tests that construct requests to include `nick`

### 3. Daemon — nick scoping (`service/`)

- [x] Generate `instanceSalt` (32 random bytes) at daemon startup, hold in memory
- [x] Add `computeOwnerHash(salt, nick)` utility: `sha256(salt + nick).hex().slice(0, 8)`
- [x] Add `owner: string` field to internal session state
- [x] Stamp `owner` on `session.create` and `tab.open` auto-create
- [x] Add nick validation at request ingress (400 on malformed)
- [x] Add scope check in `validateSession`: session exists but `owner !== nick` → `SESSION_SCOPE_MISMATCH`
- [x] Filter `session list` by `request.nick`
- [x] Filter `debug.status` by `request.nick`
- [x] Filter `debug.last` by live session owner match; exclude entries for closed/non-resolvable sessions
- [x] Filter `debug.log` response from extension by `entry.session` → owner match; exclude entries for closed sessions
- [x] Enrich `SESSION_NOT_FOUND` error: `retry: "never"`, add `suggestedAction`
- [x] Include `ownerHash` in `session.create` / `tab.open` responses
- [x] Emit `ownerHash` (not raw nick) in structured log entries
- [x] Update request schema validation to require `nick` field
- [x] Update all tests

### 4. Daemon — configuration (`service/`)

- [ ] Define daemon config types for both `pacing` and `safety`
- [ ] Move hard-coded pacing preset defaults out of `shared/` and into daemon config/defaults
- [ ] Load `BPROXY_HOME/config.json` at startup (optional file, missing = all defaults)
- [ ] Validate config shape (reject unknown keys, wrong types) → fail startup on invalid
- [ ] Validate pacing ranges (`min <= max`) and enforce `pacing.*.*.min/max >= safety.minInterval.ms` → fail startup on invalid
- [ ] Log active configuration at startup (`info` level)
- [ ] Wire config values into pacing and safety modules

### 5. Daemon — safety guards (`service/`)

- [ ] Minimum interval tracker: per-nick last-request timestamp
- [ ] Minimum interval check: reject with `RATE_LIMITED` + `retryAfter` if below threshold
- [ ] Metronome detector: track last N+1 arrival timestamps per nick
- [ ] Metronome detector: compute interval equality within configurable tolerance
- [ ] Metronome detector: skip intervals above `maxIntervalMs`
- [ ] Metronome detector: reject on Nth consecutive equal interval with `METRONOME_DETECTED`
- [ ] Metronome detector: reset streak on rejection or pattern break
- [ ] Error-path delay: inject jittered sleep (config min/max) before returning any error response
- [ ] Per-nick rate cap: sliding window counter (config requests/min)
- [ ] Per-nick rate cap: return `RATE_LIMITED` with `retryAfter` in details
- [ ] Ingress ordering: nick validation → min interval → rate cap → metronome → session validation → pacing → dispatch
- [ ] Enforce `minInterval` as absolute precedence over `human` / `fast` pacing mode

### 6. Extension (`extension/`)

- [ ] Store `session` from forwarded request in trace entry (one field addition in dispatcher trace append)
- [ ] Verify `nick` is NOT included in forwarded WS messages (stripped at daemon before dispatch)

### 7. Documentation

- [ ] Update `docs/internal/architecture.md` — mention nick scoping in session authority
- [ ] Update `docs/public/solution/cli.md` — add `--nick` to global flags table, update examples
- [ ] Update `docs/public/solution/service.md` — session ownership, scope validation, safety guards, config file
- [ ] Update `docs/public/solution/shared.md` — new types, new error codes, TraceEntry change
- [ ] Update `docs/public/views/04-session-state.md` — ownership on session creation
- [ ] Update `docs/public/views/06-threat-model.md` — inter-agent isolation via nick, ownerHash in logs

---

## What this does NOT change

- Auth model stays single-token (nick is authorization/namespace, not authentication)
- Single-user scope preserved
- Session ID format unchanged (`/^[a-z2-7]{6}$/`)
- No daemon persistence of nicks (in-memory, cleared on restart)
- Extension receives no new logic or strategy — just stores one additional field in trace

---

## Validation

- `pnpm check` passes (typecheck + format + lint + arch + deadcode)
- `pnpm test` passes (all packages — tests updated for required `nick` field)
- Unit tests: nick validation, scope mismatch, ownership stamp, listing filter, hash computation
- Unit tests: minimum interval rejection, metronome detection + reset, rate cap, error delay
- Unit tests: config loading (valid, invalid, missing file), pacing config validation, debug.log/debug.last closed-session filtering
- Integration: daemon startup fails with meaningful error when pacing config undercuts `safety.minInterval.ms`
- Integration: two agents with different nicks cannot see or touch each other's sessions
- Integration: agent with correct nick can operate its sessions normally
- Integration: `SESSION_NOT_FOUND` returns `retry: "never"` with guidance
- Integration: daemon logs show `ownerHash`, not raw nick
- Integration: metronome detection triggers on equal-interval commands, resets after break
