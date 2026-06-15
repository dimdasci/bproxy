---
title: "Phase 7 — Distribution & Installation"
status: done
---

## Quality standard

**Production quality is required for every task in this phase.** No MVP-level, placeholder, or "good enough for now" implementations. Every command, workflow, error path, and documentation page must be complete, tested, and polished to the same standard as Phases 1–6. This means:

- Error messages are actionable and specific, not generic
- Edge cases are handled (missing permissions, wrong Node version, stale state, partial installs)
- Platform-specific code is robust (not "works on my machine")
- Documentation is accurate, complete, and copy-edited — not a skeleton
- The skill is self-contained and usable by an agent with zero prior context
- CI gates (`pnpm check`, `pnpm test`, `pnpm docs:build`) pass at every commit

This constraint is non-negotiable. If a task cannot be completed to production quality within its timebox, the task is split — not shipped at lower quality.

---

## Intent

Make the hardened system installable and updatable outside the monorepo. A user can `npm install -g bproxy`, load the extension from a GitHub Release zip, pair, and run a smoke command — without cloning the repo or understanding the workspace layout.

## Inputs

- Phase 6 shipped: 739 tests, `pnpm check` green, daily-driver read→act workflow proven.
- Roadmap Phase 7 definition-of-done: "a user can install bproxy from published/release artifacts, load or install the extension, start the daemon, pair the extension, run a smoke command, and upgrade without breaking existing BPROXY_HOME token/state semantics."
- ADR-005 (Node/TS), ADR-008 (no native messaging), ADR-010/011 (token/pairing model), ADR-016 (no WAR — sideload OK), ADR-028 (temp confinement to BPROXY_HOME).

## Decisions

### Distribution shape

| Artifact | Channel | Rationale |
|----------|---------|-----------|
| CLI + daemon | npm (single `@dimdasci/bproxy` package, two `bin` entries) | Node ≥ 24 already required; standard install/upgrade/uninstall; `npx @dimdasci/bproxy` works zero-install |
| Extension | GitHub Release `.zip` (load unpacked) | Developer-mode audience; no CWS review latency; auto-update deferred |
| User manual | Astro Starlight site (`docs/public/guide/`) | Already symlinked into views; zero new tooling |
| Agent skill | `skill/SKILL.md` at repo root (Agent Skills standard) | Installable by pi, hermes, or manual copy |

### npm package layout

```
dist/
  bproxy.mjs            ← CLI binary (from cli/dist/)
  bproxy-service.mjs    ← daemon binary (from service/dist/)
package.json            ← publishable (not private), engines: node >=24, zero deps
README.md               ← user-facing quick-start
```

Both bins are self-contained ESM bundles (tsup inlines `@bproxy/shared`, `citty`, `fastify`, etc.). No runtime `dependencies` in the published package.

### What is explicitly out of scope

- Chrome Web Store submission (deferred to post-adoption feedback)
- Homebrew tap (stretch, not blocking)
- Node SEA single-binary (experimental in Node 24)
- Auto-update mechanism

---

## Tasks

### Task 1 — npm package assembly script

**Input:** Existing `cli/dist/bproxy.mjs` and `service/dist/index.mjs` from workspace builds.

**Output:** `scripts/build-release.sh` that:
1. Runs `pnpm --filter @bproxy/cli build` and `pnpm --filter @bproxy/service build`
2. Creates `dist/` at repo root
3. Copies CLI binary as `dist/bproxy.mjs`
4. Copies service binary as `dist/bproxy-service.mjs`
5. Generates `dist/package.json` from a template (`scripts/release-package.json`) with version injected from root `package.json`
6. Copies root `README.md` (or a release-specific one) into `dist/`

**Done when:** `cd dist && npm pack` produces a valid tarball; `npm install -g ./bproxy-*.tgz` puts both `bproxy` and `bproxy-service` on PATH.

---

### Task 2 — Service binary resolution fix

**Input:** `cli/src/service-binary.ts` resolution chain: `BPROXY_SERVICE_BIN` → workspace sibling → `bproxy-service` on PATH.

**Output:** Add a resolution step between workspace and PATH: "sibling in the same directory as the running CLI binary." After global npm install, both `.mjs` files live under the same `node_modules/.bin/` prefix — the CLI should find its sibling without requiring PATH lookup.

**Done when:** Unit tests cover the new resolution step; global install scenario resolves correctly; existing workspace-dev scenario still works.

---

### Task 3 — GitHub Release workflow

**Input:** Existing `.github/workflows/ci.yml` (runs check + test on push/PR).

**Output:** `.github/workflows/release.yml` triggered on `v*` tag push:
1. Checkout + pnpm install
2. `pnpm check` + `pnpm test` (gate)
3. `pnpm -r build` (all workspaces including extension)
4. Run `scripts/build-release.sh`
5. `cd dist && npm publish` (with `NODE_AUTH_TOKEN` secret)
6. Zip `extension/.output/chrome-mv3/` → `bproxy-extension-v${version}.zip`
7. Create GitHub Release with:
   - Extension zip attached
   - Release notes (changelog or auto-generated)
   - Link to npm package

**Done when:** A test tag (`v0.1.0-rc.1`) triggers the workflow and produces a draft release with the zip attached (npm publish can be dry-run initially).

---

### Task 4 — User manual: install + uninstall + upgrade

**Input:** Deployment view, pairing flow (ADR-011), token/state model (ADR-028).

**Output:** Three files in `docs/public/guide/`:

**`install.md`:**
- Prerequisites: Node ≥ 24, Chrome
- `npm install -g bproxy`
- Extension: download zip from GitHub Releases, extract, `chrome://extensions` → Developer mode → Load unpacked
- First run: `bproxy service start` → note pairing code → open extension popup → enter code
- Verify: `bproxy service status`

**`uninstall.md`:**
- `bproxy service stop`
- `npm uninstall -g bproxy`
- Remove extension from Chrome
- Optionally `rm -rf ~/.bproxy` (explain what's in there: tokens, logs, session artifacts)

**`upgrade.md`:**
- `npm update -g bproxy`
- Re-download extension zip, reload in chrome://extensions
- Tokens persist — no re-pairing unless protocol version changes
- If protocol mismatch: extension popup will show error; re-pair resolves it

**Done when:** `pnpm docs:build` passes; pages render correctly in local dev server.

---

### Task 5 — User manual: usage quick-start

**Input:** Scenarios from `docs/internal/scenarios.md`, CLI spec, action catalog.

**Output:** `docs/public/guide/usage.md` covering:
- Start daemon + pair (recap from install)
- Open a tab: `bproxy tab open --url https://example.com`
- Read page: `bproxy text -s <id> --tab t1`
- Get links: `bproxy links -s <id> --tab t1`
- Click a link: `bproxy click -s <id> --tab t1 --element ln3`
- Fill a form: `bproxy fill -s <id> --tab t1 --element el2 --value "hello" --method paste`
- Scroll: `bproxy scroll -s <id> --tab t1 --direction down`
- Handle `HUMAN_REQUIRED`: user resolves in browser, then `bproxy session resume -s <id>`
- Close session: `bproxy session close -s <id>`
- Stop daemon: `bproxy service stop`

**Done when:** Page renders; examples use real command shapes matching CLI spec.

---

### Task 6 — Sidebar integration

**Input:** `views/astro.config.mjs` sidebar config.

**Output:** Add "Guide" section to sidebar before "Architecture":
```js
{
  label: "Guide",
  items: [{ autogenerate: { directory: "guide" } }],
},
```

Add appropriate `sidebar` frontmatter or ordering to guide `.md` files so they sort: install → usage → upgrade → uninstall.

**Done when:** `pnpm docs:build` passes; `pnpm docs:dev` shows Guide section with all four pages in correct order.

---

### Task 7 — Agent skill

**Input:** Existing `docs/internal/skills/fill-method-selection.md`, action catalog from architecture, CLI spec, error taxonomy from shared types.

**Output:** `skill/` directory at repo root:

```
skill/
├── SKILL.md
└── references/
    ├── actions.md
    ├── fill-methods.md
    └── errors.md
```

**`SKILL.md` frontmatter:**
```yaml
name: bproxy
description: >-
  Control the operator's real Chrome browser for web research, form filling,
  and page interaction. Use when you need to read web pages, extract links,
  fill forms, click elements, or scroll — all through a running bproxy daemon
  that proxies commands to a Chrome extension. Requires bproxy installed and
  daemon running.
compatibility: Node >=24, bproxy installed (npm install -g bproxy), daemon running (bproxy service start), extension paired
license: MIT
metadata:
  version: "0.1.0"
```

**`SKILL.md` body:**
- Setup verification: `bproxy service status` expected output
- Core workflow pattern: open → read → act → close
- Command reference (one-liner per action with typical flags)
- Session management: `-s <id>` threading, `--tab t1`
- Error handling patterns: `HUMAN_REQUIRED`, `ELEMENT_NOT_FOUND`, `SESSION_NOT_FOUND`
- Install instructions for various harnesses:
  ```bash
  # pi
  pi skill install https://github.com/<user>/bproxy/tree/main/skill
  # Manual (any harness)
  cp -r skill/ ~/.agents/skills/bproxy
  ```

**`references/actions.md`:** Full action catalog with params/response shapes (condensed from architecture + CLI spec).

**`references/fill-methods.md`:** Migrated + updated from `docs/internal/skills/fill-method-selection.md`.

**`references/errors.md`:** Error codes, categories, retry guidance, and agent recovery patterns.

**Done when:** Skill validates against Agent Skills spec frontmatter requirements; content is self-contained (an agent with no repo access can use bproxy after reading SKILL.md + references).

---

### Task 8 — `bproxy doctor`

**Input:** Existing `service status` response, binary resolution logic, protocol version constant.

**Output:** `bproxy doctor` command that validates the full operational chain and reports structured JSON:

```json
{
  "node": { "ok": true, "version": "v24.15.0", "minimum": "v24.0.0" },
  "binary": { "ok": true, "cli": "/usr/local/bin/bproxy", "service": "/usr/local/bin/bproxy-service" },
  "daemon": { "ok": true, "pid": 12345, "port": 9615, "version": "0.1.0" },
  "protocol": { "ok": true, "cli": 1, "daemon": 1 },
  "extension": { "ok": true, "connected": true, "protocolVersion": 1 },
  "state": { "ok": true, "home": "/Users/x/.bproxy", "token": true, "extensionToken": true }
}
```

Checks:
1. Node version ≥ 24
2. Both binaries resolvable (using existing `resolveServiceBinary` logic)
3. Daemon reachable (`GET /` or status check via PID + port file)
4. Protocol version agreement between CLI and running daemon
5. Extension WebSocket connected (from daemon status)
6. State directory exists with correct permissions; token files present

Exit codes: 0 = all checks pass, 1 = one or more checks failed (failures shown in output).

**Done when:** Unit tests cover each check independently; a running system reports all-green; a stopped daemon reports degraded state correctly.

---

### Task 9 — `bproxy service install|uninstall`

**Input:** Daemon binary path, `BPROXY_HOME`, platform detection.

**Output:** Two subcommands that register/remove the daemon as a user-level background service:

**macOS (launchd):**
- `bproxy service install` generates `~/Library/LaunchAgents/com.bproxy.daemon.plist` with:
  - `ProgramArguments`: `["node", "<resolved bproxy-service path>", "start"]`
  - `EnvironmentVariables`: `{ "BPROXY_HOME": "<resolved>" }`
  - `RunAtLoad`: true
  - `KeepAlive`: false (crash-restart is daemon's own concern via PID file)
  - `StandardOutPath` / `StandardErrorPath`: `BPROXY_HOME/logs/launchd-{out,err}.log`
- Runs `launchctl load` (or `launchctl bootstrap` on modern macOS)
- Prints confirmation JSON: `{ "installed": true, "plist": "<path>", "status": "loaded" }`

- `bproxy service uninstall` runs `launchctl unload` (or `launchctl bootout`), removes plist file
- Prints: `{ "uninstalled": true }`

**Linux (systemd user unit):**
- `bproxy service install` generates `~/.config/systemd/user/bproxy.service` with:
  - `ExecStart=node <resolved bproxy-service path> start`
  - `Environment=BPROXY_HOME=<resolved>`
  - `Type=simple`, `Restart=no`
- Runs `systemctl --user daemon-reload && systemctl --user enable bproxy`
- Prints confirmation JSON

- `bproxy service uninstall` disables + removes unit file

**Platform detection:** `process.platform` → `darwin` (launchd) | `linux` (systemd) | other (error with suggestion).

**Done when:** Install/uninstall works on macOS; Linux systemd path tested (or unit-tested with mocked fs/exec); unsupported platforms get a clear error; `bproxy doctor` detects installed state.

---

### Task 10 — Version and protocol compatibility

**Input:** Protocol version (`1`) already in every request envelope; no `--version` CLI command exists.

**Output:**
- `bproxy --version` prints `bproxy v0.1.0 (protocol v1)` to stdout, exits 0
- `bproxy service status` response includes `{ ..., version: "0.1.0", protocolVersion: 1 }`
- CLI warns (stderr) when daemon reports a different protocol version than CLI expects
- Extension already sends protocol version on WS connect (subprotocol); daemon already validates

**Done when:** Unit tests cover version output; integration test confirms mismatch warning.

---

### Task 11 — npm name check + first publish

**Input:** Desired package name `bproxy`.

**Output:**
- Verify `npm info bproxy` — claim name if available, fall back to `@bproxy/bproxy` if taken
- First publish: `npm publish --dry-run` from assembled `dist/`
- Verify: `npm install -g bproxy && bproxy --version && bproxy service start && bproxy service stop`
- Document any scoped-name decision in this phase file

**Done when:** Package is published (or dry-run validated); global install + smoke test passes on a clean machine (or CI).

---

### Task 12 — Phase file + roadmap update

**Input:** This plan.

**Output:**
- This file finalized with shipped outcome after all tasks complete
- `docs/internal/plans/roadmap.md` Phase 7 status changed to `✅ Done`
- Root `package.json` version bumped to `0.1.0`

**Done when:** Roadmap reflects reality; version is consistent across all references.

---

## Validation

Phase 7 is done when all of the following hold **at production quality** (no partial, placeholder, or degraded implementations accepted):

1. `npm install -g bproxy` on a clean Node ≥ 24 machine puts `bproxy` and `bproxy-service` on PATH
2. `bproxy --version` reports version and protocol
3. `bproxy doctor` validates the full chain (node, binaries, daemon, extension, state) with actionable per-check diagnostics
4. `bproxy service start` starts daemon, prints pairing code
5. `bproxy service install` registers daemon for auto-start on login; `bproxy service uninstall` reverses it cleanly on both macOS and Linux
6. Extension loaded from GitHub Release zip; pairing completes
7. `bproxy tab open --url https://example.com` returns session + tab
8. `bproxy text -s <id> --tab t1` returns page text
9. `bproxy session close -s <id>` cleans up
10. `bproxy service stop` stops daemon
11. `npm update -g bproxy` upgrades without breaking `~/.bproxy/` state
12. `npm uninstall -g bproxy` removes cleanly
13. Astro docs site builds with Guide section — all pages are complete, accurate, and copy-edited
14. `skill/SKILL.md` is installable by pi (`pi skill install ./skill`) and self-contained for an agent with zero prior context
15. `pnpm check`, `pnpm test`, `pnpm docs:build` all pass
16. Every error path in new commands has specific, actionable output — no generic "something went wrong" messages
17. Platform-specific code (launchd, systemd) handles missing tools, permission errors, and already-installed states gracefully

## Deferred / rejected

| Item | Disposition |
|------|-------------|
| Chrome Web Store | Deferred — submit after initial adoption validates the extension shape |
| Homebrew tap | Deferred — convenience layer, not blocking |
| Node SEA binary | Rejected for now — experimental, 100MB+ output |
| Auto-update | Rejected — npm/brew handle this; no custom updater |
| `bproxy` unscoped npm name | Taken by existing package (chinese proxy tool, 108 versions). Using `@dimdasci/bproxy` instead. |
