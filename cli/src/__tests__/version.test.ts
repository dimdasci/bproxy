/**
 * Tests for `bproxy --version` handling.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("bproxy --version", () => {
	it("prints version and protocol version", () => {
		const binPath = join(__dirname, "../../dist/bproxy.mjs");
		const result = execSync(`node "${binPath}" --version`, { encoding: "utf8" }).trim();
		expect(result).toMatch(/^bproxy v\d+\.\d+\.\d+ \(protocol v\d+\)$/);
	});

	it("includes protocol v2", () => {
		const binPath = join(__dirname, "../../dist/bproxy.mjs");
		const result = execSync(`node "${binPath}" --version`, { encoding: "utf8" }).trim();
		expect(result).toContain("protocol v2");
	});

	it("exits with code 0", () => {
		const binPath = join(__dirname, "../../dist/bproxy.mjs");
		// execSync throws on non-zero exit, so if this doesn't throw, it's exit 0
		const result = execSync(`node "${binPath}" --version`, { encoding: "utf8" });
		expect(result).toBeTruthy();
	});
});
