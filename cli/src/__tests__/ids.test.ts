import { describe, expect, it } from "vitest";
import { generateRequestId } from "../ids.js";

describe("generateRequestId", () => {
	it("returns a valid UUID v4 string", () => {
		const id = generateRequestId();
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it("generates unique IDs on successive calls", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
		expect(ids.size).toBe(100);
	});
});
