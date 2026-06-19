import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { configFilePath, DEFAULT_DAEMON_CONFIG, loadDaemonConfig } from "../daemon-config";
import { createTestStateDir, removeTestStateDir } from "./helpers/test-state-dir";

const homes: string[] = [];

function createHome(): string {
	const home = createTestStateDir("daemon-config-");
	homes.push(home);
	return home;
}

function writeConfig(home: string, config: unknown): void {
	writeFileSync(configFilePath(home), JSON.stringify(config, null, 2));
}

afterEach(() => {
	while (homes.length > 0) {
		removeTestStateDir(homes.pop()!);
	}
});

describe("daemon config", () => {
	it("uses defaults when config.json is missing", () => {
		const home = createHome();
		expect(loadDaemonConfig(home)).toEqual(DEFAULT_DAEMON_CONFIG);
	});

	it("loads config.json from BPROXY_HOME", () => {
		const home = createHome();
		const custom = {
			...DEFAULT_DAEMON_CONFIG,
			pacing: {
				...DEFAULT_DAEMON_CONFIG.pacing,
				fast: {
					...DEFAULT_DAEMON_CONFIG.pacing.fast,
					navigate: { min: 1000, max: 1100 },
				},
			},
			safety: {
				...DEFAULT_DAEMON_CONFIG.safety,
				rateCap: { requestsPerMinute: 42 },
			},
		};
		writeConfig(home, custom);

		const loaded = loadConfig({ BPROXY_HOME: home });
		expect(loaded.daemon).toEqual(custom);
	});

	it("rejects unknown keys", () => {
		const home = createHome();
		writeConfig(home, { ...DEFAULT_DAEMON_CONFIG, extra: true });

		expect(() => loadDaemonConfig(home)).toThrow(/extra/);
	});

	it("rejects pacing ranges that undercut the minInterval floor", () => {
		const home = createHome();
		const invalid = {
			...DEFAULT_DAEMON_CONFIG,
			pacing: {
				...DEFAULT_DAEMON_CONFIG.pacing,
				fast: {
					...DEFAULT_DAEMON_CONFIG.pacing.fast,
					fill: { min: 800, max: 1200 },
				},
			},
		};
		writeConfig(home, invalid);

		expect(() => loadDaemonConfig(home)).toThrow(/pacing\.fast\.fill\.min/);
	});

	it("rejects invalid JSON with the config path in the error", () => {
		const home = createHome();
		const path = join(home, "config.json");
		writeFileSync(path, "{not json");

		expect(() => loadDaemonConfig(home)).toThrow(new RegExp(path.replaceAll(".", "\\.")));
	});
});
