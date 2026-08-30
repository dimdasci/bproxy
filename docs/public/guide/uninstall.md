---
title: Uninstall
sidebar:
  order: 4
---

Complete removal of bproxy from your system.

## Step 1: Stop the daemon

```bash
bproxy service stop
```

If the daemon is registered as a login service, unregister it first:

```bash
bproxy service uninstall
```

## Step 2: Remove the npm package

```bash
npm uninstall -g @dimdasci/bproxy
```

This removes both the `bproxy` CLI and `bproxy-service` daemon binaries from your PATH.

## Step 3: Remove the Chrome extension

1. Open `chrome://extensions`
2. Find the bproxy extension
3. Click **Remove** and confirm

## Step 4: Remove state directory (optional)

All bproxy state lives in a single directory:

```bash
rm -rf ~/.bproxy
```

This removes:

| Contents | Description |
|----------|-------------|
| `token` | Daemon bearer token |
| `extension-token` | Extension WebSocket token |
| `bproxy.pid` / `port` | Daemon lifecycle files |
| `logs/` | Structured request logs |
| `tmp/` | Temporary session artifacts (screenshots, exports) |

If you used a custom `BPROXY_HOME`, remove that directory instead.

## Verify removal

```bash
which bproxy
# (no output — binary removed)

which bproxy-service
# (no output — binary removed)

ls ~/.bproxy
# ls: cannot access '~/.bproxy': No such file or directory
```
