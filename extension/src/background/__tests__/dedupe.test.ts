import { type BproxyResponse, PROTOCOL_VERSION } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { createFakeStorageItem } from "../../test/fakes/storage";
import { createDedupe, type DedupeStore } from "../dedupe";

function okResponse(id: string): BproxyResponse {
	return {
		protocol_version: PROTOCOL_VERSION,
		id,
		ok: true,
		data: { text: "x" },
		page: { url: "https://x", title: "", state: "ready", busy: false },
		replay: false,
	};
}

function makeFakeStore(): DedupeStore {
	return createFakeStorageItem("session:dedupe", {});
}

describe("dedupe table", () => {
	it("returns the stored response after set", async () => {
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 1000,
			maxSize: 10,
			now: () => 0,
		});

		await dedupe.set("a", okResponse("a"));
		const hit = await dedupe.get("a");
		expect(hit).toMatchObject({ id: "a", ok: true });
	});

	it("returns undefined for unknown ids", async () => {
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 1000,
			maxSize: 10,
			now: () => 0,
		});
		expect(await dedupe.get("missing")).toBeUndefined();
	});

	it("evicts entries that exceed the TTL on read", async () => {
		let t = 0;
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 1000,
			maxSize: 10,
			now: () => t,
		});

		await dedupe.set("a", okResponse("a"));
		t = 2000;
		expect(await dedupe.get("a")).toBeUndefined();
	});

	it("evicts the oldest entry when capacity is exceeded", async () => {
		let t = 0;
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 10_000,
			maxSize: 2,
			now: () => t,
		});

		await dedupe.set("a", okResponse("a"));
		t = 1;
		await dedupe.set("b", okResponse("b"));
		t = 2;
		await dedupe.set("c", okResponse("c"));

		expect(await dedupe.get("a")).toBeUndefined();
		expect(await dedupe.get("b")).toMatchObject({ id: "b" });
		expect(await dedupe.get("c")).toMatchObject({ id: "c" });
	});

	it("set is idempotent: writing the same id twice updates ts and survives older eviction passes", async () => {
		let t = 0;
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 1000,
			maxSize: 10,
			now: () => t,
		});

		await dedupe.set("a", okResponse("a"));
		t = 500;
		await dedupe.set("a", okResponse("a"));
		t = 1200;
		// Original ts (0) would have expired by now; refreshed ts (500) is
		// still within the 1000ms TTL window.
		expect(await dedupe.get("a")).toMatchObject({ id: "a" });
	});

	it("purges all stale entries when sweep is invoked", async () => {
		let t = 0;
		const dedupe = createDedupe({
			store: makeFakeStore(),
			ttlMs: 1000,
			maxSize: 10,
			now: () => t,
		});

		await dedupe.set("a", okResponse("a"));
		t = 500;
		await dedupe.set("b", okResponse("b"));
		t = 2000;
		await dedupe.purge();

		expect(await dedupe.get("a")).toBeUndefined();
		expect(await dedupe.get("b")).toBeUndefined();
		// Fresh writes after a purge are still accepted.
		await dedupe.set("c", okResponse("c"));
		expect(await dedupe.get("c")).toMatchObject({ id: "c" });
	});
});
