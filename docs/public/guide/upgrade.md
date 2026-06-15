---
title: Upgrade
sidebar:
  order: 3
---

How to upgrade bproxy to a new version without losing state.

## Upgrade the CLI and daemon

```bash
npm update -g @anthropics/bproxy
```

Verify:

```bash
bproxy --version
```

## Upgrade the extension

1. Download the new `bproxy-extension-v{version}.zip` from [GitHub Releases](https://github.com/anthropics/bproxy/releases/latest)
2. Extract to the same directory you used for the original install (overwrite existing files)
3. Open `chrome://extensions`
4. Find the bproxy extension and click the reload icon (↻)

## What persists across upgrades

- **Tokens persist** — your daemon token (`~/.bproxy/token`) and extension token (`~/.bproxy/extension-token`) remain valid. No re-pairing is needed unless the protocol version changes.
- **State directory** — `~/.bproxy/` is preserved as-is. Session artifacts in `tmp/` are ephemeral and may be cleaned by the daemon on restart.
- **Auto-start registration** — if you ran `bproxy service install`, the launchd/systemd entry continues to work (it references the binary by PATH, which npm updates in place).

## Protocol version mismatch

If a new version changes the protocol version (rare), the extension popup will show a connection error after upgrading only one side. To resolve:

1. Upgrade both CLI/daemon and extension to the same release
2. Restart the daemon: `bproxy service restart`
3. If the extension still shows an error: re-pair with `bproxy service start` and enter the new pairing code

The `bproxy doctor` command will report protocol mismatches explicitly:

```bash
bproxy doctor
# "protocol": { "ok": false, "cli": 2, "daemon": 1 }
```

## Upgrade with auto-start

If the daemon is registered as a system service:

```bash
bproxy service stop
npm update -g bproxy
bproxy service start
```

The service registration does not need to be reinstalled — it references `bproxy-service` by PATH.
