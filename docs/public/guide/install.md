---
title: Install
sidebar:
  order: 1
---

Complete installation guide for bproxy — CLI, daemon, and Chrome extension.

## Prerequisites

- **Node.js ≥ 24** — check with `node --version`
- **Chrome** (or Chromium-based browser) with Developer mode available
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
# bproxy v0.7.0 (protocol v1)
```

## Install the Chrome extension

1. Download `bproxy-extension-v{version}.zip` from the [latest GitHub Release](https://github.com/dimdasci/bproxy/releases/latest)
2. Extract the zip to a permanent location (e.g., `~/bproxy-extension/`)
3. Open Chrome and navigate to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked** and select the extracted folder
6. The bproxy extension icon appears in your toolbar

> **Tip:** Do not delete the extracted folder — Chrome references it directly. If you move it, you'll need to reload the extension.

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

```bash
bproxy service status
```

Expected output when everything is connected:

```json
{"running":true,"pid":12345,"port":9615,"version":"0.7.0","protocolVersion":1}
```

For a comprehensive check of all components:

```bash
bproxy doctor
```

This validates Node version, binary resolution, daemon connectivity, protocol version agreement, extension WebSocket connection, and state directory health.

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
