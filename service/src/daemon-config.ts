import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type PacingConfig, type PacingMode } from "@bproxy/shared";
import { z } from "zod";

export interface SafetyConfig {
	minInterval: { ms: number };
	rateCap: { requestsPerMinute: number };
	errorDelay: { minMs: number; maxMs: number };
	metronome: { tolerance: number; consecutiveEqual: number; maxIntervalMs: number };
}

export interface DaemonConfig {
	pacing: DaemonPacingConfig;
	safety: SafetyConfig;
}

export type DaemonPacingConfig = Record<PacingMode, PacingConfig>;

const PACING_MODES = ["human", "fast"] as const satisfies readonly PacingMode[];
const PACING_BUCKETS = [
	"navigate",
	"scroll",
	"interaction",
	"fill",
] as const satisfies readonly (keyof PacingConfig)[];

const positiveInt = z.number().int().positive();
const positiveFinite = z.number().finite().positive();
const rangeSchema = z.object({ min: positiveInt, max: positiveInt }).strict();
const pacingSchema = z
	.object({
		navigate: rangeSchema,
		scroll: rangeSchema,
		interaction: rangeSchema,
		fill: rangeSchema,
	})
	.strict();
const daemonConfigSchema = z
	.object({
		pacing: z.object({ human: pacingSchema, fast: pacingSchema }).strict(),
		safety: z
			.object({
				minInterval: z.object({ ms: positiveInt }).strict(),
				rateCap: z.object({ requestsPerMinute: positiveInt }).strict(),
				errorDelay: z.object({ minMs: positiveInt, maxMs: positiveInt }).strict(),
				metronome: z
					.object({
						tolerance: z.number().finite().gt(0).lt(1),
						consecutiveEqual: z.number().int().gte(2),
						maxIntervalMs: positiveFinite,
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
	pacing: {
		human: {
			navigate: { min: 1500, max: 4000 },
			scroll: { min: 4000, max: 8000 },
			interaction: { min: 1200, max: 2500 },
			fill: { min: 1200, max: 2500 },
		},
		fast: {
			navigate: { min: 900, max: 1400 },
			scroll: { min: 900, max: 1600 },
			interaction: { min: 900, max: 1200 },
			fill: { min: 900, max: 1200 },
		},
	},
	safety: {
		minInterval: { ms: 900 },
		rateCap: { requestsPerMinute: 60 },
		errorDelay: { minMs: 500, maxMs: 2000 },
		metronome: { tolerance: 0.1, consecutiveEqual: 3, maxIntervalMs: 60_000 },
	},
};

export function configFilePath(stateDir: string): string {
	return resolve(stateDir, "config.json");
}

export function loadDaemonConfig(stateDir: string): DaemonConfig {
	const path = configFilePath(stateDir);
	if (!existsSync(path)) return cloneDaemonConfig(DEFAULT_DAEMON_CONFIG);
	const raw = readConfigFile(path);
	const parsed = daemonConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Invalid daemon config at ${path}: ${formatZodError(parsed.error)}`);
	}
	validateDaemonConfig(parsed.data, path);
	return cloneDaemonConfig(parsed.data);
}

function readConfigFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid daemon config at ${path}: ${message}`);
	}
}

function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

function validateDaemonConfig(config: DaemonConfig, path: string): void {
	const minIntervalMs = config.safety.minInterval.ms;
	for (const mode of PACING_MODES) {
		for (const bucket of PACING_BUCKETS) {
			const range = config.pacing[mode][bucket];
			const key = `pacing.${mode}.${bucket}`;
			if (range.min > range.max) {
				throw new Error(`Invalid daemon config at ${path}: ${key}.min must be <= ${key}.max`);
			}
			if (range.min < minIntervalMs) {
				throw new Error(
					`Invalid daemon config at ${path}: ${key}.min must be >= safety.minInterval.ms (${minIntervalMs})`,
				);
			}
			if (range.max < minIntervalMs) {
				throw new Error(
					`Invalid daemon config at ${path}: ${key}.max must be >= safety.minInterval.ms (${minIntervalMs})`,
				);
			}
		}
	}
	if (config.safety.errorDelay.minMs > config.safety.errorDelay.maxMs) {
		throw new Error(
			`Invalid daemon config at ${path}: safety.errorDelay.minMs must be <= safety.errorDelay.maxMs`,
		);
	}
	if (config.safety.metronome.maxIntervalMs < minIntervalMs) {
		throw new Error(
			`Invalid daemon config at ${path}: safety.metronome.maxIntervalMs must be >= safety.minInterval.ms (${minIntervalMs})`,
		);
	}
}

function cloneRange(range: { min: number; max: number }): { min: number; max: number } {
	return { min: range.min, max: range.max };
}

function clonePacingConfig(config: PacingConfig): PacingConfig {
	return {
		navigate: cloneRange(config.navigate),
		scroll: cloneRange(config.scroll),
		interaction: cloneRange(config.interaction),
		fill: cloneRange(config.fill),
	};
}

function cloneDaemonConfig(config: DaemonConfig): DaemonConfig {
	return {
		pacing: {
			human: clonePacingConfig(config.pacing.human),
			fast: clonePacingConfig(config.pacing.fast),
		},
		safety: {
			minInterval: { ms: config.safety.minInterval.ms },
			rateCap: { requestsPerMinute: config.safety.rateCap.requestsPerMinute },
			errorDelay: {
				minMs: config.safety.errorDelay.minMs,
				maxMs: config.safety.errorDelay.maxMs,
			},
			metronome: {
				tolerance: config.safety.metronome.tolerance,
				consecutiveEqual: config.safety.metronome.consecutiveEqual,
				maxIntervalMs: config.safety.metronome.maxIntervalMs,
			},
		},
	};
}
