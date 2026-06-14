import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
	it("uses defaults when env is empty", () => {
		const config = loadConfig({});
		expect(config.port).toBe(9615);
		expect(config.host).toBe("127.0.0.1");
		expect(config.logLevel).toBe("info");
		expect(config.stateDir).toMatch(/\.bproxy$/);
	});

	it("honours BPROXY_PORT and BPROXY_HOME", () => {
		const config = loadConfig({ BPROXY_PORT: "12345", BPROXY_HOME: "/home/testuser/.bproxy-alt" });
		expect(config.port).toBe(12345);
		expect(config.stateDir).toBe("/home/testuser/.bproxy-alt");
	});

	it("falls back to default port for invalid BPROXY_PORT", () => {
		expect(loadConfig({ BPROXY_PORT: "garbage" }).port).toBe(9615);
		expect(loadConfig({ BPROXY_PORT: "-1" }).port).toBe(9615);
	});

	it("rejects unknown log level", () => {
		expect(loadConfig({ BPROXY_LOG_LEVEL: "shout" }).logLevel).toBe("info");
	});
});
