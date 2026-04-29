# 11. Implementation Order

[← Index](./README.md) · Prev: [Testing Strategy](./10-testing.md)

---

## Phase 1 — Vertical slice (prove the loop works)

1. Proxy service: HTTP + WS relay with timeout handling.
2. Extension: background.js (WS client + navigate + screenshot) + content.js (click, type, text).
3. CLI: single script, all commands, JSON output with error codes.
4. Manual test: navigate → text → click → screenshot.

## Phase 2 — Page awareness

5. Page state detection: MutationObserver settle logic, busy indicators, `page` context block on all responses.
6. `wait` command (settle + selector + hidden strategies).
7. SPA navigation detection (URL polling + popstate).
8. Navigate command: wait for settle after load, not just load event.

## Phase 3 — Agent ergonomics

9. `elements` command.
10. `images` command.
11. `outline` command.
12. `dom` command.
13. `status` command.
14. `eval` with main-world injection.
15. Content script auto-re-injection on navigation.

## Phase 4 — Robustness

16. `wait --network` (fetch/XHR interception).
17. Tab management (`tabs`, `tab`).
18. Proxy request log.
19. End-to-end test suite.
20. `bproxy start` daemon mode (auto-start proxy from CLI).
