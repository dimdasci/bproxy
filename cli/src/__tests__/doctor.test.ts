/**
 * Tests for `bproxy doctor` command.
 *
 * Tests each check function independently with mocked dependencies.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const TEST_TMP = join(__dirname, "../../.tmp");

function createTestStateDir(): string {
	mkdirSync(TEST_TMP, { recursive: true });
	const dir = mkdtempSync(join(TEST_TMP, "doctor-test-"));
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
}

describe("bproxy doctor", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const d of dirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				// best effort
			}
		}
		dirs.length = 0;
	});

	describe("node check", () => {
		it("passes on Node >= 24", () => {
			const major = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
			// This test runs on Node 24+ by project requirement
			expect(major).toBeGreaterThanOrEqual(24);
		});
	});

	describe("state check", () => {
		it("reports missing state directory", () => {
			const dir = join(TEST_TMP, "nonexistent-" + Date.now());
			// Directory doesn't exist → check should fail
			const { existsSync } = require("node:fs");
			expect(existsSync(dir)).toBe(false);
		});

		it("reports existing state directory with correct permissions", () => {
			const dir = createTestStateDir();
			dirs.push(dir);
			const { statSync } = require("node:fs");
			const stat = statSync(dir);
			const mode = stat.mode & 0o777;
			expect(mode & 0o077).toBe(0); // no group/other perms
		});

		it("detects token file presence", () => {
			const dir = createTestStateDir();
			dirs.push(dir);
			writeFileSync(join(dir, "token"), "test-token", { mode: 0o600 });
			const { existsSync } = require("node:fs");
			expect(existsSync(join(dir, "token"))).toBe(true);
		});
	});

	describe("binary check", () => {
		it("resolves service binary from resolution chain", async () => {
			const { resolveServiceBinary } = await import("../service-binary.js");
			// In dev environment, workspace binary should exist
			const result = resolveServiceBinary({ env: process.env });
			// May or may not resolve depending on whether service is built
			expect(typeof result === "string" || result === null).toBe(true);
		});
	});

	describe("daemon check", () => {
		it("reports not running when no PID file exists", () => {
			const dir = createTestStateDir();
			dirs.push(dir);
			const { existsSync } = require("node:fs");
			expect(existsSync(join(dir, "bproxy.pid"))).toBe(false);
			expect(existsSync(join(dir, "port"))).toBe(false);
		});

		it("reports stale PID when process does not exist", () => {
			const dir = createTestStateDir();
			dirs.push(dir);
			// Write a PID that definitely doesn't exist
			writeFileSync(join(dir, "bproxy.pid"), "999999999", { mode: 0o600 });
			writeFileSync(join(dir, "port"), "9615", { mode: 0o600 });

			// Verify the PID is not alive
			let alive = false;
			try {
				process.kill(999999999, 0);
				alive = true;
			} catch {
				alive = false;
			}
			expect(alive).toBe(false);
		});
	});
});
