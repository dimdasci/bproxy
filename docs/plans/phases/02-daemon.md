---
title: Phase 2 — Daemon
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship `@bproxy/service` — the localhost proxy daemon that bridges CLI (HTTP) and extension (WebSocket). After this phase, a mock WS client can connect to the daemon and complete a round-trip against every action defined in `@bproxy/shared`, with auth, pacing, pending-map, and structured logging behaving as specified.

**Strategy:** Bottom-up inside the service workspace. Pure logic (pacing, pending, dispatch, sessions) first with deterministic TDD using injected clocks. Boundary code (auth, routes, server bootstrap) layered on top. Lifecycle scripts and the mock-client integration test close the phase. The daemon is the first consumer of `@bproxy/shared` — runtime validation (Zod) lands here, not in `shared/`, per `docs/solution/shared.md` § Out of scope.

**Spec:** [`docs/solution/service.md`](../../solution/service.md).
**Roadmap entry:** [Phase 2 in roadmap.md](../roadmap.md#phase-2--daemon).
**Decisions that constrain this phase:**
- [ADR-003](../../decisions.md#adr-003-service-framework--fastify) — Fastify.
- [ADR-008](../../decisions.md#adr-008-websocket-over-native-messaging) — WebSocket transport for CLI↔extension.
- [ADR-009](../../decisions.md#adr-009-observability-as-a-first-class-design-constraint) — request `id` is the universal correlation key in logs.
- [ADR-010](../../decisions.md#adr-010-websocket-auth-transport--two-token-model) — two-token auth: daemon bearer (HTTP) + extension token (WS subprotocol).
- [ADR-011](../../decisions.md#adr-011-extension-token-bootstrap-via-popup-driven-pairing) — popup-driven pairing via `POST /pair/claim`.

---

## Locked outcomes for this phase

1. **`service/` package compiles, bundles, and runs.** `pnpm --filter @bproxy/service build` produces `dist/index.mjs`. Running `node service/dist/index.mjs start` brings up Fastify on `127.0.0.1:9615` (default port).
2. **Three routes implemented behind the four-layer auth gate:**
   - `POST /` — CLI command intake. Requires daemon bearer token.
   - `POST /pair/claim` — popup pairing claim. Requires pairing code; **no** daemon token.
   - `GET /ws` — extension WebSocket upgrade. Requires extension token via `Sec-WebSocket-Protocol`.
3. **Pacing engine enforces per-session delays** for `navigate`, `scroll`, `fill`. Default `human` preset. Switchable via in-memory `session.bind --pacing`. Per-session arbitrary `PacingConfig` literal is deferred (per `shared.md`).
4. **Pending-request map** handles: deadline timeout, replay-on-reconnect, idempotent dedupe by `id`, bounded size (100, then `OVERLOADED`).
5. **Per-tab serialization** in dispatch — commands targeting the same tab are queued, not parallel.
6. **Lifecycle scripts work end-to-end:** `service start` (detached child + lockfile + token + pairing code), `service stop` (SIGTERM via lockfile), `service status` (parse PID file and report state). State directory is `~/.bproxy/`.
7. **Structured logging via pino:** every line carries the request `id` when applicable; every lifecycle event from `service.md` § Observability table is emitted at the documented level.
8. **End-to-end mock-WS-client test passes:** start daemon, connect a mock WS client over the real socket, send a command, verify pacing wait + dispatch + response + log lines.
9. **Design-asserted by tests:**
   - Auth hook runs before any route handler (a route-level test where auth fails → handler is never invoked).
   - Pacing engine waits the configured jittered interval (deterministic via injected clock).
   - Pending map deduplicates concurrent requests with the same `id`.
   - Pending map replays in-flight requests after WS reconnect.
10. **`pnpm check` and `pnpm test` pass from a clean checkout.**
11. **Views integration:** `service` is already in `KNOWN_WORKSPACES`; `pnpm views:regen` produces `docs/views/auto/service-components.svg`. The Container view (`docs/views/02-containers.md`) gains a `click Daemon ./auto/service-components.svg` directive linking the diagram node to the generated graph.

---

## Inputs

- Service spec: [`docs/solution/service.md`](../../solution/service.md)
- Shared types (already shipped): `shared/src/*` — `BproxyRequest`, `BproxyResponse`, `Action`, `ActionParams`, `ActionResult`, `BproxyError`, `PacingMode`, `PACING_PRESETS`, `SessionInfo`.
- Architecture protocol: [`docs/architecture.md` § Protocol](../../architecture.md#protocol)
- Quality gates: [`docs/quality-gates.md`](../../quality-gates.md)
- Views regen entry: [`views/scripts/regen.ts`](../../../views/scripts/regen.ts) — `service` already listed in `KNOWN_WORKSPACES`.
- Containers diagram: [`docs/views/02-containers.md`](../../views/02-containers.md) — `click Daemon` directive to add.

---

## File structure introduced this phase

```
service/
├── package.json                   # MODIFIED — add deps, scripts, bin
├── tsconfig.json                  # UNCHANGED (already correct)
├── tsup.config.ts                 # NEW — bundle config
├── vitest.config.ts               # NEW — test runner config
├── README.md                      # NEW — per layer DoD
└── src/
    ├── index.ts                   # REPLACE stub — CLI entry: start | stop | status
    ├── server.ts                  # NEW — buildServer(): Fastify instance with plugins+routes
    ├── config.ts                  # NEW — port, state-dir, env resolution
    ├── logger.ts                  # NEW — pino instance + LifecycleEvent type
    ├── schemas.ts                 # NEW — Zod schemas derived from shared types (runtime validation)
    ├── auth.ts                    # NEW — four-layer onRequest hook
    ├── sessions.ts                # NEW — session registry, pacing-mode store
    ├── pacing.ts                  # NEW — per-session jittered delay enforcement
    ├── pending.ts                 # NEW — bounded pending map with timeout + dedupe + replay
    ├── dispatch.ts                # NEW — resolve client, per-tab serialize, send+await
    ├── clients.ts                 # NEW — WS client registry
    ├── lifecycle.ts               # NEW — start/stop/status, PID/lockfile, daemonize, tokens
    ├── pairing.ts                 # NEW — pairing-code generation, TTL, single-use claim
    ├── debug-actions.ts           # NEW — daemon-local handlers for debug.last / debug.status
    ├── routes/
    │   ├── command.ts             # NEW — POST /
    │   ├── pair.ts                # NEW — POST /pair/claim
    │   └── ws.ts                  # NEW — GET /ws
    └── __tests__/
        ├── pacing.test.ts
        ├── pending.test.ts
        ├── dispatch.test.ts
        ├── sessions.test.ts
        ├── auth.test.ts
        ├── pairing.test.ts
        ├── schemas.test.ts
        └── round-trip.test.ts     # integration: real Fastify + mock WS client
docs/
└── views/02-containers.md         # MODIFIED — add `click Daemon` directive
```

> **`shared/` is unchanged this phase.** The Zod schemas live in `service/src/schemas.ts` because Phase 1 explicitly deferred runtime validation to the first consumer.

> **State directory `~/.bproxy/`** is created at startup. Tests use a temp directory via `BPROXY_HOME` env var so they don't trample the real one.

---

## Task 1: Bootstrap `@bproxy/service` package

**Files:** `service/package.json`, `service/tsup.config.ts`, `service/vitest.config.ts`, `service/README.md`, `service/src/index.ts` (replace stub).

**Purpose:** Get the workspace to a state where `pnpm --filter @bproxy/service test` and `... build` both work against trivial inputs. Establish the test runner and bundler before any logic is written.

- [x] **Step 1: Replace `service/package.json`**

```json
{
  "name": "@bproxy/service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "bproxy-service": "./dist/index.mjs"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@bproxy/shared": "workspace:*",
    "@fastify/websocket": "^11.0.2",
    "fastify": "^5.2.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsup": "^8.3.5",
    "typescript": "^5.8.3",
    "vitest": "^2.1.8",
    "ws": "^8.18.0",
    "@types/ws": "^8.5.13"
  }
}
```

- [x] **Step 2: Write `service/tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	splitting: false,
	sourcemap: true,
	dts: false,
	banner: { js: "#!/usr/bin/env node" },
});
```

- [x] **Step 3: Write `service/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.ts"],
		environment: "node",
		clearMocks: true,
		restoreMocks: true,
	},
});
```

- [x] **Step 4: Replace `service/src/index.ts`** (stub a CLI dispatcher; real logic lands in Task 8)

```typescript
async function main(): Promise<void> {
	const cmd = process.argv[2] ?? "help";
	if (cmd !== "start" && cmd !== "stop" && cmd !== "status" && cmd !== "daemonize") {
		process.stdout.write("usage: bproxy-service <start|stop|status>\n");
		process.exit(cmd === "help" ? 0 : 2);
	}
	process.stdout.write(`bproxy-service ${cmd}: not yet implemented\n`);
	process.exit(0);
}

void main();
```

- [x] **Step 5: Write minimal `service/README.md`**

```markdown
# @bproxy/service

The localhost proxy daemon. Bridges CLI HTTP requests and the browser extension over WebSocket. Owns auth, pacing, request lifecycle, and observability.

## Public API

Single entry point: [`src/index.ts`](./src/index.ts). The package ships a `bproxy-service` binary with `start | stop | status` subcommands.

## Development

```bash
pnpm --filter @bproxy/service typecheck
pnpm --filter @bproxy/service test
pnpm --filter @bproxy/service build
```

## Configuration

- `BPROXY_HOME` — state directory (default: `~/.bproxy`)
- `BPROXY_PORT` — listen port (default: `9615`)
- `BPROXY_LOG_LEVEL` — pino level (default: `info`)
```

- [x] **Step 6: Run `pnpm install` at repo root**

- [x] **Step 7: Verify the workspace is healthy**

```bash
pnpm --filter @bproxy/service typecheck
pnpm --filter @bproxy/service build
pnpm --filter @bproxy/service test
```

Expected: typecheck passes, build emits `service/dist/index.mjs`, test exits 0 (no tests yet — that's fine; vitest `run` returns 0 on no-tests).

- [x] **Step 8: Commit**

```bash
git add service/ pnpm-lock.yaml
git commit -m "feat(service): bootstrap @bproxy/service package (Phase 2 Task 1)"
```

---

## Task 2: Config and logger foundation

**Files:** `service/src/config.ts`, `service/src/logger.ts`, `service/src/__tests__/logger.test.ts`.

**Purpose:** Centralise port/state-dir/env resolution in one module; centralise pino instance creation in another. Every later module imports one or the other. Defining lifecycle-event names as a TypeScript discriminated union here prevents typos in log lines downstream.

- [x] **Step 1: Write `service/src/config.ts`**

```typescript
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ServiceConfig {
	port: number;
	host: string;
	stateDir: string;
	logLevel: "trace" | "debug" | "info" | "warn" | "error";
}

const DEFAULT_PORT = 9615;
const DEFAULT_HOST = "127.0.0.1";
const VALID_LEVELS = new Set(["trace", "debug", "info", "warn", "error"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
	const port = Number.parseInt(env.BPROXY_PORT ?? "", 10);
	const level = env.BPROXY_LOG_LEVEL ?? "info";
	return {
		port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
		host: DEFAULT_HOST,
		stateDir: env.BPROXY_HOME ?? resolve(homedir(), ".bproxy"),
		logLevel: VALID_LEVELS.has(level) ? (level as ServiceConfig["logLevel"]) : "info",
	};
}

export function stateFile(stateDir: string, name: "bproxy.pid" | "port" | "token"): string {
	return resolve(stateDir, name);
}

export function logDir(stateDir: string): string {
	return resolve(stateDir, "logs");
}
```

- [x] **Step 2: Write `service/src/logger.ts`**

```typescript
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { logDir, type ServiceConfig } from "./config";

export type LifecycleEvent =
	| "received"
	| "pacing_wait"
	| "forwarded"
	| "response"
	| "timeout"
	| "replay"
	| "ws_connect"
	| "ws_disconnect"
	| "pacing_config";

export function buildLogger(config: ServiceConfig): Logger {
	const dir = logDir(config.stateDir);
	mkdirSync(dir, { recursive: true });
	const today = new Date().toISOString().slice(0, 10);
	const target = join(dir, `${today}.log`);
	return pino(
		{ level: config.logLevel },
		pino.destination({ dest: target, sync: false, mkdir: true }),
	);
}

export function buildTestLogger(): Logger {
	return pino({ level: "silent" });
}

export interface CapturedLogger {
	logger: Logger;
	lines: readonly Record<string, unknown>[];
	clear(): void;
}

export function buildCapturedLogger(): CapturedLogger {
	const lines: Record<string, unknown>[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(chunk: string) {
				for (const line of chunk.split("\n")) {
					if (!line) continue;
					try {
						lines.push(JSON.parse(line) as Record<string, unknown>);
					} catch {
						/* skip non-JSON */
					}
				}
			},
		} as pino.DestinationStream,
	);
	return {
		logger,
		lines,
		clear() {
			lines.length = 0;
		},
	};
}
```

- [x] **Step 3: Write `service/src/__tests__/logger.test.ts`** (failing first)

```typescript
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
	it("uses defaults when env is empty", () => {
		const config = loadConfig({});
		expect(config.port).toBe(9615);
		expect(config.host).toBe("127.0.0.1");
		expect(config.logLevel).toBe("info");
		expect(config.stateDir).toMatch(/\.bproxy$/);
	});

	it("honours BPROXY_PORT and BPROXY_HOME", () => {
		const config = loadConfig({ BPROXY_PORT: "12345", BPROXY_HOME: "/tmp/xyz" });
		expect(config.port).toBe(12345);
		expect(config.stateDir).toBe("/tmp/xyz");
	});

	it("falls back to default port for invalid BPROXY_PORT", () => {
		expect(loadConfig({ BPROXY_PORT: "garbage" }).port).toBe(9615);
		expect(loadConfig({ BPROXY_PORT: "-1" }).port).toBe(9615);
	});

	it("rejects unknown log level", () => {
		expect(loadConfig({ BPROXY_LOG_LEVEL: "shout" }).logLevel).toBe("info");
	});
});
```

- [x] **Step 4: Run `pnpm --filter @bproxy/service test`** — all 4 assertions pass.

- [x] **Step 5: Commit**

```bash
git add service/src/config.ts service/src/logger.ts service/src/__tests__/logger.test.ts
git commit -m "feat(service): config and logger foundation (Phase 2 Task 2)"
```

---

## Task 3: Sessions registry

**Files:** `service/src/sessions.ts`, `service/src/__tests__/sessions.test.ts`.

**Purpose:** In-memory registry of session state (name, bound tab, pacing mode, paused flag). Used by pacing, dispatch, and routes. No persistence — sessions reset on daemon restart, per `service.md` (sessions created implicitly on first command).

- [x] **Step 1: Write `service/src/__tests__/sessions.test.ts`** (failing first)

```typescript
import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../sessions";

describe("session registry", () => {
	it("implicitly creates sessions on first lookup", () => {
		const reg = createSessionRegistry();
		const s = reg.getOrCreate("default");
		expect(s.name).toBe("default");
		expect(s.tabId).toBeNull();
		expect(s.pacing).toBe("human");
		expect(s.paused).toBe(false);
	});

	it("returns the same instance for repeated lookups", () => {
		const reg = createSessionRegistry();
		expect(reg.getOrCreate("a")).toBe(reg.getOrCreate("a"));
	});

	it("binds a tab to a session", () => {
		const reg = createSessionRegistry();
		reg.bind("default", 42, "fast");
		const s = reg.getOrCreate("default");
		expect(s.tabId).toBe(42);
		expect(s.pacing).toBe("fast");
	});

	it("pauses and resumes a session", () => {
		const reg = createSessionRegistry();
		reg.pause("default", "captcha");
		expect(reg.getOrCreate("default").paused).toBe(true);
		expect(reg.getOrCreate("default").pauseReason).toBe("captcha");
		reg.resume("default");
		expect(reg.getOrCreate("default").paused).toBe(false);
	});

	it("lists all sessions", () => {
		const reg = createSessionRegistry();
		reg.getOrCreate("a");
		reg.getOrCreate("b");
		expect(reg.list().map((s) => s.name).sort()).toEqual(["a", "b"]);
	});
});
```

- [x] **Step 2: Run the tests — verify they fail** (`createSessionRegistry not defined`).

- [x] **Step 3: Write `service/src/sessions.ts`**

```typescript
import type { PacingMode, SessionInfo } from "@bproxy/shared";

interface InternalSession extends SessionInfo {
	lastActionAt: Record<string, number>;
}

export interface SessionRegistry {
	getOrCreate(name: string): SessionInfo;
	bind(name: string, tabId: number, pacing?: PacingMode): void;
	unbind(name: string): void;
	pause(name: string, reason?: string): void;
	resume(name: string): void;
	list(): SessionInfo[];
	internal(name: string): InternalSession;
}

export function createSessionRegistry(): SessionRegistry {
	const sessions = new Map<string, InternalSession>();

	function getOrCreate(name: string): SessionInfo {
		let s = sessions.get(name);
		if (!s) {
			s = { name, tabId: null, pacing: "human", paused: false, lastActionAt: {} };
			sessions.set(name, s);
		}
		return s;
	}

	return {
		getOrCreate,
		bind(name, tabId, pacing) {
			const s = sessions.get(name) ?? (getOrCreate(name) as InternalSession);
			s.tabId = tabId;
			if (pacing) s.pacing = pacing;
		},
		unbind(name) {
			const s = sessions.get(name);
			if (s) s.tabId = null;
		},
		pause(name, reason) {
			const s = sessions.get(name) ?? (getOrCreate(name) as InternalSession);
			s.paused = true;
			s.pauseReason = reason;
		},
		resume(name) {
			const s = sessions.get(name);
			if (s) {
				s.paused = false;
				delete s.pauseReason;
			}
		},
		list() {
			return [...sessions.values()];
		},
		internal(name) {
			return sessions.get(name) ?? (getOrCreate(name) as InternalSession);
		},
	};
}
```

- [x] **Step 4: Run the tests** — all 5 pass.

- [x] **Step 5: Commit**

```bash
git add service/src/sessions.ts service/src/__tests__/sessions.test.ts
git commit -m "feat(service): session registry (Phase 2 Task 3)"
```

---

## Task 4: Pacing engine

**Files:** `service/src/pacing.ts`, `service/src/__tests__/pacing.test.ts`.

**Purpose:** Per-session jittered delay enforcement. Daemon-side; agent cannot bypass. Uses an injected `now()` and `sleep()` so tests are deterministic. Pacing applies to `navigate`, `scroll`, `fill`, `fill-form`; other actions pass through with no wait.

- [x] **Step 1: Write `service/src/__tests__/pacing.test.ts`** (failing first)

```typescript
import { describe, expect, it, vi } from "vitest";
import { PACING_PRESETS } from "@bproxy/shared";
import { createPacing } from "../pacing";
import { createSessionRegistry } from "../sessions";

describe("pacing engine", () => {
	// One pinned-jitter test locks the formula. Other tests assert ranges so
	// changes to the jitter formula don't churn unrelated tests.
	it("waits the configured delay on a paced action (pinned jitter)", async () => {
		let clock = 1_000_000;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot("s", "navigate"); // first call: no prior action → no wait
		expect(sleeps).toEqual([]);

		clock += 100; // 100ms later, second navigate. preset 1500–4000, mid → 2750
		await pacing.waitForSlot("s", "navigate");
		expect(sleeps).toEqual([2750 - 100]);
	});

	it("waits a delay inside the preset range under real jitter", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => Math.random(),
		});

		await pacing.waitForSlot("s", "navigate"); // no prior action
		await pacing.waitForSlot("s", "navigate");
		expect(sleeps.length).toBe(1);
		const { min, max } = PACING_PRESETS.human.navigate;
		expect(sleeps[0]).toBeGreaterThanOrEqual(min - 1);
		expect(sleeps[0]).toBeLessThanOrEqual(max);
	});

	it("passes through unpaced actions immediately", async () => {
		const sleep = vi.fn();
		const pacing = createPacing({
			sessions: createSessionRegistry(),
			now: () => 0,
			sleep,
			random: () => 0,
		});
		await pacing.waitForSlot("s", "text");
		await pacing.waitForSlot("s", "elements");
		expect(sleep).not.toHaveBeenCalled();
	});

	it("respects per-session pacing mode override (pinned)", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const sessions = createSessionRegistry();
		sessions.bind("fast-session", 1, "fast");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			random: () => 0.5,
		});

		await pacing.waitForSlot("fast-session", "fill"); // first call
		clock += 10;
		await pacing.waitForSlot("fast-session", "fill"); // fast preset 100–400 → 250
		expect(sleeps).toEqual([250 - 10]);
	});

	it("never sleeps when elapsed already exceeds the configured delay", async () => {
		let clock = 0;
		const sleep = vi.fn(async (ms: number) => {
			clock += ms;
		});
		const sessions = createSessionRegistry();
		sessions.getOrCreate("s");
		const pacing = createPacing({
			sessions,
			now: () => clock,
			sleep,
			random: () => 0.5,
		});

		await pacing.waitForSlot("s", "navigate");
		clock += 10_000; // wait longer than the preset max
		await pacing.waitForSlot("s", "navigate");
		// Sleep must not be called for the second slot — elapsed already exceeds target.
		expect(sleep).not.toHaveBeenCalled();
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/pacing.ts`**

```typescript
import { PACING_PRESETS, type Action } from "@bproxy/shared";
import type { SessionRegistry } from "./sessions";

type PacedAction = "navigate" | "scroll" | "fill" | "fill-form";
const PACED: ReadonlySet<Action> = new Set<Action>(["navigate", "scroll", "fill", "fill-form"]);

function pacingKey(action: Action): PacedAction | null {
	if (action === "navigate" || action === "scroll" || action === "fill") return action;
	if (action === "fill-form") return "fill-form";
	return null;
}

export interface PacingDeps {
	sessions: SessionRegistry;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
}

export interface PacingEngine {
	waitForSlot(session: string, action: Action): Promise<number>;
}

export function createPacing(deps: PacingDeps): PacingEngine {
	return {
		async waitForSlot(session, action) {
			if (!PACED.has(action)) return 0;
			const key = pacingKey(action);
			if (!key) return 0;
			const s = deps.sessions.internal(session);
			const presetKey = key === "fill-form" ? "fill" : key;
			const preset = PACING_PRESETS[s.pacing][presetKey];
			const target = preset.min + deps.random() * (preset.max - preset.min);
			const last = s.lastActionAt[presetKey] ?? 0;
			const elapsed = deps.now() - last;
			const wait = Math.max(0, Math.round(target) - elapsed);
			if (wait > 0) await deps.sleep(wait);
			s.lastActionAt[presetKey] = deps.now();
			return wait;
		},
	};
}
```

- [x] **Step 4: Run tests — all pass.**

- [x] **Step 5: Commit**

```bash
git add service/src/pacing.ts service/src/__tests__/pacing.test.ts
git commit -m "feat(service): pacing engine with deterministic clock injection (Phase 2 Task 4)"
```

---

## Task 5: Pending request map

**Files:** `service/src/pending.ts`, `service/src/__tests__/pending.test.ts`.

**Purpose:** Bounded map keyed by request `id`. Supports: register-with-timeout, resolve-by-id, dedupe (same `id` returns existing promise), replay-for-client (re-send on WS reconnect), bounded size (`OVERLOADED` on 100+).

- [x] **Step 1: Write `service/src/__tests__/pending.test.ts`** (failing first)

```typescript
import { describe, expect, it, vi } from "vitest";
import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { createPending } from "../pending";

const BASE = 1_000_000;

function req(id: string, deadline = BASE + 5000): BproxyRequest {
	return {
		protocol_version: 1,
		id,
		action: "text",
		params: {},
		session: "default",
		deadline,
		destructive: false,
	};
}

function okResponse(id: string): BproxyResponse {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { text: "x" },
		page: { url: "https://x", title: "", state: "ready", busy: false },
		replay: false,
	};
}

describe("pending map", () => {
	it("registers and resolves a request by id", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send = vi.fn();
		const p = pending.register(req("a"), send);
		expect(send).toHaveBeenCalledOnce();
		pending.resolveById("a", okResponse("a"));
		await expect(p).resolves.toMatchObject({ ok: true });
	});

	it("dedupes by id: same id returns the existing promise without re-sending", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send = vi.fn();
		const p1 = pending.register(req("a"), send);
		const p2 = pending.register(req("a"), send);
		expect(send).toHaveBeenCalledOnce();
		expect(p1).toBe(p2);
		pending.resolveById("a", okResponse("a"));
		await expect(p1).resolves.toMatchObject({ ok: true });
	});

	it("times out at deadline with an error envelope", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
		const pending = createPending({ maxSize: 10, now: () => Date.now() });
		const p = pending.register(req("a", BASE + 100), vi.fn());
		vi.advanceTimersByTime(150);
		await expect(p).resolves.toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
		vi.useRealTimers();
	});

	it("resolves immediately with TIMEOUT when the deadline is already in the past", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
		const pending = createPending({ maxSize: 10, now: () => Date.now() });
		const p = pending.register(req("a", BASE - 1), vi.fn());
		vi.advanceTimersByTime(0); // flush the 0-ms timer
		await expect(p).resolves.toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
		vi.useRealTimers();
	});

	it("rejects with OVERLOADED when bounded size is reached", async () => {
		const sendFull = vi.fn();
		const pending = createPending({ maxSize: 2, now: () => BASE });
		pending.register(req("a"), sendFull);
		pending.register(req("b"), sendFull);
		const overflowSend = vi.fn();
		const overflow = await pending.register(req("c"), overflowSend);
		expect(overflow).toMatchObject({ ok: false, error: { code: "OVERLOADED" } });
		expect(overflowSend).not.toHaveBeenCalled();
	});

	it("replays in-flight requests: original promise resolves when replayed send is responded", async () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		const send1 = vi.fn();
		const original = pending.register(req("a"), send1);
		expect(send1).toHaveBeenCalledOnce();

		// First client drops; new client connects.
		const send2 = vi.fn();
		pending.replayForClient(send2);
		expect(send2).toHaveBeenCalledOnce();
		const replayed = send2.mock.calls[0][0] as BproxyRequest;
		expect(replayed.id).toBe("a");

		// The new client responds — the ORIGINAL promise must resolve.
		pending.resolveById("a", okResponse("a"));
		await expect(original).resolves.toMatchObject({ ok: true, id: "a" });
	});

	it("replayForClient with id filter only replays matching ids", () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		pending.register(req("a"), vi.fn());
		pending.register(req("b"), vi.fn());
		const send = vi.fn();
		pending.replayForClient(send, ["a"]);
		expect(send).toHaveBeenCalledOnce();
		expect((send.mock.calls[0][0] as BproxyRequest).id).toBe("a");
	});

	it("snapshot lists pending ids", () => {
		const pending = createPending({ maxSize: 10, now: () => BASE });
		pending.register(req("a"), vi.fn());
		pending.register(req("b"), vi.fn());
		expect(pending.size()).toBe(2);
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/pending.ts`**

```typescript
import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";

type SendFn = (cmd: BproxyRequest) => void;

interface PendingEntry {
	cmd: BproxyRequest;
	promise: Promise<BproxyResponse>;
	resolve: (r: BproxyResponse) => void;
	timer: NodeJS.Timeout;
}

export interface PendingOptions {
	maxSize: number;
	now?: () => number;
}

export interface PendingMap {
	register(cmd: BproxyRequest, send: SendFn): Promise<BproxyResponse>;
	resolveById(id: string, response: BproxyResponse): void;
	replayForClient(send: SendFn, ids?: readonly string[]): void;
	delete(id: string): void;
	size(): number;
}

function errorResponse(id: string, error: BproxyError): BproxyResponse {
	return { protocol_version: 1, id, ok: false, error };
}

export function createPending(opts: PendingOptions): PendingMap {
	const entries = new Map<string, PendingEntry>();
	const now = opts.now ?? (() => Date.now());

	return {
		register(cmd, send) {
			const existing = entries.get(cmd.id);
			if (existing) return existing.promise;

			if (entries.size >= opts.maxSize) {
				return Promise.resolve(
					errorResponse(cmd.id, {
						code: "OVERLOADED",
						category: "transport",
						retry: "safe",
						message: "Daemon pending map is full",
					}),
				);
			}

			let resolveOuter!: (r: BproxyResponse) => void;
			const promise = new Promise<BproxyResponse>((resolve) => {
				resolveOuter = resolve;
			});

			const wait = Math.max(0, cmd.deadline - now());
			const timer = setTimeout(() => {
				const e = entries.get(cmd.id);
				if (!e) return;
				entries.delete(cmd.id);
				e.resolve(
					errorResponse(cmd.id, {
						code: "TIMEOUT",
						category: "transport",
						retry: "conditional",
						message: `Request ${cmd.id} exceeded its deadline`,
					}),
				);
			}, wait);

			entries.set(cmd.id, { cmd, promise, resolve: resolveOuter, timer });
			send(cmd);
			return promise;
		},

		resolveById(id, response) {
			const e = entries.get(id);
			if (!e) return;
			clearTimeout(e.timer);
			entries.delete(id);
			e.resolve(response);
		},

		replayForClient(send, ids) {
			const filter = ids ? new Set(ids) : null;
			for (const [id, entry] of entries) {
				if (filter && !filter.has(id)) continue;
				send({ ...entry.cmd });
			}
		},

		delete(id) {
			const e = entries.get(id);
			if (!e) return;
			clearTimeout(e.timer);
			entries.delete(id);
		},

		size() {
			return entries.size;
		},
	};
}
```

- [x] **Step 4: Run tests — all pass.**

- [x] **Step 5: Commit**

```bash
git add service/src/pending.ts service/src/__tests__/pending.test.ts
git commit -m "feat(service): bounded pending map with timeout, dedupe, replay (Phase 2 Task 5)"
```

---

## Task 6: WS clients registry and dispatch

**Files:** `service/src/clients.ts`, `service/src/dispatch.ts`, `service/src/__tests__/dispatch.test.ts`.

**Purpose:** Track connected WS clients and route a command to the right one for a session's pinned tab. Per-tab serialization: commands targeting the same `tabId` queue and execute one at a time (prevents content-script races, per `service.md` § Dispatch).

- [x] **Step 1: Write `service/src/__tests__/dispatch.test.ts`** (failing first)

```typescript
import { describe, expect, it, vi } from "vitest";
import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { createClients } from "../clients";
import { createDispatch } from "../dispatch";
import { createPending } from "../pending";
import { createSessionRegistry } from "../sessions";

function req(id: string, session = "default"): BproxyRequest {
	return {
		protocol_version: 1,
		id,
		action: "text",
		params: {},
		session,
		deadline: Date.now() + 5000,
		destructive: false,
	};
}

function ok(id: string): BproxyResponse {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { text: "x" },
		page: { url: "", title: "", state: "ready", busy: false },
		replay: false,
	};
}

describe("dispatch", () => {
	it("returns NO_EXTENSION when no clients are connected", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients: createClients(), pending, sessions });
		const r = await dispatch.send(req("a"));
		expect(r).toMatchObject({ ok: false, error: { code: "NO_EXTENSION" } });
	});

	it("returns TAB_NOT_FOUND when the session has no bound tab", async () => {
		const sessions = createSessionRegistry();
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });
		const r = await dispatch.send(req("a"));
		expect(r).toMatchObject({ ok: false, error: { code: "TAB_NOT_FOUND" } });
	});

	it("forwards to the client and resolves on response", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const p = dispatch.send(req("a"));
		expect(sendMock).toHaveBeenCalledOnce();
		const forwarded = sendMock.mock.calls[0][0] as BproxyRequest;
		pending.resolveById(forwarded.id, ok(forwarded.id));
		await expect(p).resolves.toMatchObject({ ok: true });
	});

	it("serialises commands targeting the same tab in FIFO order", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("default", 42);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const p1 = dispatch.send(req("a"));
		const p2 = dispatch.send(req("b"));
		const p3 = dispatch.send(req("c"));
		// Only the first should have been forwarded so far.
		expect(sendMock).toHaveBeenCalledOnce();
		expect((sendMock.mock.calls[0][0] as BproxyRequest).id).toBe("a");

		pending.resolveById("a", ok("a"));
		await p1;
		// After 'a' resolves, 'b' (not 'c') is forwarded next — order preserved.
		expect(sendMock).toHaveBeenCalledTimes(2);
		expect((sendMock.mock.calls[1][0] as BproxyRequest).id).toBe("b");

		pending.resolveById("b", ok("b"));
		await p2;
		expect(sendMock).toHaveBeenCalledTimes(3);
		expect((sendMock.mock.calls[2][0] as BproxyRequest).id).toBe("c");

		pending.resolveById("c", ok("c"));
		await p3;
	});

	it("runs commands targeting different tabs in parallel (per-tab lock only)", async () => {
		const sessions = createSessionRegistry();
		sessions.bind("s-a", 1);
		sessions.bind("s-b", 2);
		const clients = createClients();
		const sendMock = vi.fn();
		clients.add({ id: "c1", send: sendMock });
		const pending = createPending({ maxSize: 10 });
		const dispatch = createDispatch({ clients, pending, sessions });

		const pa = dispatch.send(req("a", "s-a"));
		const pb = dispatch.send(req("b", "s-b"));
		// Different tabs → both forwarded immediately, no serialization between them.
		expect(sendMock).toHaveBeenCalledTimes(2);

		pending.resolveById("b", ok("b"));
		await pb;
		pending.resolveById("a", ok("a"));
		await pa;
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/clients.ts`**

```typescript
import type { BproxyRequest } from "@bproxy/shared";

export interface ClientHandle {
	id: string;
	send: (cmd: BproxyRequest) => void;
}

export interface ClientsRegistry {
	add(client: ClientHandle): void;
	remove(id: string): void;
	any(): ClientHandle | undefined;
	all(): ClientHandle[];
	size(): number;
}

export function createClients(): ClientsRegistry {
	const clients = new Map<string, ClientHandle>();
	return {
		add(c) {
			clients.set(c.id, c);
		},
		remove(id) {
			clients.delete(id);
		},
		any() {
			return clients.values().next().value;
		},
		all() {
			return [...clients.values()];
		},
		size() {
			return clients.size;
		},
	};
}
```

- [x] **Step 4: Write `service/src/dispatch.ts`**

```typescript
import type { BproxyError, BproxyRequest, BproxyResponse } from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { PendingMap } from "./pending";
import type { SessionRegistry } from "./sessions";

export interface DispatchDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	sessions: SessionRegistry;
}

export interface DispatchEngine {
	send(cmd: BproxyRequest): Promise<BproxyResponse>;
}

function errorResponse(id: string, error: BproxyError): BproxyResponse {
	return { protocol_version: 1, id, ok: false, error };
}

export function createDispatch(deps: DispatchDeps): DispatchEngine {
	const tabQueues = new Map<number, Promise<void>>();

	async function withTabLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
		const prev = tabQueues.get(tabId) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		tabQueues.set(
			tabId,
			prev.then(() => gate),
		);
		await prev;
		try {
			return await fn();
		} finally {
			release();
			if (tabQueues.get(tabId) === prev) tabQueues.delete(tabId);
		}
	}

	return {
		async send(cmd) {
			const client = deps.clients.any();
			if (!client) {
				return errorResponse(cmd.id, {
					code: "NO_EXTENSION",
					category: "transport",
					retry: "conditional",
					message: "No extension WebSocket client is connected",
				});
			}

			const session = deps.sessions.getOrCreate(cmd.session);
			if (session.tabId === null) {
				return errorResponse(cmd.id, {
					code: "TAB_NOT_FOUND",
					category: "target",
					retry: "never",
					message: `Session '${cmd.session}' has no bound tab`,
				});
			}

			return withTabLock(session.tabId, () => deps.pending.register(cmd, client.send));
		},
	};
}
```

- [x] **Step 5: Run tests — all pass.**

- [x] **Step 6: Commit**

```bash
git add service/src/clients.ts service/src/dispatch.ts service/src/__tests__/dispatch.test.ts
git commit -m "feat(service): WS client registry and per-tab serialized dispatch (Phase 2 Task 6)"
```

---

## Task 7: Zod schemas (runtime request validation)

**Files:** `service/src/schemas.ts`, `service/src/__tests__/schemas.test.ts`.

**Purpose:** Validate `BproxyRequest` JSON at the HTTP boundary. Phase 1 deferred runtime validation; the daemon is the first consumer. Schemas mirror the shape in `shared/src/protocol.ts` and `shared/src/actions.ts`. A test asserts every `Action` literal has a corresponding `params` validator.

- [x] **Step 1: Write `service/src/__tests__/schemas.test.ts`** (failing first)

```typescript
import { describe, expect, it } from "vitest";
import { ACTIONS, ACTION_PARAM_SCHEMAS, parseRequest } from "../schemas";

describe("request schemas", () => {
	it("provides a params validator for every Action", () => {
		// ACTIONS is `satisfies readonly Action[]` in schemas.ts — adding a new
		// Action in @bproxy/shared without extending ACTIONS fails TypeScript.
		// This runtime test asserts every key has a schema entry.
		for (const a of ACTIONS) {
			expect(ACTION_PARAM_SCHEMAS[a]).toBeDefined();
		}
	});

	it("accepts a valid navigate request", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "navigate",
			params: { url: "https://example.com" },
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(true);
	});

	it("rejects an unknown action", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "made-up",
			params: {},
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(false);
	});

	it("rejects navigate without url", () => {
		const r = parseRequest({
			protocol_version: 1,
			id: "abc",
			action: "navigate",
			params: {},
			session: "default",
			deadline: Date.now() + 1000,
			destructive: false,
		});
		expect(r.success).toBe(false);
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/schemas.ts`**

Define one Zod schema per `Action` mirroring the `ActionParams[action]` shape from `shared/src/actions.ts`. Use `z.object({}).passthrough()` for empty-params actions, and `z.object({ ... }).strict()` for parameterised ones. Export:
- `ACTION_PARAM_SCHEMAS: Record<Action, z.ZodTypeAny>`
- `parseRequest(input: unknown): { success: true; data: BproxyRequest } | { success: false; error: string }`

```typescript
import { z } from "zod";
import type { Action, BproxyRequest } from "@bproxy/shared";

// Runtime list of every action. `satisfies readonly Action[]` makes the
// compiler verify that ACTIONS only contains valid Action literals; the
// _AssertCovers type below verifies the inverse — every Action is present.
export const ACTIONS = [
	"navigate", "text", "images", "elements", "outline", "dom", "scroll",
	"screenshot", "fill", "fill-form", "select", "wait", "require-human", "eval",
	"tab.list", "tab.pin", "tab.unpin", "tab.open", "tab.close",
	"session.list", "session.bind", "session.unbind", "session.resume",
	"debug.log", "debug.last", "debug.status",
] as const satisfies readonly Action[];

// If a new Action is added to @bproxy/shared without being appended to ACTIONS,
// this type resolves to a non-`true` literal and the constant assignment fails.
type _AssertCovers = Exclude<Action, (typeof ACTIONS)[number]> extends never ? true : false;
const _coverage: _AssertCovers = true;
void _coverage;

const elementTarget = z.union([
	z.object({ selector: z.string() }).strict(),
	z.object({
		route: z.object({
			hosts: z.array(z.object({ selector: z.string(), index: z.number().int().optional() })),
			target: z.string(),
		}),
	}).strict(),
]);

const fillMethod = z.enum(["direct", "paste", "runtime-api"]);
const executionWorld = z.enum(["isolated", "main"]);
const pacingMode = z.enum(["human", "fast"]);

export const ACTION_PARAM_SCHEMAS: Record<Action, z.ZodTypeAny> = {
	navigate: z.object({ url: z.string() }).strict(),
	text: z.object({ selector: z.string().optional() }).strict(),
	images: z.object({ selector: z.string().optional() }).strict(),
	elements: z.object({ form: z.boolean().optional() }).strict(),
	outline: z.object({}).strict(),
	dom: z.object({ selector: z.string().optional(), depth: z.number().int().optional() }).strict(),
	scroll: z.object({
		by: z.string().optional(),
		direction: z.enum(["up", "down"]).optional(),
		untilStable: z.boolean().optional(),
	}).strict(),
	screenshot: z.object({
		activate: z.boolean().optional(),
		debugger: z.boolean().optional(),
	}).strict(),
	fill: z.object({
		target: elementTarget,
		value: z.string(),
		method: fillMethod,
		world: executionWorld,
	}).strict(),
	"fill-form": z.object({
		fields: z.array(
			z.object({
				target: elementTarget,
				value: z.string(),
				method: fillMethod,
				world: executionWorld,
			}).strict(),
		),
	}).strict(),
	select: z.object({ trigger: elementTarget, optionText: z.string() }).strict(),
	wait: z.object({
		strategy: z.enum(["selector", "url", "navigation"]),
		target: z.string(),
		timeout: z.number().int().optional(),
	}).strict(),
	"require-human": z.object({ reason: z.string(), forAttach: z.string().optional() }).strict(),
	eval: z.object({ code: z.string() }).strict(),
	"tab.list": z.object({}).strict(),
	"tab.pin": z.object({ tabId: z.number().int().optional() }).strict(),
	"tab.unpin": z.object({}).strict(),
	"tab.open": z.object({ url: z.string() }).strict(),
	"tab.close": z.object({ tabId: z.number().int().optional() }).strict(),
	"session.list": z.object({}).strict(),
	"session.bind": z.object({ tabId: z.number().int(), pacing: pacingMode.optional() }).strict(),
	"session.unbind": z.object({}).strict(),
	"session.resume": z.object({}).strict(),
	"debug.log": z.object({ id: z.string().optional(), limit: z.number().int().optional() }).strict(),
	"debug.last": z.object({ count: z.number().int().optional() }).strict(),
	"debug.status": z.object({}).strict(),
};

const ENVELOPE_BASE = z.object({
	protocol_version: z.literal(1),
	id: z.string().min(1),
	action: z.string(),
	params: z.unknown(),
	session: z.string().min(1),
	deadline: z.number().int(),
	destructive: z.boolean(),
});

export type ParseResult =
	| { success: true; data: BproxyRequest }
	| { success: false; error: string };

export function parseRequest(input: unknown): ParseResult {
	const envelope = ENVELOPE_BASE.safeParse(input);
	if (!envelope.success) return { success: false, error: envelope.error.message };
	const action = envelope.data.action;
	const schema = (ACTION_PARAM_SCHEMAS as Record<string, z.ZodTypeAny>)[action];
	if (!schema) return { success: false, error: `Unknown action: ${action}` };
	const params = schema.safeParse(envelope.data.params);
	if (!params.success) return { success: false, error: params.error.message };
	return {
		success: true,
		data: { ...envelope.data, action: action as Action, params: params.data } as BproxyRequest,
	};
}
```

- [x] **Step 4: Run tests — all pass.**

- [x] **Step 5: Commit**

```bash
git add service/src/schemas.ts service/src/__tests__/schemas.test.ts
git commit -m "feat(service): Zod schemas for runtime request validation (Phase 2 Task 7)"
```

---

## Task 8: Auth gate (four-layer check)

**Files:** `service/src/auth.ts`, `service/src/__tests__/auth.test.ts`.

**Purpose:** Single `onRequest` hook that enforces four layers (Host, Origin, Sec-Fetch-Site, route-specific secret) before any route runs. The hook is the design-asserted invariant: a route handler must never be reached on an auth-failing request.

- [x] **Step 1: Write `service/src/__tests__/auth.test.ts`** (failing first)

```typescript
import { describe, expect, it } from "vitest";
import { evaluateAuth } from "../auth";

const port = 9615;
const daemonToken = "abc123";
const extensionToken = "deadbeef";

interface H { [k: string]: string | undefined }

function call(url: string, method: "GET" | "POST", headers: H) {
	return evaluateAuth({
		url,
		method,
		headers,
		port,
		daemonToken,
		extensionToken,
		validPairingCodes: new Set(["GOOD-CODE"]),
		bodyPairingCode: headers["x-test-body-code"],
	});
}

describe("evaluateAuth — four-layer gate", () => {
	it("rejects when Host header is missing", () => {
		expect(call("/", "POST", { authorization: `Bearer ${daemonToken}` }).ok).toBe(false);
	});

	it("rejects when Host header points elsewhere", () => {
		expect(
			call("/", "POST", { host: "example.com:9615", authorization: `Bearer ${daemonToken}` }).ok,
		).toBe(false);
	});

	it("rejects when Sec-Fetch-Site is cross-site", () => {
		expect(
			call("/", "POST", {
				host: `127.0.0.1:${port}`,
				"sec-fetch-site": "cross-site",
				authorization: `Bearer ${daemonToken}`,
			}).ok,
		).toBe(false);
	});

	it("accepts POST / with valid Host + bearer token", () => {
		expect(
			call("/", "POST", {
				host: `127.0.0.1:${port}`,
				authorization: `Bearer ${daemonToken}`,
			}).ok,
		).toBe(true);
	});

	it("rejects POST / with wrong bearer", () => {
		expect(
			call("/", "POST", { host: `127.0.0.1:${port}`, authorization: "Bearer nope" }).ok,
		).toBe(false);
	});

	it("accepts POST /pair/claim with valid pairing code, no bearer required", () => {
		expect(
			call("/pair/claim", "POST", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"x-test-body-code": "GOOD-CODE",
			}).ok,
		).toBe(true);
	});

	it("rejects POST /pair/claim with unknown pairing code", () => {
		expect(
			call("/pair/claim", "POST", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"x-test-body-code": "BAD",
			}).ok,
		).toBe(false);
	});

	it("accepts GET /ws when Sec-WebSocket-Protocol carries the extension token", () => {
		const auth = Buffer.from(extensionToken).toString("base64url");
		expect(
			call("/ws", "GET", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"sec-websocket-protocol": `bproxy.v1, auth.${auth}`,
			}).ok,
		).toBe(true);
	});

	it("rejects GET /ws with wrong extension token", () => {
		const auth = Buffer.from("wrong").toString("base64url");
		expect(
			call("/ws", "GET", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"sec-websocket-protocol": `bproxy.v1, auth.${auth}`,
			}).ok,
		).toBe(false);
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/auth.ts`**

```typescript
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthInput {
	url: string;
	method: string;
	headers: Record<string, string | undefined>;
	port: number;
	daemonToken: string;
	extensionToken: string;
	validPairingCodes: Set<string>;
	bodyPairingCode?: string;
}

export type AuthDecision =
	| { ok: true }
	| { ok: false; reason: string };

function constantTimeEquals(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

function checkHost(host: string | undefined, port: number): boolean {
	if (!host) return false;
	return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function checkOrigin(origin: string | undefined, route: "command" | "pair" | "ws"): boolean {
	if (!origin) return route === "command"; // CLI has no Origin
	return origin.startsWith("chrome-extension://");
}

function checkFetchSite(value: string | undefined): boolean {
	if (!value) return true;
	return value === "none" || value === "same-origin";
}

function routeFor(url: string, method: string): "command" | "pair" | "ws" | null {
	if (method === "POST" && url === "/") return "command";
	if (method === "POST" && url === "/pair/claim") return "pair";
	if (method === "GET" && url === "/ws") return "ws";
	return null;
}

function parseBearer(header: string | undefined): string | null {
	if (!header) return null;
	const m = /^Bearer\s+(.+)$/i.exec(header);
	return m ? m[1] : null;
}

function parseWsAuth(header: string | undefined): string | null {
	if (!header) return null;
	const parts = header.split(",").map((p) => p.trim());
	const tok = parts.find((p) => p.startsWith("auth."));
	if (!tok) return null;
	try {
		return Buffer.from(tok.slice("auth.".length), "base64url").toString("utf8");
	} catch {
		return null;
	}
}

export function evaluateAuth(input: AuthInput): AuthDecision {
	const route = routeFor(input.url, input.method);
	if (!route) return { ok: false, reason: "unknown route" };

	if (!checkHost(input.headers.host, input.port)) return { ok: false, reason: "bad host" };
	if (!checkOrigin(input.headers.origin, route)) return { ok: false, reason: "bad origin" };
	if (!checkFetchSite(input.headers["sec-fetch-site"])) return { ok: false, reason: "bad sec-fetch-site" };

	if (route === "command") {
		const bearer = parseBearer(input.headers.authorization);
		if (!bearer || !constantTimeEquals(bearer, input.daemonToken)) {
			return { ok: false, reason: "bad bearer" };
		}
	} else if (route === "pair") {
		const code = input.bodyPairingCode ?? "";
		if (!input.validPairingCodes.has(code)) return { ok: false, reason: "bad pairing code" };
	} else {
		const token = parseWsAuth(input.headers["sec-websocket-protocol"]);
		if (!token || !constantTimeEquals(token, input.extensionToken)) {
			return { ok: false, reason: "bad ws auth" };
		}
	}

	return { ok: true };
}

export interface AuthHookDeps {
	port: number;
	daemonToken: () => string;
	extensionToken: () => string;
	pairingCodes: () => Set<string>;
	readBodyPairingCode: (req: FastifyRequest) => string | undefined;
}

export function makeAuthHook(deps: AuthHookDeps) {
	return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
		const decision = evaluateAuth({
			url: req.url,
			method: req.method,
			headers: req.headers as Record<string, string | undefined>,
			port: deps.port,
			daemonToken: deps.daemonToken(),
			extensionToken: deps.extensionToken(),
			validPairingCodes: deps.pairingCodes(),
			bodyPairingCode: deps.readBodyPairingCode(req),
		});
		if (!decision.ok) {
			reply.code(401).send({ ok: false, error: { code: "UNAUTHORIZED", reason: decision.reason } });
		}
	};
}
```

- [x] **Step 4: Run tests — all 9 pass.**

- [x] **Step 5: Commit**

```bash
git add service/src/auth.ts service/src/__tests__/auth.test.ts
git commit -m "feat(service): four-layer onRequest auth gate (Phase 2 Task 8)"
```

---

## Task 9: Pairing — code generation, TTL, single-use claim

**Files:** `service/src/pairing.ts`, `service/src/__tests__/pairing.test.ts`.

**Purpose:** Owns the pairing-code lifecycle: generation (`ABCD-EFGH`), TTL (5 min), single-use consumption, rate-limit counter, constant-time compare. The popup-side handler in `routes/pair.ts` is a thin adapter over this module.

- [x] **Step 1: Write `service/src/__tests__/pairing.test.ts`** (failing first)

```typescript
import { describe, expect, it } from "vitest";
import { createPairingStore } from "../pairing";

describe("pairing store", () => {
	it("issues a code in the ABCD-EFGH shape", () => {
		const store = createPairingStore({ ttlMs: 300_000, now: () => 0 });
		const { code } = store.issue();
		expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	});

	it("claim returns a bootstrap payload exactly once", () => {
		const store = createPairingStore({ ttlMs: 300_000, now: () => 0 });
		const { code } = store.issue();
		const r1 = store.claim(code);
		const r2 = store.claim(code);
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.code).toBe("PAIRING_CODE_CONSUMED");
	});

	it("claim fails when the code is expired", () => {
		let now = 0;
		const store = createPairingStore({ ttlMs: 1000, now: () => now });
		const { code } = store.issue();
		now = 5000;
		const r = store.claim(code);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("PAIRING_CODE_EXPIRED");
	});

	it("claim fails for unknown code", () => {
		const store = createPairingStore({ ttlMs: 1000, now: () => 0 });
		const r = store.claim("ZZZZ-ZZZZ");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("PAIRING_CODE_INVALID");
	});

	it("active() lists unconsumed, unexpired codes", () => {
		let now = 0;
		const store = createPairingStore({ ttlMs: 1000, now: () => now });
		const a = store.issue();
		const b = store.issue();
		store.claim(a.code);
		expect(store.active()).toEqual(new Set([b.code]));
		now = 5000;
		expect(store.active()).toEqual(new Set());
	});
});
```

- [x] **Step 2: Run — verify failures.**

- [x] **Step 3: Write `service/src/pairing.ts`**

```typescript
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface PairingBootstrap {
	extensionToken: string;
	wsUrl: string;
	protocolVersion: 1;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export type ClaimResult =
	| { ok: true; bootstrap: PairingBootstrap }
	| { ok: false; code: "PAIRING_CODE_INVALID" | "PAIRING_CODE_EXPIRED" | "PAIRING_CODE_CONSUMED" };

export interface PairingStore {
	issue(): { code: string; expiresAt: number };
	claim(code: string, makeBootstrap?: () => Omit<PairingBootstrap, "issuedAt" | "expiresAt" | "nonce">): ClaimResult;
	active(): Set<string>;
}

interface PairingDeps {
	ttlMs: number;
	now: () => number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomBlock(): string {
	const buf = randomBytes(4);
	let s = "";
	for (let i = 0; i < 4; i++) s += ALPHABET[buf[i] % ALPHABET.length];
	return s;
}

function constantEq(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

interface Entry {
	code: string;
	expiresAt: number;
	issuedAt: number;
	consumed: boolean;
}

export function createPairingStore(deps: PairingDeps): PairingStore {
	const entries = new Map<string, Entry>();

	function purgeExpired(): void {
		const now = deps.now();
		for (const [k, v] of entries) if (v.expiresAt < now) entries.delete(k);
	}

	function find(code: string): Entry | null {
		for (const e of entries.values()) if (constantEq(e.code, code)) return e;
		return null;
	}

	return {
		issue() {
			const code = `${randomBlock()}-${randomBlock()}`;
			const issuedAt = deps.now();
			const expiresAt = issuedAt + deps.ttlMs;
			entries.set(code, { code, expiresAt, issuedAt, consumed: false });
			return { code, expiresAt };
		},
		claim(code, makeBootstrap) {
			purgeExpired();
			const entry = find(code);
			if (!entry) return { ok: false, code: "PAIRING_CODE_INVALID" };
			if (entry.consumed) return { ok: false, code: "PAIRING_CODE_CONSUMED" };
			if (entry.expiresAt < deps.now()) return { ok: false, code: "PAIRING_CODE_EXPIRED" };
			entry.consumed = true;
			const baseline = makeBootstrap?.() ?? {
				extensionToken: randomBytes(32).toString("base64url"),
				wsUrl: "ws://127.0.0.1:9615/ws",
				protocolVersion: 1 as const,
			};
			return {
				ok: true,
				bootstrap: {
					...baseline,
					issuedAt: entry.issuedAt,
					expiresAt: entry.expiresAt,
					nonce: randomUUID(),
				},
			};
		},
		active() {
			purgeExpired();
			const out = new Set<string>();
			for (const e of entries.values()) if (!e.consumed) out.add(e.code);
			return out;
		},
	};
}
```

- [x] **Step 4: Run tests — all pass.**

- [x] **Step 5: Commit**

```bash
git add service/src/pairing.ts service/src/__tests__/pairing.test.ts
git commit -m "feat(service): pairing-code store with TTL and single-use claim (Phase 2 Task 9)"
```

---

## Task 10: Routes — POST /, POST /pair/claim, GET /ws

**Files:** `service/src/routes/command.ts`, `service/src/routes/pair.ts`, `service/src/routes/ws.ts`, `service/src/debug-actions.ts`.

**Purpose:** Thin route handlers wired to dispatch, pairing store, and clients. Daemon-local `debug.last` and `debug.status` short-circuit dispatch (per `service.md` § HTTP Route).

- [x] **Step 1: Write `service/src/debug-actions.ts`**

```typescript
import type { BproxyRequest, BproxyResponse, DaemonRequestTrace } from "@bproxy/shared";
import type { ClientsRegistry } from "./clients";
import type { SessionRegistry } from "./sessions";

export interface DebugDeps {
	clients: ClientsRegistry;
	sessions: SessionRegistry;
	startedAt: number;
	traces: () => readonly DaemonRequestTrace[];
}

export function isDaemonLocal(action: string): boolean {
	return action === "debug.last" || action === "debug.status";
}

function pageOk() {
	return { url: "", title: "", state: "ready" as const, busy: false };
}

export function handleDaemonLocal(cmd: BproxyRequest, deps: DebugDeps): BproxyResponse {
	if (cmd.action === "debug.last") {
		const params = cmd.params as { count?: number };
		const count = params.count ?? 50;
		return {
			protocol_version: 1,
			id: cmd.id,
			ok: true,
			data: { requests: deps.traces().slice(-count) },
			page: pageOk(),
			replay: false,
		};
	}
	// debug.status
	const sessions = deps.sessions.list();
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: true,
		data: {
			daemon: {
				pid: process.pid,
				port: 9615,
				uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
			},
			wsClients: deps.clients.all().map((c) => ({ id: c.id, connectedAt: 0 })),
			sessions,
			pausedSessions: sessions
				.filter((s) => s.paused)
				.map((s) => ({ session: s.name, reason: s.pauseReason })),
		},
		page: pageOk(),
		replay: false,
	};
}
```

- [x] **Step 2: Write `service/src/routes/command.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { DispatchEngine } from "../dispatch";
import type { PacingEngine } from "../pacing";
import { parseRequest } from "../schemas";
import { handleDaemonLocal, isDaemonLocal, type DebugDeps } from "../debug-actions";

export interface CommandRouteDeps {
	dispatch: DispatchEngine;
	pacing: PacingEngine;
	logger: Logger;
	debug: DebugDeps;
}

export function commandRoute(deps: CommandRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.post("/", async (request, reply) => {
			const parsed = parseRequest(request.body);
			if (!parsed.success) {
				return reply.code(400).send({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error } });
			}
			const cmd = parsed.data;
			deps.logger.info({ id: cmd.id, action: cmd.action, session: cmd.session, destructive: cmd.destructive, event: "received" });

			const waited = await deps.pacing.waitForSlot(cmd.session, cmd.action);
			if (waited > 0) deps.logger.info({ id: cmd.id, event: "pacing_wait", delay_ms: waited });

			let response;
			if (isDaemonLocal(cmd.action)) {
				response = handleDaemonLocal(cmd, deps.debug);
			} else {
				response = await deps.dispatch.send(cmd);
			}
			deps.logger.info({ id: cmd.id, event: "response", ok: response.ok, error_code: !response.ok ? response.error.code : undefined });
			return response;
		});
	};
}
```

- [x] **Step 3: Write `service/src/routes/pair.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { PairingStore } from "../pairing";

const ClaimBody = z.object({ code: z.string() }).strict();

export interface PairRouteDeps {
	pairing: PairingStore;
	logger: Logger;
	wsUrl: string;
}

export function pairRoute(deps: PairRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.post("/pair/claim", async (request, reply) => {
			const body = ClaimBody.safeParse(request.body);
			if (!body.success) {
				return reply.code(400).send({ ok: false, error: { code: "PAIRING_CODE_INVALID", message: "code required" } });
			}
			const r = deps.pairing.claim(body.data.code, () => ({
				extensionToken: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
				wsUrl: deps.wsUrl,
				protocolVersion: 1,
			}));
			if (!r.ok) {
				deps.logger.warn({ event: "pair_claim_failed", code: r.code });
				return reply.code(401).send({ ok: false, error: { code: r.code } });
			}
			deps.logger.info({ event: "pair_claim_ok" });
			return { ok: true, data: r.bootstrap };
		});
	};
}
```

- [x] **Step 4: Write `service/src/routes/ws.ts`**

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { Logger } from "pino";
import type { ClientsRegistry } from "../clients";
import type { PendingMap } from "../pending";

export interface WsRouteDeps {
	clients: ClientsRegistry;
	pending: PendingMap;
	logger: Logger;
	newClientId: () => string;
}

export function wsRoute(deps: WsRouteDeps) {
	return async function (app: FastifyInstance): Promise<void> {
		app.get("/ws", { websocket: true }, (socket: WebSocket, _req: FastifyRequest) => {
			const id = deps.newClientId();
			deps.logger.info({ event: "ws_connect", ws_client: id });

			const handle = {
				id,
				send: (cmd: object) => socket.send(JSON.stringify(cmd)),
			};
			deps.clients.add(handle);

			// Replay in-flight requests to the newly connected client.
			deps.pending.replayForClient(handle.send);

			const heartbeat = setInterval(() => {
				try {
					socket.ping();
				} catch {
					/* socket already closed */
				}
			}, 20_000);

			socket.on("message", (raw) => {
				try {
					const msg = JSON.parse(raw.toString()) as { id: string };
					if (msg.id) deps.pending.resolveById(msg.id, msg as never);
				} catch (e) {
					deps.logger.warn({ event: "ws_bad_message", err: String(e) });
				}
			});

			socket.on("close", () => {
				clearInterval(heartbeat);
				deps.clients.remove(id);
				deps.logger.info({ event: "ws_disconnect", ws_client: id });
			});
		});
	};
}
```

- [x] **Step 5: Write `service/src/__tests__/debug-actions.test.ts`**

Guards the daemon-local routing decision. `debug.log` must be forwarded to the extension (not handled locally) — a one-line guard prevents future regressions.

```typescript
import { describe, expect, it } from "vitest";
import { isDaemonLocal } from "../debug-actions";

describe("isDaemonLocal", () => {
	it("returns true for debug.last and debug.status", () => {
		expect(isDaemonLocal("debug.last")).toBe(true);
		expect(isDaemonLocal("debug.status")).toBe(true);
	});

	it("returns false for debug.log (must be forwarded to the extension)", () => {
		expect(isDaemonLocal("debug.log")).toBe(false);
	});

	it("returns false for all non-debug actions", () => {
		for (const a of ["navigate", "text", "fill", "scroll", "session.bind"]) {
			expect(isDaemonLocal(a)).toBe(false);
		}
	});
});
```

- [x] **Step 6: Run tests — debug-actions unit test passes; routes are integration-tested in Task 12.**

- [x] **Step 7: Commit**

```bash
git add service/src/routes service/src/debug-actions.ts service/src/__tests__/debug-actions.test.ts
git commit -m "feat(service): HTTP and WS route handlers (Phase 2 Task 10)"
```

---

## Task 11: Server bootstrap (buildServer)

**Files:** `service/src/server.ts`.

**Purpose:** Compose every module into a single `buildServer({...})` function that returns a Fastify instance with auth hook, routes, and the shared object graph wired. Used by both the `start` lifecycle subcommand (Task 13) and the integration test (Task 12).

- [x] **Step 1: Write `service/src/server.ts`**

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { Logger } from "pino";
import { makeAuthHook } from "./auth";
import { createClients } from "./clients";
import { createDispatch } from "./dispatch";
import { createPacing } from "./pacing";
import { createPairingStore, type PairingStore } from "./pairing";
import { createPending } from "./pending";
import { createSessionRegistry, type SessionRegistry } from "./sessions";
import { commandRoute } from "./routes/command";
import { pairRoute } from "./routes/pair";
import { wsRoute } from "./routes/ws";
import type { DaemonRequestTrace } from "@bproxy/shared";

export interface BuildServerOptions {
	port: number;
	daemonToken: string;
	extensionToken: string;
	logger: Logger;
	pairing?: PairingStore;
	sessions?: SessionRegistry;
	traces?: () => readonly DaemonRequestTrace[];
}

export interface BuiltServer {
	app: FastifyInstance;
	clients: ReturnType<typeof createClients>;
	pending: ReturnType<typeof createPending>;
	sessions: SessionRegistry;
	pairing: PairingStore;
}

export async function buildServer(opts: BuildServerOptions): Promise<BuiltServer> {
	const app = Fastify({ logger: false });
	const sessions = opts.sessions ?? createSessionRegistry();
	const clients = createClients();
	const pending = createPending({ maxSize: 100, now: () => Date.now() });
	const dispatch = createDispatch({ clients, pending, sessions });
	const pacing = createPacing({
		sessions,
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		random: () => Math.random(),
	});
	const pairing = opts.pairing ?? createPairingStore({ ttlMs: 300_000, now: () => Date.now() });

	let clientCounter = 0;
	const newClientId = (): string => `client-${++clientCounter}`;

	await app.register(websocket);
	app.addHook(
		"onRequest",
		makeAuthHook({
			port: opts.port,
			daemonToken: () => opts.daemonToken,
			extensionToken: () => opts.extensionToken,
			pairingCodes: () => pairing.active(),
			readBodyPairingCode: (req) => {
				const body = req.body as { code?: string } | undefined;
				return body?.code;
			},
		}),
	);

	const startedAt = Date.now();
	const traces = opts.traces ?? (() => [] as readonly DaemonRequestTrace[]);

	await app.register(commandRoute({
		dispatch,
		pacing,
		logger: opts.logger,
		debug: { clients, sessions, startedAt, traces },
	}));
	await app.register(pairRoute({ pairing, logger: opts.logger, wsUrl: `ws://127.0.0.1:${opts.port}/ws` }));
	await app.register(wsRoute({ clients, pending, logger: opts.logger, newClientId }));

	return { app, clients, pending, sessions, pairing };
}
```

- [x] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bproxy/service typecheck
```

- [x] **Step 3: Commit**

```bash
git add service/src/server.ts
git commit -m "feat(service): buildServer composes the daemon object graph (Phase 2 Task 11)"
```

---

## Task 12: End-to-end round-trip integration test

**Files:** `service/src/__tests__/round-trip.test.ts`.

**Purpose:** The integration test required by `service.md` § Testing. Start a Fastify instance bound to an ephemeral port, connect a real `ws` client, send a `POST /` command, verify it lands on the WS client, respond, verify the HTTP response. This is also where the design-asserted invariant "auth hook runs before any route handler" is proven: a request with no bearer never reaches the handler.

- [x] **Step 1: Write the test**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { BproxyRequest, BproxyResponse } from "@bproxy/shared";
import { buildServer, type BuiltServer } from "../server";
import { buildCapturedLogger, buildTestLogger, type CapturedLogger } from "../logger";

const daemonToken = "test-daemon-token";
const extensionToken = "test-extension-token";

let built: BuiltServer;
let port: number;
let captured: CapturedLogger;

function makeCmd(overrides: Partial<BproxyRequest> = {}): BproxyRequest {
	return {
		protocol_version: 1,
		id: overrides.id ?? `01HZX${Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(21, "0")}`,
		action: "text",
		params: {},
		session: "default",
		deadline: Date.now() + 5000,
		destructive: false,
		...overrides,
	};
}

async function postCommand(cmd: BproxyRequest, token = daemonToken): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(cmd),
	});
}

function connectClient(): Promise<WebSocket> {
	const auth = Buffer.from(extensionToken).toString("base64url");
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
		headers: { Origin: "chrome-extension://test" },
	});
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (fn()) return resolve();
			if (Date.now() - start > timeoutMs) return reject(new Error("waitUntil timeout"));
			setTimeout(tick, 10);
		};
		tick();
	});
}

beforeEach(async () => {
	captured = buildCapturedLogger();
	built = await buildServer({ port: 0, daemonToken, extensionToken, logger: captured.logger });
	const addr = await built.app.listen({ host: "127.0.0.1", port: 0 });
	port = Number.parseInt(addr.split(":").pop() ?? "0", 10);
});

afterEach(async () => {
	await built.app.close();
});

describe("round-trip — design-asserted invariants", () => {
	// This test is the "auth-before-handler" design assertion. It is engineered so
	// it CANNOT pass if auth is removed: the request body is a fully valid
	// BproxyRequest (no schema-validation false positive) and a positive control
	// confirms the same body reaches the handler when the bearer is correct.
	it("auth runs before any route handler", async () => {
		const handlerSpy = vi.spyOn(built.pending, "register");
		const cmd = makeCmd({ id: "auth-test", action: "debug.status" });

		// Negative: missing bearer → 401, handler never called.
		const noAuth = await fetch(`http://127.0.0.1:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(cmd),
		});
		expect(noAuth.status).toBe(401);
		expect(handlerSpy).not.toHaveBeenCalled();

		// Negative: wrong bearer → 401, handler never called.
		const badAuth = await postCommand(cmd, "wrong-token");
		expect(badAuth.status).toBe(401);
		expect(handlerSpy).not.toHaveBeenCalled();

		// Positive control: SAME body with the right bearer succeeds. This proves
		// the negative result above was caused by auth, not schema parsing or
		// some other early rejection. debug.status is daemon-local so it does
		// not need a WS client.
		const okRes = await postCommand(cmd);
		expect(okRes.status).toBe(200);
	});
});

describe("round-trip — happy path", () => {
	it("forwards a command to a connected WS client and resolves with the response", async () => {
		built.sessions.bind("default", 42);
		const ws = await connectClient();

		ws.on("message", (raw) => {
			const req = JSON.parse(raw.toString()) as BproxyRequest;
			const resp: BproxyResponse = {
				protocol_version: 1,
				id: req.id,
				ok: true,
				data: { text: "hello" },
				page: { url: "https://x", title: "X", state: "ready", busy: false },
				replay: false,
			};
			ws.send(JSON.stringify(resp));
		});

		const cmd = makeCmd({ id: "01HZX0000000000000000000ZZ" });
		const res = await postCommand(cmd);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		expect(body).toMatchObject({ ok: true, id: cmd.id });
		ws.close();
	});

	it("debug.status is handled daemon-locally even without a WS client", async () => {
		const cmd = makeCmd({ id: "01HZX0000000000000000000DD", action: "debug.status" });
		const res = await postCommand(cmd);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		if (!body.ok) throw new Error("debug.status should succeed");
		expect(body.data.daemon.pid).toBe(process.pid);
	});

	it("pairing flow: claim issues an extension token", async () => {
		const issue = built.pairing.issue();
		const res = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "chrome-extension://abc" },
			body: JSON.stringify({ code: issue.code }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; data: { extensionToken: string } };
		expect(body.ok).toBe(true);
		expect(body.data.extensionToken.length).toBeGreaterThan(0);
	});
});

describe("round-trip — reconnect and replay", () => {
	// Proves end-to-end replay: an in-flight request whose client drops mid-flight
	// is replayed to the next client that connects, and the ORIGINAL HTTP POST
	// resolves with the response from the new client.
	it("replays an in-flight request to a reconnecting client and resolves the original POST", async () => {
		built.sessions.bind("default", 42);
		let ws = await connectClient();

		// Client 1 receives the command but disconnects WITHOUT responding.
		const seenByClient1 = new Promise<BproxyRequest>((resolve) => {
			ws.once("message", (raw) => resolve(JSON.parse(raw.toString()) as BproxyRequest));
		});

		const cmd = makeCmd({ id: "01HZX0000000000000000000RP", deadline: Date.now() + 10_000 });
		const postPromise = postCommand(cmd);
		await seenByClient1; // make sure client 1 actually received it
		ws.close();
		await waitUntil(() => built.clients.size() === 0);

		// Client 2 reconnects — pending replays should re-send the in-flight command.
		ws = await connectClient();
		const replayed = await new Promise<BproxyRequest>((resolve) => {
			ws.once("message", (raw) => resolve(JSON.parse(raw.toString()) as BproxyRequest));
		});
		expect(replayed.id).toBe(cmd.id);

		// Client 2 responds — the ORIGINAL HTTP request must resolve.
		ws.send(
			JSON.stringify({
				protocol_version: 1,
				id: replayed.id,
				ok: true,
				data: { text: "from-client-2" },
				page: { url: "https://x", title: "", state: "ready", busy: false },
				replay: false,
			} satisfies BproxyResponse),
		);

		const res = await postPromise;
		expect(res.status).toBe(200);
		const body = (await res.json()) as BproxyResponse;
		expect(body).toMatchObject({ ok: true, id: cmd.id });
		if (body.ok && body.data && "text" in body.data) {
			expect(body.data.text).toBe("from-client-2");
		}
		ws.close();
	});
});

describe("round-trip — observability (ADR-009)", () => {
	// Asserts the lifecycle events from service.md § Observability are emitted
	// with the documented fields. Failure here means a log consumer (debug.last,
	// ops tooling, ADR-009 promise) would break.
	it("emits received → pacing_wait? → response with the request id on every command", async () => {
		const cmd = makeCmd({ id: "01HZX000000000000000000OBS", action: "debug.status" });
		await postCommand(cmd);

		const eventsForId = captured.lines.filter((l) => l.id === cmd.id);
		const events = eventsForId.map((l) => l.event);
		expect(events).toContain("received");
		expect(events).toContain("response");

		const received = eventsForId.find((l) => l.event === "received");
		expect(received).toMatchObject({
			id: cmd.id,
			action: "debug.status",
			session: "default",
			destructive: false,
		});

		const response = eventsForId.find((l) => l.event === "response");
		expect(response).toMatchObject({ id: cmd.id, ok: true });
	});

	it("emits ws_connect and ws_disconnect when a client connects and drops", async () => {
		captured.clear();
		const ws = await connectClient();
		await waitUntil(() => captured.lines.some((l) => l.event === "ws_connect"));
		ws.close();
		await waitUntil(() => captured.lines.some((l) => l.event === "ws_disconnect"));

		const connect = captured.lines.find((l) => l.event === "ws_connect");
		expect(connect).toHaveProperty("ws_client");
	});
});
```

> **Note on the auth test:** the body is a valid `BproxyRequest`; the positive control sends the same body with a correct bearer and asserts 200. Together these prove the 401 response is caused by auth, not by schema validation, body parsing, or any other early rejection — which is the only way to assert "auth runs *before* any handler" without reading source.

- [x] **Step 2: Run the integration test**

```bash
pnpm --filter @bproxy/service test
```

Expected: all test cases pass. The first proves the auth-before-handler invariant (negative + positive control); the happy-path group proves end-to-end dispatch, daemon-local routing, and pairing; the reconnect-and-replay test proves end-to-end replay survives a client drop; the observability group proves ADR-009 lifecycle events are emitted with documented fields.

- [x] **Step 3: Commit**

```bash
git add service/src/__tests__/round-trip.test.ts
git commit -m "test(service): end-to-end round-trip, replay, and observability invariants (Phase 2 Task 12)"
```

---

## Task 13: Lifecycle — start, stop, status, daemonize

**Files:** `service/src/lifecycle.ts`, `service/src/index.ts` (replace).

**Purpose:** PID file, lockfile, daemon token generation (`~/.bproxy/token`, mode 0600 with owner check), pairing-code printing, detached child fork, signal handlers, and the three CLI subcommands.

- [x] **Step 1: Write `service/src/lifecycle.ts`**

Implement, in this order. Every function takes the resolved `ServiceConfig` from `config.ts` (not just `stateDir`) so test code can stub paths and ports cleanly:

1. `ensureStateDir(config)` — `mkdirSync(config.stateDir, { recursive: true })`.
2. `readPid(config): number | null` — read & parse lockfile; return null if absent.
3. `isAlive(pid): boolean` — `process.kill(pid, 0)` swallows ESRCH → false; EPERM → true.
4. **`writeToken(config): string`** — generate `randomBytes(32).toString('hex')`; if `~/.bproxy/token` already exists, `statSync` it and fail closed by throwing `Error('INSECURE_TOKEN_FILE: ...')` when `(st.mode & 0o777) !== 0o600` OR `st.uid !== process.getuid?.()`. Otherwise write the token with `{ mode: 0o600 }` and return it. **This is the auth-gate security invariant from `service.md` § Auth Gate; the matching test is in Step 4.**
5. `clearToken(config)`, `writePort(config, port)`, `writePidFile(config, pid)`.
6. `startForeground(config)` — build the server (Task 11), listen on the configured port, register **both** SIGTERM **and** SIGINT handlers that call `app.close()` then `process.exit(0)`. Print pairing code as one machine-readable JSON line on stdout: `{"pairingCode":"ABCD-EFGH","expiresAt":...}`.
7. `startDetached(config)` — `child_process.spawn(process.execPath, [bin, 'daemonize'], { detached: true, stdio: 'ignore' })`, then write child PID to lockfile, then exit 0.
8. `stop(config)` — read PID, `process.kill(pid, 'SIGTERM')`, remove lockfile & port file & token after kill (best-effort).
9. `status(config)` — `{ running: boolean; pid?: number; port?: number }`. Returns `{ running: false }` when no lockfile exists OR the lockfile's PID is not alive.

Export `writeToken` so the security test in Step 4 can call it directly.

- [x] **Step 2: Replace `service/src/index.ts`**

```typescript
import { loadConfig } from "./config";
import { startDetached, startForeground, status, stop } from "./lifecycle";

async function main(): Promise<number> {
	const cmd = process.argv[2];
	const config = loadConfig();
	switch (cmd) {
		case "start": {
			startDetached(config);
			return 0;
		}
		case "daemonize": {
			await startForeground(config);
			return 0;
		}
		case "stop": {
			stop(config);
			return 0;
		}
		case "status": {
			const s = status(config);
			process.stdout.write(`${JSON.stringify(s)}\n`);
			return 0;
		}
		default:
			process.stdout.write("usage: bproxy-service <start|stop|status>\n");
			return cmd ? 2 : 0;
	}
}

main().then((code) => process.exit(code));
```

- [x] **Step 3: Verify manually**

```bash
pnpm --filter @bproxy/service build
BPROXY_HOME="$(mktemp -d)" node service/dist/index.mjs start
sleep 1
BPROXY_HOME="$(mktemp -d)" node service/dist/index.mjs status
BPROXY_HOME=… node service/dist/index.mjs stop
```

Use the **same** `BPROXY_HOME` across the three calls (export it first). Expected: `status` reports `{"running":true,"pid":…,"port":9615}` between `start` and `stop`.

- [x] **Step 4: Add a lifecycle smoke test** (`service/src/__tests__/lifecycle.test.ts`)

A short test that:
1. spawns `node service/dist/index.mjs daemonize` (foreground) in a subprocess with a fresh `BPROXY_HOME`,
2. polls `~/.bproxy/port` until present,
3. sends `SIGTERM`, waits for exit,
4. asserts exit code 0.

```typescript
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeToken } from "../lifecycle";

const BIN = resolve(__dirname, "../../dist/index.mjs");

function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
	return new Promise((resolveOK, reject) => {
		const start = Date.now();
		const poll = setInterval(() => {
			if (existsSync(path)) {
				clearInterval(poll);
				resolveOK();
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(poll);
				reject(new Error(`timeout waiting for ${path}`));
			}
		}, 30);
	});
}

async function runDaemonized(home: string, signal: "SIGTERM" | "SIGINT"): Promise<void> {
	const child = spawn(process.execPath, [BIN, "daemonize"], {
		env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	try {
		await waitForFile(join(home, "port"));
		const port = Number.parseInt(readFileSync(join(home, "port"), "utf8"), 10);
		expect(port).toBeGreaterThan(0);
	} finally {
		child.kill(signal);
		const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
		expect(code).toBe(0);
	}
}

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "bproxy-test-"));
});

describe("lifecycle smoke", () => {
	it("daemonize listens, writes port, and exits 0 on SIGTERM", async () => {
		expect(existsSync(BIN), "Run `pnpm --filter @bproxy/service build` first").toBe(true);
		await runDaemonized(home, "SIGTERM");
	});

	it("daemonize also exits 0 on SIGINT (Ctrl-C)", async () => {
		expect(existsSync(BIN)).toBe(true);
		await runDaemonized(home, "SIGINT");
	});

	it("status reports running:false when no daemon is running", () => {
		expect(existsSync(BIN)).toBe(true);
		const out = spawnSync(process.execPath, [BIN, "status"], {
			env: { ...process.env, BPROXY_HOME: home },
			encoding: "utf8",
		});
		expect(out.status).toBe(0);
		const parsed = JSON.parse(out.stdout) as { running: boolean };
		expect(parsed.running).toBe(false);
	});
});

describe("token-file security (auth-gate invariant from service.md § Auth Gate)", () => {
	it("writes the token with mode 0600", () => {
		writeToken({ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" });
		const st = statSync(join(home, "token"));
		// Lower 9 bits are permission; expect rw-------.
		expect(st.mode & 0o777).toBe(0o600);
	});

	it("refuses to start with INSECURE_TOKEN_FILE when an existing token is world-readable", () => {
		// Plant a token file with insecure mode 0644.
		const tokenPath = join(home, "token");
		writeFileSync(tokenPath, "deadbeef", { mode: 0o644 });
		chmodSync(tokenPath, 0o644);
		expect(() =>
			writeToken({ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" }),
		).toThrow(/INSECURE_TOKEN_FILE/);
	});
});
```

> **The `writeToken` security test is the design-asserted invariant for the auth gate** (per `service.md` § Auth Gate "Security invariant: daemon token secrecy is enforced by OS file ownership and mode"). The test plants a 0644 token file and asserts `writeToken` fails closed. Ownership check (uid mismatch) is harder to test portably; the mode check is the load-bearing assertion.

- [x] **Step 5: Run tests**

```bash
pnpm --filter @bproxy/service build
pnpm --filter @bproxy/service test
```

- [x] **Step 6: Commit**

```bash
git add service/src/lifecycle.ts service/src/index.ts service/src/__tests__/lifecycle.test.ts
git commit -m "feat(service): start/stop/status lifecycle + token gen (Phase 2 Task 13)"
```

---

## Task 14: Views integration — Container click directive

**Files:** `docs/views/02-containers.md`.

**Purpose:** Surface the generated service component graph from the Container view. `service` is already in `KNOWN_WORKSPACES` in `views/scripts/regen.ts`, so `pnpm views:regen` will pick it up automatically once `service/src/` has source files. This task adds the Mermaid `click` directive.

- [x] **Step 1: Run `pnpm views:regen` and verify the SVG is generated**

```bash
pnpm views:regen
ls docs/views/auto/service-components.svg
```

If `dot` (Graphviz) is missing, the script will write `.dot` instead and warn — install it (`brew install graphviz`) and re-run.

- [x] **Step 2: Edit `docs/views/02-containers.md`** — add the click directive at the end of the Mermaid block, before the closing fence:

```mermaid
  Popup -- "POST /pair/claim" --> Daemon

  click Daemon "./auto/service-components.svg" "Inside the Daemon — component view" _blank
```

Update the "See also" section: replace `_Component view, coming in Phase 2._` with a real link.

```markdown
## See also

- Inside the Daemon: [auto/service-components.svg](./auto/service-components.svg) — generated by `pnpm views:regen`.
- Inside the Extension: _Component view, coming in Phase 3._
- Trust boundaries and where each process runs: _Deployment view, coming in a later phase._
```

- [x] **Step 3: Verify the site builds**

```bash
pnpm docs:build
```

- [x] **Step 4: Verify `views:audit` reports `02-containers` as affected by a service-source change**

```bash
# Make a no-op edit to a service file
git status service/
pnpm views:audit HEAD
```

Expected: `02-containers` appears in the affected list (its frontmatter `sources` glob includes `service/src/**`).

- [x] **Step 5: Commit**

```bash
git add docs/views/02-containers.md docs/views/auto/service-components.svg views/public/views/auto/service-components.svg
git commit -m "docs(views): link Container Daemon node to service component graph (Phase 2 Task 14)"
```

---

## Task 15: Final verification (Phase 2 definition of done)

**Purpose:** Walk the four-criterion DoD from the roadmap. Update phase status.

- [x] **Functional** — every interface consumed by later layers is implemented.
  - `POST /` accepts every `Action` in the union (verified by `parseRequest` test + integration round-trip).
  - `POST /pair/claim` issues an extension token on a valid one-time code.
  - `GET /ws` accepts the WS subprotocol auth and supports replay-on-reconnect.
  - `service start | stop | status` work.

- [x] **Design-asserted** — at least one test or static check per design constraint.
  - **Auth hook runs before any route handler** — `round-trip.test.ts` § "auth runs before any route handler" (valid `BproxyRequest` body, missing/wrong bearer → 401 + `pending.register` never called; positive control with correct bearer → 200, proving the 401 is auth-caused, not parser-caused).
  - **Daemon token file is fail-closed on insecure mode** — `lifecycle.test.ts` § "refuses to start with INSECURE_TOKEN_FILE when an existing token is world-readable" (security invariant from `service.md` § Auth Gate).
  - **Pacing engine waits the configured interval** — `pacing.test.ts` § "waits the configured delay on a paced action (pinned jitter)" + range-based jitter test for non-coupled regression coverage.
  - **Pending map deduplicates by id** — `pending.test.ts` § "dedupes by id".
  - **Pending map replays the original promise on reconnect** — `pending.test.ts` § "replays in-flight requests: original promise resolves when replayed send is responded" + integration-level `round-trip.test.ts` § "replays an in-flight request to a reconnecting client and resolves the original POST".
  - **Pending map treats past-deadline registrations as immediate timeouts** — `pending.test.ts` § "resolves immediately with TIMEOUT when the deadline is already in the past".
  - **Per-tab serialization is FIFO; different tabs run in parallel** — `dispatch.test.ts` § "serialises commands targeting the same tab in FIFO order" + "runs commands targeting different tabs in parallel".
  - **`debug.log` is forwarded, not daemon-local** — `debug-actions.test.ts` § "returns false for debug.log".
  - **Observability lifecycle events from service.md § Observability are emitted with documented fields** — `round-trip.test.ts` § "emits received → pacing_wait? → response with the request id" + "emits ws_connect and ws_disconnect" (honours ADR-009 as a first-class constraint).
  - **Action schema completeness** — `schemas.ts` `_AssertCovers` (compile-time check that every `Action` from `@bproxy/shared` is listed in `ACTIONS`) + `schemas.test.ts` § "provides a params validator for every Action".

- [x] **Documented** — `service/README.md` committed; `docs/solution/service.md` matches reality (no doc edits needed unless deviations occurred — flag any to the user). `docs/views/02-containers.md` updated with click directive.

- [x] **Static gates pass** — clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

All gates green.

- [x] **Views integration**
  - `pnpm views:regen` produces `docs/views/auto/service-components.svg`.
  - `pnpm views:audit HEAD` reports `02-containers` when service source files change.
  - `pnpm docs:build` passes.

- [x] **No stray TODO/FIXME/XXX**

```bash
grep -rnE "TODO|FIXME|XXX" service/src 2>/dev/null
```

Expected: empty.

- [x] **Update `docs/plans/roadmap.md`** — mark Phase 2 as ✅ Done; set Phase 3 (Extension) to "Not started — _plan written when Phase 2 closes_".

- [x] **Commit and PR**

```bash
git add docs/plans/roadmap.md
git commit -m "docs: mark Phase 2 (Daemon) as done"
```

---

## Task 16: Identified test-coverage gaps (post-DoD hardening)

**Purpose:** Record known gaps where tests currently pass but spec-level behavior can still be wrong, and add explicit steps to close those gaps with failing-first tests before implementation changes.

> **Execution rule:** For each subtask below, write the test first, run it to observe failure, then implement the minimum change to satisfy the test and the service spec.

### Gap A — Action contract coverage is incomplete

Current tests cover selected actions (`debug.status`, `text`) but do not prove route-level behavior for all action families (`session.*`, `tab.*`, forwarding vs daemon-local, tab-binding requirements).

- [ ] **Step A1: Add a table-driven contract test file** `service/src/__tests__/action-contract.test.ts`.
- [ ] **Step A2: Encode expected behavior per action family**:
  - daemon-local: `debug.last`, `debug.status`
  - forwarded: `debug.log`, browser actions
  - session lifecycle: `session.bind`, `session.unbind`, `session.resume`, `session.list`
  - tab lifecycle: `tab.list`, `tab.pin`, `tab.unpin`, `tab.open`, `tab.close`
- [ ] **Step A3: Assert preconditions and outcomes** per row:
  - needs WS client?
  - needs bound tab?
  - expected success/error code.
- [ ] **Step A4: Ensure at least one test proves `session.bind` works from an unbound session** (catches chicken-and-egg regressions in dispatch).

### Gap B — Missing end-to-end workflow tests

Unit tests validate components in isolation, but they do not prove realistic state transitions.

- [ ] **Step B1: Add workflow tests in** `service/src/__tests__/workflows.test.ts`.
- [ ] **Step B2: Add flow: unbound session → `session.bind` → normal forwarded action**; assert full success path.
- [ ] **Step B3: Add flow: pause/human-required state → `session.resume` → next command continues**.
- [ ] **Step B4: Add flow: tab reassignment updates routing target** (if session is rebound, next forwarded command goes to new tab context).

### Gap C — Auth ordering is not proven at server-hook level

Current checks validate auth decisions, but not enough against accidental Fastify hook-stage drift.

- [ ] **Step C1: Add integration assertions to** `service/src/__tests__/round-trip.test.ts` (or new `auth-ordering.test.ts`) that fail if auth is moved too late in request lifecycle.
- [ ] **Step C2: Add negative tests with valid request payload + missing/invalid auth** and assert handler-side effects do not occur.
- [ ] **Step C3: Add malformed JSON + invalid auth case** and assert status is `401` (not `400`) to prove auth runs before body parsing.
- [ ] **Step C4: Add positive control with identical payload + valid auth** to prove rejection reason is auth-only.
- [ ] **Step C5: Keep this test coupled to documented requirement in `service.md` (auth gate at `onRequest`, before parse/validation/route logic).**

### Gap D — Observability contract is only partially asserted

Tests currently assert a subset of lifecycle events; spec documents a broader event contract.

- [ ] **Step D1: Add an observability contract test file** `service/src/__tests__/observability-contract.test.ts` (or extend round-trip tests).
- [ ] **Step D2: For forwarded happy path, assert sequence and fields:** `received` → `pacing_wait?` → `forwarded` → `response`.
- [ ] **Step D3: For deadline expiry, assert `timeout` event with request `id` and elapsed fields.**
- [ ] **Step D4: For reconnect replay, assert `replay` event with request `id` and `ws_client`.**
- [ ] **Step D5: For pacing-mode change, assert `pacing_config` event with `session` and `mode`.**

### Gap E — Lifecycle contract tests are smoke-only

Current lifecycle tests confirm boot/shutdown basics but not full command contract behavior.

- [ ] **Step E1: Add contract tests in** `service/src/__tests__/lifecycle-contract.test.ts`.
- [ ] **Step E2: Assert `start` fails cleanly when daemon already running** (no duplicate daemon spawn).
- [ ] **Step E3: Assert `start -> status -> stop -> status` with same `BPROXY_HOME` gives expected state transitions.
- [ ] **Step E4: Assert lock/token/port file semantics around shutdown are consistent with spec (best-effort cleanup + running-state truth).

### Close-out criteria for Task 16

- [ ] New tests fail before fixes and pass after fixes.
- [ ] `pnpm --filter @bproxy/service test` passes with the new suites.
- [ ] `pnpm check` remains green.
- [ ] If behavior changed, update `docs/solution/service.md` and `docs/plans/phases/02-daemon.md` accordingly.
- [ ] Commit with explicit scope, e.g.:

```bash
git add service/src/__tests__/ docs/solution/service.md docs/plans/phases/02-daemon.md
git commit -m "test(service): close phase-2 coverage gaps (action contract, workflows, auth ordering, observability, lifecycle)"
```

---

## Out of scope (this phase)

- **CLI implementation.** The daemon ships its own `bproxy-service` binary with `start | stop | status`. The user-facing `bproxy service ...` subcommands belong to Phase 4.
- **Real extension behaviour.** Phase 2 tests against a mock WS client. Phase 3 builds the extension.
- **Per-session `PacingConfig` literal overrides.** Only `"human" | "fast"` presets are wired. Per `shared.md` deferred note.
- **Drift detection between `architecture.md` actions table and the action schemas in `service/src/schemas.ts`.** Accept drift risk; the compile-time guard in `@bproxy/shared` is the primary defence. Revisit if drift bites.
- **Pre-commit hooks.** Deferred to Phase 5 per `quality-gates.md`.
- **`chrome.debugger` / `eval` execution.** Daemon validates and forwards; execution semantics are Phase 3's problem.
- **Rate-limiting on `/pair/claim`.** Spec mentions 5/min as a target; only the structural plumbing is in this phase. Add the limiter when `eval`/abuse surfaces actually exist.
- **Log rotation logic beyond day-naming.** Pino writes to `~/.bproxy/logs/YYYY-MM-DD.log`; multi-day retention pruning is deferred.

---

## Self-review notes

- **Spec coverage:** every route, the pacing engine, the pending map (timeout/replay/dedupe/bounded/past-deadline), per-tab serialization (with FIFO + parallel-across-tabs assertions), the four-layer auth gate, lifecycle (`start`/`stop`/`status`, SIGTERM **and** SIGINT, "no daemon running"), structured logging with the request `id`, and views integration all map to numbered tasks above. Daemon-local debug routing (`debug.last`, `debug.status` daemon-local; `debug.log` forwarded) is covered in Task 10 with a dedicated unit test.
- **Type consistency:** `BproxyRequest`, `BproxyResponse`, `BproxyError`, `PACING_PRESETS`, and `Action` are imported by name from `@bproxy/shared` throughout. The Zod schemas in Task 7 mirror — not duplicate — the `ActionParams` shapes from `shared.md`. The `ACTIONS` const is `satisfies readonly Action[]` and is paired with a compile-time `_AssertCovers` check so adding an `Action` to shared without extending `ACTIONS` fails the typecheck.
- **Auth-before-handler invariant** is captured by sending a fully valid `BproxyRequest` body, asserting 401 + `pending.register` never called, **and** a positive control where the same body with a correct bearer reaches the handler. This proves the 401 was caused by auth, not by schema validation, body parsing, or any other early rejection — fail closed even if someone reorders Fastify hooks or changes the parser.
- **Daemon token file invariant** (the named "Security invariant" in `service.md` § Auth Gate) is tested in `lifecycle.test.ts` by planting a 0644 token and asserting `writeToken` throws `INSECURE_TOKEN_FILE`.
- **Replay invariant** is tested at both layers: the unit test asserts the *original* promise resolves when the replayed `send` is responded; the integration test in `round-trip.test.ts` exercises the full WS reconnect path end-to-end.
- **Observability is asserted, not just emitted.** A captured-logger helper (`buildCapturedLogger`) wraps pino and exposes the structured lines; `round-trip.test.ts` asserts the `received` and `response` events from `service.md` § Observability are emitted with the documented fields (`id`, `action`, `session`, `destructive`, `ok`). Honours ADR-009 as a first-class constraint.
- **Determinism:** all clock-dependent code (pacing, pending) takes an injected `now`. Tests that don't need real timers use frozen clocks; the integration test uses real wall-clock but with generous deadlines.
- **No leaky module state:** `wsRoute` accepts `newClientId` via deps (no module-level counter), so tests can reset per-suite without relying on test-execution order.
