import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AstContainer } from "./ast.ts";
import { extractName, findEnclosing, getContainers } from "./ast.ts";

const execFileAsync = promisify(execFile);

const MAX_BACK_REFS = 5;
const BACK_REF_TIMEOUT_MS = 2_000;

/** Names too generic to produce useful back-references. */
const SKIP_NAMES = new Set([
	"new",
	"run",
	"get",
	"set",
	"init",
	"start",
	"stop",
	"main",
	"test",
	"it",
	"describe",
]);

/**
 * Find callers of a function by name using rg --json (fast, no shell).
 * Skips: the definition itself, imports, re-definitions, test files (by default).
 */
export async function findBackRefs(
	funcName: string,
	definitionFile: string,
	definitionLine: number,
	cwd: string,
	signal?: AbortSignal,
): Promise<string[]> {
	if (funcName.length <= 2 || SKIP_NAMES.has(funcName)) return [];

	try {
		const { stdout } = await execFileAsync(
			"rg",
			[
				"--json",
				"--fixed-strings",
				"--type",
				"ts",
				"--type",
				"js",
				"--type",
				"py",
				"--type",
				"rust",
				"--type",
				"go",
				funcName,
				cwd,
			],
			{
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(BACK_REF_TIMEOUT_MS)])
					: AbortSignal.timeout(BACK_REF_TIMEOUT_MS),
				maxBuffer: 1_000_000,
			},
		);

		if (!stdout.trim()) return [];

		const callers: string[] = [];

		for (const line of stdout.split("\n")) {
			if (!line.trim()) continue;
			let parsed: {
				type?: string;
				data?: {
					path?: { text?: string };
					line_number?: number;
					lines?: { text?: string };
				};
			};
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			if (parsed.type !== "match") continue;

			const file = parsed.data?.path?.text;
			const lineNum = parsed.data?.line_number;
			const content = parsed.data?.lines?.text ?? "";

			if (!file || !lineNum) continue;

			// Skip the definition itself
			if (file === definitionFile && lineNum === definitionLine) continue;

			// Skip imports
			if (/^\s*(import|from|use|require)\b/.test(content)) continue;

			// Skip other definitions of the same name
			if (new RegExp(`(def|fn|function|class|interface|type)\\s+${funcName}\\b`).test(content))
				continue;

			// Skip test files for caller summaries
			if (/__tests__|\.test\.|\.spec\.|test\//.test(file)) continue;

			// Find enclosing function for the caller
			const containers = await getContainers(file, signal);
			const enclosing = findEnclosing(lineNum, containers);

			const shortFile = file.startsWith(cwd + "/") ? file.slice(cwd.length + 1) : file;

			if (enclosing) {
				const callerName = extractName(enclosing.label);
				callers.push(`← ${callerName} (${shortFile}:${lineNum})`);
			} else {
				callers.push(`← module level (${shortFile}:${lineNum})`);
			}

			if (callers.length >= MAX_BACK_REFS) break;
		}

		return callers;
	} catch {
		return [];
	}
}
