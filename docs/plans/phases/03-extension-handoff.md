---
title: Phase 3 — Hand-off note for the next session
---

> Short status file for whoever (likely a fresh Claude Code session) picks
> up Phase 3 execution after a context clear. Delete this file once the
> phase is closed; it is not part of the long-term documentation.

## Where we are

- **Branch:** `plan/03-extension` (verify exact divergence with `git log --oneline main..HEAD`).
- **Tasks complete (12 of 17):** Task 1 (contract alignment), Task 2 (WXT bootstrap), Task 3 (storage/trace/dedupe/response helpers), Task 4 (popup pairing flow), Task 5 (background WebSocket client), Task 6 (dispatcher/dedupe/`debug.log`), Task 7 (tab resolution/frame table/programmatic injection), Task 8 (content RPC/page-state foundation), Task 9 (targeting and shadow-aware discovery primitives), Task 10 (read action handlers), Task 11 (DOM polling / `wait` / `scroll`), Task 12 (ISOLATED-world writes: `direct` / `paste` / `fill-form` / `select`).
- **Tasks remaining (5):** 13 → 17, in plan order.

Verify with `git log --oneline main..HEAD` from the repo root.

## Where to resume

**Next: Task 13 — MAIN-world one-shot actions (`runtime-api` and `eval`).** Read its section in [`03-extension.md`](./03-extension.md#task-13-main-world-one-shot-actions--runtime-api-and-eval). Task 12 is now in: `extension/src/content/events.ts` holds native setter / paste event helpers plus actionability checks, `content/actions/fill.ts` implements `fill` + `fill-form`, `content/actions/select.ts` covers native/custom dropdown flows, and `entrypoints/content.ts` wires the new handlers into the runtime content host. Build on that boundary; do not move `runtime-api` into the content script.

Dependencies that landed in earlier tasks (don't re-derive):

- `extension/src/background/storage.ts` — `bootstrapItem` carries `{ extensionToken, wsUrl, protocolVersion, issuedAt, expiresAt, nonce }`; `dedupeItem`, `traceItem`, and `injectedTabsItem` are already wired in the SW.
- `BproxyForwardedRequest` from `@bproxy/shared` — wire shape with `target.tabId`.
- `extension/src/background/{dispatcher,forwarded-actions,forwarded-params,forwarded-request}.ts` — Task 6 parses and routes forwarded requests, handles `debug.log`, and traces every accepted request.
- `extension/src/background/{injection,tabs}.ts` — Task 7 resolves daemon-targeted tabs, tracks injected tabs in session storage, observes navigation/frame events, injects `content-scripts/content.js` on first use, and routes DOM actions through timeout-bounded RPC.
- `extension/src/content/{rpc,page-state,polling,read-tree}.ts` plus `extension/src/entrypoints/content.ts` — Task 8 owns the content-side contract and listener registration; Tasks 10/11 now add the read handlers, subtree/text serialization helpers, and jittered polling primitives already wired into the runtime content script.
- `extension/src/background/ws-client.ts` now exposes `send(data)` so the dispatcher can reply over the active socket.

## Workflow rule that survives the context clear

**Memory file `~/.claude-team/projects/<this-project>/memory/feedback_minors_must_be_confirmed.md` is auto-loaded.** It encodes the rule the user established mid-Phase-3:

> A task is not complete until every reviewer finding — Critical, Important, Minor, "non-blocking", "paint", AND pre-existing gaps the reviewer flagged in passing — has been (a) resolved by code change and (b) explicitly confirmed by a re-review from the same reviewer type. Re-dispatch the reviewer with the fix SHA and wait for "all closed, no new findings" before marking the task complete.

This was learned the hard way at the end of Task 4. Don't try to argue YAGNI or scope creep with the user — they have already adjudicated that category twice.

Workflow per task:

1. Dispatch implementer (general-purpose agent) with the full Task N text + scene-setting context + verbatim contract facts that depend on prior tasks.
2. Dispatch spec compliance reviewer (general-purpose) with the implementer's report and the same Task N text.
3. Apply fix loop until spec ✅.
4. Dispatch code-quality reviewer (general-purpose) with commit SHAs.
5. Apply fix loop until code-quality ✅ AND every finding (incl. Minors / pre-existing gaps) is closed AND re-confirmed by the same code-quality reviewer.
6. Mark task complete in the plan file (status line + flip `[ ]` to `[x]`).
7. Move to next task.

## Quality gates expected to pass at every checkpoint

From repo root:

```
pnpm --filter @bproxy/extension typecheck
pnpm --filter @bproxy/extension test
pnpm --filter @bproxy/extension build
pnpm check
pnpm -r test
```

The 3 dependency-cruiser `no-orphans` warnings on `extension/src/entrypoints/{background,content}.ts` and `cli/src/index.ts` are expected and will resolve as later tasks wire those entrypoints into real modules. They are warnings, not errors — `pnpm check` exits 0.

Some service tests bind sockets (`workflows`, `round-trip`, `lifecycle*`, `observability-contract`, `auth-ordering`) and fail under the default Bash sandbox with `EPERM 127.0.0.1`. Run with `dangerouslyDisableSandbox: true` if you need to verify them; baseline is that they pass outside the sandbox.

## Open seams the next tasks will close

These are flagged here so you don't waste a research turn rediscovering them:

- **Task 13** now owns the remaining `fill` branch: `runtime-api` must stay background-owned and use one-shot `chrome.scripting.executeScript(..., { world: "MAIN" })` only when `method === "runtime-api" && world === "main"`.
- **Task 13** will need to decide whether to default-disable `eval` with an `EVAL_DISABLED` error. Daemon has no eval flag wired today; extension-side default-deny is fine.
- **Task 14** will need to connect background browser actions (`navigate`, `screenshot`, `tab.*`, `require-human`) to the dispatcher; Task 12 only touched content-side DOM writes.

## Decisions worth remembering across the clear

- **Bootstrap is one atomic record**, not multiple `chrome.storage.local` keys. Use `bootstrapItem.setValue(...)` / `bootstrapItem.getValue()` — never `chrome.storage.local.set({ token, ... })`.
- **Pairing/module convention:** all side-effects DI'd via a typed `*Deps` interface where practical, no hidden global `Date.now()` / `fetch` dependencies in core logic. Tests inject in-memory fakes. Task 9 continued that style with fake-DOM fixtures instead of bringing in jsdom.
- **Popup is a directory entrypoint** (`popup/index.html` + `popup/main.ts`) because WXT 0.20 rejects same-basename siblings. The plan's text still says flat `popup.html`/`popup.ts` — the directory form is canonical.
- **Manifest hygiene hook in `wxt.config.ts`** strips `content_scripts: []` and `web_accessible_resources: []` that WXT emits when a runtime content script is declared. Don't fight this — Task 16 will lock it in as a hygiene test.
- **`noPropertyAccessFromIndexSignature: true`** stays on for the extension package. If a future task genuinely needs to bypass it, do so with a per-file `// @ts-expect-error`, not by re-introducing the per-project override.

## Things NOT to do in Task 13 (common scope drift)

- Don't move `runtime-api` execution into the content script; MAIN-world one-shot execution belongs in background helpers.
- Don't expand `wxt.config.ts` manifest permissions (`debugger` is gated on Task 14's opt-in flag).
- Don't change `BproxyForwardedRequest` or any other `@bproxy/shared` types just to make MAIN-world plumbing convenient.
- Don't add extension-side method auto-selection or fallback chains; the agent chooses `direct` / `paste` / `runtime-api` explicitly.
