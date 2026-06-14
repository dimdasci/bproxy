import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { readExtensionToken, writeExtensionToken, writeToken } from "../lifecycle";
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

async function runDaemonized(home: string, signal: "SIGTERM" | "SIGINT"): Promise<void> {
	const child = spawn(process.execPath, [BIN, "daemonize"], {
		env: { ...process.env, BPROXY_HOME: home, BPROXY_PORT: "0" },
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stderr = "";
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	child.stdout?.resume();

	let exitCode: number | null = null;
	const exitPromise = new Promise<number | null>((r) => {
		child.once("exit", (c) => {
			exitCode = c;
			r(c);
		});
	});

	await waitForFile(join(home, "port"));
	const port = Number.parseInt(readFileSync(join(home, "port"), "utf8"), 10);
	expect(port).toBeGreaterThan(0);

	if (exitCode === null) {
		child.kill(signal);
	}
	const code = await exitPromise;
	expect(code, `daemon exited ${code} after ${signal}; stderr=${stderr}`).toBe(0);
}

let home: string;
beforeEach(() => {
	home = createTestStateDir("bproxy-test-");
});

describe("lifecycle smoke", () => {
	it("daemonize listens, writes port, and exits 0 on SIGTERM", { timeout: 15_000 }, async () => {
		expect(existsSync(BIN), "Run `pnpm --filter @bproxy/service build` first").toBe(true);
		await runDaemonized(home, "SIGTERM");
	});

	it("daemonize also exits 0 on SIGINT (Ctrl-C)", { timeout: 15_000 }, async () => {
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

describe("token-file security (auth-gate invariant)", () => {
	it("writes the token with mode 0600", () => {
		writeToken({ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" });
		const st = statSync(join(home, "token"));
		expect(st.mode & 0o777).toBe(0o600);
	});

	it("refuses to start with INSECURE_TOKEN_FILE when an existing token is world-readable", () => {
		const tokenPath = join(home, "token");
		writeFileSync(tokenPath, "deadbeef", { mode: 0o644 });
		chmodSync(tokenPath, 0o644);
		expect(() =>
			writeToken({ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" }),
		).toThrow(/INSECURE_TOKEN_FILE/);
	});

	it("writes extension-token with mode 0600", () => {
		writeExtensionToken(
			{ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" },
			"ext-token",
		);
		const st = statSync(join(home, "extension-token"));
		expect(st.mode & 0o777).toBe(0o600);
	});

	it("refuses INSECURE_EXTENSION_TOKEN_FILE when existing extension-token is world-readable", () => {
		const tokenPath = join(home, "extension-token");
		writeFileSync(tokenPath, "deadbeef", { mode: 0o644 });
		chmodSync(tokenPath, 0o644);
		expect(() =>
			writeExtensionToken(
				{ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" },
				"ext-token",
			),
		).toThrow(/INSECURE_EXTENSION_TOKEN_FILE/);
	});

	it("reads persisted extension-token when mode/owner are secure", () => {
		writeExtensionToken(
			{ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" },
			"persisted-ext-token",
		);
		const token = readExtensionToken({
			stateDir: home,
			host: "127.0.0.1",
			port: 9615,
			logLevel: "info",
		});
		expect(token).toBe("persisted-ext-token");
	});

	it("refuses reading insecure extension-token file", () => {
		const tokenPath = join(home, "extension-token");
		writeFileSync(tokenPath, "persisted-ext-token", { mode: 0o644 });
		chmodSync(tokenPath, 0o644);
		expect(() =>
			readExtensionToken({ stateDir: home, host: "127.0.0.1", port: 9615, logLevel: "info" }),
		).toThrow(/INSECURE_EXTENSION_TOKEN_FILE/);
	});
});
