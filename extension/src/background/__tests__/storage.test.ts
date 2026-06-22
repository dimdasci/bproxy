import { PROTOCOL_VERSION } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import {
	bootstrapItem,
	configFlagsItem,
	dedupeItem,
	injectedTabsItem,
	type PairingBootstrap,
	sessionPinsItem,
	traceItem,
} from "../storage";

describe("storage items", () => {
	it("bootstrap is local-scoped and round-trips a payload", async () => {
		expect(bootstrapItem.key).toBe("local:bootstrap");
		expect(await bootstrapItem.getValue()).toBeNull();

		const payload: PairingBootstrap = {
			extensionToken: "tok",
			wsUrl: "ws://127.0.0.1:9615",
			protocolVersion: PROTOCOL_VERSION,
			issuedAt: 100,
			expiresAt: 200,
			nonce: "n",
		};
		await bootstrapItem.setValue(payload);
		expect(await bootstrapItem.getValue()).toEqual(payload);
	});

	it("configFlags is local-scoped and defaults to {}", async () => {
		expect(configFlagsItem.key).toBe("local:configFlags");
		expect(await configFlagsItem.getValue()).toEqual({});
	});

	it("session pins are session-scoped and default to {}", async () => {
		expect(sessionPinsItem.key).toBe("session:pins");
		expect(await sessionPinsItem.getValue()).toEqual({});
	});

	it("dedupe table is session-scoped and defaults to {}", async () => {
		expect(dedupeItem.key).toBe("session:dedupe");
		expect(await dedupeItem.getValue()).toEqual({});
	});

	it("injected tabs default to an empty array", async () => {
		expect(injectedTabsItem.key).toBe("session:injectedTabs");
		expect(await injectedTabsItem.getValue()).toEqual([]);
	});

	it("trace ring buffer defaults to an empty array", async () => {
		expect(traceItem.key).toBe("session:trace");
		expect(await traceItem.getValue()).toEqual([]);
	});
});
