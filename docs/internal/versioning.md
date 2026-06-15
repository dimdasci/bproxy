---
title: Versioning Policy
---

## Package version

bproxy uses [Semantic Versioning 2.0.0](https://semver.org/) for the published `@anthropics/bproxy` npm package.

| Bump | Trigger |
|------|---------|
| **Major** (1.0.0) | Breaking change to CLI output shape, removal of commands, breaking state directory layout change |
| **Minor** (0.2.0) | New commands, new action types, new optional fields in output, new CLI flags |
| **Patch** (0.1.1) | Bug fixes, performance improvements, documentation corrections |

**Pre-1.0 caveat:** While version is `0.x.y`, minor bumps may include breaking changes. The protocol version (below) is the actual compatibility contract.

## Protocol version

The protocol version (`protocol_version` field in every request/response envelope) is **independent** of the package version. It changes only when the wire format between CLI↔daemon or daemon↔extension is incompatible.

| Protocol version | Meaning |
|-----------------|---------|
| Same across CLI, daemon, extension | Fully compatible — everything works |
| CLI > daemon | CLI is newer; daemon needs upgrade |
| CLI < daemon | Daemon is newer; CLI needs upgrade |

**Protocol version changes are rare.** Adding new optional fields or new actions does NOT bump protocol version. Only structural envelope changes (e.g., removing `ok` field, changing `protocol_version` semantics) trigger a bump.

Current: **protocol v1** (since initial release).

## Single source of truth

| What | Location | Used by |
|------|----------|---------|
| Runtime version + protocol version | `shared/src/version.ts` | CLI (`bproxy --version`), doctor, daemon status |
| Package version (published artifact) | Root `package.json` `version` field | `scripts/build-release.sh` injects into `dist/package.json` |
| Workspace package versions | Each `packages/*/package.json` | Internal only; not user-facing |

The release script reads version from root `package.json` and injects it into the published package. The `shared/src/version.ts` constant must be updated alongside root `package.json` on every release — this is validated by CI (the `--version` output must match).

## Version synchronization rules

1. **Root `package.json` version** = the release version. The release script reads it.
2. **`shared/src/version.ts` `VERSION`** must equal root `package.json` version. This is the runtime constant.
3. **Workspace `package.json` versions** are kept in sync but are not user-facing (workspaces are private).
4. **`PROTOCOL_VERSION`** in `shared/src/version.ts` is bumped manually and independently — only on breaking wire changes.

## Compatibility matrix

| CLI version | Daemon version | Extension version | Result |
|-------------|---------------|-------------------|--------|
| Same | Same | Same | ✅ Full compatibility |
| Newer (same protocol) | Older | Older | ✅ Works — new CLI features may get "not supported" from older daemon |
| Older | Newer (same protocol) | Newer | ✅ Works — CLI won't use features it doesn't know about |
| Any | Any | Different protocol | ❌ Extension shows error in popup; re-pair required |
| Different protocol | Different protocol | — | ❌ `bproxy doctor` reports mismatch; upgrade needed |

## Tokens and upgrades

- **Daemon token** (`~/.bproxy/token`) — persists across upgrades. Format is version-independent.
- **Extension token** (`~/.bproxy/extension-token`) — persists across upgrades within the same protocol version. Protocol version change invalidates the WS subprotocol handshake, requiring re-pairing.
- **State directory layout** — stable. New files may be added in minor versions; existing files are not renamed or removed without a major version bump.

## Release checklist

1. Update `shared/src/version.ts` `VERSION` constant
2. Update root `package.json` `version`
3. Update workspace `package.json` versions (`pnpm -r exec -- npm version <ver> --no-git-tag-version`)
4. `pnpm check && pnpm test`
5. Commit: `release: v0.x.y`
6. Tag: `git tag v0.x.y`
7. Push tag → triggers `.github/workflows/release.yml`
