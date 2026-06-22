import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AST_GREP_COMMAND = "ast-grep";
const AST_GREP_FILE_TIMEOUT_MS = 5_000;

export interface AstContainer {
	kind: string;
	label: string;
	startLine: number;
	endLine: number;
	snippet: string;
}

interface LanguageRule {
	kinds: string[];
}

const LANGUAGE_RULES: Record<string, LanguageRule> = {
	".ts": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"interface_declaration",
			"type_alias_declaration",
			"variable_declarator",
		],
	},
	".tsx": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"interface_declaration",
			"type_alias_declaration",
			"variable_declarator",
		],
	},
	".js": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"variable_declarator",
		],
	},
	".jsx": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"variable_declarator",
		],
	},
	".mjs": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"variable_declarator",
		],
	},
	".cjs": {
		kinds: [
			"function_declaration",
			"method_definition",
			"class_declaration",
			"variable_declarator",
		],
	},
	".py": { kinds: ["function_definition", "class_definition"] },
	".rs": { kinds: ["function_item", "impl_item", "struct_item", "enum_item", "trait_item"] },
	".go": { kinds: ["function_declaration", "method_declaration", "type_declaration"] },
};

function supportedRule(filePath: string): LanguageRule | null {
	return LANGUAGE_RULES[path.extname(filePath).toLowerCase()] ?? null;
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function labelForContainer(kind: string, snippet: string): string {
	const line = normalizeNewlines(snippet).split("\n", 1)[0] ?? "";
	const regexByKind: Record<string, RegExp> = {
		function_declaration: /function\s+([A-Za-z_$][\w$]*)/,
		method_definition: /^\s*(?:async\s+)?([A-Za-z_$#][\w$#]*)\s*\(/,
		class_declaration: /class\s+([A-Za-z_$][\w$]*)/,
		interface_declaration: /interface\s+([A-Za-z_$][\w$]*)/,
		type_alias_declaration: /type\s+([A-Za-z_$][\w$]*)/,
		variable_declarator: /^(?:\s*export\s+)?\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=/,
		function_definition: /def\s+([A-Za-z_][\w]*)/,
		class_definition: /class\s+([A-Za-z_][\w]*)/,
		function_item: /fn\s+([A-Za-z_][\w]*)/,
		impl_item: /impl\s+([^\s{]+)/,
		struct_item: /struct\s+([A-Za-z_][\w]*)/,
		enum_item: /enum\s+([A-Za-z_][\w]*)/,
		trait_item: /trait\s+([A-Za-z_][\w]*)/,
		method_declaration: /func\s+\([^)]*\)\s+([A-Za-z_][\w]*)/,
		type_declaration: /type\s+([A-Za-z_][\w]*)/,
	};
	const tagByKind: Record<string, string> = {
		function_declaration: "fn",
		method_definition: "method",
		class_declaration: "class",
		interface_declaration: "interface",
		type_alias_declaration: "type",
		variable_declarator: "fn",
		function_definition: "fn",
		class_definition: "class",
		function_item: "fn",
		impl_item: "impl",
		struct_item: "struct",
		enum_item: "enum",
		trait_item: "trait",
		method_declaration: "method",
		type_declaration: "type",
	};
	const matcher = regexByKind[kind];
	const label = tagByKind[kind] ?? kind;
	const name = matcher?.exec(line)?.[1];
	return name ? `${label} ${name}` : label;
}

interface AstGrepMatch {
	lines?: string;
	text?: string;
	range?: {
		start?: { line?: number };
		end?: { line?: number };
	};
}

function normalizeContainer(kind: string, entry: AstGrepMatch): AstContainer | null {
	const snippet = entry.lines ?? entry.text ?? "";
	if (kind === "variable_declarator" && !/(=>|function\s*\()/.test(snippet)) {
		return null;
	}
	return {
		kind,
		label: labelForContainer(kind, snippet),
		startLine: Number(entry.range?.start?.line) + 1,
		endLine: Number(entry.range?.end?.line) + 1,
		snippet: normalizeNewlines(snippet),
	};
}

async function runAstGrep(
	kind: string,
	filePath: string,
	signal: AbortSignal | undefined,
): Promise<AstGrepMatch[]> {
	try {
		const { stdout } = await execFileAsync(
			AST_GREP_COMMAND,
			["run", "--kind", kind, "--json", filePath],
			{ signal: combinedSignal(signal, AST_GREP_FILE_TIMEOUT_MS), maxBuffer: 2_000_000 },
		);
		const parsed = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : [];
	} catch (error: unknown) {
		if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") {
			throw error;
		}
		const err = error as { stdout?: string; code?: number };
		const stdout = typeof err?.stdout === "string" ? err.stdout : "";
		if (err?.code === 1 && stdout.trim()) {
			const parsed = JSON.parse(stdout);
			return Array.isArray(parsed) ? parsed : [];
		}
		throw error;
	}
}

export function isSupportedFile(filePath: string): boolean {
	return supportedRule(filePath) !== null;
}

export async function ensureAstGrepAvailable(
	state: { availability: "unknown" | "ready" | "unavailable" },
	signal?: AbortSignal,
): Promise<boolean> {
	if (state.availability === "ready") return true;
	if (state.availability === "unavailable") return false;
	try {
		await execFileAsync(AST_GREP_COMMAND, ["--version"], {
			signal,
			maxBuffer: 64_000,
		});
		state.availability = "ready";
		return true;
	} catch (error: unknown) {
		if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") {
			throw error;
		}
		state.availability = "unavailable";
		return false;
	}
}

export async function getContainers(
	filePath: string,
	signal?: AbortSignal,
): Promise<AstContainer[]> {
	const rule = supportedRule(filePath);
	if (!rule) return [];
	const containers: AstContainer[] = [];
	for (const kind of rule.kinds) {
		const matches = await runAstGrep(kind, filePath, signal);
		for (const match of matches) {
			const container = normalizeContainer(kind, match);
			if (container) containers.push(container);
		}
	}
	containers.sort((left, right) => {
		if (left.startLine !== right.startLine) return left.startLine - right.startLine;
		return left.endLine - left.startLine - (right.endLine - right.startLine);
	});
	return containers;
}
