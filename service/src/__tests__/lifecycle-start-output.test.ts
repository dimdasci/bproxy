import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@bproxy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	LifecycleStartResult,
	LifecycleStatusResult,
	LifecycleStopResult,
} from "../lifecycle";
import { createTestStateDir } from "./helpers/test-state-dir";

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

function stopDaemon(home: string): Promise<number | null> {
	return new Promise((res) => {
		const child = spawn(process.execPath, [BIN, "stop"], {
			env: { ...process.env, BPROXY_HOME: home },
			stdio: "ignore",
		});
		child.once("exit", (code) => res(code));
	});
}

let home: string;
beforeEach(() => {
	home = createTestStateDir("bproxy-start-output-");
	if (!existsSync(BIN)) {
		throw new Error("Run `pnpm --filter @bproxy/service build` first");
	}
});

afterEach(async () => {
	// Best-effort cleanup
	try {
		await stopDaemon(home);
	} catch {
		/* ignore */
	}
});

describe("start output JSON shape", () => {
	it("start prints lifecycle JSON with running, pid, port, pairingCode, pairingExpiresAt", {
		timeout: 15_000,
	}, async () => {
		const child = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr!.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
		expect(code, `exit code should be 0; stderr=${stderr}`).toBe(0);

		const result = JSON.parse(stdout.trim()) as LifecycleStartResult;
		expect(result.running).toBe(true);
		expect(result.pid).toBeGreaterThan(0);
		expect(result.port).toBeGreaterThan(0);
		expect(result.port).toBeLessThanOrEqual(65535);
		expect(result.pairingCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(result.pairingExpiresAt).toBeGreaterThan(Date.now());
	});
});

describe("pairing.json file", () => {
	it("pairing.json is written with mode 0600 and contains valid metadata", {
		timeout: 15_000,
	}, async () => {
		const child = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});

		await new Promise<void>((r) => child.once("exit", () => r()));

		const pairingPath = join(home, "pairing.json");
		expect(existsSync(pairingPath)).toBe(true);

		// Check file mode
		const st = statSync(pairingPath);
		expect(st.mode & 0o777).toBe(0o600);

		// Check contents match start output
		const meta = JSON.parse(readFileSync(pairingPath, "utf8")) as {
			pairingCode: string;
			pairingExpiresAt: number;
			issuedAt: number;
		};
		const startResult = JSON.parse(stdout.trim()) as LifecycleStartResult;

		expect(meta.pairingCode).toBe(startResult.pairingCode);
		expect(meta.pairingExpiresAt).toBe(startResult.pairingExpiresAt);
		expect(meta.issuedAt).toBeGreaterThan(0);
		expect(meta.issuedAt).toBeLessThanOrEqual(meta.pairingExpiresAt);
	});

	it("pairing.json is retained after parent reads it (parent read does not delete)", {
		timeout: 15_000,
	}, async () => {
		const child = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		await new Promise<void>((r) => child.once("exit", () => r()));

		const pairingPath = join(home, "pairing.json");
		// Parent exited (it read the file), but it should still exist
		expect(existsSync(pairingPath)).toBe(true);

		// Read it again — still there
		const meta = JSON.parse(readFileSync(pairingPath, "utf8"));
		expect(meta.pairingCode).toBeDefined();
	});

	it("pairing.json is removed on daemon shutdown", { timeout: 15_000 }, async () => {
		const child = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: "ignore",
		});
		await new Promise<void>((r) => child.once("exit", () => r()));

		const pairingPath = join(home, "pairing.json");
		expect(existsSync(pairingPath)).toBe(true);

		// Stop the daemon
		await stopDaemon(home);

		// Wait for cleanup
		await new Promise<void>((resolve, reject) => {
			const start = Date.now();
			const poll = setInterval(() => {
				if (!existsSync(pairingPath)) {
					clearInterval(poll);
					resolve();
				} else if (Date.now() - start > 5000) {
					clearInterval(poll);
					reject(new Error("pairing.json not removed after stop"));
				}
			}, 50);
		});
	});
});

describe("stop output JSON shape", () => {
	it('stop prints {"running":false}', { timeout: 15_000 }, async () => {
		// Start daemon first
		const startChild = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: "ignore",
		});
		await new Promise<void>((r) => startChild.once("exit", () => r()));
		await waitForFile(join(home, "bproxy.pid"));

		// Stop with stdout capture
		const stopChild = spawn(process.execPath, [BIN, "stop"], {
			env: { ...process.env, BPROXY_HOME: home },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		stopChild.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});

		const code = await new Promise<number | null>((r) => stopChild.once("exit", (c) => r(c)));
		expect(code).toBe(0);

		const result = JSON.parse(stdout.trim()) as LifecycleStopResult;
		expect(result).toEqual({ running: false });
	});

	it('stop on already-stopped daemon prints {"running":false}', { timeout: 10_000 }, async () => {
		const stopChild = spawn(process.execPath, [BIN, "stop"], {
			env: { ...process.env, BPROXY_HOME: home },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		stopChild.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});

		const code = await new Promise<number | null>((r) => stopChild.once("exit", (c) => r(c)));
		expect(code).toBe(0);

		const result = JSON.parse(stdout.trim()) as LifecycleStopResult;
		expect(result).toEqual({ running: false });
	});
});

describe("status output JSON shape", () => {
	it("status reports {running:false} when no daemon running", () => {
		const out = spawnSync(process.execPath, [BIN, "status"], {
			env: { ...process.env, BPROXY_HOME: home },
			encoding: "utf8",
		});
		expect(out.status).toBe(0);
		const result = JSON.parse(out.stdout.trim()) as LifecycleStatusResult;
		expect(result).toMatchObject({ running: false, version: VERSION, protocolVersion: 1 });
	});

	it("status reports running:true with pid and port while daemon runs", {
		timeout: 15_000,
	}, async () => {
		const startChild = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: "ignore",
		});
		await new Promise<void>((r) => startChild.once("exit", () => r()));
		await waitForFile(join(home, "port"));

		const out = spawnSync(process.execPath, [BIN, "status"], {
			env: { ...process.env, BPROXY_HOME: home },
			encoding: "utf8",
		});
		expect(out.status).toBe(0);
		const result = JSON.parse(out.stdout.trim()) as LifecycleStatusResult;
		expect(result.running).toBe(true);
		expect(result.pid).toBeGreaterThan(0);
		expect(result.port).toBeGreaterThan(0);
		expect(result.version).toBe(VERSION);
		expect(result.protocolVersion).toBe(1);
	});

	it("status is process-liveness based: stale files do not count as running", () => {
		// Write stale PID for a non-existent process
		writeFileSync(join(home, "bproxy.pid"), "999999");
		writeFileSync(join(home, "port"), "9999");

		const out = spawnSync(process.execPath, [BIN, "status"], {
			env: { ...process.env, BPROXY_HOME: home },
			encoding: "utf8",
		});
		expect(out.status).toBe(0);
		const result = JSON.parse(out.stdout.trim()) as LifecycleStatusResult;
		expect(result.running).toBe(false);
	});
});

describe("extension-token preservation", () => {
	it("extension-token survives stop/start cycle", { timeout: 20_000 }, async () => {
		// Pre-plant an extension-token
		const extTokenPath = join(home, "extension-token");
		writeFileSync(extTokenPath, "test-ext-token-value", { mode: 0o600 });

		// Start
		const startChild = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: "ignore",
		});
		await new Promise<void>((r) => startChild.once("exit", () => r()));
		await waitForFile(join(home, "port"));

		// Stop
		await stopDaemon(home);

		// extension-token should still exist
		expect(existsSync(extTokenPath)).toBe(true);
		expect(readFileSync(extTokenPath, "utf8")).toBe("test-ext-token-value");

		// daemon token should be gone
		expect(existsSync(join(home, "token"))).toBe(false);
	});
});

describe("duplicate start failure", () => {
	it("second start while running fails with non-zero exit and clear message", {
		timeout: 15_000,
	}, async () => {
		// First start
		const start1 = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: "ignore",
		});
		await new Promise<void>((r) => start1.once("exit", () => r()));
		await waitForFile(join(home, "bproxy.pid"));

		// Second start
		const start2 = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stderr = "";
		start2.stderr!.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		const code = await new Promise<number | null>((r) => start2.once("exit", (c) => r(c)));
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/already running/i);
	});
});

describe("stale PID recovery", () => {
	it("starts cleanly with stale pid/port from a dead process", { timeout: 15_000 }, async () => {
		// Plant stale files
		writeFileSync(join(home, "bproxy.pid"), "999999");
		writeFileSync(join(home, "port"), "12345");

		const child = spawn(process.execPath, [BIN, "start"], {
			env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout!.on("data", (d: Buffer) => {
			stdout += d.toString();
		});

		const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
		expect(code).toBe(0);

		const result = JSON.parse(stdout.trim()) as LifecycleStartResult;
		expect(result.running).toBe(true);
		expect(result.port).not.toBe(12345);
		expect(result.pairingCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	});
});
