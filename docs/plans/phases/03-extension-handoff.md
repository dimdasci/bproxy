---
title: Phase 3 — Hand-off note for the next session
---

> Short status file for whoever (likely a fresh Claude Code session) picks
> up Phase 3 execution after a context clear. Delete this file once the
> phase is closed; it is not part of the long-term documentation.

## Where we are

- **Branch:** `plan/03-extension` (off `main`, 21 commits ahead).
- **Tasks complete (6 of 17):** Task 1 (contract alignment), Task 2 (WXT bootstrap), Task 3 (storage/trace/dedupe/response helpers), Task 4 (popup pairing flow), Task 5 (background WebSocket client), Task 6 (dispatcher/dedupe/`debug.log`).
- **Tasks remaining (11):** 7 → 17, in plan order.

Verify with `git log --oneline main..HEAD` from the repo root.

## Where to resume

**Next: Task 7 — Tab resolution, frame table, and programmatic injection.** Read its section in [`03-extension.md`](./03-extension.md#task-7-tab-resolution-frame-table-and-programmatic-injection). Task 6 already wires the WS client to a dispatcher with explicit browser/content handler seams; Task 7 should replace the current "not implemented" DOM path with real tab resolution, injection, and background↔content RPC.

Dependencies that landed in earlier tasks (don't re-derive):

- `extension/src/background/storage.ts` — `bootstrapItem` carries `{ extensionToken, wsUrl, protocolVersion, issuedAt, expiresAt, nonce }`; `dedupeItem` and `traceItem` are already wired in the SW.
- `BproxyForwardedRequest` from `@bproxy/shared` — wire shape with `target.tabId`.
- `extension/src/background/{dispatcher,forwarded-actions,forwarded-params,forwarded-request}.ts` — Task 6 parses and routes forwarded requests, handles `debug.log`, traces every accepted request, and expects real browser/DOM handlers to be plugged into its DI seams.
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

- **Task 7** needs the `BproxyForwardedRequest.target.tabId` to know which tab to target. The shared type already exists.
- **Task 7** should replace the current background-entrypoint `notImplemented(...)` stubs with real browser/content routing modules, starting with tab resolution, injected-tab bookkeeping, and content RPC.
- **Task 8** will define the runtime content-script message contract consumed by Task 7's RPC layer.
- **Task 13** will need to decide whether to default-disable `eval` with an `EVAL_DISABLED` error. Daemon has no eval flag wired today; extension-side default-deny is fine.

## Decisions worth remembering across the clear

- **Bootstrap is one atomic record**, not multiple `chrome.storage.local` keys. Use `bootstrapItem.setValue(...)` / `bootstrapItem.getValue()` — never `chrome.storage.local.set({ token, ... })`.
- **Pairing module convention:** all side-effects DI'd via a typed `*Deps` interface, no global `chrome.*` / `Date.now()` / `fetch` calls. Tests inject in-memory fakes. Repeat this pattern for the WS client, dispatcher, and content RPC.
- **Popup is a directory entrypoint** (`popup/index.html` + `popup/main.ts`) because WXT 0.20 rejects same-basename siblings. The plan's text still says flat `popup.html`/`popup.ts` — the directory form is canonical.
- **Manifest hygiene hook in `wxt.config.ts`** strips `content_scripts: []` and `web_accessible_resources: []` that WXT emits when a runtime content script is declared. Don't fight this — Task 16 will lock it in as a hygiene test.
- **`noPropertyAccessFromIndexSignature: true`** stays on for the extension package. If a future task genuinely needs to bypass it, do so with a per-file `// @ts-expect-error`, not by re-introducing the per-project override.

## Things NOT to do in Task 7 (common scope drift)

- Don't add DOM action logic beyond the minimum RPC/injection substrate; read/write handlers start in Tasks 8–14.
- Don't add MAIN-world helpers (Task 13).
- Don't expand `wxt.config.ts` manifest permissions (`debugger` is gated on Task 14's opt-in flag).
- Don't change `BproxyForwardedRequest` or any other `@bproxy/shared` types.
