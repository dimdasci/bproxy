# @bproxy/shared

The domain model shared by CLI, daemon, and extension. Types only — no runtime code except `PACING_PRESETS` (a const object that inlines at compile time).

Phase 5 models daemon-generated session capability handles, session-scoped logical tab handles, daemon-local session lifecycle actions, `links` extraction, and the daemon↔extension forwarded-request shape where `target.tabId` may be `null` for background-handled tab actions. Handle types are intentionally narrower than plain `string` (`SessionId` is branded; `TabHandle` is branded and `t${number}`-shaped) so consumers cannot pass arbitrary strings without an explicit validation/cast point.

## Public API

Single entry point: [`src/index.ts`](./src/index.ts). Re-exports from:
- `protocol.ts` — `BproxyRequest`, `BproxyResponse`, `PageState`
- `actions.ts` — `Action`, `ActionParams`, `ActionResult`, supporting types (`LinkInfo`, `ElementTarget`, traces, etc.)
- `errors.ts` — `ErrorCode`, `BproxyError`
- `sessions.ts` — `PacingMode`, `PACING_PRESETS`, `SessionId`, `TabHandle`, `SessionInfo`, `TabInfo`

## Development

```bash
pnpm --filter @bproxy/shared typecheck   # type-checks source plus compile-time contract assertions
```
