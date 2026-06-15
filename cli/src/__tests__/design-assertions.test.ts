/**
 * Command coverage and design assertions.
 *
 * Turns CLI architectural constraints into automated checks:
 *   1. Every shared Action maps to a CLI command (exhaustiveness)
 *   2. No CLI command module calls fetch directly (single-client boundary)
 *   3. No CLI production source imports service/ or extension/
 *   4. Stdout is machine JSON for success/error; stderr for diagnostics
 *   5. Exit codes are deterministic per response shape
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClientGlobalArgs, sendAction } from "../client.js";
import { allRegisteredActions } from "../command-registry.js";
import type { Action } from "../types.js";
import { createTestStateDir } from "./helpers/test-state-dir.js";

// ─── Test infrastructure ───────────────────────────────────────────────

const CLI_SRC = resolve(import.meta.dirname, "..");
const COMMANDS_DIR = resolve(CLI_SRC, "commands");

function setupTempHome(): string {
	const dir = createTestStateDir("bproxy-design-test-");
	writeFileSync(join(dir, "token"), "test-token\n", { mode: 0o600 });
	writeFileSync(join(dir, "port"), "9615", { mode: 0o644 });
	return dir;
}

function makeGlobals(home: string): ClientGlobalArgs {
	return { session: "m4q7z2", timeout: "5000", home, verbose: false };
}

function makeVerboseGlobals(home: string): ClientGlobalArgs {
	return { session: "m4q7z2", timeout: "5000", home, verbose: true };
}

function successResponse(id: string) {
	return {
		protocol_version: 1,
		id,
		ok: true,
		data: { text: "hello" },
		page: { url: "https://example.com", title: "Example", state: "ready", busy: false },
		replay: false,
	};
}

function errorResponse(id: string, code: string) {
	return {
		protocol_version: 1,
		id,
		ok: false,
		error: { code, message: "Something failed" },
	};
}

type FetchInput = string | URL | Request;

function createMockFetch(responseBody: unknown, status = 200) {
	const mockFetch = (_url: FetchInput, _init?: RequestInit): Promise<Response> => {
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	};
	return mockFetch;
}

/** Collect all .ts files in a directory tree, excluding __tests__ and index.ts grouping files */
const SKIP_DIRS = new Set(["__tests__", "test", "node_modules"]);

function collectSourceFiles(dir: string, pattern?: RegExp): string[] {
	const results: string[] = [];
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
			results.push(...collectSourceFiles(fullPath, pattern));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			if (pattern && !pattern.test(entry.name)) continue;
			results.push(fullPath);
		}
	}
	return results;
}

// ─── 1. Action coverage assertion ─────────────────────────────────────

describe("action coverage", () => {
	/**
	 * Maps every shared Action to the CLI command that handles it.
	 * Service lifecycle commands are not protocol actions and are excluded.
	 *
	 * This mapping must be updated when a new Action is added to shared.
	 */
	const ACTION_TO_COMMAND: Record<Action, string> = {
		navigate: "commands/navigate.ts",
		text: "commands/text.ts",
		links: "commands/links.ts",
		images: "commands/images.ts",
		elements: "commands/elements.ts",
		outline: "commands/outline.ts",
		dom: "commands/dom.ts",
		inspect: "commands/inspect.ts",
		snapshot: "commands/snapshot.ts",
		scroll: "commands/scroll.ts",
		click: "commands/click.ts",
		hover: "commands/hover.ts",
		screenshot: "commands/screenshot.ts",
		fill: "commands/fill.ts",
		"fill-form": "commands/fill-form.ts",
		select: "commands/select.ts",
		wait: "commands/wait.ts",
		"require-human": "commands/require-human.ts",
		"tab.list": "commands/tab/list.ts",
		"tab.pin": "commands/tab/pin.ts",
		"tab.unpin": "commands/tab/unpin.ts",
		"tab.open": "commands/tab/open.ts",
		"tab.close": "commands/tab/close.ts",
		"session.create": "commands/session/create.ts",
		"session.list": "commands/session/list.ts",
		"session.bind": "commands/session/bind.ts",
		"session.unbind": "commands/session/unbind.ts",
		"session.resume": "commands/session/resume.ts",
		"session.close": "commands/session/close.ts",
		"debug.log": "commands/debug/log.ts",
		"debug.last": "commands/debug/last.ts",
		"debug.status": "commands/debug/status.ts",
	};

	it("every registered action maps to a command file that exists", () => {
		const registered = allRegisteredActions();
		for (const action of registered) {
			const commandPath = ACTION_TO_COMMAND[action];
			expect(commandPath, `Action '${action}' has no command mapping`).toBeDefined();
			const fullPath = resolve(CLI_SRC, commandPath);
			expect(
				statSync(fullPath, { throwIfNoEntry: false })?.isFile(),
				`Command file missing for '${action}': ${fullPath}`,
			).toBe(true);
		}
	});

	it("ACTION_TO_COMMAND covers exactly allRegisteredActions", () => {
		const registered = allRegisteredActions();
		const mapped = new Set(Object.keys(ACTION_TO_COMMAND));
		expect(mapped.size).toBe(registered.size);
		for (const action of registered) {
			expect(mapped.has(action), `Missing mapping for: ${action}`).toBe(true);
		}
	});

	it("every command file imports sendAction from client module", () => {
		// Service commands are exempt (they spawn a binary, not POST)
		// Doctor is exempt (diagnostic command that directly checks daemon health)
		const exemptDirs = ["service"];
		const exemptFiles = ["doctor.ts"];
		const commandFiles = collectSourceFiles(COMMANDS_DIR);
		const protocolCommands = commandFiles.filter((f) => {
			if (exemptDirs.some((d) => f.includes(`/commands/${d}/`))) return false;
			if (exemptFiles.some((name) => f.endsWith(`/commands/${name}`))) return false;
			return true;
		});

		// Filter to leaf commands (not grouping index files)
		const leafCommands = protocolCommands.filter((f) => {
			const content = readFileSync(f, "utf8");
			// Leaf commands have a run() and import sendAction
			return content.includes("async run(") && !content.includes("subCommands");
		});

		for (const file of leafCommands) {
			const content = readFileSync(file, "utf8");
			expect(
				content.includes("sendAction"),
				`Command ${file} does not import sendAction — all POST commands must use the shared client`,
			).toBe(true);
		}
	});
});

// ─── 2. No direct fetch in command modules ─────────────────────────────

describe("architecture boundary: no direct fetch in commands", () => {
	it("no command file uses globalThis.fetch or node-fetch directly", () => {
		// Doctor is exempt (diagnostic command that directly probes daemon HTTP)
		const exemptFiles = ["doctor.ts"];
		const commandFiles = collectSourceFiles(COMMANDS_DIR).filter(
			(f) => !exemptFiles.some((name) => f.endsWith(`/commands/${name}`)),
		);
		for (const file of commandFiles) {
			const content = readFileSync(file, "utf8");
			// Check for direct fetch usage (not the import from client)
			const hasFetchCall =
				content.includes("globalThis.fetch") ||
				content.includes("node-fetch") ||
				// Match bare `fetch(` but not `sendAction` or `mockFetch`
				(/(?<!mock|send|create\w{0,20})fetch\s*\(/.test(content) &&
					!content.includes('from "../client') &&
					!content.includes('from "../../client'));
			expect(
				hasFetchCall,
				`Command ${file} appears to call fetch directly — use sendAction from client.ts`,
			).toBe(false);
		}
	});
});

// ─── 3. No cross-workspace imports ─────────────────────────────────────

describe("architecture boundary: import restrictions", () => {
	it("no CLI production source imports from service/", () => {
		const sourceFiles = collectSourceFiles(CLI_SRC);
		for (const file of sourceFiles) {
			const content = readFileSync(file, "utf8");
			// Check actual import statements, not comments
			const hasServiceImport =
				/^\s*import\b[^"']*from\s+["']@bproxy\/service/m.test(content) ||
				/^\s*import\b[^"']*from\s+["'][^"']*service\/src/m.test(content) ||
				/^\s*require\s*\(\s*["']@bproxy\/service/m.test(content) ||
				/^\s*require\s*\(\s*["'][^"']*service\/src/m.test(content);
			expect(
				hasServiceImport,
				`File ${file} imports from service package — CLI must only import from shared`,
			).toBe(false);
		}
	});

	it("no CLI production source imports from extension/", () => {
		const sourceFiles = collectSourceFiles(CLI_SRC);
		for (const file of sourceFiles) {
			const content = readFileSync(file, "utf8");
			// Check actual import statements, not comments
			const hasExtensionImport =
				/^\s*import\b[^"']*from\s+["']@bproxy\/extension/m.test(content) ||
				/^\s*import\b[^"']*from\s+["'][^"']*extension\/src/m.test(content) ||
				/^\s*require\s*\(\s*["']@bproxy\/extension/m.test(content) ||
				/^\s*require\s*\(\s*["'][^"']*extension\/src/m.test(content);
			expect(
				hasExtensionImport,
				`File ${file} imports from extension package — CLI must only import from shared`,
			).toBe(false);
		}
	});
});

// ─── 4. Stdout cleanliness ─────────────────────────────────────────────

describe("stdout cleanliness", () => {
	it("success (exit 0): stdout is valid single-line JSON", async () => {
		const home = setupTempHome();
		const requestId = "test-stdout-001";
		const fetch = createMockFetch(successResponse(requestId));

		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(0);
		expect(plan.stdout).toBeDefined();
		// Must be serializable as single-line JSON
		const json = JSON.stringify(plan.stdout);
		expect(json).not.toContain("\n");
		// Must parse back to the same structure
		expect(JSON.parse(json)).toEqual(plan.stdout);
	});

	it("protocol error (exit 1): stdout is valid single-line JSON", async () => {
		const home = setupTempHome();
		const requestId = "test-stdout-002";
		const fetch = createMockFetch(errorResponse(requestId, "TIMEOUT"));

		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
		expect(plan.stdout).toBeDefined();
		const json = JSON.stringify(plan.stdout);
		expect(json).not.toContain("\n");
		expect(JSON.parse(json)).toEqual(plan.stdout);
	});

	it("usage error (exit 2): no stdout, only stderr", async () => {
		const home = setupTempHome();
		// Remove token file to trigger preflight failure
		const { unlinkSync } = await import("node:fs");
		unlinkSync(join(home, "token"));

		const requestId = "test-stdout-003";
		const fetch = createMockFetch(successResponse(requestId));

		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(2);
		expect(plan.stdout).toBeUndefined();
		expect(plan.stderr).toBeDefined();
		expect(typeof plan.stderr).toBe("string");
		expect(plan.stderr!.length).toBeGreaterThan(0);
	});

	it("success stdout contains protocol_version and ok:true", async () => {
		const home = setupTempHome();
		const requestId = "test-stdout-004";
		const fetch = createMockFetch(successResponse(requestId));

		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(0);
		const output = plan.stdout as Record<string, unknown>;
		expect(output["protocol_version"]).toBe(1);
		expect(output["ok"]).toBe(true);
		expect(output["id"]).toBe(requestId);
	});

	it("protocol error stdout contains error.code", async () => {
		const home = setupTempHome();
		const requestId = "test-stdout-005";
		const fetch = createMockFetch(errorResponse(requestId, "NO_EXTENSION"));

		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
		const output = plan.stdout as Record<string, unknown>;
		expect(output["ok"]).toBe(false);
		const error = output["error"] as Record<string, unknown>;
		expect(error["code"]).toBe("NO_EXTENSION");
	});
});

// ─── 5. Verbose mode ───────────────────────────────────────────────────

describe("verbose mode", () => {
	it("writes structured JSON to stderr when --verbose is set", async () => {
		const home = setupTempHome();
		const requestId = "test-verbose-001";
		const fetch = createMockFetch(successResponse(requestId));
		const stderrChunks: string[] = [];
		const stderr = {
			write(chunk: string) {
				stderrChunks.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WritableStream;

		await sendAction("text", {}, makeVerboseGlobals(home), { fetch, requestId, stderr });

		// Should have pre-request and post-request entries
		expect(stderrChunks.length).toBeGreaterThanOrEqual(2);
		for (const chunk of stderrChunks) {
			const parsed = JSON.parse(chunk.trim());
			expect(parsed).toHaveProperty("requestId", requestId);
			expect(parsed).toHaveProperty("action", "text");
		}
	});

	it("verbose output never contains token values", async () => {
		const home = setupTempHome();
		const requestId = "test-verbose-002";
		const fetch = createMockFetch(successResponse(requestId));
		const stderrChunks: string[] = [];
		const stderr = {
			write(chunk: string) {
				stderrChunks.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WritableStream;

		await sendAction("text", {}, makeVerboseGlobals(home), { fetch, requestId, stderr });

		const allStderr = stderrChunks.join("");
		expect(allStderr).not.toContain("test-token");
		expect(allStderr).not.toContain("Bearer");
	});

	it("verbose post-request entry includes elapsed time and httpStatus", async () => {
		const home = setupTempHome();
		const requestId = "test-verbose-003";
		const fetch = createMockFetch(successResponse(requestId));
		const stderrChunks: string[] = [];
		const stderr = {
			write(chunk: string) {
				stderrChunks.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WritableStream;

		await sendAction("text", {}, makeVerboseGlobals(home), { fetch, requestId, stderr });

		// The last entry should have elapsed and httpStatus
		const lastEntry = JSON.parse(stderrChunks.at(-1)!.trim());
		expect(lastEntry).toHaveProperty("elapsed");
		expect(typeof lastEntry.elapsed).toBe("number");
		expect(lastEntry).toHaveProperty("httpStatus", 200);
	});

	it("verbose error entry includes errorCode", async () => {
		const home = setupTempHome();
		const requestId = "test-verbose-004";
		const fetch = createMockFetch(errorResponse(requestId, "EXTENSION_TIMEOUT"));
		const stderrChunks: string[] = [];
		const stderr = {
			write(chunk: string) {
				stderrChunks.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WritableStream;

		await sendAction("text", {}, makeVerboseGlobals(home), { fetch, requestId, stderr });

		const lastEntry = JSON.parse(stderrChunks.at(-1)!.trim());
		expect(lastEntry).toHaveProperty("errorCode", "EXTENSION_TIMEOUT");
	});

	it("no verbose output when --verbose is false", async () => {
		const home = setupTempHome();
		const requestId = "test-verbose-005";
		const fetch = createMockFetch(successResponse(requestId));
		const stderrChunks: string[] = [];
		const stderr = {
			write(chunk: string) {
				stderrChunks.push(chunk);
				return true;
			},
		} as unknown as NodeJS.WritableStream;

		await sendAction("text", {}, makeGlobals(home), { fetch, requestId, stderr });

		expect(stderrChunks.length).toBe(0);
	});
});

// ─── 6. Exit code determinism ──────────────────────────────────────────

describe("exit code determinism", () => {
	it("ok:true response → exit 0", async () => {
		const home = setupTempHome();
		const requestId = "exit-001";
		const fetch = createMockFetch(successResponse(requestId));
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(0);
	});

	it("ok:false response → exit 1", async () => {
		const home = setupTempHome();
		const requestId = "exit-002";
		const fetch = createMockFetch(errorResponse(requestId, "NO_TAB"));
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(1);
	});

	it("missing token → exit 2", async () => {
		const dir = createTestStateDir("bproxy-design-test-");
		writeFileSync(join(dir, "port"), "9615", { mode: 0o644 });
		const requestId = "exit-003";
		const fetch = createMockFetch(successResponse(requestId));
		const plan = await sendAction("text", {}, makeGlobals(dir), { fetch, requestId });
		expect(plan.code).toBe(2);
	});

	it("daemon unreachable → exit 2", async () => {
		const home = setupTempHome();
		const requestId = "exit-004";
		const fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
			return Promise.reject(new Error("ECONNREFUSED"));
		}) as typeof globalThis.fetch;
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(2);
	});

	it("HTTP 401 → exit 2", async () => {
		const home = setupTempHome();
		const requestId = "exit-005";
		const fetch = createMockFetch({ error: "unauthorized" }, 401);
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(2);
	});

	it("non-JSON response → exit 2", async () => {
		const home = setupTempHome();
		const requestId = "exit-006";
		const fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
			return Promise.resolve(
				new Response("not json at all", {
					status: 200,
					headers: { "Content-Type": "text/plain" },
				}),
			);
		}) as typeof globalThis.fetch;
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(2);
	});

	it("malformed protocol response → exit 2", async () => {
		const home = setupTempHome();
		const requestId = "exit-007";
		// Valid JSON but wrong shape (missing protocol_version)
		const fetch = createMockFetch({ ok: true, data: {} });
		const plan = await sendAction("text", {}, makeGlobals(home), { fetch, requestId });
		expect(plan.code).toBe(2);
	});

	it("invalid timeout value → exit 2", async () => {
		const home = setupTempHome();
		const requestId = "exit-008";
		const fetch = createMockFetch(successResponse(requestId));
		const globals: ClientGlobalArgs = { ...makeGlobals(home), timeout: "not-a-number" };
		const plan = await sendAction("text", {}, globals, { fetch, requestId });
		expect(plan.code).toBe(2);
	});
});
