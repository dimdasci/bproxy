# PoC 1 — MV3 SW + WebSocket + protocol envelope

Date: 2026-05-08
Status: complete

## Question

Does our designed pattern survive realistic MV3 SW lifecycle?

1. Does the WebSocket subprotocol auth (`bproxy.v1` + `auth.{base64url(token)}`) negotiate correctly in Chrome?
2. Does the SW reconnect after a forced suspend?
3. Can we round-trip protocol-shaped JSON envelopes through the connection?

## Method

Standalone Fastify v5 server (`poc/mv3-ws-reconnect/server.mjs`) accepting WebSocket upgrades and validating subprotocol auth. Minimal MV3 extension (`poc/mv3-ws-reconnect/extension/`) connecting with the designed subprotocol pair and sending one protocol-envelope-shaped JSON message per connection. Three scenarios: initial connection (A), forced SW suspend (B), wrong-token rejection (C).

## Finding

- Scenario A: Initial connection succeeded. SW console showed `connecting` → `open, negotiated protocol: bproxy.v1` → `received: { ok: true, data: { echoed: "navigate" } }`. Server logged `ws_connect` and `received` with matching request id.
- Scenario B: After extension reload (used as forced SW restart proxy), previous socket closed and a new WS connection was established automatically. Server logged `ws_close` then a fresh `ws_connect` and `received` with a new request id.
- Scenario C: With wrong token, WS handshake failed as expected. SW console showed `WebSocket connection ... failed: Error during WebSocket handshake: Sent non-empty 'Sec-WebSocket-Protocol' header but no response was received`, then `[poc] error`, `close: 1006`, and exponential reconnect attempts. After reverting token and reloading, successful `received` resumed.

## Implication

- Subprotocol auth: Chrome MV3 extension can send the designed dual subprotocol (`bproxy.v1` + `auth.{base64url(token)}`), and server-side validation/acceptance works.
- SW reconnect: Connection lifecycle is robust across restart/reload events; reconnect logic and backoff behavior operate as expected.
- Envelope round-trip: Protocol-shaped request/response envelopes pass end-to-end over WS with expected fields and id correlation.

## Verdict

✅ **Confirms the design** — Layer 2/3 implementation can proceed as specified in `docs/solution/service.md` and `docs/solution/extension.md`.

## Artifacts

- `poc/mv3-ws-reconnect/` (committed, never imported by production)
