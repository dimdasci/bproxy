# Phase 05b — Code quality review

**Date:** 2026-06-14
**Branch reviewed:** `fix/security-gaps`
**Reviewer task:** Review current branch code quality for the Phase 05b security hardening work and SonarCloud-driven fixes.

## Prerequisite documentation for the developer

Before addressing this review, read these documents in full and keep the implementation aligned with them:

1. `docs/internal/plans/phases/05b-pairing-rate-limit-hardening.md` — scope and acceptance criteria for the pairing rate-limit hardening.
2. `docs/internal/decisions.md` — authoritative ADRs, especially:
   - ADR-010 WebSocket auth / two-token model
   - ADR-011 popup-driven pairing
   - ADR-025 security scanner findings are remediated in code
   - ADR-028 temporary files confined to `BPROXY_HOME`
3. `docs/internal/architecture.md` — daemon authority, pairing flow, session model, and sensor/actuator boundary.
4. Public specs that must stay code-synchronized:
   - `docs/public/solution/service.md`
   - `docs/public/solution/extension.md`
   - `docs/public/solution/cli.md`
   - `docs/public/views/06-threat-model.md`
5. `docs/internal/quality-gates.md` — expected static-analysis and `pnpm check` surface.

## Verdict

Not merge-ready yet. The pairing rate-limit implementation itself is solid and well covered, but the branch is not fully compliant with ADR-025/ADR-028 and still leaves Sonar-relevant security patterns in production/test code.

## What looks good

- `/pair/claim` implements the planned global in-memory failed-attempt limiter.
- Error shape is normalized to code-only envelopes for route-handled pairing failures.
- Popup recognizes and surfaces `PAIRING_RATE_LIMITED`.
- Pairing tests cover schema failures, invalid/expired/consumed codes, lockout, fake-time expiry, success path, and valid-code-during-lockout.
- Validation passed during review:
  - `pnpm check`
  - `pnpm -r test`
  - `pnpm docs:build`

## Blockers / findings

### 1. ADR-028 is not actually enforced for `BPROXY_HOME` permissions

ADR-028 states `BPROXY_HOME` is created with mode `0o700`, but current code uses default directory mode:

- `service/src/lifecycle.ts:26`
- `service/src/pairing-file.ts:30`
- `service/src/logger.ts:6` creates log dir without explicit secure mode

This can leave `~/.bproxy` world-searchable depending on umask, while docs claim user-only access.

### 2. `os.tmpdir()` is still used widely in tests

ADR-028 explicitly forbids `os.tmpdir()` in tests. Current branch still has many call sites, for example:

- `cli/src/__tests__/client.test.ts:2`, `:82`
- `cli/src/__tests__/command-test-helpers.ts:8`, `:15`
- `cli/src/__tests__/screenshot-file.test.ts:15`
- `service/src/__tests__/lifecycle.test.ts:3`, `:60`
- `service/src/__tests__/lifecycle-contract.test.ts:44`, `:257`, `:258`

This means the Sonar S5443 remediation is incomplete by the branch's own ADR.

### 3. ADR-028 cleanup contract is only partially implemented

`service/src/session-tmp.ts:42` wipes only `BPROXY_HOME/tmp/sessions`, but ADR-028 says daemon startup/shutdown wipes `BPROXY_HOME/tmp/` and removes orphaned atomic `*.tmp` siblings.

Also, `pairing-file.ts` creates `${path}.${pid}.tmp`, but startup cleanup does not remove stale siblings.

### 4. SonarCloud security hotspots remain unresolved

SonarCloud API currently has only `main` analyzed, not this branch, but unresolved hotspot patterns still exist locally. Production examples:

- `service/src/auth.ts:48` — regex hotspot on bearer parsing
- `extension/src/content/actions/fill.ts:129` — `Math.random()`
- `extension/src/content/polling.ts:211` — `Math.random()`
- `extension/src/entrypoints/background.ts:122` — `Math.random()`
- `service/src/server.ts:109` — `Math.random()`

ADR-025 says security findings/hotspots must be remediated in code, not marked safe or suppressed. POC hotspots are exempt, but these production/test locations are not.

### 5. Public service docs are stale for `tmpDir`

Code now returns `tmpDir` from `session.create`, but docs still say:

- `docs/public/solution/service.md:160` — returns `{ session, label? }`

This conflicts with ADR-028 and the current shared action contract.

### 6. `git diff --check` fails

Trailing whitespace in:

- `docs/internal/plans/phases/05b-pairing-rate-limit-hardening.md:3`
- `docs/internal/plans/phases/05b-pairing-rate-limit-hardening.md:4`

## Recommendation

Before merge:

1. Enforce `0o700` state/log/tmp directory creation and handle pre-existing insecure dirs.
2. Replace all remaining test `os.tmpdir()` usage with package-local `.tmp/test-*` helpers.
3. Implement full `BPROXY_HOME/tmp` and orphan `*.tmp` cleanup per ADR-028.
4. Remediate non-POC Sonar hotspots in code/tests.
5. Update public docs for `tmpDir`.
6. Fix trailing whitespace so `git diff --check` passes.
