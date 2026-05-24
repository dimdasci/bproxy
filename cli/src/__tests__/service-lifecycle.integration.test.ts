/**
 * Integration tests for service lifecycle commands.
 *
 * Uses the real built service binary in a temp BPROXY_HOME.
 * Requires: `pnpm --filter @bproxy/service build` to have been run.
 *
 * Tests:
 * - start produces correct JSON with pairing code
 * - duplicate start fails with exit 2
 * - status reports running state (token-free)
 * - stop prints {"running":false}
 * - stale PID cleanup
 * - token file mode
 * - extension-token preservation across stop/start
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execServiceBinary } from "../service-binary.js";

// ─── Test setup ────────────────────────────────────────────────────────

const SERVICE_BIN = resolve(import.meta.dirname, "../../../service/dist/index.mjs");

// Check service binary exists before running tests
beforeAll(() => {
	if (!existsSync(SERVICE_BIN)) {
		throw new Error(
			`Service binary not found at ${SERVICE_BIN}. Run: pnpm --filter @bproxy/service build`,
		);
	}
});

describe("service lifecycle integration", () => {
	let tempHome: string;
	let childEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "bproxy-svc-integ-"));
		childEnv = {
			...process.env,
			BPROXY_HOME: tempHome,
			BPROXY_PORT: "0", // random port
		};
		// Remove test-related env vars that might interfere
		delete childEnv["TEST"];
		delete childEnv["VITEST"];
		delete childEnv["NODE_ENV"];
	});

	afterEach(async () => {
		// Ensure daemon is stopped
		try {
			await execServiceBinary(SERVICE_BIN, "stop", childEnv, 10_000);
		} catch {
			// best effort
		}
		// Wait briefly for cleanup
		await new Promise((r) => setTimeout(r, 200));
		try {
			rmSync(tempHome, { recursive: true, force: true });
		} catch {
			// best effort
		}
	});

	it("start produces JSON with running, pid, port, pairingCode, pairingExpiresAt", async () => {
		const result = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const parsed = JSON.parse(result.stdout);
		expect(parsed.running).toBe(true);
		expect(typeof parsed.pid).toBe("number");
		expect(parsed.pid).toBeGreaterThan(0);
		expect(typeof parsed.port).toBe("number");
		expect(parsed.port).toBeGreaterThan(0);
		expect(typeof parsed.pairingCode).toBe("string");
		expect(parsed.pairingCode.length).toBeGreaterThan(0);
		expect(typeof parsed.pairingExpiresAt).toBe("number");
		expect(parsed.pairingExpiresAt).toBeGreaterThan(Date.now());
	});

	it("start creates token file with mode 0600", async () => {
		const result = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(result.ok).toBe(true);

		const tokenPath = join(tempHome, "token");
		expect(existsSync(tokenPath)).toBe(true);

		const stats = statSync(tokenPath);
		expect(stats.mode & 0o777).toBe(0o600);
	});

	it("duplicate start fails clearly", async () => {
		const first = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(first.ok).toBe(true);

		const second = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.stderr).toContain("already running");
		}
	});

	it("status reports running state without token", async () => {
		const startResult = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(startResult.ok).toBe(true);
		if (!startResult.ok) return;
		const startParsed = JSON.parse(startResult.stdout);

		const statusResult = await execServiceBinary(SERVICE_BIN, "status", childEnv, 5_000);
		expect(statusResult.ok).toBe(true);
		if (!statusResult.ok) return;

		const parsed = JSON.parse(statusResult.stdout);
		expect(parsed.running).toBe(true);
		expect(parsed.pid).toBe(startParsed.pid);
		expect(parsed.port).toBe(startParsed.port);
	});

	it("status reports not running when daemon is stopped", async () => {
		const result = await execServiceBinary(SERVICE_BIN, "status", childEnv, 5_000);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const parsed = JSON.parse(result.stdout);
		expect(parsed.running).toBe(false);
	});

	it("stop prints {running:false} on success", async () => {
		const startResult = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(startResult.ok).toBe(true);

		const stopResult = await execServiceBinary(SERVICE_BIN, "stop", childEnv, 10_000);
		expect(stopResult.ok).toBe(true);
		if (!stopResult.ok) return;

		const parsed = JSON.parse(stopResult.stdout);
		expect(parsed.running).toBe(false);
	});

	it("stop removes transient state files (pid, port, token) but not extension-token", async () => {
		// Pre-create an extension-token to ensure preservation
		const extTokenPath = join(tempHome, "extension-token");
		writeFileSync(extTokenPath, "preserved-ext-token", { mode: 0o600 });

		const startResult = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(startResult.ok).toBe(true);

		const stopResult = await execServiceBinary(SERVICE_BIN, "stop", childEnv, 10_000);
		expect(stopResult.ok).toBe(true);

		// Transient files should be gone
		expect(existsSync(join(tempHome, "bproxy.pid"))).toBe(false);
		expect(existsSync(join(tempHome, "port"))).toBe(false);
		expect(existsSync(join(tempHome, "token"))).toBe(false);

		// Extension token should be preserved
		expect(existsSync(extTokenPath)).toBe(true);
		expect(readFileSync(extTokenPath, "utf8")).toBe("preserved-ext-token");
	});

	it("stale PID file is cleaned up on status", async () => {
		// Write a PID file with a non-existent PID
		writeFileSync(join(tempHome, "bproxy.pid"), "999999999");

		const result = await execServiceBinary(SERVICE_BIN, "status", childEnv, 5_000);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const parsed = JSON.parse(result.stdout);
		expect(parsed.running).toBe(false);

		// Stale PID file should be cleaned
		expect(existsSync(join(tempHome, "bproxy.pid"))).toBe(false);
	});

	it("stale PID is cleaned and new start succeeds", async () => {
		// Write a PID file with a non-existent PID
		writeFileSync(join(tempHome, "bproxy.pid"), "999999999");

		const result = await execServiceBinary(SERVICE_BIN, "start", childEnv, 10_000);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const parsed = JSON.parse(result.stdout);
		expect(parsed.running).toBe(true);
		expect(parsed.pid).not.toBe(999999999);
	});
});
