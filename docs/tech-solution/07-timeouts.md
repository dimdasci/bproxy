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

All timeouts produce `EXTENSION_TIMEOUT` error with `retry: true`.
