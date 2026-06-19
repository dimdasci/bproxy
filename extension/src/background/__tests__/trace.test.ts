import type { TraceEntry } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import { createTrace } from "../trace";

type TraceInput = Omit<TraceEntry, "extensionVersion">;

function entry(id: string, overrides: Partial<TraceInput> = {}): TraceInput {
	return {
		id,
		action: "text",
		tab: 1,
		timestamp: 0,
		elapsed: 0,
		result: "ok",
		replay: false,
		...overrides,
	};
}

describe("trace ring buffer", () => {
	it("stamps every appended entry with the injected extensionVersion", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		const trace = createTrace({ store, maxSize: 10, extensionVersion: () => "0.1.0" });

		await trace.append(entry("a", { session: "m4q8z2" }));
		const all = await trace.query();

		expect(all).toHaveLength(1);
		expect(all[0]?.extensionVersion).toBe("0.1.0");
		expect(all[0]?.session).toBe("m4q8z2");
	});

	it("evicts the oldest entry when appending beyond capacity", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		const trace = createTrace({ store, maxSize: 3, extensionVersion: () => "0.1.0" });

		await trace.append(entry("a"));
		await trace.append(entry("b"));
		await trace.append(entry("c"));
		await trace.append(entry("d"));

		const all = await trace.query();
		expect(all.map((e) => e.id)).toEqual(["b", "c", "d"]);
	});

	it("query with limit returns the K most recent entries", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		const trace = createTrace({ store, maxSize: 10, extensionVersion: () => "0.1.0" });

		for (const id of ["a", "b", "c", "d", "e"]) {
			await trace.append(entry(id));
		}
		const recent = await trace.query({ limit: 2 });
		expect(recent.map((e) => e.id)).toEqual(["d", "e"]);
	});

	it("query with id filter returns only entries matching that id", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		const trace = createTrace({ store, maxSize: 10, extensionVersion: () => "0.1.0" });

		await trace.append(entry("a", { action: "text" }));
		await trace.append(entry("b", { action: "fill" }));
		await trace.append(entry("a", { action: "scroll" }));

		const matches = await trace.query({ id: "a" });
		expect(matches.map((e) => e.action)).toEqual(["text", "scroll"]);
	});

	it("query with id and limit applies the filter before truncating", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		const trace = createTrace({ store, maxSize: 10, extensionVersion: () => "0.1.0" });

		await trace.append(entry("a", { timestamp: 1 }));
		await trace.append(entry("b", { timestamp: 2 }));
		await trace.append(entry("a", { timestamp: 3 }));
		await trace.append(entry("a", { timestamp: 4 }));

		const matches = await trace.query({ id: "a", limit: 2 });
		expect(matches.map((e) => e.timestamp)).toEqual([3, 4]);
	});

	it("preserves stamping when the extensionVersion provider changes over time", async () => {
		const store = createFakeStorageItem<TraceEntry[]>("session:trace", []);
		let version = "0.1.0";
		const trace = createTrace({ store, maxSize: 10, extensionVersion: () => version });

		await trace.append(entry("a"));
		version = "0.2.0";
		await trace.append(entry("b"));

		const all = await trace.query();
		expect(all.map((e) => e.extensionVersion)).toEqual(["0.1.0", "0.2.0"]);
	});
});
