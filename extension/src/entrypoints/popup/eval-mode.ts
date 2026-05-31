import type { ConfigFlags, PairingBootstrap } from "../../background/storage";
import type { StorageItem } from "../../background/storage-item";

export interface EvalModeState {
	paired: boolean;
	enabled: boolean;
}

export interface EvalModeDeps {
	bootstrap: StorageItem<PairingBootstrap | null>;
	configFlags: StorageItem<ConfigFlags>;
}

export async function readEvalModeState(deps: EvalModeDeps): Promise<EvalModeState> {
	const [bootstrap, flags] = await Promise.all([
		deps.bootstrap.getValue(),
		deps.configFlags.getValue(),
	]);
	return {
		paired: bootstrap !== null,
		enabled: flags["evalEnabled"] === true,
	};
}

export async function writeEvalModeEnabled(
	deps: EvalModeDeps,
	enabled: boolean,
): Promise<void> {
	const bootstrap = await deps.bootstrap.getValue();
	if (bootstrap === null) {
		throw new Error("Eval mode cannot be changed until the extension is paired.");
	}
	const flags = await deps.configFlags.getValue();
	await deps.configFlags.setValue({ ...flags, evalEnabled: enabled });
}
