---
title: Privacy Policy
---

## bproxy Extension Privacy Policy

The bproxy Chrome extension does not collect, store, or transmit any user data.

**What the extension does:**
- Reads page content only when an AI agent sends a command through the local daemon.
- Passes page content to a daemon running on the same machine (`127.0.0.1`).
- Nothing leaves your device. There is no remote server, no analytics, no telemetry.

**What the extension stores:**
- A pairing token in Chrome's local storage, used to authenticate the WebSocket connection to the local daemon.
- Bounded session diagnostics (request trace, dedupe cache) in Chrome's session storage, cleared when the browser closes.

**Network communication:**
- The extension communicates exclusively with `localhost:9615` (`ws://127.0.0.1:9615/ws` and `http://127.0.0.1:9615/pair/claim`).
- It never contacts any external service.

**Permissions rationale:**
- `tabs`: route actions to specific tabs and manage tab lifecycle.
- `scripting`: programmatically inject the content script on first command.
- `webNavigation`: track top-level navigation for page identity.
- `alarms`: background service-worker keepalive scheduling.
- `storage`: persist bootstrap token and session diagnostics.
- `<all_urls>`: support user-directed actions on any page.
