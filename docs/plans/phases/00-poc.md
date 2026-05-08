# Phase 0 — PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk three load-bearing technical assumptions in the bproxy design — MV3 SW WebSocket lifecycle, CLI → extension pairing transport, and paste-flavored writes on real frameworks — and capture findings as journal memos and (if needed) ADR amendments.

**Architecture:** Three independent throwaway PoCs under `poc/<name>/`, each answering one question with the smallest possible code. PoCs are standalone Node projects (their own `package.json`), never imported by production packages, but committed for reference. Each closes with a journal memo (question / method / finding / implication / verdict).

**Tech Stack:** Node 18+, Chrome MV3, Fastify v5 + `@fastify/websocket` v11 (PoCs 1 + 2 servers), plain devtools-pasted JS (PoC 3).

**Spec:** [`docs/plans/roadmap.md`](../roadmap.md) — Phase 0 section. Cross-cutting PoC structure rules in the same doc.

---

## File Structure

```
poc/
├── mv3-ws-reconnect/                  # PoC 1
│   ├── README.md
│   ├── package.json
│   ├── server.mjs
│   └── extension/
│       ├── manifest.json
│       └── background.js
├── cli-extension-pairing/             # PoC 2
│   ├── README.md
│   ├── package.json
│   ├── cli-attempt.mjs
│   ├── server.mjs
│   └── extension/
│       ├── manifest.json
│       ├── background.js
│       ├── popup.html
│       └── popup.js
└── paste-fill/                        # PoC 3
    ├── README.md
    └── snippet.js

docs/journal/
├── 2026-05-08-poc-mv3-ws-reconnect.md
├── 2026-05-08-poc-cli-extension-pairing.md
└── 2026-05-08-poc-paste-fill.md
```

Each PoC is independent. Run order does not matter; PoC 3 is the cheapest if you want to start small.

PoCs use **pnpm** (`pnpm install`, `pnpm start`). Workspace is not yet configured at this phase, so each PoC's `package.json` is standalone.

---

## Task 1: PoC 1 — MV3 SW + WebSocket + protocol envelope

**Files:**
- Create: `poc/mv3-ws-reconnect/README.md`
- Create: `poc/mv3-ws-reconnect/package.json`
- Create: `poc/mv3-ws-reconnect/server.mjs`
- Create: `poc/mv3-ws-reconnect/extension/manifest.json`
- Create: `poc/mv3-ws-reconnect/extension/background.js`
- Create: `docs/journal/2026-05-08-poc-mv3-ws-reconnect.md`

**Question:** Does our designed pattern survive realistic MV3 SW lifecycle? Specifically: (a) Does the WebSocket subprotocol auth (`bproxy.v1` + `auth.{base64url(token)}`) negotiate correctly in Chrome? (b) Does the SW reconnect after a forced suspend? (c) Can we round-trip protocol-shaped JSON envelopes through the connection?

**Timebox:** 1 day. If a definitive answer isn't reached, mark the PoC inconclusive and decide next step.

- [x] **Step 1: Scaffold the PoC directory.**

```bash
mkdir -p poc/mv3-ws-reconnect/extension
```

- [x] **Step 2: Write the README explaining the question and how to run.**

Create `poc/mv3-ws-reconnect/README.md`:

```markdown
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
```

- [x] **Step 3: Write `package.json`.**

Create `poc/mv3-ws-reconnect/package.json`:

```json
{
  "name": "poc-mv3-ws-reconnect",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.mjs"
  },
  "dependencies": {
    "@fastify/websocket": "^11.0.0",
    "fastify": "^5.0.0"
  }
}
```

- [x] **Step 4: Install dependencies.**

```bash
cd poc/mv3-ws-reconnect && pnpm install
```

Expected: `node_modules/` populated, no errors.

- [x] **Step 5: Write the WebSocket server.**

Create `poc/mv3-ws-reconnect/server.mjs`:

```javascript
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const TOKEN = 'test-token-deadbeef';
const PORT = 9090;

const app = Fastify({ logger: true });

await app.register(websocket, {
  options: {
    handleProtocols: (protocols) => {
      const list = Array.from(protocols);
      const v1 = list.includes('bproxy.v1');
      const auth = list.find((p) => p.startsWith('auth.'));
      if (!v1 || !auth) return false;
      const provided = Buffer.from(auth.slice('auth.'.length), 'base64url').toString();
      if (provided !== TOKEN) return false;
      return 'bproxy.v1';
    },
  },
});

app.get('/ws', { websocket: true }, (socket) => {
  app.log.info({ event: 'ws_connect' });
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    app.log.info({ event: 'received', id: msg.id, action: msg.action });
    socket.send(JSON.stringify({
      protocol_version: 1,
      id: msg.id,
      ok: true,
      data: { echoed: msg.action },
    }));
  });
  socket.on('close', () => app.log.info({ event: 'ws_close' }));
});

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`Listening on ws://127.0.0.1:${PORT}/ws (token: ${TOKEN})`);
```

- [x] **Step 6: Write the extension manifest.**

Create `poc/mv3-ws-reconnect/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "bproxy PoC: MV3 WS reconnect",
  "version": "0.0.1",
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": ["storage", "alarms"],
  "host_permissions": ["http://127.0.0.1:9090/*"]
}
```

- [x] **Step 7: Write the background SW.**

Create `poc/mv3-ws-reconnect/extension/background.js`:

```javascript
const TOKEN = 'test-token-deadbeef';
const WS_URL = 'ws://127.0.0.1:9090/ws';

let socket = null;
let reconnectTimer = null;
let attempt = 0;

function base64url(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function connect() {
  if (socket && socket.readyState !== WebSocket.CLOSED) return;
  console.log('[poc] connecting to', WS_URL);
  const protocols = ['bproxy.v1', `auth.${base64url(TOKEN)}`];
  socket = new WebSocket(WS_URL, protocols);

  socket.addEventListener('open', () => {
    console.log('[poc] open, negotiated protocol:', socket.protocol);
    attempt = 0;
    socket.send(JSON.stringify({
      protocol_version: 1,
      id: crypto.randomUUID(),
      action: 'navigate',
      params: { url: 'https://example.com' },
      session: 'default',
      deadline: Date.now() + 30000,
      destructive: true,
    }));
  });

  socket.addEventListener('message', (event) => {
    console.log('[poc] received:', event.data);
  });

  socket.addEventListener('close', (event) => {
    console.log('[poc] close:', event.code, event.reason || '(no reason)');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    console.warn('[poc] error');
  });
}

function scheduleReconnect() {
  attempt += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** attempt);
  console.log(`[poc] reconnecting in ${delay}ms (attempt ${attempt})`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay);
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);

chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && (!socket || socket.readyState !== WebSocket.OPEN)) {
    connect();
  }
});

connect();
```

- [x] **Step 8: Run Scenario A — initial connection.**

In one terminal:
```bash
cd poc/mv3-ws-reconnect && pnpm start
```
Expected server log: `Listening on ws://127.0.0.1:9090/ws (token: test-token-deadbeef)`.

In Chrome:
1. Open `chrome://extensions`. Enable Developer mode.
2. Click "Load unpacked" → select `poc/mv3-ws-reconnect/extension/`.
3. Click the "service worker" link to open SW devtools.

Expected SW console output:
```
[poc] connecting to ws://127.0.0.1:9090/ws
[poc] open, negotiated protocol: bproxy.v1
[poc] received: {"protocol_version":1,"id":"...","ok":true,"data":{"echoed":"navigate"}}
```

Expected server log lines including `event: "ws_connect"` and `event: "received"`.

Note observed behavior in your scratch notes for the journal memo.

- [x] **Step 9: Run Scenario B — forced suspend / reconnect.**

In SW devtools, click the "stop" / "Terminate" button (top of the panel; the icon and label vary by Chrome version. If absent, navigate to `chrome://serviceworker-internals/?devtools` and click "Stop" on this extension's SW row).

Wait up to 30 seconds for the keepalive alarm to fire (or trigger a faster wake-up by clicking the extension icon).

Expected: SW console shows a fresh `connecting…` / `open` / `received` cycle. Server log shows a new `ws_connect`.

If the SW does NOT reconnect: this is a finding. The reconnect pattern needs revision. Document it in the memo.

- [x] **Step 10: Run Scenario C — wrong-token rejection.**

Edit `poc/mv3-ws-reconnect/extension/background.js`: change `const TOKEN = 'test-token-deadbeef';` to `const TOKEN = 'wrong-token';`. Save.

In `chrome://extensions`, click the reload icon on the PoC extension.

Expected: SW console shows a `close` event with code `1006` or similar; no `open` / `received`. Server logs an upgrade rejection (no `ws_connect` line).

After observing, revert the token change to `'test-token-deadbeef'`.

- [x] **Step 11: Write the journal memo.**

Create `docs/journal/2026-05-08-poc-mv3-ws-reconnect.md`:

```markdown
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

[Fill in: what was observed in each scenario. Specific to behaviors, not assumptions. Times, log lines, surprises.]

- Scenario A: …
- Scenario B: …
- Scenario C: …

## Implication

[Fill in: what this means for the production design.]

- Subprotocol auth: …
- SW reconnect: …
- Envelope round-trip: …

## Verdict

One of:

- ✅ **Confirms the design** — Layer 2/3 implementation can proceed as specified in `docs/solution/service.md` and `docs/solution/extension.md`.
- ⚠️ **Modifies the design** — list the modifications and the affected ADRs / solution docs.
- ❌ **Invalidates the design** — describe the failure mode and the alternative path.

## Artifacts

- `poc/mv3-ws-reconnect/` (committed, never imported by production)
```

- [x] **Step 12: If verdict is "modifies" or "invalidates," amend the relevant ADR(s).** *(Skipped: verdict is "confirms".)*

Most likely affected: ADR-008 (WebSocket transport), ADR-010 (subprotocol auth). If a finding modifies either, append a new section to the ADR ("Superseded note (2026-05-08): …") or — for invalidating findings — write a new ADR that supersedes the old one. Per `docs/decisions.md`, ADRs are append-only: never edit history; supersede.

If verdict is "confirms," skip this step.

- [x] **Step 13: Commit.**

```bash
git add poc/mv3-ws-reconnect docs/journal/2026-05-08-poc-mv3-ws-reconnect.md
# If ADR amended:
git add docs/decisions.md
git commit -m "$(cat <<'EOF'
poc: validate MV3 SW + WebSocket + protocol envelope

PoC 1 from docs/plans/phases/00-poc.md. Findings in
docs/journal/2026-05-08-poc-mv3-ws-reconnect.md.
EOF
)"
```

---

## Task 2: PoC 2 — CLI → extension pairing transport

**Files:**
- Create: `poc/cli-extension-pairing/README.md`
- Create: `poc/cli-extension-pairing/package.json`
- Create: `poc/cli-extension-pairing/cli-attempt.mjs`
- Create: `poc/cli-extension-pairing/server.mjs`
- Create: `poc/cli-extension-pairing/extension/manifest.json`
- Create: `poc/cli-extension-pairing/extension/background.js`
- Create: `poc/cli-extension-pairing/extension/popup.html`
- Create: `poc/cli-extension-pairing/extension/popup.js`
- Create: `docs/journal/2026-05-08-poc-cli-extension-pairing.md`
- Modify (conditional): `docs/decisions.md` (ADR-011 amendment)

**Question:** ADR-011 specifies that the CLI delivers the bootstrap payload to the extension via `chrome.runtime.onMessageExternal`. Is this transport actually viable from a Node CLI process? If not, what's the simplest alternative?

**Background:** `chrome.runtime.sendMessage(extensionId, ...)` is a Chrome-only API exposed inside extensions, content scripts, and web pages allowlisted via `externally_connectable.matches`. A pure Node process is none of those. We expect Plan A (the spec as written) to fail; the spike confirms this and validates an alternative — the simplest being a popup-driven claim where the user pastes the pairing code into the extension's popup and the popup itself calls the daemon's `/pair/claim` endpoint (Plan D).

**Timebox:** 1 day.

- [ ] **Step 1: Scaffold the PoC directory.**

```bash
mkdir -p poc/cli-extension-pairing/extension
```

- [ ] **Step 2: Write the README.**

Create `poc/cli-extension-pairing/README.md`:

```markdown
# PoC 2 — CLI → extension pairing transport

## Question

ADR-011 specifies that the CLI delivers the bootstrap payload to the extension via `chrome.runtime.onMessageExternal`. Is this transport actually viable from a Node CLI process?

## Approach

Two parts:

1. **Plan A (spec as written) — confirm whether `chrome.runtime` APIs are reachable from Node.** Run `node cli-attempt.mjs`. Expectation: the `chrome` global doesn't exist; the call fails. We capture this as a verdict on Plan A.
2. **Plan D (popup-driven claim) — spike the alternative.** The CLI prints the pairing code; the user pastes it into the extension's popup; the popup calls the daemon's `/pair/claim` endpoint directly. No CLI-to-extension transport needed.

## Run

Plan A:

```bash
node cli-attempt.mjs
```

Plan D:

```bash
pnpm install
pnpm start            # mock daemon listening on :9091
```

Then in Chrome:

1. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
2. Click the extension's icon to open the popup.
3. Paste pairing code `ABCD-EFGH` (any non-empty value works for the mock).
4. Click "Pair". Popup logs the bootstrap payload returned by the mock daemon.

Findings → `docs/journal/2026-05-08-poc-cli-extension-pairing.md`.
```

- [ ] **Step 3: Write `package.json`.**

Create `poc/cli-extension-pairing/package.json`:

```json
{
  "name": "poc-cli-extension-pairing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "attempt": "node cli-attempt.mjs"
  },
  "dependencies": {
    "fastify": "^5.0.0"
  }
}
```

- [ ] **Step 4: Install dependencies.**

```bash
cd poc/cli-extension-pairing && pnpm install
```

- [ ] **Step 5: Write the Plan A attempt.**

Create `poc/cli-extension-pairing/cli-attempt.mjs`:

```javascript
console.log('[plan-a] attempting chrome.runtime.sendMessage from Node...');
console.log('[plan-a] typeof chrome:', typeof chrome);

try {
  // eslint-disable-next-line no-undef
  chrome.runtime.sendMessage('fake-extension-id', { type: 'pair.bootstrap' });
  console.log('[plan-a] call succeeded — surprising. Investigate further.');
} catch (err) {
  console.log('[plan-a] call failed:', err.constructor.name, err.message);
}

console.log('[plan-a] verdict: chrome.* APIs are not available in Node — confirmed gap in ADR-011.');
```

- [ ] **Step 6: Run the Plan A attempt and observe.**

```bash
node cli-attempt.mjs
```

Expected output:
```
[plan-a] attempting chrome.runtime.sendMessage from Node...
[plan-a] typeof chrome: undefined
[plan-a] call failed: ReferenceError chrome is not defined
[plan-a] verdict: chrome.* APIs are not available in Node — confirmed gap in ADR-011.
```

Note in scratch: confirmed Plan A unviable. Move to Plan D.

- [ ] **Step 7: Write the mock daemon.**

Create `poc/cli-extension-pairing/server.mjs`:

```javascript
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

const PORT = 9091;
const VALID_CODE = 'ABCD-EFGH';

const app = Fastify({ logger: true });

app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') reply.code(204).send();
});

app.post('/pair/claim', async (request, reply) => {
  const { code } = request.body ?? {};
  if (!code || typeof code !== 'string') {
    return reply.code(400).send({ ok: false, error: { code: 'PAIRING_CODE_INVALID' } });
  }
  if (code !== VALID_CODE) {
    return reply.code(400).send({ ok: false, error: { code: 'PAIRING_CODE_INVALID' } });
  }
  return {
    ok: true,
    data: {
      extensionToken: 'mock-extension-token-' + randomUUID(),
      wsUrl: 'ws://127.0.0.1:9090/ws',
      protocolVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      nonce: randomUUID(),
    },
  };
});

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`Mock daemon listening on http://127.0.0.1:${PORT} (valid code: ${VALID_CODE})`);
```

- [ ] **Step 8: Write the extension manifest.**

Create `poc/cli-extension-pairing/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "bproxy PoC: pairing popup",
  "version": "0.0.1",
  "action": { "default_popup": "popup.html" },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": ["storage"],
  "host_permissions": ["http://127.0.0.1:9091/*"]
}
```

- [ ] **Step 9: Write the popup HTML.**

Create `poc/cli-extension-pairing/extension/popup.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font: 14px sans-serif; padding: 12px; min-width: 240px; }
      input, button { font: inherit; padding: 6px; width: 100%; box-sizing: border-box; margin: 4px 0; }
      pre { background: #f4f4f4; padding: 8px; font-size: 11px; max-height: 200px; overflow: auto; }
    </style>
  </head>
  <body>
    <h3>Pair extension</h3>
    <input id="code" placeholder="Pairing code (e.g. ABCD-EFGH)" autofocus />
    <button id="pair">Pair</button>
    <pre id="log"></pre>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 10: Write the popup script.**

Create `poc/cli-extension-pairing/extension/popup.js`:

```javascript
const codeInput = document.getElementById('code');
const button = document.getElementById('pair');
const logEl = document.getElementById('log');

function log(msg) {
  logEl.textContent += msg + '\n';
}

button.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) { log('enter a code first'); return; }
  log(`POST /pair/claim with code=${code}...`);
  try {
    const res = await fetch('http://127.0.0.1:9091/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    log(`response (${res.status}):\n${JSON.stringify(json, null, 2)}`);
    if (json.ok) {
      await chrome.storage.local.set({
        extensionToken: json.data.extensionToken,
        wsUrl: json.data.wsUrl,
      });
      log('stored token in chrome.storage.local');
      chrome.runtime.sendMessage({ type: 'pair.complete' });
    }
  } catch (err) {
    log(`error: ${err.message}`);
  }
});
```

- [ ] **Step 11: Write the background SW.**

Create `poc/cli-extension-pairing/extension/background.js`:

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'pair.complete') {
    console.log('[poc] pair.complete received from popup');
    chrome.storage.local.get(['extensionToken', 'wsUrl']).then((stored) => {
      console.log('[poc] stored bootstrap:', stored);
    });
  }
});
```

- [ ] **Step 12: Run Plan D end-to-end.**

In one terminal:
```bash
cd poc/cli-extension-pairing && pnpm start
```
Expected log: `Mock daemon listening on http://127.0.0.1:9091 (valid code: ABCD-EFGH)`.

In Chrome:
1. `chrome://extensions` → Developer mode → Load unpacked → select `poc/cli-extension-pairing/extension/`.
2. Click the extension's icon (puzzle piece menu → pin first if not visible).
3. In the popup, type `ABCD-EFGH` and click "Pair".
4. The popup log should show the JSON response with `ok: true` and an `extensionToken`.
5. Open the SW devtools (chrome://extensions → "service worker" link). Console should show `[poc] pair.complete received from popup` and `[poc] stored bootstrap: { extensionToken: ..., wsUrl: ... }`.

Try a wrong code (e.g., `WRONG`). Popup should show a 400 response with `PAIRING_CODE_INVALID`.

- [ ] **Step 13: Write the journal memo.**

Create `docs/journal/2026-05-08-poc-cli-extension-pairing.md`:

```markdown
# PoC 2 — CLI → extension pairing transport

Date: 2026-05-08
Status: complete

## Question

ADR-011 specifies that the CLI delivers the bootstrap payload to the extension via `chrome.runtime.onMessageExternal`. Is this transport actually viable from a Node CLI process?

## Method

Two-part spike:

1. **Plan A (spec as written):** `node cli-attempt.mjs` attempts to call `chrome.runtime.sendMessage` from Node.
2. **Plan D (popup-driven claim):** Mock daemon serves `POST /pair/claim`. Extension popup accepts a pairing code, calls the daemon endpoint, stores the returned token. CLI reduces to "print the pairing code for the user to copy."

## Finding

- **Plan A:** [Fill in: confirmed/refuted; what was observed.]
- **Plan D:** [Fill in: did the round-trip succeed? Any surprises with CORS, MV3 popup lifecycle, fetch from popup context?]

## Implication

[Fill in: which approach is the right transport for production?]

If Plan D is the new path, `docs/architecture.md` § *Extension Token Bootstrap (Pairing)* needs revision: the CLI step (5) ("CLI sends payload to installed extension via runtime messaging bridge") becomes "CLI prints pairing code; user pastes it into the extension popup; popup claims the code via `POST /pair/claim`." `docs/solution/extension.md` § *Pairing (No Options Page)* needs renaming and rewriting around a popup, not external messaging. ADR-011 needs an amendment recording the change.

## Verdict

One of:

- ✅ **Confirms the design** — Plan A worked unexpectedly. Investigate why and document.
- ⚠️ **Modifies the design** — Plan A unviable; Plan D adopted. ADR-011 amended; architecture.md and solution/extension.md updated in Phase 0.5.
- ❌ **Invalidates the design** — neither Plan A nor Plan D works; describe the alternative.

## Artifacts

- `poc/cli-extension-pairing/` (committed, never imported by production)
```

- [ ] **Step 14: If verdict is "modifies," amend ADR-011.**

Append a "Superseded note" section to ADR-011 in `docs/decisions.md`:

```markdown
**Superseded note (2026-05-08):** PoC 2 (`docs/journal/2026-05-08-poc-cli-extension-pairing.md`) confirmed that `chrome.runtime.onMessageExternal` is not reachable from a Node CLI process. Pairing transport changed: the extension popup now claims the pairing code directly via `POST /pair/claim`. CLI's role reduces to printing the pairing code for the user. See updated flow in `docs/architecture.md` § Extension Token Bootstrap (to be edited in Phase 0.5).
```

If verdict is "confirms" (Plan A worked), skip this step.

- [ ] **Step 15: Commit.**

```bash
git add poc/cli-extension-pairing docs/journal/2026-05-08-poc-cli-extension-pairing.md
# If ADR amended:
git add docs/decisions.md
git commit -m "$(cat <<'EOF'
poc: validate CLI to extension pairing transport

PoC 2 from docs/plans/phases/00-poc.md. Findings in
docs/journal/2026-05-08-poc-cli-extension-pairing.md.
EOF
)"
```

---

## Task 3: PoC 3 — Paste-flavored writes on real frameworks

**Files:**
- Create: `poc/paste-fill/README.md`
- Create: `poc/paste-fill/snippet.js`
- Create: `docs/journal/2026-05-08-poc-paste-fill.md`

**Question:** Does the paste-flavored input pattern (native value setter + `InputEvent('beforeinput'/'input', { inputType: 'insertFromPaste' })` + `Event('change')`) update controlled state in a real React/Vue application form, such that the user's eventual submit sends the pasted values?

**Timebox:** ½ day.

**Target page:** Welcome to the Jungle's application form is the suggested first target. Final pick is at execution time — pick any modern React/Vue job application form. Document which one was used.

- [ ] **Step 1: Scaffold the PoC directory.**

```bash
mkdir -p poc/paste-fill
```

- [ ] **Step 2: Write the README.**

Create `poc/paste-fill/README.md`:

```markdown
# PoC 3 — Paste-flavored writes on real frameworks

## Question

Does the paste-flavored input pattern (native value setter + `InputEvent('beforeinput'/'input', { inputType: 'insertFromPaste' })` + `Event('change')`) update controlled state in a real React/Vue application form?

## Run

1. Open a real application form. Suggested: Welcome to the Jungle (https://www.welcometothejungle.com/) — find any "Apply" page that uses their multi-field application form. Any modern React/Vue form is fine; record which one you used.
2. Open devtools console.
3. Paste the contents of `snippet.js` into the console. (Browsers may require typing "allow pasting" first — follow the prompt.)
4. Find a target field and call:
   ```js
   pasteFill('input[name="firstName"]', 'Test')
   ```
5. Observe:
   - The value appears in the field.
   - The framework's reflected state updates (verify by typing one extra character — does the form preserve `Test` plus your typed character, or does it reset to your character only?).
   - If the form has any "review" or "summary" view that reads back the value, it shows the pasted value.

Findings → `docs/journal/2026-05-08-poc-paste-fill.md`.
```

- [ ] **Step 3: Write the snippet.**

Create `poc/paste-fill/snippet.js`:

```javascript
window.pasteFill = function (selector, value) {
  const el = document.querySelector(selector);
  if (!el) { console.error('not found:', selector); return false; }
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    console.error('not an input/textarea:', el);
    return false;
  }
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: value, bubbles: true, cancelable: true }));
  el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: value, bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`[poc] filled ${selector} with "${value}". Verify framework state by typing an extra character.`);
  return true;
};
```

- [ ] **Step 4: Test against at least three field types.**

For the chosen target page, exercise the snippet against:

- A short text input (e.g., first name).
- An email input.
- A textarea (e.g., cover letter or "tell us about yourself").

For each, after running `pasteFill`, type one extra character at the end of the field. The expected behavior is that the value becomes `<pasted-value><typed-char>`. If instead it becomes just `<typed-char>` (the pasted value vanished), the framework rejected the synthetic input — record this as a finding.

If a target site's form rejects the pattern entirely, try at least one more site (Greenhouse, Lever, Workday, or another React-based form) before declaring the verdict.

- [ ] **Step 5: Test a custom-component field if present.**

If the form uses a custom React-Select or similar dropdown for any field, attempt the same pattern on it (the underlying `<input>` inside the dropdown's DOM). Record the outcome separately — custom dropdowns may not respond to plain `insertFromPaste` and may need the `select` action's click-trigger pattern instead. This finding belongs in the memo even though it's outside ADR-007's scope.

- [ ] **Step 6: Write the journal memo.**

Create `docs/journal/2026-05-08-poc-paste-fill.md`:

```markdown
# PoC 3 — Paste-flavored writes on real frameworks

Date: 2026-05-08
Status: complete

## Question

Does the paste-flavored input pattern update controlled state in a real React/Vue application form, such that the user's eventual submit sends the pasted values?

## Method

Devtools-pasted snippet (`poc/paste-fill/snippet.js`) running on a real application form. Tested against multiple field types and (if present) a custom-component field.

## Target

[Fill in: which site, which form, which framework if obvious. e.g., "Welcome to the Jungle / Stripe SF Engineering application page / React".]

## Finding

- **Plain text input:** [observed behavior]
- **Email input:** [observed behavior]
- **Textarea:** [observed behavior]
- **Custom dropdown component (if tested):** [observed behavior]
- **Edge cases / surprises:** [anything noteworthy — submit-behavior, validation re-runs, framework dev warnings in console]

## Implication

[Fill in: does ADR-007 hold? Are there field types that need a different approach? Does the `select` primitive need to be sharper?]

## Verdict

One of:

- ✅ **Confirms the design** — ADR-007 stands. `fill` defaults to `insertFromPaste` as specified.
- ⚠️ **Modifies the design** — pattern works for [X] but not [Y]; document the constraints; ADR-007 amended with the carve-out.
- ❌ **Invalidates the design** — pattern does not work in modern React/Vue. Reconsider write strategy.

## Artifacts

- `poc/paste-fill/snippet.js` (committed)
```

- [ ] **Step 7: If verdict is "modifies" or "invalidates," amend ADR-007.**

Append a "Superseded note" or follow-up section in `docs/decisions.md` ADR-007 capturing the constraint or invalidation. Per `docs/decisions.md` rules, ADRs are append-only; supersede rather than rewrite.

- [ ] **Step 8: Commit.**

```bash
git add poc/paste-fill docs/journal/2026-05-08-poc-paste-fill.md
# If ADR amended:
git add docs/decisions.md
git commit -m "$(cat <<'EOF'
poc: validate paste-flavored writes on real frameworks

PoC 3 from docs/plans/phases/00-poc.md. Findings in
docs/journal/2026-05-08-poc-paste-fill.md.
EOF
)"
```

---

## Task 4: Phase 0 closeout

**Files:**
- Verify only. No new files unless a gap is found.

- [ ] **Step 1: Verify all three PoCs produced their three required outputs.**

For each of `mv3-ws-reconnect`, `cli-extension-pairing`, `paste-fill`, confirm:

```bash
ls poc/<name>/                                # spike code present
ls docs/journal/2026-05-08-poc-<topic>.md     # memo present
```

For each memo, confirm a **Verdict** section exists with one of: ✅ Confirms / ⚠️ Modifies / ❌ Invalidates.

- [ ] **Step 2: Verify ADR amendments are in place for any "modifies" or "invalidates" verdict.**

If any PoC modified or invalidated a design decision, confirm the corresponding ADR in `docs/decisions.md` has a "Superseded note" or new ADR entry. Cross-check against the verdict in each memo.

- [ ] **Step 3: Confirm no PoC code is imported by production packages.**

Production packages don't exist yet at this phase, so this should be trivially true. The check exists as a habit: run

```bash
grep -rn "poc/" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" -- :^poc/
```

Expected: no output. If output appears, it's a leak — investigate.

- [ ] **Step 4: Phase 0 done.**

The roadmap defines Phase 0 done as: "all three PoCs have committed code under `poc/<name>/`, journal memos under `docs/journal/`, and any ADR amendments under `docs/decisions.md`. Each PoC closes with a verdict."

If all four checks above pass, Phase 0 is complete. Phase 0.5 (doc reconciliation) is the next phase — its plan will be written separately, informed by the PoC verdicts.

No commit at this step; this is a verification-only checkpoint.

---

## Out of scope for this plan

- **Phase 0.5 (doc reconciliation).** Has its own plan, written after Phase 0 closes so it can incorporate the actual verdicts.
- **Phases 1–5 (production layers).** Each gets its own plan, written when its predecessor completes. Just-in-time planning per the roadmap's bottom-up philosophy.
- **Workspace setup, tooling, CI.** Belong to Phase 1 — `pnpm check` and the static gates do not apply to PoC code, which is throwaway by design.
