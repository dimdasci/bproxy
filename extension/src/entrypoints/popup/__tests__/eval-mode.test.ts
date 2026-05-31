import { describe, expect, it } from "vitest";
import type { ConfigFlags, PairingBootstrap } from "../../../background/storage";
import { createFakeStorageItem } from "../../../test/fakes/storage";
import {
	readEvalModeState,
	writeEvalModeEnabled,
	type EvalModeDeps,
} from "../eval-mode";

function makeDeps(options: {
	bootstrap?: PairingBootstrap | null;
	flags?: ConfigFlags;
} = {}): EvalModeDeps {
	return {
		bootstrap: createFakeStorageItem<PairingBootstrap | null>(
			"local:bootstrap",
			options.bootstrap ?? null,
		),
		configFlags: createFakeStorageItem<ConfigFlags>("local:configFlags", options.flags ?? {}),
	};
}

describe("eval mode popup state", () => {
	it("reports unpaired state when bootstrap is missing", async () => {
		const deps = makeDeps();

		expect(await readEvalModeState(deps)).toEqual({ paired: false, enabled: false });
	});

	it("reports paired state and eval flag from storage", async () => {
		const deps = makeDeps({
			bootstrap: {
				extensionToken: "tok",
				wsUrl: "ws://127.0.0.1:9615",
				protocolVersion: 1,
				issuedAt: 100,
				expiresAt: 200,
				nonce: "n",
			},
			flags: { evalEnabled: true },
		});

		expect(await readEvalModeState(deps)).toEqual({ paired: true, enabled: true });
	});

	it("rejects writes before pairing", async () => {
		const deps = makeDeps();

		await expect(writeEvalModeEnabled(deps, true)).rejects.toThrow(
			"Eval mode cannot be changed until the extension is paired.",
		);
		expect(await deps.configFlags.getValue()).toEqual({});
	});

	it("writes evalEnabled without dropping other flags", async () => {
		const deps = makeDeps({
			bootstrap: {
				extensionToken: "tok",
				wsUrl: "ws://127.0.0.1:9615",
				protocolVersion: 1,
				issuedAt: 100,
				expiresAt: 200,
				nonce: "n",
			},
			flags: { debuggerScreenshot: true },
		});

		await writeEvalModeEnabled(deps, true);

		expect(await deps.configFlags.getValue()).toEqual({
			debuggerScreenshot: true,
			evalEnabled: true,
		});
	});
});
