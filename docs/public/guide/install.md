---
title: Install
sidebar:
  order: 1
---

Complete installation guide for bproxy — CLI, daemon, and Chrome extension.

## Prerequisites

- **Node.js ≥ 24** — check with `node --version`
- **Google Chrome** — required to install the extension from the Chrome Web Store
- **macOS or Linux** — Windows is not currently supported

## Install the CLI and daemon

```bash
npm install -g @dimdasci/bproxy
```

This puts two binaries on your PATH:

- `bproxy` — the CLI (one command per invocation)
- `bproxy-service` — the daemon (long-running localhost process)

Verify the install:

```bash
bproxy --version
# bproxy v0.9.3 (protocol v2)
```

## Install the Chrome extension

1. Open [bproxy in the Chrome Web Store](https://chromewebstore.google.com/detail/bproxy/hjedkgneajbgjpgepbffdeanekhfffhc).
2. Click **Add to Chrome**, then confirm **Add extension**.
3. To keep the popup handy, open Chrome's **Extensions** menu and pin bproxy to the toolbar.

Chrome manages extension updates automatically. You do not need Developer mode or a local extension folder.

## Start the daemon and pair

Start the daemon:

```bash
bproxy service start
```

Output:

```json
{"running":true,"pid":12345,"port":9615,"pairingCode":"ABCD-EFGH","pairingExpiresAt":1714000300000}
```

The pairing code is valid for 5 minutes. To pair:

1. Click the bproxy extension icon in Chrome
2. Enter the pairing code shown in the terminal (e.g., `ABCD-EFGH`)
3. Click **Pair**

Once paired, the extension connects via WebSocket and is ready to accept commands.

## Verify the connection

Check that the daemon is running:

```bash
bproxy service status
```

For a comprehensive check, including the extension WebSocket connection:

```bash
bproxy doctor
```

A successful report includes `"extension":{"ok":true,"connected":true,"protocolVersion":2}`. `doctor` also validates Node version, binary resolution, daemon connectivity, protocol agreement, and state-directory health.

## Auto-start on login (optional)

Register the daemon to start automatically when you log in:

```bash
bproxy service install
```

This creates a platform-native service entry (launchd on macOS, systemd on Linux). To remove it:

```bash
bproxy service uninstall
```

## State directory

bproxy stores all state in `~/.bproxy/` (override with `BPROXY_HOME` or `--home`):

| File | Purpose |
|------|---------|
| `token` | Daemon bearer token for CLI→daemon auth |
| `extension-token` | Extension→daemon WebSocket auth token |
| `bproxy.pid` | Daemon process ID (lifecycle lock) |
| `port` | Port the daemon is listening on |
| `logs/` | Structured request logs |
| `tmp/` | Temporary session artifacts |

All files are created with mode `0600`/`0700` — only your user account can read them.

## Install the agent skill (optional)

If you use a coding agent that supports [Agent Skills](https://agentskills.io), install the bproxy skill:

```bash
npx skills add dimdasci/bproxy
```

For pi:

```bash
pi skill install https://github.com/dimdasci/bproxy/tree/main/skills/bproxy
```

The skill provides command reference, fill-method selection, consent handling, and error recovery — everything an agent needs to use bproxy without reading the full docs.
