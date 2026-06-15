/**
 * Tests for service lifecycle commands.
 *
 * Tests the service-binary module's resolution logic and the exec function.
 * Integration tests (with actual daemon) are in a separate file.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execServiceBinary, resolveServiceBinary } from "../service-binary.js";

// ─── resolveServiceBinary ──────────────────────────────────────────────

describe("resolveServiceBinary", () => {
	it("returns BPROXY_SERVICE_BIN if set and file exists", () => {
		const result = resolveServiceBinary({
			env: { BPROXY_SERVICE_BIN: "/custom/path/service.mjs" },
			existsSync: (p) => p === "/custom/path/service.mjs",
			which: () => null,
		});
		expect(result).toBe("/custom/path/service.mjs");
	});

	it("ignores BPROXY_SERVICE_BIN if file does not exist", () => {
		const result = resolveServiceBinary({
			env: { BPROXY_SERVICE_BIN: "/missing/service.mjs" },
			existsSync: () => false,
			which: () => null,
		});
		expect(result).toBeNull();
	});

	it("ignores empty BPROXY_SERVICE_BIN", () => {
		const result = resolveServiceBinary({
			env: { BPROXY_SERVICE_BIN: "" },
			existsSync: () => false,
			which: () => null,
		});
		expect(result).toBeNull();
	});

	it("falls back to bproxy-service on PATH", () => {
		const result = resolveServiceBinary({
			env: {},
			existsSync: () => false,
			which: (name) => (name === "bproxy-service" ? "/usr/local/bin/bproxy-service" : null),
		});
		expect(result).toBe("/usr/local/bin/bproxy-service");
	});

	it("returns null when nothing found", () => {
		const result = resolveServiceBinary({
			env: {},
			existsSync: () => false,
			which: () => null,
		});
		expect(result).toBeNull();
	});

	it("prefers BPROXY_SERVICE_BIN over all others", () => {
		const result = resolveServiceBinary({
			env: { BPROXY_SERVICE_BIN: "/override/service.mjs" },
			existsSync: () => true,
			which: () => "/usr/local/bin/bproxy-service",
		});
		expect(result).toBe("/override/service.mjs");
	});

	it("finds sibling bproxy-service.mjs next to CLI binary when workspace miss", () => {
		// When existsSync returns true for all paths, workspace will match first.
		// To test sibling specifically, we need workspace candidates to miss.
		// The sibling path ends with "bproxy-service.mjs" in the same dir as the running file.
		const result = resolveServiceBinary({
			env: {},
			existsSync: (p) => p.endsWith("bproxy-service.mjs") && !p.includes("service/dist"),
			which: () => null,
		});
		// Should resolve the sibling before falling through to PATH
		expect(result).not.toBeNull();
		expect(result).toMatch(/bproxy-service\.mjs$/);
	});

	it("prefers workspace resolution over sibling", () => {
		const result = resolveServiceBinary({
			env: {},
			existsSync: (p) => p.includes("service/dist/index.mjs") || p.endsWith("bproxy-service.mjs"),
			which: () => null,
		});
		// Should pick workspace (contains service/dist/index.mjs) over sibling
		expect(result).toMatch(/service\/dist\/index\.mjs$/);
	});

	it("prefers sibling over PATH lookup", () => {
		const result = resolveServiceBinary({
			env: {},
			existsSync: (p) => p.endsWith("bproxy-service.mjs") && !p.includes("service/dist"),
			which: () => "/usr/local/bin/bproxy-service",
		});
		// Should pick sibling over PATH
		expect(result).toMatch(/bproxy-service\.mjs$/);
		expect(result).not.toBe("/usr/local/bin/bproxy-service");
	});
});

// ─── execServiceBinary ─────────────────────────────────────────────────

const TEST_TMP = join(__dirname, "../../.tmp");

function writeTempScript(content: string): string {
	mkdirSync(TEST_TMP, { recursive: true });
	const dir = mkdtempSync(join(TEST_TMP, "svc-test-"));
	const scriptPath = join(dir, "service.mjs");
	writeFileSync(scriptPath, content, { mode: 0o755 });
	return scriptPath;
}

describe("execServiceBinary", () => {
	it("returns ok with stdout when script exits 0", async () => {
		const script = writeTempScript(`
			const cmd = process.argv[2];
			process.stdout.write(JSON.stringify({ running: true, pid: 123, port: 9615 }));
			process.exit(0);
		`);

		const result = await execServiceBinary(script, "start", { ...process.env }, 5000);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(JSON.parse(result.stdout)).toEqual({ running: true, pid: 123, port: 9615 });
		}
	});

	it("returns error with stderr when script exits non-zero", async () => {
		const script = writeTempScript(`
			process.stderr.write("daemon already running (pid 456)");
			process.exit(1);
		`);

		const result = await execServiceBinary(script, "start", { ...process.env }, 5000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("daemon already running");
		}
	});

	it("passes environment variables to child process", async () => {
		const script = writeTempScript(`
			process.stdout.write(JSON.stringify({
				home: process.env.BPROXY_HOME,
				port: process.env.BPROXY_PORT,
			}));
			process.exit(0);
		`);

		const result = await execServiceBinary(
			script,
			"start",
			{
				...process.env,
				BPROXY_HOME: "/home/testuser/.bproxy",
				BPROXY_PORT: "8080",
			},
			5000,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const parsed = JSON.parse(result.stdout);
			expect(parsed.home).toBe("/home/testuser/.bproxy");
			expect(parsed.port).toBe("8080");
		}
	});

	it("passes the command as second arg to the script", async () => {
		const script = writeTempScript(`
			process.stdout.write(JSON.stringify({ cmd: process.argv[2] }));
			process.exit(0);
		`);

		const result = await execServiceBinary(script, "status", { ...process.env }, 5000);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(JSON.parse(result.stdout).cmd).toBe("status");
		}
	});

	it("times out and returns error for stuck processes", async () => {
		const script = writeTempScript(`
			// Simulate a hung process
			setTimeout(() => {}, 60000);
		`);

		const result = await execServiceBinary(script, "start", { ...process.env }, 200);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.stderr).toContain("timed out");
		}
	});

	it("returns error when binary path does not exist", async () => {
		const result = await execServiceBinary(
			"/nonexistent/path/service.mjs",
			"start",
			{ ...process.env },
			5000,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.exitCode).toBeGreaterThan(0);
			expect(result.stderr.length).toBeGreaterThan(0);
		}
	});

	it("returns stdout as error context when stderr is empty", async () => {
		const script = writeTempScript(`
			process.stdout.write("usage: bproxy-service <start|stop|status>");
			process.exit(2);
		`);

		const result = await execServiceBinary(script, "invalid", { ...process.env }, 5000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.stderr).toContain("usage");
		}
	});
});
