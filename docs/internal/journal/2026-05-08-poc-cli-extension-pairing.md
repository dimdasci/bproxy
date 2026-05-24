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

- **Plan A:** Confirmed unviable from Node CLI. Running `node cli-attempt.mjs` produced:
  - `typeof chrome: undefined`
  - `ReferenceError: chrome is not defined`
  This confirms `chrome.runtime.sendMessage` is not callable from a native Node process.
- **Plan D:** Succeeded end-to-end.
  - Popup request `POST /pair/claim` with `ABCD-EFGH` returned `200` with bootstrap payload (`extensionToken`, `wsUrl`, `protocolVersion`, timestamps, nonce).
  - Popup stored token in `chrome.storage.local`.
  - Background SW observed stored bootstrap values.
  - Invalid code path (`WRONG`) returned `400` with `PAIRING_CODE_INVALID`.
  - No blockers observed with popup-context `fetch` to localhost in this setup.

## Implication

Plan D is the viable production transport. Plan A (CLI → extension runtime messaging from Node) is not implementable as written.

Required doc updates:
- `docs/architecture.md` § *Extension Token Bootstrap (Pairing)*: replace CLI runtime-bridge delivery step with popup-driven claim flow.
- `docs/solution/extension.md` § *Pairing (No Options Page)*: rewrite around extension popup claim UX instead of external runtime messaging from CLI.
- `docs/decisions.md` ADR-011: append superseded note capturing the transport change.

## Verdict

⚠️ **Modifies the design** — Plan A is unviable; Plan D is adopted.

## Artifacts

- `poc/cli-extension-pairing/` (committed, never imported by production)
