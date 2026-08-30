---
title: Upgrade
sidebar:
  order: 3
---

How to upgrade bproxy to a new version without losing state.

## Upgrade the CLI and daemon

```bash
npm update -g @dimdasci/bproxy
```

Verify:

```bash
bproxy --version
```

## Upgrade the extension

The [Chrome Web Store](https://chromewebstore.google.com/detail/bproxy/hjedkgneajbgjpgepbffdeanekhfffhc) updates bproxy automatically. No extension ZIP download or manual reload is required.

To check the installed version, open `chrome://extensions` and select bproxy. If Chrome has not applied an update yet, leave it enabled and it will update through Chrome's normal extension-update cycle.

## What persists across upgrades

- **Tokens persist** — your daemon token (`~/.bproxy/token`) and extension token (`~/.bproxy/extension-token`) remain valid. No re-pairing is needed unless the protocol version changes.
- **State directory** — `~/.bproxy/` is preserved as-is. Session artifacts in `tmp/` are ephemeral and may be cleaned by the daemon on restart.
- **Auto-start registration** — if you ran `bproxy service install`, the launchd/systemd entry continues to work after normal npm updates.

## Protocol version mismatch

If a new version changes the protocol version (rare), the extension popup will show a connection error after upgrading only one side. To resolve:

1. Upgrade the CLI and daemon to the latest release
2. Confirm Chrome has updated bproxy from the [Chrome Web Store](https://chromewebstore.google.com/detail/bproxy/hjedkgneajbgjpgepbffdeanekhfffhc)
3. Restart the daemon: `bproxy service restart`
4. If the extension still shows an error, re-pair: run `bproxy service start` and enter the new pairing code

The `bproxy doctor` command will report protocol mismatches explicitly:

```bash
bproxy doctor
# "protocol": { "ok": false, "cli": 2, "daemon": 1 }
```

## Upgrade with auto-start

If the daemon is registered as a system service:

```bash
bproxy service stop
npm update -g @dimdasci/bproxy
bproxy service start
```

The service registration does not need to be reinstalled — it references `bproxy-service` by PATH.
