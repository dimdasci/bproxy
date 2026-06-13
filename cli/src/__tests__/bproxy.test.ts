import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = resolve(__dirname, "../../dist/bproxy.mjs");

/** Env without test-detection vars that cause consola (used by citty) to suppress output. */
function cliEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env["TEST"];
	delete env["VITEST"];
	delete env["NODE_ENV"];
	return env;
}

function run(args: string[]): { stdout: string; stderr: string; status: number } {
	const result = spawnSync(process.execPath, [bin, ...args], {
		encoding: "utf8",
		timeout: 5000,
		env: cliEnv(),
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		status: result.status ?? 0,
	};
}

describe("bproxy CLI shell", () => {
	it("binary exists at expected path", () => {
		expect(existsSync(bin)).toBe(true);
		expect(bin).toContain("cli/dist/bproxy.mjs");
	});

	it("prints help with exit 0", () => {
		const result = run(["--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("bproxy");
		expect(result.stdout).toContain("--session");
		expect(result.stdout).toContain("--timeout");
		expect(result.stdout).toContain("--home");
		expect(result.stdout).toContain("--verbose");
	});

	it("lists all top-level action commands", () => {
		const result = run(["--help"]);
		const commands = [
			"navigate",
			"text",
			"links",
			"images",
			"elements",
			"outline",
			"dom",
			"scroll",
			"click",
			"hover",
			"screenshot",
			"fill",
			"fill-form",
			"select",
			"wait",
			"require-human",
			"status",
			"service",
			"session",
			"tab",
			"debug",
		];
		for (const cmd of commands) {
			expect(result.stdout).toContain(cmd);
		}
	});

	it("service subcommands are reachable", () => {
		const result = run(["service", "--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("start");
		expect(result.stdout).toContain("stop");
		expect(result.stdout).toContain("status");
		expect(result.stdout).toContain("restart");
	});

	it("session subcommands are reachable", () => {
		const result = run(["session", "--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("create");
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("bind");
		expect(result.stdout).toContain("unbind");
		expect(result.stdout).toContain("resume");
		expect(result.stdout).toContain("close");
	});

	it("tab subcommands are reachable", () => {
		const result = run(["tab", "--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("pin");
		expect(result.stdout).toContain("unpin");
		expect(result.stdout).toContain("open");
		expect(result.stdout).toContain("close");
	});

	it("debug subcommands are reachable", () => {
		const result = run(["debug", "--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("log");
		expect(result.stdout).toContain("last");
		expect(result.stdout).toContain("status");
	});
});
