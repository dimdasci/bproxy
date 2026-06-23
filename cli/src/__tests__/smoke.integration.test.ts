/**
 * CLI integration smoke test against a real daemon.
 *
 * Proves the built CLI binary talks to the real daemon process, not just mocked fetch.
 *
 * Tests:
 * - Start a real daemon through `bproxy service start`
 * - Verify start output (pairing code, PID, port)
 * - Token file is 0600
 * - `service status` reports live PID/port
 * - `session list` returns valid JSON (daemon-local, no extension needed)
 * - `session create` + `session close` work against running daemon
 * - `debug status` returns daemon status
 * - `debug last` returns request history
 * - Forwarded action via mock WS client (session create → tab open → text → verify response)
 * - Stop through CLI, verify status becomes running:false
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../types.js";
import { createTestStateDir } from "./helpers/test-state-dir.js";

// ─── Constants ─────────────────────────────────────────────────────────

const CLI_BIN = resolve(import.meta.dirname, "../../dist/bproxy.mjs");
const SERVICE_BIN = resolve(import.meta.dirname, "../../../service/dist/index.mjs");

// ─── Pre-flight ────────────────────────────────────────────────────────

beforeAll(() => {
	if (!existsSync(CLI_BIN)) {
		throw new Error(`CLI binary not found at ${CLI_BIN}. Run: pnpm --filter @bproxy/cli build`);
	}
	if (!existsSync(SERVICE_BIN)) {
		throw new Error(
			`Service binary not found at ${SERVICE_BIN}. Run: pnpm --filter @bproxy/service build`,
		);
	}
});

// ─── Helpers ───────────────────────────────────────────────────────────

function cleanEnv(): NodeJS.ProcessEnv {
	return {
		PATH: process.env["PATH"],
		HOME: process.env["HOME"],
		USER: process.env["USER"],
		SHELL: process.env["SHELL"],
		LANG: process.env["LANG"],
		BPROXY_PORT: "0",
	};
}

function runCli(
	args: string[],
	home: string,
	timeoutMs = 10_000,
): { stdout: string; stderr: string; exitCode: number } {
	try {
		const stdout = execSync(`node ${CLI_BIN} ${args.join(" ")} --home ${home}`, {
			encoding: "utf8",
			timeout: timeoutMs,
			env: { ...cleanEnv(), BPROXY_HOME: home },
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; status?: number };
		return {
			stdout: (e.stdout ?? "").trim(),
			stderr: (e.stderr ?? "").trim(),
			exitCode: e.status ?? 1,
		};
	}
}

function parseJson(s: string): unknown {
	return JSON.parse(s);
}

function runCliAsync(
	args: string[],
	home: string,
	timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve) => {
		const child = spawn("node", [CLI_BIN, ...args, "--home", home], {
			env: { ...cleanEnv(), BPROXY_HOME: home },
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 124 });
		}, timeoutMs);

		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
		});
	});
}

// ─── Lifecycle tests (no extension) ───────────────────────────────────

describe("CLI integration smoke", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = createTestStateDir("bproxy-smoke-");
		// Relax safety guards so sequential CLI calls don't hit minInterval rejection
		writeFileSync(
			join(tempHome, "config.json"),
			JSON.stringify({
				pacing: {
					human: {
						navigate: { min: 1, max: 2 },
						scroll: { min: 1, max: 2 },
						interaction: { min: 1, max: 2 },
						fill: { min: 1, max: 2 },
					},
					fast: {
						navigate: { min: 1, max: 2 },
						scroll: { min: 1, max: 2 },
						interaction: { min: 1, max: 2 },
						fill: { min: 1, max: 2 },
					},
				},
				safety: {
					minInterval: { ms: 1 },
					rateCap: { requestsPerMinute: 600 },
					errorDelay: { minMs: 1, maxMs: 1 },
					metronome: { tolerance: 0.1, consecutiveEqual: 100, maxIntervalMs: 60000 },
				},
			}),
		);
	});

	afterEach(async () => {
		// Ensure daemon is stopped
		try {
			runCli(["service", "stop"], tempHome);
		} catch {
			// best effort
		}
		await new Promise((r) => setTimeout(r, 300));
		try {
			rmSync(tempHome, { recursive: true, force: true });
		} catch {
			// best effort
		}
	});

	it("service start produces JSON with pairing code, PID, and port", () => {
		const result = runCli(["service", "start"], tempHome);
		expect(result.exitCode).toBe(0);

		const parsed = parseJson(result.stdout) as Record<string, unknown>;
		expect(parsed["running"]).toBe(true);
		expect(typeof parsed["pid"]).toBe("number");
		expect(parsed["pid"]).toBeGreaterThan(0);
		expect(typeof parsed["port"]).toBe("number");
		expect(parsed["port"]).toBeGreaterThan(0);
		expect(typeof parsed["pairingCode"]).toBe("string");
		expect((parsed["pairingCode"] as string).length).toBeGreaterThan(0);
		expect(typeof parsed["pairingExpiresAt"]).toBe("number");
	});

	it("token file is created with mode 0600", () => {
		runCli(["service", "start"], tempHome);
		const tokenPath = join(tempHome, "token");
		expect(existsSync(tokenPath)).toBe(true);
		const stats = statSync(tokenPath);
		expect(stats.mode & 0o777).toBe(0o600);
	});

	it("service status reports running PID and port", () => {
		const startResult = runCli(["service", "start"], tempHome);
		const started = parseJson(startResult.stdout) as Record<string, unknown>;

		const statusResult = runCli(["service", "status"], tempHome);
		expect(statusResult.exitCode).toBe(0);

		const status = parseJson(statusResult.stdout) as Record<string, unknown>;
		expect(status["running"]).toBe(true);
		expect(status["pid"]).toBe(started["pid"]);
		expect(status["port"]).toBe(started["port"]);
	});

	it("session list returns valid JSON without extension", () => {
		runCli(["service", "start"], tempHome);

		const result = runCli(["session", "list", "-n", "halbot"], tempHome);
		expect(result.exitCode).toBe(0);

		const parsed = parseJson(result.stdout) as Record<string, unknown>;
		expect(parsed["ok"]).toBe(true);
		expect(parsed["protocol_version"]).toBe(PROTOCOL_VERSION);
		const data = parsed["data"] as Record<string, unknown>;
		expect(Array.isArray(data["sessions"])).toBe(true);
	});

	it("session create and close work against running daemon", () => {
		runCli(["service", "start"], tempHome);

		const createResult = runCli(
			["session", "create", "-n", "halbot", "--label", "research"],
			tempHome,
		);
		expect(createResult.exitCode).toBe(0);
		const createParsed = parseJson(createResult.stdout) as Record<string, unknown>;
		expect(createParsed["ok"]).toBe(true);
		const createData = createParsed["data"] as Record<string, unknown>;
		expect(createData["session"]).toMatch(/^[a-z2-7]{6}$/);
		expect(createData["label"]).toBe("research");

		const sessionId = createData["session"] as string;
		const closeResult = runCli(["session", "close", "-n", "halbot", "-s", sessionId], tempHome);
		expect(closeResult.exitCode).toBe(0);
		const closeParsed = parseJson(closeResult.stdout) as Record<string, unknown>;
		expect(closeParsed["ok"]).toBe(true);
		const closeData = closeParsed["data"] as Record<string, unknown>;
		expect(closeData["session"]).toBe(sessionId);
	});

	it("debug status returns daemon info without extension", () => {
		runCli(["service", "start"], tempHome);

		const result = runCli(["status", "-n", "halbot"], tempHome);
		expect(result.exitCode).toBe(0);

		const parsed = parseJson(result.stdout) as Record<string, unknown>;
		expect(parsed["ok"]).toBe(true);
		const data = parsed["data"] as Record<string, unknown>;
		const daemon = data["daemon"] as Record<string, unknown>;
		expect(typeof daemon["pid"]).toBe("number");
		expect(typeof daemon["port"]).toBe("number");
		expect(typeof daemon["uptimeSec"]).toBe("number");
	});

	it("debug last returns valid response structure", () => {
		runCli(["service", "start"], tempHome);

		const result = runCli(["debug", "last", "-n", "halbot", "--count", "5"], tempHome);
		expect(result.exitCode).toBe(0);

		const parsed = parseJson(result.stdout) as Record<string, unknown>;
		expect(parsed["ok"]).toBe(true);
		expect(parsed["protocol_version"]).toBe(PROTOCOL_VERSION);
		const data = parsed["data"] as Record<string, unknown>;
		expect(Array.isArray(data["requests"])).toBe(true);
	});

	it("service stop makes status return running:false", () => {
		runCli(["service", "start"], tempHome);

		const stopResult = runCli(["service", "stop"], tempHome);
		expect(stopResult.exitCode).toBe(0);
		const stopParsed = parseJson(stopResult.stdout) as Record<string, unknown>;
		expect(stopParsed["running"]).toBe(false);

		const statusResult = runCli(["service", "status"], tempHome);
		expect(statusResult.exitCode).toBe(0);
		const statusParsed = parseJson(statusResult.stdout) as Record<string, unknown>;
		expect(statusParsed["running"]).toBe(false);
	});

	it("forwarded action via mock WS client", async () => {
		// Start daemon
		const startResult = runCli(["service", "start"], tempHome);
		expect(startResult.exitCode).toBe(0);
		const started = parseJson(startResult.stdout) as Record<string, unknown>;
		const port = started["port"] as number;
		const pairingCode = started["pairingCode"] as string;

		// Claim pairing code to get extension token
		const claimRes = await fetch(`http://127.0.0.1:${port}/pair/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "chrome-extension://test" },
			body: JSON.stringify({ code: pairingCode }),
		});
		expect(claimRes.status).toBe(200);
		const claimBody = (await claimRes.json()) as {
			ok: boolean;
			data: { extensionToken: string };
		};
		expect(claimBody.ok).toBe(true);
		const extensionToken = claimBody.data.extensionToken;

		// Connect mock WS client
		const auth = Buffer.from(extensionToken).toString("base64url");
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
			headers: { Origin: "chrome-extension://test" },
		});

		await new Promise<void>((resolve, reject) => {
			ws.once("open", () => resolve());
			ws.once("error", reject);
		});

		// Set up WS to respond to forwarded requests
		ws.on("message", (raw: unknown) => {
			const req = JSON.parse(String(raw)) as Record<string, unknown>;
			if (req["protocol_version"] !== PROTOCOL_VERSION) return;
			if (req["action"] === "tab.open") {
				ws.send(
					JSON.stringify({
						protocol_version: PROTOCOL_VERSION,
						id: req["id"],
						ok: true,
						data: { tabId: 99, url: "https://example.com" },
						page: {
							url: "https://example.com",
							title: "Mock",
							state: "ready",
							busy: false,
						},
						replay: false,
					}),
				);
				return;
			}
			ws.send(
				JSON.stringify({
					protocol_version: PROTOCOL_VERSION,
					id: req["id"],
					ok: true,
					data: { text: "mock-response-text" },
					page: { url: "https://example.com", title: "Mock", state: "ready", busy: false },
					replay: false,
				}),
			);
		});

		const createResult = runCli(["session", "create", "-n", "halbot"], tempHome);
		expect(createResult.exitCode).toBe(0);
		const createParsed = parseJson(createResult.stdout) as Record<string, unknown>;
		const sessionId = (createParsed["data"] as Record<string, unknown>)["session"] as string;

		const openResult = await runCliAsync(
			["tab", "open", "-n", "halbot", "-s", sessionId, "--url", "https://example.com"],
			tempHome,
			10_000,
		);
		expect(openResult.exitCode).toBe(0);

		// Send a forwarded read command (text) using async spawn
		const textResult = await runCliAsync(
			["text", "-n", "halbot", "-s", sessionId],
			tempHome,
			10_000,
		);
		expect(textResult.exitCode).toBe(0);

		const textParsed = parseJson(textResult.stdout) as Record<string, unknown>;
		expect(textParsed["ok"]).toBe(true);
		const textData = textParsed["data"] as Record<string, unknown>;
		expect(textData["text"]).toBe("mock-response-text");

		ws.close();
	});
});
