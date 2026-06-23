# Error Codes

Shape:

```json
{ "ok": false, "error": { "code": "...", "category": "transport|target|policy|execution", "retry": "safe|conditional|never", "message": "...", "suggestedAction": "...", "details": {} } }
```

Retry:
- `safe` → wait, then retry if still useful. Respect `details.retryAfter`.
- `conditional` → fix condition first.
- `never` → request/pattern wrong. Do not repeat unchanged.

## Transport

| Code | Retry | Recovery |
|------|-------|----------|
| `NO_EXTENSION` | conditional | Operator checks extension paired/connected. |
| `WS_DISCONNECTED` | conditional | Extension link dropped. Wait/reconnect, then retry non-destructive only. |
| `TIMEOUT` | safe | Page slow. `wait`, increase `--timeout`, retry once. |
| `OVERLOADED` | safe | Wait 1–2s, retry. |

## Target

| Code | Retry | Recovery |
|------|-------|----------|
| `ELEMENT_NOT_FOUND` | conditional | Re-read `elements`/`links`; target may not exist. |
| `ELEMENT_NOT_ACTIONABLE` | conditional | Hidden/disabled/covered. `inspect`, scroll, wait, or human. |
| `SELECTOR_AMBIGUOUS` | never | Selector matched >1. Use handle or narrower selector. |
| `INVALID_SESSION_ID` | never | Session id must match `/^[a-z2-7]{6}$/`. |
| `SESSION_NOT_FOUND` | never | Closed/never existed. Open new session. Do not retry old id. |
| `TAB_HANDLE_NOT_FOUND` | conditional | `tab list`, use existing `tN`. |
| `TAB_NOT_IN_SESSION` | never | Tab handle from wrong session. |
| `ELEMENT_HANDLE_NOT_FOUND` | conditional | Expired/evicted. Re-read. |
| `ELEMENT_HANDLE_STALE` | conditional | Page changed. Re-read. |
| `ELEMENT_HANDLE_SCOPE_MISMATCH` | never | Handle from another session/tab/page. |

## Policy

| Code | Retry | Recovery |
|------|-------|----------|
| `HUMAN_REQUIRED` | conditional | Stop. Tell operator. After fix: `session resume`. |
| `SESSION_REQUIRED` | never | Add `-s <id>` or start with `tab open --url`. |
| `SESSION_SCOPE_MISMATCH` | never | Wrong nick/session. Use your own nick/session. |
| `RATE_LIMITED` | safe | Wait `details.retryAfter` ms before next command. |
| `METRONOME_DETECTED` | never | Fixed-interval loop detected. Stop loop; do not retry same pattern. |
| `DEBUGGER_DISABLED` | never | Remove `--debugger`. |

## Execution

| Code | Retry | Recovery |
|------|-------|----------|
| `SCRIPT_ERROR` | conditional | Retry once after wait. If persistent, change method/target or human. |
| `NAVIGATION_FAILED` | conditional | Check URL/reachability. |
| `TAB_NOT_VISIBLE` | conditional | Run `tab activate -n <nick> -s <id> [--tab tN]`, then retry. |

## Patterns

- Stale handle → re-read, use new `elN`/`lnN` only.
- Slow page → `wait --strategy selector --target "main"`, then retry.
- Human blocker → `require-human`, wait, `session resume`, continue.
- Lost session → `tab open --url ... -n <nick>`; old id is dead.
- Rate limited → wait exact `retryAfter`; avoid burst/fixed cadence.
- Scope mismatch → verify nick and session owner; do not guess other nicks.
