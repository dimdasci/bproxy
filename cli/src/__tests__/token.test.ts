import { describe, expect, it } from "vitest";
import { formatMode, preflightToken, type TokenStatInfo } from "../token.js";

function makeStatInfo(overrides: Partial<TokenStatInfo> = {}): TokenStatInfo {
	return {
		isFile: () => true,
		mode: 0o100600,
		uid: 1000,
		...overrides,
	};
}

describe("preflightToken", () => {
	it("succeeds with valid token file", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo(),
			read: () => "secret-token-value\n",
			getuid: () => 1000,
		});
		expect(result).toEqual({ ok: true, token: "secret-token-value" });
	});

	it("trims whitespace from token content", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo(),
			read: () => "  abc123  \n",
			getuid: () => 1000,
		});
		expect(result).toEqual({ ok: true, token: "abc123" });
	});

	it("fails when file does not exist", () => {
		const result = preflightToken("/state/token", {
			stat: () => {
				throw new Error("ENOENT");
			},
			read: () => "",
			getuid: () => 1000,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Token file not found: /state/token",
		});
	});

	it("fails when path is not a regular file", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ isFile: () => false }),
			read: () => "token",
			getuid: () => 1000,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Token path is not a regular file: /state/token",
		});
	});

	it("fails when mode is too permissive (0644)", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ mode: 0o100644 }),
			read: () => "token",
			getuid: () => 1000,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("insecure permissions");
			expect(result.reason).toContain("0644");
			expect(result.reason).toContain("expected 0600");
		}
	});

	it("fails when mode is 0640", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ mode: 0o100640 }),
			read: () => "token",
			getuid: () => 1000,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("0640");
		}
	});

	it("fails when mode is 0666", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ mode: 0o100666 }),
			read: () => "token",
			getuid: () => 1000,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("0666");
		}
	});

	it("fails when owner does not match current UID", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ uid: 999 }),
			read: () => "token",
			getuid: () => 1000,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Token file is owned by uid 999, expected 1000: /state/token",
		});
	});

	it("skips owner check when getuid returns undefined (Windows)", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo({ uid: 999 }),
			read: () => "token",
			getuid: () => undefined,
		});
		expect(result).toEqual({ ok: true, token: "token" });
	});

	it("fails when token file is empty", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo(),
			read: () => "   \n",
			getuid: () => 1000,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Token file is empty: /state/token",
		});
	});

	it("fails when token read throws", () => {
		const result = preflightToken("/state/token", {
			stat: () => makeStatInfo(),
			read: () => {
				throw new Error("EACCES");
			},
			getuid: () => 1000,
		});
		expect(result).toEqual({
			ok: false,
			reason: "Failed to read token file: /state/token",
		});
	});

	it("never includes token value in error messages", () => {
		// Test all failure paths to make sure no token is leaked
		const failures = [
			preflightToken("/state/token", {
				stat: () => {
					throw new Error("ENOENT");
				},
				read: () => "secret",
				getuid: () => 1000,
			}),
			preflightToken("/state/token", {
				stat: () => makeStatInfo({ isFile: () => false }),
				read: () => "secret",
				getuid: () => 1000,
			}),
			preflightToken("/state/token", {
				stat: () => makeStatInfo({ mode: 0o100644 }),
				read: () => "secret",
				getuid: () => 1000,
			}),
			preflightToken("/state/token", {
				stat: () => makeStatInfo({ uid: 0 }),
				read: () => "secret",
				getuid: () => 1000,
			}),
		];

		for (const result of failures) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).not.toContain("secret");
			}
		}
	});
});

describe("formatMode", () => {
	it("formats 0600", () => {
		expect(formatMode(0o600)).toBe("0600");
	});

	it("formats 0644", () => {
		expect(formatMode(0o644)).toBe("0644");
	});

	it("formats 0755", () => {
		expect(formatMode(0o755)).toBe("0755");
	});

	it("formats 0000", () => {
		expect(formatMode(0o000)).toBe("0000");
	});

	it("formats 0777", () => {
		expect(formatMode(0o777)).toBe("0777");
	});

	it("masks to lower 12 bits from full stat mode", () => {
		// stat.mode includes file type bits (e.g. 0o100644 for regular file)
		expect(formatMode(0o100644)).toBe("0644");
		expect(formatMode(0o100600)).toBe("0600");
	});
});
