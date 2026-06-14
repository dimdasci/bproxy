# Phase 05b — Pairing rate-limit hardening

**Date:** 2026-06-14  
**Status:** Implemented  
**Context:** v1 hardening pass; close pairing-route security/documentation gap with minimal viable localhost-appropriate protection.

## Implementation status

Implemented on 2026-06-14.

Shipped changes:
- Added `service/src/pairing-rate-limit.ts` with a daemon-local, global, in-memory fixed-window limiter: 5 route-handled failures / 60s.
- Wired the limiter into `service/src/routes/pair.ts` before body validation and pairing claim.
- Added `buildServer` / `pairRoute` injection seams for limiter or fake-time tests.
- Normalized route-handled `/pair/claim` failures to `{ ok: false, error: { code } }`.
- Added `PAIRING_RATE_LIMITED` popup pass-through and friendly popup copy.
- Updated public service, extension, and threat-model docs plus the internal architecture pairing summary.
- Added limiter unit tests and `/pair/claim` route tests for schema failures, invalid/expired/consumed failures, lockout, fake-time expiry, successful claims, success after prior failures, and valid-code-during-lockout.

Validation run:
- `pnpm --filter @bproxy/service test`
- `pnpm --filter @bproxy/extension test`
- `pnpm typecheck`
- `pnpm format`
- `pnpm lint`
- `pnpm arch`
- `pnpm deadcode`

## Prerequisite reading

Before implementing, read these documents in full so the rate-limit change stays aligned with the project architecture, auth model, and documentation contract:

1. `docs/internal/architecture.md` — system shape, pairing flow, daemon authority, and design principles.
2. `docs/internal/decisions.md` — especially:
   - ADR-003 Fastify
   - ADR-010 WebSocket auth / two-token model
   - ADR-011 popup-driven pairing
   - ADR-019/020 public architecture views contract
   - ADR-025 security findings remediated in code
3. `docs/internal/journal/2026-06-14-pairing-route-implementation-gaps.md` — original feature request / gap statement.
4. Public documentation entrypoint and all referenced public specs/views:
   - `docs/public/index.md`
   - `docs/public/views/01-context.md`
   - `docs/public/views/02-containers.md`
   - `docs/public/views/03-deployment.md`
   - `docs/public/views/04-session-state.md`
   - `docs/public/views/06-threat-model.md` (**especially important**)
   - `docs/public/solution/service.md`
   - `docs/public/solution/extension.md`
   - `docs/public/solution/cli.md`
   - `docs/public/solution/shared.md`

Implementation must preserve the documented constraints: localhost-only daemon, route-specific auth, `/pair/claim` body-auth with Host/Origin/Sec-Fetch ingress checks, popup-driven extension bootstrap, code-as-doc synchronization, and honest threat-model wording that does not claim stronger guarantees than shipped.

## Goal

Close the pairing-route security/documentation gap with a **minimal, honest, localhost-appropriate rate limiter** on `POST /pair/claim`, and align docs with the actual shipped behavior.

## Scope

This task includes:

1. Implementing pairing claim rate limiting
2. Normalizing pairing error responses
3. Updating public docs and threat-model wording
4. Adding tests that prove the behavior

This task does **not** include:

- persistent rate-limit state
- per-IP / per-origin attribution claims
- distributed/DDoS protection
- changes to CLI or extension UX beyond consuming the existing error code

---

## Design

### 1) Limiter model

Use a **global in-memory failed-attempt limiter** for `POST /pair/claim`.

Reason:
- localhost source identity is weak
- “per-source” would overstate what we can actually guarantee
- global throttle is simpler, honest, and sufficient as “foolproofing”
- daemon-owned in-memory state is consistent with the current session/pairing authority model

### 2) Minimal semantics

- **Window:** 60 seconds
- **Budget:** 5 failed attempts per window
- **Algorithm:** fixed window anchored at the first counted failure
  - first failure when no active window exists starts `windowStart = now` and `failures = 1`
  - failures 1–5 within `now < windowStart + 60_000` are allowed to reach normal pairing validation
  - the 6th and later request while the window is active is rejected before body validation / claim
  - when `now >= windowStart + 60_000`, reset the window and allow attempts again
- **Failure attempts that count:**
  - parsed JSON body is missing `code`, has non-string `code`, or has extra fields rejected by the strict schema
  - `PAIRING_CODE_INVALID`
  - `PAIRING_CODE_EXPIRED`
  - `PAIRING_CODE_CONSUMED`
- **Invalid JSON syntax:** may be rejected by Fastify before the pair route handler runs; it is out of scope for this minimal route-level limiter unless the implementation adds an explicit parse-error handler.
- **Successful claim:** does **not** count
- **When limited:**
  - reject **all** `/pair/claim` attempts until the window expires, including attempts that might otherwise contain the valid pairing code
  - return **HTTP 429**
  - return `{ ok: false, error: { code: "PAIRING_RATE_LIMITED" } }`

### 3) Error contract

Normalize pairing route failures to a single minimal envelope:

```json
{ "ok": false, "error": { "code": "..." } }
```

Applies to route-handled failures:
- 400 parsed body schema failure → `PAIRING_CODE_INVALID`
- 401 invalid/expired/consumed
- 429 rate limited

No `message` field in the route response.

### 4) Observability

Add lightweight logs:
- limiter reject event
- pairing failure code
- pairing success

No sensitive request-body logging.

---

## Code tasks

### Task 1 — Add a tiny limiter module

Create a small in-memory utility in `service/src/`, e.g.:
- `service/src/pairing-rate-limit.ts`

Responsibilities:
- injected clock (`now`)
- fixed-window logic matching the semantics above
- no persistence and no per-source attribution
- API like:
  - `isLimited(): boolean`
  - `recordFailure(): void`
  - `reset()` optional for tests only, if useful

Keep it tiny and self-contained.

### Task 2 — Wire limiter into the route

Update:
- `service/src/routes/pair.ts`

Behavior order:
1. check limiter state first
   - if limited: return `429 / PAIRING_RATE_LIMITED`
2. validate parsed body
   - missing/non-string `code`, or schema-rejected extra fields => count failure + return `400 / PAIRING_CODE_INVALID`
3. attempt claim
   - failed claim => count failure + return `401 / <code>`
4. successful claim
   - activate token
   - return success
   - do not increment limiter

This means a valid code submitted during an active lockout is rejected with `PAIRING_RATE_LIMITED`. That is intentional for a global throttle.

### Task 3 — Pass deps through server setup

Update route deps and server wiring so the limiter is created once per daemon instance and injected into the pair route.

Test seam requirement:
- route/integration tests must be able to inject either the limiter or its clock through `pairRoute` / `buildServer` options
- tests must not sleep for the real 60-second window

Likely touched files:
- `service/src/routes/pair.ts`
- `service/src/server.ts`
- possibly `service/src/lifecycle.ts` if construction happens there

### Task 4 — Normalize error shape

Ensure all pair-route failures use:
- `{ ok: false, error: { code } }`

Remove the body-parse special-case `message`.

---

## Test tasks

### Task 5 — Unit test the limiter

Add tests for the limiter module:
- allows first 5 failures
- blocks on 6th within window
- resets after window expiry
- success path does not affect counters if modeled there, otherwise route-level only

### Task 6 — Route/integration tests for `/pair/claim`

Update/add tests under `service/src/__tests__/` to prove:

1. **Parsed body schema failure**
   - missing/non-string `code`, or strict-schema extra fields, returns `400`
   - body shape is code-only
   - counts toward limit

2. **Invalid claim**
   - returns `401 / PAIRING_CODE_INVALID`
   - counts toward limit

3. **Expired / consumed**
   - count toward limit

4. **Rate limit reached**
   - after 5 failed attempts, next attempt returns `429 / PAIRING_RATE_LIMITED`

5. **Window expiry**
   - after time advances, attempts are allowed again

6. **Successful claim**
   - does not consume failure budget

7. **Success after prior failures**
   - still succeeds if below limit

8. **Valid code during lockout**
   - after the failure budget is exhausted, even the valid pairing code returns `429 / PAIRING_RATE_LIMITED` until the window expires

### Task 7 — Extension popup compatibility tests

Update popup tests only as needed to prove:
- `PAIRING_RATE_LIMITED` is forwarded correctly by the popup pairing logic

Likely file:
- `extension/src/entrypoints/popup/__tests__/pairing.test.ts`

Also update accepted daemon error codes in:
- `extension/src/entrypoints/popup/pairing.ts`

So popup can surface `PAIRING_RATE_LIMITED` instead of collapsing to transport error.

Update extension-facing documentation in Task 10 so the daemon pass-through list stays in sync.

---

## Documentation tasks

### Task 8 — Update service spec

Update:
- `docs/public/solution/service.md`

Changes:
1. Pairing Bootstrap Route validation/security checklist
   - replace “per-source rate limit” with accurate wording:
     - **global in-memory failed-attempt throttle (5 failures / 60s)**
2. Failure codes
   - include `PAIRING_RATE_LIMITED`
3. Pairing error contract section
   - keep simplified envelope `{ ok: false, error: { code } }`
4. add wording that this limiter is:
   - localhost-scoped
   - best-effort
   - not a strong source-identity control

### Task 9 — Update threat model

Update:
- `docs/public/views/06-threat-model.md`

Changes:
1. Replace language saying limiter is deferred
2. Describe shipped mitigation accurately:
   - one-time code
   - 5-min TTL
   - constant-time compare
   - Origin gate
   - **global failed-attempt throttle on `/pair/claim`**
3. Remove “Enforced pairing-code rate limiting…” from “Still out of scope”
4. Keep clear that this is **not** DDoS-grade or strong attribution-based defense

### Task 10 — Update extension spec and cleanup stale references

Update:
- `docs/public/solution/extension.md`

Changes:
- Popup pairing UI daemon pass-through error list must include `PAIRING_RATE_LIMITED`.

Also grep for stale references and update maintained/public docs that say rate limiting is deferred or unimplemented.

Likely candidates if needed:
- `docs/internal/architecture.md` pairing security properties (add the global failed-attempt throttle if the section is kept normative)
- phase notes / maintained internal plans
- any public-facing references surfaced by grep

Do not rewrite historical journal entries unless the project convention treats them as mutable; they may remain as audit trail.

---

## Acceptance criteria

This task is done when:

1. `/pair/claim` enforces a **global 5 failed attempts / 60s** throttle
2. throttle returns:
   - HTTP `429`
   - `{ ok: false, error: { code: "PAIRING_RATE_LIMITED" } }`
3. all route-handled pairing failures use one consistent **code-only** shape
4. extension popup recognizes `PAIRING_RATE_LIMITED`
5. tests cover limiter behavior and route semantics, including valid-code attempts during lockout and fake-time window expiry
6. docs describe the implementation exactly, without claiming stronger guarantees than shipped

---

## Recommended file touch set

Expected primary files:

- `service/src/routes/pair.ts`
- `service/src/server.ts`
- `service/src/pairing-rate-limit.ts` ← new
- `service/src/__tests__/...` relevant pairing/auth/route tests
- `extension/src/entrypoints/popup/pairing.ts`
- `extension/src/entrypoints/popup/__tests__/pairing.test.ts`
- `docs/public/solution/service.md`
- `docs/public/solution/extension.md`
- `docs/public/views/06-threat-model.md`
- `docs/internal/architecture.md` if its pairing security summary remains normative

If implemented as planned, this will close the pairing rate-limit gap with minimal viable protection appropriate for the localhost threat model while keeping documentation honest about the guarantee level.
