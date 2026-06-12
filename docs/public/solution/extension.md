---
title: Browser Extension
---

Implementation spec for the Chrome Manifest V3 extension. Built with [WXT](https://wxt.dev).

**Decisions that constrain this:** ADR-001 (programmatic injection only), ADR-002 (WXT), ADR-006 (jittered polling), ADR-007 (three write methods), ADR-013 (MAIN world on demand), ADR-014 (shadow-DOM targeting), ADR-015 (MAIN-world hygiene), ADR-016 (WAR default-deny).

---

## Project layout

```text
extension/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wxt.config.ts
├── README.md
├── scripts/
│   ├── assert-build.ts
│   └── smoke/
│       ├── command.ts
│       ├── daemon.ts
│       ├── fixture-server.ts
│       ├── fixture.html
│       └── workflow.ts
└── src/
    ├── entrypoints/
    │   ├── background.ts
    │   ├── content.ts
    │   └── popup/
    │       ├── index.html
    │       ├── main.ts
    │       └── pairing.ts
    ├── background/
    │   ├── browser-action-interstitials.ts
    │   ├── browser-action-support.ts
    │   ├── browser-actions.ts
    │   ├── dedupe.ts
    │   ├── dispatcher.ts
    │   ├── forwarded-actions.ts
    │   ├── forwarded-params.ts
    │   ├── forwarded-request.ts
    │   ├── injection.ts
    │   ├── main-world*.ts
    │   ├── responses.ts
    │   ├── storage*.ts
    │   ├── tabs*.ts
    │   ├── trace.ts
    │   └── ws-client.ts
    ├── content/
    │   ├── actions/
    │   │   ├── fill.ts
    │   │   ├── reads.ts
    │   │   ├── scroll-wait.ts
    │   │   └── select.ts
    │   ├── discovery.ts
    │   ├── dom-helpers.ts
    │   ├── events.ts
    │   ├── page-state.ts
    │   ├── polling.ts
    │   ├── read-tree.ts
    │   ├── rpc.ts
    │   └── targeting.ts
    └── test/
        ├── fakes/
        ├── fixtures/
        └── setup-chrome-storage.ts
```

### Deliberate WXT layout deviations

- `srcDir: "src"` is enabled so dependency-cruiser and knip scan the real extension sources under `extension/src/**`.
- The popup uses a **directory entrypoint**: `src/entrypoints/popup/index.html` + `main.ts`. WXT 0.20 rejects flat `popup.html` + `popup.ts` siblings with the same basename, so the source layout differs from the original phase sketch even though the emitted manifest still points at `popup.html`.
- The runtime content script is bundled by WXT but **not declared** in the manifest. The background service worker injects it programmatically on first use.

Output: `extension/.output/chrome-mv3/`.

---

## WXT configuration

`extension/wxt.config.ts` is part of the security contract, not just build plumbing.

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  vite: () => ({
    build: {
      sourcemap: true,
      modulePreload: false,
    },
  }),
  manifest: {
    name: "bproxy",
    description: "Browser proxy companion extension for bproxy daemon.",
    permissions: ["tabs", "scripting", "webNavigation", "alarms", "storage"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "bproxy",
      default_popup: "popup.html",
    },
  },
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0) {
        delete manifest.content_scripts;
      }
      if (
        Array.isArray(manifest.web_accessible_resources) &&
        manifest.web_accessible_resources.length === 0
      ) {
        delete manifest.web_accessible_resources;
      }
    },
  },
});
```

Locked implications:

- no declarative `content_scripts` (ADR-001);
- no `web_accessible_resources` by default (ADR-016);
- no `debugger` permission in the shipped manifest; debugger-backed screenshots remain future opt-in only;
- source maps are preserved in production output to keep service-worker and content-script failures diagnosable;
- Vite's modulepreload polyfill is disabled because it injects `MutationObserver`, which would violate ADR-006.

---

## Runtime shape

### Background service worker

**Entrypoint:** `src/entrypoints/background.ts`

Owns:

1. bootstrap storage lookup and validation;
2. daemon WebSocket connection, reconnect, heartbeat, and badge state;
3. forwarded-request parsing (`BproxyForwardedRequest`);
4. exactly-once execution via dedupe + replay-safe responses;
5. extension trace ring buffer for `debug.log`;
6. browser-API actions (`navigate`, `screenshot`, `require-human`, `tab.*`);
7. programmatic content-script injection and DOM-action RPC;
8. one-shot MAIN-world execution for `fill(method="runtime-api")`.

Authentication uses WebSocket subprotocols:

- `bproxy.v1`
- `auth.{base64url(extensionToken)}`

Connection state is surfaced via the action badge:

- empty / transparent = disconnected or connected idle;
- `…` = connecting;
- `!` = startup or transport error.

### Popup pairing UI

**Entrypoint:** `src/entrypoints/popup/index.html` + `main.ts`

Flow:

1. user enters the one-time pairing code;
2. popup `POST`s `{ code }` to `http://127.0.0.1:9615/pair/claim`;
3. popup validates the bootstrap payload shape:
   - `extensionToken` non-empty string
   - `wsUrl` loopback `ws://`
   - `protocolVersion === 1`
   - `expiresAt > Date.now()`
   - `nonce` present
4. popup stores the bootstrap payload as **one atomic record** in `chrome.storage.local`;
5. popup sends `pair.complete` to the background worker so reconnect happens immediately.

Validation failures surface distinct popup-side error codes (`INVALID_PAYLOAD_SHAPE`, `INVALID_WS_URL`, `UNSUPPORTED_PROTOCOL_VERSION`, `BOOTSTRAP_EXPIRED`, `MISSING_NONCE`, `PAIR_TRANSPORT_ERROR`, `PAIR_NOTIFY_FAILED`) in addition to daemon pass-throughs (`PAIRING_CODE_INVALID`, `PAIRING_CODE_EXPIRED`, `PAIRING_CODE_CONSUMED`).

### Runtime content script

**Entrypoint:** `src/entrypoints/content.ts`

The content script is registered with:

```ts
export default defineContentScript({
  registration: "runtime",
  matches: ["<all_urls>"],
  runAt: "document_idle",
  world: "ISOLATED",
});
```

The service worker injects it with `chrome.scripting.executeScript` on first command per tab. The content side keeps a single `chrome.runtime.onMessage` listener and returns typed success/error envelopes plus page-state snapshots.

---

## Storage schema

`src/background/storage.ts` defines the typed storage items.

| Key | Scope | Purpose |
|---|---|---|
| `local:bootstrap` | local | Pairing bootstrap payload `{ extensionToken, wsUrl, protocolVersion, issuedAt, expiresAt, nonce }` |
| `local:configFlags` | local | Future opt-in flags such as `debuggerScreenshot` |
| `session:pins` | session | Reserved tab-pin map storage seam |
| `session:dedupe` | session | Request-id → cached response + timestamp |
| `session:injectedTabs` | session | Tabs already injected with the runtime content script |
| `session:trace` | session | Bounded extension trace ring buffer |

Important contract: `bootstrapItem` is written and read as **one record**, never as separate token/url/version keys.

---

## Wire contract with the daemon

The extension parses **forwarded** daemon messages:

```ts
type BproxyForwardedRequest<A extends Action = Action> = BproxyRequest<A> & {
  target: { tabId: number };
};
```

Implications:

- the daemon remains the source of truth for `session → tabId`;
- the extension does not re-resolve session state;
- `session.*`, `debug.last`, and `debug.status` stay daemon-local and must not have extension handlers;
- `debug.log` is forwarded and served from the extension ring buffer.

Responses are the normal shared `BproxyResponse` envelope; successful responses include page state and `replay`.

---

## Action handling

### DOM actions in ISOLATED world

Handled through `src/content/**` and routed via background/content RPC.

| Action | Notes |
|---|---|
| `text`, `links`, `images`, `elements`, `outline`, `dom` | Read-only DOM extraction; `links` returns structured URLs, traverses open shadow roots, and can filter to visible/in-viewport anchors |
| `scroll`, `wait` | Jittered polling only; no `MutationObserver`. `scroll` targets only the viewport/document by default or an explicit agent-supplied `ElementTarget`; it never infers scroll containers. |
| `fill(method="direct")` | Native DOM state write, no events |
| `fill(method="paste")` | Dispatches `beforeinput`/`input` with `inputType: "insertFromPaste"` plus `change`; no synthetic key events |
| `fill-form` | Multi-field isolated-world writes with hidden-field guard and read-back verification |
| `select` | Trigger + poll + option click + verification |

### MAIN-world one-shot actions

Handled in `src/background/main-world*.ts`.

| Action | Notes |
|---|---|
| `fill(method="runtime-api", world="main")` | Exactly one `chrome.scripting.executeScript({ world: "MAIN" })` call per request |

MAIN-world injected functions must:

- resolve only the provided target/route;
- catch and normalize errors inside the injected function;
- return plain data only;
- contain no identifying literals such as extension ids, `chrome-extension`, package names, or bproxy branding;
- install no persistent listeners or globals.

### Browser-API actions in the background

Handled in `src/background/browser-actions.ts`.

| Action | Notes |
|---|---|
| `navigate` | `chrome.tabs.update` + wait for top-level load + interstitial detection → `HUMAN_REQUIRED` |
| `screenshot` | `chrome.tabs.captureVisibleTab` normal path |
| `screenshot(debugger=true)` | currently returns `DEBUGGER_DISABLED` unless a future explicit opt-in ships with permission + flag wiring |
| `tab.list` | returns Chrome tabs plus injected/session annotations where known |
| `tab.open`, `tab.close`, `tab.pin`, `tab.unpin` | Chrome tabs API only; does not take ownership of daemon session state |
| `require-human` | returns structured `HUMAN_REQUIRED` for daemon pause handling |

---

## Targeting and discovery

`src/content/targeting.ts` and `src/content/discovery.ts` implement the route-based targeting contract from ADR-014.

```ts
interface ElementRoute {
  hosts: Array<{ selector: string; index?: number }>;
  target: string;
}

type ElementTarget =
  | { selector: string; route?: never }
  | { selector?: never; route: ElementRoute };
```

Discovery rules:

- open shadow roots are supported;
- closed shadow roots are out of scope and return honest target errors;
- probing is intent-scoped (active element chain, dialogs/popovers, viewport/hit-test roots, scoped subtree);
- runtime editor handles are probed only inside the candidate root, never via whole-page recursive scans.

---

## Polling and page state

`src/content/polling.ts` provides the shared wait/stability primitive.

Rules:

- jittered intervals, not fixed cadence;
- bounded timeout;
- visibility-aware bail-out for destructive actions (`TAB_NOT_VISIBLE` when hidden);
- no `MutationObserver` in source or built output.

`src/content/page-state.ts` normalizes page snapshots into the shared `PageState` envelope:

```ts
interface PageState {
  url: string;
  title: string;
  state: "loading" | "ready" | "error";
  busy: boolean;
}
```

---

## Dedupe and observability

### Dedupe

`src/background/dedupe.ts` caches prior responses by request id:

```ts
interface DedupeEntry {
  response: BproxyResponse;
  ts: number;
}
```

The store is bounded by size and TTL so daemon replay-on-reconnect does not re-run destructive requests.

### Trace ring buffer

`src/background/trace.ts` stores bounded trace entries for `debug.log`.

```ts
interface TraceEntry {
  id: string;
  action: string;
  tab: number;
  timestamp: number;
  elapsed: number;
  result: "ok" | "error";
  errorCode?: string;
  replay: boolean;
  extensionVersion: string;
}
```

The `extensionVersion` stamp makes stale-build traces visible after extension reloads.

---

## Security and exposure hygiene

- **Programmatic injection only.** No default content script presence.
- **ISOLATED world by default.** Reads plus `direct`/`paste` writes stay out of MAIN world.
- **MAIN world is one-shot.** `runtime-api` fill executes through a single `chrome.scripting.executeScript({ world: "MAIN" })` call.
- **Default-deny WAR.** No `web_accessible_resources` are shipped.
- **No default debugger surface.** The manifest omits the `debugger` permission.
- **No `MutationObserver`.** The extension uses jittered polling instead.
- **Bootstrap secrecy.** Long-lived auth material is kept in `chrome.storage.local`; per-session caches live in `chrome.storage.session`.

---

## Testing and local verification

Automated coverage lives under:

- `src/background/__tests__`
- `src/content/__tests__`
- `src/entrypoints/popup/__tests__`

Locked design assertions include:

- no `MutationObserver` in the production bundle;
- manifest contains no declarative `content_scripts` or default `web_accessible_resources`;
- paste writes dispatch the expected paste-flavored events and no key events;
- MAIN-world actions use `executeScript({ world: "MAIN" })` only on demand;
- duplicate request ids reply from cache rather than executing twice;
- production artifacts preserve source maps and useful startup crash labels.

Local smoke helpers live under `scripts/smoke/` and exercise the real daemon + real Chrome pairing flow on localhost.

---

## Development

```bash
pnpm --filter @bproxy/extension dev
pnpm --filter @bproxy/extension build
pnpm --filter @bproxy/extension typecheck
pnpm --filter @bproxy/extension test
```

See [`extension/README.md`](../../../extension/README.md) for the end-to-end smoke workflow and local loading instructions.
