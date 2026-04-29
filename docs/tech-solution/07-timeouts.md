# 7. Timeouts

[← Index](./README.md) · Prev: [Failure Modes](./06-failure-modes.md) · Next: [Tab Management →](./08-tab-management.md)

---

| Boundary                  | Default | Configurable via |
|---------------------------|---------|------------------|
| CLI → Proxy HTTP          | 30s     | `--timeout <ms>` CLI flag |
| Proxy → Extension WS      | 30s     | hardcoded initially       |
| Navigate action           | 60s     | extended timeout for nav  |
| Wait command (default)    | 10s     | per strategy defaults     |
| Wait --network / --state  | 30s     | per strategy defaults     |
| WS ping/pong              | 10s     | hardcoded                 |
| Content script injection  | 5s      | hardcoded                 |

## Timeout → error code mapping

Timeouts no longer collapse onto a single `EXTENSION_TIMEOUT` bucket. The dispatcher consults its known state at the moment the deadline expires and emits the most specific code in [06-failure-modes.md → Canonical error code table](./06-failure-modes.md#canonical-error-code-table). The disambiguation rules are normative in [06-failure-modes.md → Taxonomy rules](./06-failure-modes.md#taxonomy-rules); summary:

| Boundary that expired         | Dispatcher state at expiry                                     | Emitted code                  |
|-------------------------------|----------------------------------------------------------------|-------------------------------|
| CLI → Proxy HTTP              | TCP refused                                                    | `PROXY_NOT_RUNNING`           |
| Proxy → Extension WS          | No WS in the connection slot                                   | `NO_CONNECTION`               |
| Proxy → Extension WS          | WS connected, no ack from SW                                   | `EXTENSION_UNRESPONSIVE`      |
| Content script call           | Top-frame `onCommitted` fired during the action                | `NAVIGATED_DURING_ACTION`     |
| Content script call           | Targeted subframe missing from `frameTable`                    | `FRAME_DETACHED`              |
| Content script call           | Tab URL hits `isRestricted` (caught at SW pre-flight, not by deadline) | `RESTRICTED_URL`      |
| Content script call           | Page is loading and waiter not satisfied                       | `WAIT_TIMEOUT`                |
| `bproxy wait settle`          | Adaptive quiescence window never closed                         | `NEVER_SETTLED`               |
| Content script injection      | `bproxy-ready` ack never arrived                                | `EXTENSION_UNRESPONSIVE`      |
| Navigate action               | `chrome.tabs.update` rejected                                   | `NAVIGATION_FAILED`           |

The legacy `EXTENSION_TIMEOUT` code is **deprecated** and MUST NOT appear on the wire. See [06-failure-modes.md → Deprecated codes](./06-failure-modes.md#deprecated-codes). The CLI / proxy / extension all carry a lint rule forbidding it; the testing matrix in [10-testing.md](./10-testing.md) asserts it.

`retryAfterMs` is set on `NO_CONNECTION` (`30000`, one alarm cycle), `QUEUE_FULL` (`5000`), and `EXTENSION_UNRESPONSIVE` (`1000`). All other codes leave it absent — there is no deterministic floor the proxy can promise.
