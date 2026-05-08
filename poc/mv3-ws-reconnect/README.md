# PoC 1 — MV3 SW + WebSocket + protocol envelope

## Question

Does our designed pattern survive realistic MV3 SW lifecycle? Specifically:

1. Does the WebSocket subprotocol auth (`bproxy.v1` + `auth.{base64url(token)}`) negotiate correctly in Chrome?
2. Does the SW reconnect after a forced suspend?
3. Can we round-trip protocol-shaped JSON envelopes through the connection?

## Run

```bash
pnpm install
pnpm start
```

In a separate Chrome window:

1. Navigate to `chrome://extensions`. Enable "Developer mode" (toggle, top right).
2. Click "Load unpacked" → select `poc/mv3-ws-reconnect/extension/`.
3. The extension loads. Click "service worker" link to open the SW devtools.
4. Observe the console: a connection attempt and an envelope round-trip should be logged.

## Test scenarios

- **Scenario A — initial connection.** SW logs `WebSocket open` and `received: {...}`. Server logs `ws_connect` and `received`.
- **Scenario B — forced suspend.** In SW devtools (top-right of the panel) click the "stop" / "Terminate" button (or use `chrome://serviceworker-internals` → find this extension → Stop). Wait up to 30s for the keepalive alarm. SW restarts, reconnects, sends fresh envelope.
- **Scenario C — wrong auth token.** Edit `extension/background.js`: change `TOKEN` to `'wrong-token'`. Reload the extension. Observe: server rejects upgrade; SW console shows close event with no `protocol` negotiated.

Findings → `docs/journal/2026-05-08-poc-mv3-ws-reconnect.md`.
