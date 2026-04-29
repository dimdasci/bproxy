# 9. Build & Distribution

[← Index](./README.md) · Prev: [Tab Management](./08-tab-management.md) · Next: [Testing Strategy →](./10-testing.md)

---

The previous draft of this chapter assumed `ln -s … /usr/local/bin/bproxy`. That works on one developer's macOS up to Big Sur and breaks everywhere else: Sequoia gates `/usr/local/bin` behind `sudo`, Windows has neither symlinks-by-default nor that path, Linux distros disagree on whether `~/.local/bin`, `/usr/local/bin`, or a distro-specific path is canonical, and any non-root install is locked out. The contract this chapter now commits to is **one install command per user, no `sudo`, no PATH manipulation, no platform-specific install scripts** — the unit of distribution is an npm package, the unit of execution is a Node process, and everything platform-shaped is delegated to npm's own shimming.

## Distribution shape

Three artefacts ship in one repo:

- `cli/bproxy.js` — the CLI entry point. One file, `#!/usr/bin/env node` shebang, ESM (`"type": "module"` at root). Targets **Node ≥ 20.10 LTS**, the lowest LTS line that ships `node:test` and the stable `fetch` global without flags. The CLI does not use any non-standard CLI runtime (no Bun, no Deno).
- `service/index.js` — the proxy daemon. Same Node target. Single runtime dependency: `ws`. No transpilation, no bundler.
- `extension/` — the unpacked Manifest V3 extension. No build step. Distributed to the user as an unpacked directory plus a zip for archival; see [Extension distribution](#extension-distribution).

These three live under one `package.json` at the repository root. There is no monorepo tooling, no `workspaces` block, no Turborepo. The flat layout is deliberate: every published artefact is a directory under the same `node_modules` and the install story has no per-subpackage cliffs.

## Root `package.json`

```jsonc
{
  "name": "bproxy",
  "version": "0.x.y",
  "type": "module",
  "engines": { "node": ">=20.10.0" },
  "bin": {
    "bproxy": "./cli/bproxy.js"
  },
  "files": [
    "cli/",
    "service/",
    "extension/",
    "README.md"
  ],
  "dependencies": {
    "ws": "^8.18.0"
  },
  "scripts": {
    "start": "node service/index.js",
    "test": "node --test test/"
  }
}
```

The `bin` field is the cross-platform install primitive ([npm docs — bin](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin)). On install, npm:

- On POSIX: creates a symlink at `<prefix>/bin/bproxy` → `node_modules/bproxy/cli/bproxy.js`. The shebang is honoured by the kernel.
- On Windows: `cmd-shim` writes three companion launchers next to the entry — `bproxy.cmd` (cmd.exe), `bproxy.ps1` (PowerShell), and a Bash file (Cygwin / Git Bash / MSYS2). All three call `node` against the same `cli/bproxy.js`. The shebang is read by `cmd-shim` at install time to decide the interpreter ([npm/cmd-shim](https://github.com/npm/cmd-shim), [2ality — Installing and running Node.js bin scripts](https://2ality.com/2022/08/installing-nodejs-bin-scripts.html)).

The `#!/usr/bin/env node` shebang is therefore mandatory on every entry listed in `bin`, even though Windows ignores the file's shebang at runtime — `cmd-shim` reads it at install time to wire the launcher.

## Installation methods

Two supported, one tolerated:

| Method                          | Daemon supported? | When to use                                                                                                                                                                                                |
|---------------------------------|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `npm install -g bproxy`         | yes               | The default. Works on macOS, Linux, Windows. No `sudo` required when npm's prefix is user-owned (the modern default; nvm/asdf/Volta installs are user-prefixed; system Node on Linux distros may not be — see [non-root install](#non-root-install-on-system-managed-node)). |
| `pnpm add -g bproxy` / `yarn global add bproxy` | yes  | Equivalent. The `bin` field is the same primitive in all three.                                                                                                                                            |
| `npx bproxy@latest <command>`   | **no** (one-shot only) | One-off CLI invocations from CI or a non-installed environment. Each `npx` call downloads the package to a cache, runs once, exits. Not a viable host for the long-running daemon — `npx` is one-shot by design. The CLI prints `DAEMON_NOT_RUNNING` if it cannot reach a daemon (whether or not the user used `npx` to launch the CLI) and the user must install globally to run `bproxy service start`. |

Document this prominently in `README.md` and in `bproxy --help`: `npx bproxy …` works for the CLI verbs against an already-running daemon (e.g. on a host where the user already ran `npm i -g bproxy && bproxy service start`), but it cannot be the daemon. The reasoning is structural — `npx` exits when its child exits, and we want the daemon to outlive its starter shell.

### Non-root install on system-managed Node

Linux distros that ship Node from the system package manager (Debian's `nodejs`, RHEL's `nodejs`) set npm's prefix to `/usr` by default, where a non-root user cannot write. Three escapes, in preference order:

1. **Use a user-managed Node.** `nvm`, `asdf`, `volta`, or `fnm` all install Node under `$HOME` and set the npm prefix accordingly. Documented as the default recommendation.
2. **Set `npm config set prefix ~/.local`** to redirect global installs to `~/.local/bin`, which is on `PATH` by default on most modern Linux distros (per the systemd `user-tmpfiles` convention, as well as Debian's `~/.profile` template). The user adds `~/.local/bin` to `PATH` if their distro doesn't.
3. **`sudo npm i -g bproxy`** as a last resort. We document it but do not recommend it: it puts files owned by `root` into the user's tree, which `npm update` will trip on later.

The CLI itself does not care which prefix won; once installed, `which bproxy` resolves to the same launcher and the rest of the design is unchanged.

### Verification

After install, `bproxy --version` is the canary:

```
$ bproxy --version
bproxy 0.x.y (node v20.18.0, darwin arm64)
```

This is intentionally chatty: agents and humans alike use it to confirm the install resolved a Node binary and the package was unpacked. It does not require the daemon.

## Extension distribution

The extension still ships as an unpacked load-via-`chrome://extensions` install during the v0 / v1 window. The flow is:

1. After `npm i -g bproxy`, the extension lives at `$(npm root -g)/bproxy/extension/`. The `bproxy --extension-path` subcommand prints this path; the user opens `chrome://extensions`, toggles Developer Mode, clicks **Load unpacked**, and points at the printed path.
2. On every CLI install / upgrade, the extension directory is overwritten in place. The user clicks the **Refresh** button on the extension card after `npm i -g bproxy@latest` to pick up changes; the extension does not auto-reload.
3. For archival or sideload to a peer machine: `bproxy --extension-zip ./bproxy-extension.zip` writes a zip of the extension directory.

### Why not the Chrome Web Store

Chrome Web Store distribution is **explicitly out of scope for v1** and we are honest about the reason: review of an extension that holds `<all_urls>`, `chrome.debugger`, `chrome.scripting` MAIN-world execution, and a localhost WebSocket to a privileged daemon is non-trivial, and a CWS-rejected v1 stalls the project. Sideloading via Developer Mode is the v1 distribution channel; CWS publication is a separate workstream once the threat model and the user-facing copy stabilise. See [12-risks.md → Chrome Web Store distribution](./12-risks.md#chrome-web-store-distribution-is-not-v1) for the residual.

The user-side cost: every Chrome restart prompts "Disable Developer Mode extensions" once. Documented; the user dismisses it. This is the same cost paid by every internal tool that sideloads; if it becomes a dealbreaker we revisit Chrome's `ExtensionForceInstallList` policy or CWS.

## Service installation and the daemon contract

`bproxy service start` is a **lifecycle command**, not "run `node service/index.js`." The full lifecycle (PID file, lockfile, daemonization, log rotation, status probe, multi-profile handling) is owned by [03-proxy-service.md → Service lifecycle](./03-proxy-service.md#service-lifecycle); this section is the install-time contract that lifecycle relies on:

- **Per-user state directory** at one of:
  - Linux: `$XDG_RUNTIME_DIR/bproxy/` for runtime files (PID, socket, token), `$XDG_STATE_HOME/bproxy/logs/` for logs (defaulting to `~/.local/state/bproxy/logs/` per [XDG Base Directory 0.8](https://specifications.freedesktop.org/basedir/latest/)). Runtime dir falls back to `~/.bproxy/run/` if `$XDG_RUNTIME_DIR` is unset (rare; some headless containers). The XDG split is deliberate: `XDG_RUNTIME_DIR` is `0700`, per-session, and cleared on logout — exactly the lifetime we want for PID files; `XDG_STATE_HOME` is the right place for logs that survive logout.
  - macOS: `~/Library/Application Support/bproxy/` for runtime state (token, PID), `~/Library/Logs/bproxy/` for logs. The Apple-recommended split per [File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html).
  - Windows: `%LOCALAPPDATA%\bproxy\` (runtime state), `%LOCALAPPDATA%\bproxy\logs\` (logs). `LOCALAPPDATA` over `APPDATA` because the latter roams via Active Directory profiles and our state is machine-local.

  These paths are resolved by a single helper in `cli/paths.js` consumed by both the CLI and the daemon. Token file paths from [03-proxy-service.md → Token file location](./03-proxy-service.md#token-file-location) live under the same prefix.

- **Permissions** — the runtime directory is created `0700` on POSIX. On Windows, the install path uses an explicit owner-only ACE via `icacls` and removes inherited ACEs from `%LOCALAPPDATA%\bproxy\`. The contract is "readable by the current user, no one else, on every supported OS." Same handling as the token file from task 3.

The daemon binary is the same `service/index.js` invoked under the same Node version that resolves `bproxy` — there is no separate install step. `bproxy service start` is a `child_process.spawn(process.execPath, [serviceScript], { detached: true, stdio: ['ignore', logFd, logFd] })` plus `child.unref()`; the parent CLI exits and the daemon survives. The full daemonization recipe is in [03-proxy-service.md → Daemonization](./03-proxy-service.md#daemonization).

## Cross-platform CLI behaviour

The CLI is **shell-agnostic by construction**:

- No shell-isms in `child_process.exec`; everything is `spawn` with explicit argv arrays.
- No POSIX-only path joins; `node:path` everywhere.
- No assumptions about line endings in the wire — JSON in, JSON out.
- ESM throughout (`"type": "module"`); we do not maintain a CJS branch. ESM has been the default for new Node packages since 2023 and `node:test` / dynamic import are available in our minimum target.
- The `--help` output and the JSON output are encoded UTF-8 with no BOM. Windows `cmd.exe` users may see encoding artefacts on non-ASCII URLs; documented as a sharp edge. PowerShell handles UTF-8 correctly when `[Console]::OutputEncoding` is set, and the install banner mentions this.
- Exit codes are `0` for `ok: true` and `1` for `ok: false`. No shell-specific exit codes.

## Versioning and upgrade

The package version is the only version users see. Within a major:

- The CLI, the proxy, and the extension are released together with matching `version`. The extension's `manifest.json` is regenerated from `package.json` at publish time.
- The wire `protocol_version` (see [03-proxy-service.md → Protocol versioning](./03-proxy-service.md#protocol-versioning)) bumps only on incompatible envelope changes; that is independent of the package version.
- On `npm i -g bproxy@latest`, the CLI overwrites itself; the user runs `bproxy service restart` to pick up the new daemon (the running daemon does not auto-replace itself — see [03-proxy-service.md → Daemonization](./03-proxy-service.md#daemonization)); the user clicks "Refresh" on the extension card to pick up the new content scripts.

A skew-detection step in `bproxy status` (see [03-proxy-service.md → `bproxy status`](./03-proxy-service.md#bproxy-status-endpoint)) compares the running daemon's `service_version` with the CLI's `package.json#version`; on mismatch the CLI prints a warning and the user runs `bproxy service restart`.

## Residual install hazards

These are documented because they will surface in real installs and the right answer is "we know, here's the workaround" rather than "you must be holding it wrong." Full risk write-ups are in [12-risks.md → Install and runtime residuals](./12-risks.md#install-and-runtime-residuals).

- **Enterprise Chrome with `ExtensionInstallBlocklist`** silently disables sideloaded extensions. The CLI cannot detect "user pasted token but extension is policy-disabled" until the extension fails to connect; the resulting `NO_CONNECTION` error includes a hint to check `chrome://extensions` for a policy banner.
- **macOS Sequoia local-network access prompt**: the first time the proxy listens on `127.0.0.1`, Sequoia's tightened TCC may prompt the user to grant local-network access to the terminal application that ran `bproxy service start`. Documented in the install banner.
- **Snap / Flatpak Chromium, ARC++ Chrome on ChromeOS**: untested but expected to work. The constraint is the extension's ability to `WebSocket`-connect to `127.0.0.1`, which both sandboxes allow by default. Listed as best-effort in [12-risks.md](./12-risks.md#install-and-runtime-residuals).
- **Symlinked Chrome profiles**: untested. The extension storage paths Chrome resolves are based on the profile directory at runtime; a symlinked profile is a userland aliasing trick the extension does not see. Expected to work; not warranted.
- **Chrome auto-update breaks an MV3 API.** Chrome occasionally tightens MV3 semantics (e.g. service-worker idle, `chrome.scripting` MAIN-world execution). The version-pin / version-test policy is documented in [12-risks.md → Chrome version compatibility](./12-risks.md#chrome-version-compatibility); the short version is "we test against the current stable Chrome at every release; older or newer Chrome is best-effort."
