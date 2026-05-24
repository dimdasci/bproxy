---
title: bproxy
---

Coding agents need browser access to automate web tasks — research, data extraction, form filling. Playwright-based solutions get blocked by Cloudflare, Datadome, and similar anti-bot systems because they run in detectable automated browser contexts. Even well-disguised headless browsers leak signals through JavaScript APIs, TLS fingerprints, and missing user state.

bproxy takes a different approach. A Chrome extension running in a real user browser is controlled by agents through a CLI and a localhost proxy daemon. The extension operates in the user's actual browsing context — real cookies, real session, real fingerprint — which closes the easy detection paths. The agent issues shell commands; the daemon forwards them over WebSocket to the extension; the extension reads or writes the page and returns results.

```
Code Agent ──CLI──▶ Proxy Daemon ◀──WebSocket──▶ Browser Extension ◀──▶ Page
```

## What agents do with it

The user is in front of the browser. The agent handles data reads, copy-paste relief, and bounded autonomous batch work. Login, CAPTCHA, and consent screens are handed back to the human.

Three scenarios drive the design:

**Topic research.** The agent navigates search engines by URL, reads rendered page text, paginates by rewriting query parameters, and compiles a structured shortlist. No clicks, no synthetic events — the entire flow is URL-driven navigation plus text extraction. What anti-bot systems see is a real browser with a real account loading pages at a reasonable pace.

**Feed snapshot.** The agent scrolls a social feed to load lazy content, reads each post's text, and assembles a digest. Scroll pacing is daemon-enforced with jittered intervals so the signal resembles human browsing rather than a metronomic crawler.

**Form fill.** The agent fills application forms using data the user provides in conversation. It prepares fields but does not submit — the user reviews and clicks submit themselves, so any CAPTCHA challenge fires on a genuine user interaction. Write operations use an explicit method chosen per field: direct DOM assignment for simple inputs, paste-event simulation for framework-controlled fields, or one-shot page API calls for rich editors.

## How it is shaped

A few principles define the system's boundaries and keep the design from drifting toward a general-purpose browser automation framework.

Read mode is the default and covers most useful work. The extension reads pages via isolated-world DOM access and navigates by URL. In this mode it has no presence in the page's JavaScript world — no wrapped globals, no mutation observers, no persistent scripts. The page cannot detect the extension exists.

The extension is a thin sensor and actuator. It exposes read and write primitives honestly but never decides strategy. The agent owns all choices: which selector to target, which write method to use, whether to escalate to a richer world. This keeps the extension simple and the agent's behaviour auditable from outside.

Write operations are explicit. Three methods — direct DOM assignment, paste simulation, and runtime API calls — are chosen per field by the agent. There is no automatic method selection, because each method has different detection characteristics and the right choice depends on the page framework and the context.

Pacing is enforced by the daemon, not by the agent or the extension. Every session carries timing parameters applied to navigations, scrolls, and fill delays. The agent cannot accidentally burst requests, and the pacing behaviour is consistent regardless of which agent or prompt drives the session.

The user stays in the loop for anything sensitive. CAPTCHAs, login screens, and consent dialogs are surfaced to the human via a dedicated signal. Form submissions are left for the user to trigger. The system prepares; the user commits.

Observability is structural. Every request carries a unique identifier that correlates CLI invocation, daemon routing, and extension execution. Components are independently debuggable without special tooling.

## Reading further

The [Containers](./views/02-containers.md) view is the canonical diagram — it shows the three runtime processes and the protocols between them. The remaining views drill into deployment, session behaviour, and security. The [solution specs](./solution/cli.md) document each component's implementation contract.

The source repository contains the project's full decision history and design rationale for contributors who want the audit trail.
