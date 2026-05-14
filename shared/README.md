# @bproxy/shared

The domain model shared by CLI, daemon, and extension. Types only — no runtime code except `PACING_PRESETS` (a const object that inlines at compile time).

## Public API

Single entry point: [`src/index.ts`](./src/index.ts). Re-exports from:
- `protocol.ts` — `BproxyRequest`, `BproxyResponse`, `PageState`
- `actions.ts` — `Action`, `ActionParams`, `ActionResult`, supporting types
- `errors.ts` — `ErrorCode`, `BproxyError`
- `sessions.ts` — `PacingMode`, `PACING_PRESETS`, `SessionInfo`, `TabInfo`

## Development

```bash
pnpm --filter @bproxy/shared typecheck   # type-check (the only correctness gate for a types-only package)
```
