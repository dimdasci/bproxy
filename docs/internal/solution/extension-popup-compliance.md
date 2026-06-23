---
title: Extension Popup Compliance and Presentation
---

Solution note for making the bproxy Chrome extension popup clearer, more transparent, and easier to review against Chrome Web Store expectations.

**Decisions that constrain this:** [ADR-001](../decisions.md#adr-001-default-instrumentation-strategy--read-mode) (programmatic injection only), [ADR-011](../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) (popup-driven pairing), [ADR-016](../decisions.md#adr-016-web_accessible_resources-default-deny) (no WAR by default), [ADR-017](../decisions.md#adr-017-sensoractuator-boundary) (extension is sensor/actuator only), [ADR-024](../decisions.md#adr-024-no-arbitrary-page-eval-and-no-scroll-target-inference) (no eval / no scroll inference), and [ADR-025](../decisions.md#adr-025-security-scanner-findings-are-remediated-in-code) (security findings remediated in code).

## Inputs

- Current popup screenshots show a minimal pairing form with title, pairing-code input, pair button, and one status sentence. It is functional, but too terse for a user or reviewer to understand scope, authorship, version compatibility, license, or where to read more.
- Current extension spec: [public extension solution](../../public/solution/extension.md).
- Current public documentation URL: <https://dimdasci.github.io/bproxy/>.
- Current root package metadata: version `0.9.0`, license `MIT`, description `Human-in-the-loop browser proxy for AI agents.`
- Current protocol version source: `shared/src/version.ts` exports `PROTOCOL_VERSION = 2`.
- Current license file: [`LICENSE`](../../../LICENSE). User-facing credits use `Dim Kharitonov`.

## Chrome Web Store requirements observed

Chrome's policy pages use five themes that apply directly to this popup and listing.

| Theme | Requirement | Source |
|---|---|---|
| Be honest | Extension functionality should be clearly disclosed to users, with no surprises. | [Program Policies — Chrome Web Store Principles](https://developer.chrome.com/docs/webstore/program-policies) |
| Be useful / quality | Extensions should have a narrow, understandable purpose and a respectful user experience. Persistent UI should help the current task and avoid distraction. | [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) |
| Minimum functionality | Extension must provide real utility, not just launch/link to another site. | [Minimum Functionality](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality) |
| Permission minimality | Request the narrowest permissions needed for implemented features; do not future-proof permissions. | [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions) |
| Data transparency and handling | Disclose collection/use/sharing of user data, and handle auth/user data securely. | [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), [Handling Requirements](https://developer.chrome.com/docs/webstore/program-policies/data-handling) |
| Listing metadata | Provide a detailed description, graphics, homepage URL, support URL, and content rating/details. | [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) |

## Presentation goal

The popup should answer four questions immediately:

1. **What is this?** The Chrome-side piece of bproxy: a local, human-in-the-loop browser bridge for AI agents and agentic systems.
2. **What does it do?** Pairs this Chrome profile with the local bproxy daemon so an agent can request explicit browser actions through the user's real browser session.
3. **Who made it and under what terms?** Created by Dim Kharitonov, MIT licensed.
4. **Where can I verify details?** Documentation, license, and credits links.

Avoid decorative product-dashboard language. Do **not** introduce badges, chips, gradients, icon clutter, or trend-driven UI elements. The popup should feel like a small browser utility: restrained, readable, explicit.

## Proposed popup content

```text
bproxy
Human-in-the-loop browser bridge for AI agents.

Status: Not paired

Pairing code
[ VQE7-KNBM              ]
[ Pair extension ]

Run `bproxy service start` and paste the one-time code shown by the daemon.

Extension 0.9.0 · Protocol 2
Documentation · License · Credits
Created by Dim Kharitonov · MIT
```

When paired:

```text
Status: Paired with local daemon
```

When pairing fails, preserve the existing specific error messages and codes, but keep them below the form and use plain text color treatment only.

## Required metadata

The popup should render these values from source-of-truth constants where practical:

| Field | Value / source | Notes |
|---|---|---|
| Extension version | `VERSION` from `@bproxy/shared` or WXT/manifest package version | Must match release package version. |
| Protocol version | `PROTOCOL_VERSION` from `@bproxy/shared` | Useful for daemon/extension mismatch support. |
| Documentation | `https://dimdasci.github.io/bproxy/` | Use a normal external link. |
| License | MIT, linked to repository license or docs license page | Link target can be GitHub `LICENSE` until a docs page exists. |
| Credits | Created by Dim Kharitonov | Link to repository or credits section/page. |

## Copy requirements

Use copy that is transparent without over-explaining internals:

- Product subtitle: `Human-in-the-loop browser bridge for AI agents.`
- Purpose text: `This extension pairs Chrome with your local bproxy daemon so AI agents and agentic systems can request explicit browser actions while you stay in control.`
- Human-control sentence: `You handle logins, CAPTCHAs, consent screens, and final submits.`
- Pairing help: `Run bproxy service start and paste the one-time code shown by the daemon.`
- Success text: `Paired with local daemon. You can close this popup.`
- Footer: `Created by Dim Kharitonov · MIT`

Avoid claims such as "undetectable", "bypass", "stealth", "anti-bot", or anything suggesting circumvention. The public framing should remain human-in-the-loop browser control, not evasion marketing.

## Layout requirements

- Use one compact column, about `340px` to `380px` wide.
- Keep native form semantics: real `form`, `label`, `input`, `button`, and `output aria-live="polite"`.
- Use text hierarchy, spacing, and a thin divider for clarity.
- Links live in a simple footer: `Documentation · License · Credits`.
- No badge/chip components.
- No external fonts or remote assets.
- No options page is required for this increment.

## Compliance notes for manifest and listing

The popup cannot carry all compliance burden. Store listing and privacy fields should also disclose:

- bproxy is a companion extension for a local daemon/CLI.
- It can read page text/structure and perform explicit browser actions only after pairing.
- It stores pairing bootstrap material in Chrome extension storage.
- It communicates with `ws://127.0.0.1:9615/ws` / `http://127.0.0.1:9615/pair/claim` only for local daemon pairing/control.
- Broad host access exists because the user/agent may work on arbitrary pages; this must be justified in listing/privacy text.
- Permission rationale:
  - `tabs`: route actions to tabs and manage user-requested tab actions.
  - `scripting`: programmatically inject the isolated content script on first command.
  - `webNavigation`: track top-level navigation state for session/page identity.
  - `alarms`: background service-worker keepalive/reconnect scheduling.
  - `storage`: persist bootstrap token and bounded session diagnostics.
  - `<all_urls>`: support user-selected pages across the web.

The manifest description should stay clear and non-promotional. Candidate wording:

> Companion extension for bproxy. Connects Chrome to a local bproxy daemon for explicit human-in-the-loop browser actions.

## Session and tab visibility check

The extension does **not** currently know authoritative bproxy session state.

What it has today:

- Forwarded daemon requests include `session` and `target.tabId`, so the extension trace can record which sessions/tabs were involved in actions that actually reached the extension.
- `chrome.storage.session` contains operational caches (`session:dedupe`, `session:injectedTabs`, `session:trace`, and `session:pins`), but these are not a session registry.
- The action badge only shows connection state: disconnected, connecting, connected, or error.

What it deliberately does not have today:

- `session.create`, `session.list`, `session.bind`, `session.unbind`, `session.resume`, `session.close`, `tab.list`, `debug.last`, and `debug.status` are daemon-local and excluded from extension forwarding.
- The daemon owns generated session ids, logical tab handles, tab ownership, pause state, nick scoping, and the session→Chrome-tab map.
- The extension cannot safely reconstruct active sessions by enumerating Chrome tabs. That would leak operator-opened tabs and violate the daemon-owned logical-tab boundary.
- The popup has no daemon bearer token and no nick; it only stores the extension bootstrap token used for the WebSocket.

Conclusion: the popup can honestly show pairing/connection state, but it cannot currently show "active sessions" or "tabs per session" as an authoritative value.

Decision: **discard the dashboard request**. Do not add session counts, tab counts, per-session lists, recent-activity panels, or an operator status surface to the extension popup. Keeping the extension simple preserves the daemon-owned session boundary and avoids creating an unscoped operator API surface that would conflict with [ADR-030](../decisions.md#adr-030-agent-nickname-session-scoping).

If session visibility becomes necessary later, it must start with a separate ADR/design for a daemon-supplied operator summary. It is explicitly out of scope for this popup polish.

## Implementation plan

1. Update `extension/src/entrypoints/popup/index.html` styles and markup only; keep the existing TypeScript flow in `main.ts` thin.
2. Import `VERSION` and `PROTOCOL_VERSION` in popup DOM code and render them into footer fields.
3. Add external links using `target="_blank"` and `rel="noreferrer"`.
4. Keep existing pairing validation/error handling in `pairing.ts` unchanged unless tests require DOM-selector updates.
5. Do not add session/tab counts, recent activity, or dashboard UI; this request is intentionally discarded.
6. Add/adjust popup tests to assert visible metadata and stable user-facing copy.
7. Confirm `pnpm --filter @bproxy/extension test` and relevant typecheck pass.

## Acceptance criteria

- Popup clearly states what bproxy is before the user pairs.
- Popup shows extension version and protocol version.
- Popup links to documentation, license, and credits.
- Popup identifies creator and MIT license in plain text.
- Popup does not show active session counts, tab counts, recent activity, or dashboard-like status.
- Pairing success/error behavior remains unchanged.
- No strategy, selector repair, modal solving, fallback chains, or page interaction logic is added to the popup or extension.
- Manifest/listing copy remains honest and does not imply bypassing anti-bot systems.
