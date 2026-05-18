import { describe, expect, it } from "vitest";
import { isDaemonLocal } from "../debug-actions";

describe("isDaemonLocal", () => {
	it("returns true for debug.last and debug.status", () => {
		expect(isDaemonLocal("debug.last")).toBe(true);
		expect(isDaemonLocal("debug.status")).toBe(true);
	});

	it("returns false for debug.log (must be forwarded to the extension)", () => {
		expect(isDaemonLocal("debug.log")).toBe(false);
	});

	it("returns false for all non-debug actions", () => {
		for (const a of ["navigate", "text", "fill", "scroll", "session.bind"]) {
			expect(isDaemonLocal(a)).toBe(false);
		}
	});
});
