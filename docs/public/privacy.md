---
title: Privacy
sidebar:
  order: 99
---

## bproxy Chrome Extension — Privacy

bproxy does not collect, store, or transmit any user data.

### How the extension works

The extension connects your Chrome browser to a bproxy daemon running on your own machine (`127.0.0.1:9615`). When an AI agent sends a command through the daemon, the extension reads page content or performs a browser action and returns the result to the daemon — all on localhost.

Nothing leaves your device. There is no remote server, no analytics, no telemetry, no tracking.

### What the extension stores

One pairing token in Chrome's local extension storage. This token authenticates the WebSocket connection between the extension and the local daemon. It never leaves your machine.

### What the extension does not do

- Does not collect browsing history.
- Does not collect or store page content beyond the immediate command response.
- Does not send any data to external servers.
- Does not use cookies or tracking of any kind.
- Does not serve ads.
- Does not access any Google account data or Google service APIs.

### Communication

All communication is between the extension and `localhost:9615` — the bproxy daemon on the same machine. The extension never contacts any external endpoint.

### Contact

Questions: [GitHub Issues](https://github.com/dimdasci/bproxy/issues)
