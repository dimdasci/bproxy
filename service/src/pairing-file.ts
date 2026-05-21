import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ServiceConfig } from "./config";
import { stateFile } from "./config";

export interface PairingMetadata {
	pairingCode: string;
	pairingExpiresAt: number;
	issuedAt: number;
}

export interface LifecycleStartResult {
	running: true;
	pid: number;
	port: number;
	pairingCode: string;
	pairingExpiresAt: number;
}

export interface LifecycleStopResult {
	running: false;
}

export interface LifecycleStatusResult {
	running: boolean;
	pid?: number;
	port?: number;
}

export function writePairingFile(config: ServiceConfig, meta: PairingMetadata): void {
	mkdirSync(config.stateDir, { recursive: true });
	const path = stateFile(config.stateDir, "pairing.json");
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 });
	renameSync(tmp, path);
}

export function readPairingFile(config: ServiceConfig): PairingMetadata | null {
	const path = stateFile(config.stateDir, "pairing.json");
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const data = JSON.parse(raw) as PairingMetadata;
		if (data.pairingCode && data.pairingExpiresAt && data.issuedAt) return data;
		return null;
	} catch {
		return null;
	}
}

export function removePairingFile(config: ServiceConfig): void {
	try {
		rmSync(stateFile(config.stateDir, "pairing.json"), { force: true });
	} catch {
		/* best effort */
	}
}
