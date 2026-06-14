# Pairing route implementation gaps

**Date:** 2026-06-14  
**Context:** Discovered during docs consistency audit (fix/docs-consistency branch)

## Gap 1: Rate limiting not implemented

`service.md` § Pairing Bootstrap Route lists "per-source rate limit (e.g. 5/min)" as a current validation/security check. The code has no rate limiter — `service/src/routes/pair.ts` validates the code and returns immediately.

The threat model (`06-threat-model.md`) correctly notes "full per-source limiter is deferred" and the "Still out of scope" section lists "Enforced pairing-code rate limiting beyond the current structural plumbing." The error table fix (this branch) notes `PAIRING_RATE_LIMITED` is not yet implemented.

**Remaining action:** Remove "per-source rate limit (e.g. 5/min)" from the Pairing Bootstrap Route validation checklist in `service.md`, or rephrase as future work inline. Then decide whether to implement rate limiting before v1 or leave it as accepted risk given the structural mitigations (one-time code, 5-min TTL, constant-time compare, Origin gate).

## Gap 2: Inconsistent error response shape within the pairing route

The pair/claim route returns two slightly different error shapes:

```typescript
// Body parse failure (missing/malformed code field):
reply.code(400).send({ ok: false, error: { code: "PAIRING_CODE_INVALID", message: "code required" } });

// Claim failure (invalid/expired/consumed):
reply.code(401).send({ ok: false, error: { code: r.code } });
```

The first includes `message`, the second does not. The popup handles both (it only reads `code`), so this isn't a bug — but it means the pairing error contract is underspecified. A consistent shape would be either always `{ code, message }` or always just `{ code }`.

**Remaining action:** Pick one shape and align both paths. If `message` is useful for debugging, always include it. If minimalism is the goal, drop it from the 400 path too.

## Priority

Low. Both gaps are in a localhost-only pairing flow protected by Origin gate + one-time code + short TTL. They should be addressed before any documentation claims "shipped" rate limiting, but are not blocking.
