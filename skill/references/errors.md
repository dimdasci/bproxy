# Error Codes Reference

All error codes returned by bproxy, organized by category with retry guidance and recovery patterns.

## Error response shape

Every error response follows this structure:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "category": "transport|target|policy|execution",
    "retry": "safe|conditional|never",
    "message": "Human-readable description",
    "suggestedAction": "What to do next",
    "details": {}
  }
}
```

## Retry semantics

| Retry value | Meaning | Agent action |
|-------------|---------|--------------|
| `safe` | Retry immediately with the same request | Retry up to 2-3 times with brief delay |
| `conditional` | Retry after addressing the condition | Read the `suggestedAction`, take corrective action, then retry |
| `never` | The request shape is fundamentally wrong | Fix the command parameters |

---

## Transport errors

Connection and communication failures between CLI, daemon, and extension.

| Code | Retry | Recovery |
|------|-------|----------|
| `NO_EXTENSION` | `conditional` | Extension not connected. Ask operator to check extension is loaded and paired. Run `bproxy doctor`. |
| `TIMEOUT` | `safe` | Request timed out. Page may be loading slowly. Use `wait` before retrying. Increase `--timeout` if needed. |
| `OVERLOADED` | `safe` | Daemon is at capacity. Wait 1-2 seconds, then retry. |
| `WS_DISCONNECTED` | `conditional` | WebSocket dropped. Extension may have reloaded. Wait briefly, then retry — daemon will reconnect. |

---

## Target errors

The specified element, session, or tab could not be found or used.

| Code | Retry | Recovery |
|------|-------|----------|
| `TAB_NOT_FOUND` | `conditional` | Chrome tab no longer exists. Open a new tab with `tab open --url`. |
| `ELEMENT_NOT_FOUND` | `conditional` | Selector matched nothing. Re-read with `elements` or `links` to get fresh selectors/handles. |
| `ELEMENT_NOT_ACTIONABLE` | `conditional` | Element exists but is hidden, disabled, or covered. Use `inspect` to check visibility. Try scrolling or waiting. |
| `SELECTOR_AMBIGUOUS` | `never` | Multiple elements match. Use a more specific selector or use element handles from `elements`. |
| `INVALID_SESSION_ID` | `never` | Session id is malformed (must be 6 chars, base32 lowercase: `/^[a-z2-7]{6}$/`). Fix the `-s` value. |
| `SESSION_NOT_FOUND` | `conditional` | Session doesn't exist — was it closed? Create a new one with `tab open --url`. |
| `TAB_HANDLE_NOT_FOUND` | `conditional` | Logical tab (e.g., `t3`) doesn't exist in this session. Use `tab list -s <id>` to see available tabs. |
| `TAB_NOT_IN_SESSION` | `never` | Tab handle belongs to a different session. Use the correct session id. |
| `ELEMENT_HANDLE_NOT_FOUND` | `conditional` | Handle doesn't exist in cache. Re-read with `elements` or `links` to get fresh handles. |
| `ELEMENT_HANDLE_STALE` | `conditional` | Page navigated since handle was minted. Re-read to get handles for the current page. |
| `ELEMENT_HANDLE_SCOPE_MISMATCH` | `never` | Handle belongs to a different session/tab/page. Use handles only within the session and tab they were returned from. |

---

## Policy errors

Access control, rate limiting, and human-intervention requirements.

| Code | Retry | Recovery |
|------|-------|----------|
| `HUMAN_REQUIRED` | `conditional` | Page shows CAPTCHA, login, consent, or other interstitial. **Stop automation.** Inform operator. After they resolve it in the browser: `bproxy session resume -s <id>`. |
| `DEBUGGER_DISABLED` | `never` | The `--debugger` flag was used but debugger mode is not enabled. Remove `--debugger` flag or enable in daemon config. |
| `SESSION_REQUIRED` | `never` | Browser command needs `-s <id>`. Either pass a session from a previous `tab open`, or bootstrap with `tab open --url`. |

---

## Execution errors

Runtime failures during action execution in the extension.

| Code | Retry | Recovery |
|------|-------|----------|
| `SCRIPT_ERROR` | `conditional` | Content script failed. Often transient — retry once. If persistent, the page may block script execution. |
| `NAVIGATION_FAILED` | `conditional` | URL navigation failed (network error, invalid URL). Check the URL and retry. |
| `TAB_NOT_VISIBLE` | `conditional` | Tab must be visible for this action (e.g., screenshot). Ask operator to ensure tab is in foreground, or use `--activate`. |

---

## Agent recovery patterns

### Pattern: Re-read after stale handles

```bash
# Handle is stale after navigation
bproxy click -s <id> --element el3
# -> ELEMENT_HANDLE_STALE

# Fix: re-read to get fresh handles
bproxy elements -s <id>
# -> new handles: el1, el2, el3...
bproxy click -s <id> --element el1
```

### Pattern: Wait then retry on timeout

```bash
# Timeout on slow page
bproxy text -s <id>
# -> TIMEOUT

# Fix: wait for page to settle, then retry
bproxy wait -s <id> --strategy selector --target "main"
bproxy text -s <id>
```

### Pattern: Human intervention flow

```bash
# CAPTCHA detected
bproxy navigate -s <id> --url "https://protected-site.com"
# -> HUMAN_REQUIRED: "CAPTCHA detected"

# Tell operator, wait for them to resolve it
# ... operator solves CAPTCHA in browser ...

bproxy session resume -s <id>
# Session unpaused, continue automation
bproxy text -s <id>
```

### Pattern: Session recovery

```bash
# Session lost (daemon restarted)
bproxy text -s m4q7z2
# -> SESSION_NOT_FOUND

# Fix: create new session
bproxy tab open --url "https://example.com"
# -> { session: "n5k7qa", tab: "t1", ... }
# Continue with new session id
```
