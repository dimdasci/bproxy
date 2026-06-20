# Error Codes

## Shape

```json
{ "ok": false, "error": { "code": "...", "category": "...", "retry": "safe|conditional|never", "message": "...", "suggestedAction": "..." } }
```

## Retry semantics

- `safe` → retry after waiting (respect `retryAfter` if present)
- `conditional` → fix the condition first, then retry
- `never` → request is wrong, fix params. **Do not retry.**

## By category

### Transport

| Code | Retry | Recovery |
|------|-------|----------|
| `NO_EXTENSION` | conditional | Extension not connected. Operator checks extension + pairing. |
| `TIMEOUT` | safe | Page slow. `wait` first, increase `--timeout`. |
| `OVERLOADED` | safe | Wait 1-2s, retry. |

### Target

| Code | Retry | Recovery |
|------|-------|----------|
| `ELEMENT_NOT_FOUND` | conditional | Re-read (`elements`/`links`). |
| `ELEMENT_NOT_ACTIONABLE` | conditional | Hidden/disabled/covered. `inspect` → scroll or wait. |
| `SELECTOR_AMBIGUOUS` | never | Matched >1. Use handle or narrow selector. |
| `SESSION_NOT_FOUND` | never | Session permanently closed or never existed. **Do not retry.** `tab open --url` for new session. |
| `INVALID_SESSION_ID` | never | Must match `/^[a-z2-7]{6}$/`. |
| `TAB_HANDLE_NOT_FOUND` | conditional | `tab list` to see available. |
| `TAB_NOT_IN_SESSION` | never | Wrong session. |
| `ELEMENT_HANDLE_NOT_FOUND` | conditional | Expired/evicted. Re-read. |
| `ELEMENT_HANDLE_STALE` | conditional | Page navigated. Re-read. |
| `ELEMENT_HANDLE_SCOPE_MISMATCH` | never | Handle from different session/tab. |

### Policy

| Code | Retry | Recovery |
|------|-------|----------|
| `HUMAN_REQUIRED` | conditional | **Stop.** Tell operator. Wait. `session resume`. |
| `SESSION_REQUIRED` | never | Add `-s <id>` or bootstrap with `tab open --url`. |
| `SESSION_SCOPE_MISMATCH` | never | Session belongs to another agent. Check your `--nick` value. Create your own session with `tab open --url ... -n <nick>`. |
| `RATE_LIMITED` | safe | Too fast. Wait `details.retryAfter` ms before next command. |
| `METRONOME_DETECTED` | never | Fixed-interval pattern detected. **Stop scripting.** Vary timing between commands. Do not use programmatic loops with fixed delays. |
| `DEBUGGER_DISABLED` | never | Remove `--debugger` flag. |

### Execution

| Code | Retry | Recovery |
|------|-------|----------|
| `SCRIPT_ERROR` | conditional | Retry once. If persistent, page may block scripts. |
| `NAVIGATION_FAILED` | conditional | Check URL validity. |
| `TAB_NOT_VISIBLE` | conditional | Tab not in foreground. Ask operator to switch or use `--activate`. |

## Recovery patterns

**Stale handles** → re-read, get fresh handles, retry with new handle.

**Timeout on slow page** → `wait --strategy selector --target "main"` → retry.

**Human intervention** → `require-human` → operator resolves → `session resume` → continue.

**Session lost** → `tab open --url "..." -n <nick>` → new session id → continue. Do not retry the old session.

**Rate limited** → wait `retryAfter` ms from `error.details`, then retry the same command.

**Scope mismatch** → you're using the wrong `--nick` or trying to access another agent's session. Use only sessions you created.
