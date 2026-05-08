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
