import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { logDir, resolveStateDir, resolveStatePaths, stateFile } from "../paths.js";

describe("resolveStateDir", () => {
	it("uses --home flag when provided (highest priority)", () => {
		const result = resolveStateDir("/custom/home", { BPROXY_HOME: "/env/home" });
		expect(result).toBe("/custom/home");
	});

	it("resolves relative --home flag against cwd", () => {
		const result = resolveStateDir("relative/path", {});
		expect(result).toBe(resolve("relative/path"));
	});

	it("uses BPROXY_HOME env when --home is undefined", () => {
		const result = resolveStateDir(undefined, { BPROXY_HOME: "/env/home" });
		expect(result).toBe("/env/home");
	});

	it("uses BPROXY_HOME env when --home is empty string (treated as falsy)", () => {
		// Empty string is falsy, falls through to env
		const result = resolveStateDir("", { BPROXY_HOME: "/env/home" });
		expect(result).toBe("/env/home");
	});

	it("falls back to ~/.bproxy when no flag or env is set", () => {
		const result = resolveStateDir(undefined, {});
		expect(result).toBe(resolve(homedir(), ".bproxy"));
	});

	it("falls back to ~/.bproxy when env is empty string", () => {
		const result = resolveStateDir(undefined, { BPROXY_HOME: "" });
		expect(result).toBe(resolve(homedir(), ".bproxy"));
	});
});

describe("stateFile", () => {
	it("resolves token path", () => {
		expect(stateFile("/state", "token")).toBe("/state/token");
	});

	it("resolves port path", () => {
		expect(stateFile("/state", "port")).toBe("/state/port");
	});

	it("resolves pid path", () => {
		expect(stateFile("/state", "bproxy.pid")).toBe("/state/bproxy.pid");
	});

	it("resolves pairing.json path", () => {
		expect(stateFile("/state", "pairing.json")).toBe("/state/pairing.json");
	});

	it("resolves extension-token path", () => {
		expect(stateFile("/state", "extension-token")).toBe("/state/extension-token");
	});
});

describe("logDir", () => {
	it("resolves logs directory", () => {
		expect(logDir("/state")).toBe("/state/logs");
	});
});

describe("resolveStatePaths", () => {
	it("returns all commonly-needed paths", () => {
		const paths = resolveStatePaths("/my/home", {});
		expect(paths).toEqual({
			stateDir: "/my/home",
			token: "/my/home/token",
			port: "/my/home/port",
			pid: "/my/home/bproxy.pid",
			logs: "/my/home/logs",
		});
	});

	it("uses env when flag is undefined", () => {
		const paths = resolveStatePaths(undefined, { BPROXY_HOME: "/env/state" });
		expect(paths.stateDir).toBe("/env/state");
		expect(paths.token).toBe("/env/state/token");
	});

	it("uses default home when nothing is set", () => {
		const paths = resolveStatePaths(undefined, {});
		const expected = resolve(homedir(), ".bproxy");
		expect(paths.stateDir).toBe(expected);
	});
});
