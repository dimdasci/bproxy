import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

function waitForState(home: string, expectedRunning: boolean, timeoutMs = 5000): Promise<void> {
	return new Promise((resolveOK, reject) => {
		const start = Date.now();
		const poll = setInterval(() => {
			const pidPath = join(home, "bproxy.pid");
			if (existsSync(pidPath) === expectedRunning) {
				clearInterval(poll);
				resolveOK();
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(poll);
				reject(new Error(`timeout waiting for running=${expectedRunning}`));
			}
		}, 100);
	});
}

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "bproxy-contract-"));
	if (!existsSync(BIN)) {
		throw new Error("Run `pnpm --filter @bproxy/service build` first");
	}
});

describe("lifecycle contract - GAP E", () => {
	describe("start/stop sequence", () => {
		it("start -> status -> stop -> status gives expected state transitions", {
			timeout: 20000,
		}, async () => {
			let out = spawnSync(process.execPath, [BIN, "status"], {
				env: { ...process.env, BPROXY_HOME: home },
				encoding: "utf8",
			});
			expect(out.status).toBe(0);
			let parsed = JSON.parse(out.stdout) as { running: boolean; pid?: number; port?: number };
			expect(parsed.running).toBe(false);

			const startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));
			expect(startChild.exitCode).toBe(0);

			await waitForFile(join(home, "bproxy.pid"), 5000);
			await waitForFile(join(home, "port"), 5000);

			out = spawnSync(process.execPath, [BIN, "status"], {
				env: { ...process.env, BPROXY_HOME: home },
				encoding: "utf8",
			});
			expect(out.status).toBe(0);
			parsed = JSON.parse(out.stdout) as { running: boolean; pid?: number; port?: number };
			expect(parsed.running).toBe(true);
			expect(parsed.pid).toBeGreaterThan(0);
			expect(parsed.port).toBeGreaterThan(0);

			const stopChild = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: "ignore",
			});
			await new Promise((resolve) => stopChild.once("exit", resolve));
			await waitForState(home, false, 5000);

			out = spawnSync(process.execPath, [BIN, "status"], {
				env: { ...process.env, BPROXY_HOME: home },
				encoding: "utf8",
			});
			expect(out.status).toBe(0);
			parsed = JSON.parse(out.stdout) as { running: boolean };
			expect(parsed.running).toBe(false);
		});

		it("start fails cleanly when daemon already running", { timeout: 20000 }, async () => {
			let startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));
			expect(startChild.exitCode).toBe(0);

			await waitForFile(join(home, "bproxy.pid"), 5000);

			startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: ["ignore", "pipe", "pipe"],
			});

			const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
				(resolve) => {
					let stdout = "";
					let stderr = "";
					if (startChild.stdout)
						startChild.stdout.on("data", (d) => {
							stdout += String(d);
						});
					if (startChild.stderr)
						startChild.stderr.on("data", (d) => {
							stderr += String(d);
						});
					startChild.once("exit", (code) => resolve({ stdout, stderr, code }));
				},
			);

			expect(output.code).not.toBe(0);
			expect(output.stdout + output.stderr).toMatch(/already running|locked|in use/i);

			const stopChild = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: "ignore",
			});
			await new Promise((resolve) => stopChild.once("exit", resolve));
		});
	});

	describe("file semantics", () => {
		it("lockfile exists while daemon is running", { timeout: 15000 }, async () => {
			const startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));
			expect(startChild.exitCode).toBe(0);

			await waitForFile(join(home, "bproxy.pid"), 5000);
			expect(existsSync(join(home, "bproxy.pid"))).toBe(true);

			spawnSync(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: "pipe",
			});

			await waitForState(home, false, 5000);
			expect(existsSync(join(home, "bproxy.pid"))).toBe(false);
		});

		it("port file contains valid port number", { timeout: 15000 }, async () => {
			const startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));
			expect(startChild.exitCode).toBe(0);

			await waitForFile(join(home, "port"), 5000);
			const port = Number.parseInt(readFileSync(join(home, "port"), "utf8"), 10);
			expect(port).toBeGreaterThan(0);
			expect(port).toBeLessThan(65536);

			const stopChild = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: "ignore",
			});
			await new Promise((resolve) => stopChild.once("exit", resolve));
		});

		it("token file is created and readable only by owner", { timeout: 15000 }, async () => {
			const startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));
			expect(startChild.exitCode).toBe(0);

			await waitForFile(join(home, "token"), 5000);
			expect(existsSync(join(home, "token"))).toBe(true);

			const token = readFileSync(join(home, "token"), "utf8");
			expect(token.length).toBeGreaterThan(0);

			const stopChild = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: "ignore",
			});
			await new Promise((resolve) => stopChild.once("exit", resolve));
		});
	});

	describe("stop semantics", () => {
		it("stop succeeds when daemon is running", { timeout: 15000 }, async () => {
			const startChild = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => startChild.once("exit", resolve));

			await waitForFile(join(home, "bproxy.pid"), 5000);

			const stopChild = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home },
				stdio: ["ignore", "pipe", "pipe"],
			});

			const code = await new Promise<number | null>((r) => stopChild.once("exit", (c) => r(c)));
			expect(code).toBe(0);
		});
	});

	describe("state directory isolation", () => {
		it("different BPROXY_HOME values are isolated", { timeout: 20000 }, async () => {
			const home1 = mkdtempSync(join(tmpdir(), "bproxy-isolated-1-"));
			const home2 = mkdtempSync(join(tmpdir(), "bproxy-isolated-2-"));

			const start1 = spawn(process.execPath, [BIN, "start"], {
				env: { ...process.env, BPROXY_HOME: home1, BPROXY_PORT: "0" },
				stdio: "ignore",
			});
			await new Promise((resolve) => start1.once("exit", resolve));
			await waitForFile(join(home1, "bproxy.pid"), 5000);

			const out2 = spawnSync(process.execPath, [BIN, "status"], {
				env: { ...process.env, BPROXY_HOME: home2 },
				encoding: "utf8",
			});
			const parsed2 = JSON.parse(out2.stdout) as { running: boolean };
			expect(parsed2.running).toBe(false);

			const out1 = spawnSync(process.execPath, [BIN, "status"], {
				env: { ...process.env, BPROXY_HOME: home1 },
				encoding: "utf8",
			});
			const parsed1 = JSON.parse(out1.stdout) as { running: boolean };
			expect(parsed1.running).toBe(true);

			const stop1 = spawn(process.execPath, [BIN, "stop"], {
				env: { ...process.env, BPROXY_HOME: home1 },
				stdio: "ignore",
			});
			await new Promise((resolve) => stop1.once("exit", resolve));
		});
	});
});
