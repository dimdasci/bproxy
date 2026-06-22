import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AST_GREP_COMMAND = "ast-grep";
const AST_GREP_FILE_TIMEOUT_MS = 5_000;

const LANGUAGE_RULES = {
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
	".py": { kinds: ["function_definition", "class_definition"] },
	".rs": { kinds: ["function_item", "impl_item", "struct_item", "enum_item", "trait_item"] },
	".go": { kinds: ["function_declaration", "method_declaration", "type_declaration"] },
};

function supportedRule(filePath) {
	return LANGUAGE_RULES[path.extname(filePath).toLowerCase()] ?? null;
}

function normalizeNewlines(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function combinedSignal(signal, timeoutMs) {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function labelForContainer(kind, snippet) {
	const line = normalizeNewlines(snippet).split("\n", 1)[0] ?? "";
	const regexByKind = {
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
	const tagByKind = {
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

function normalizeContainer(kind, entry) {
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

async function runAstGrep(kind, filePath, signal) {
	try {
		const { stdout } = await execFileAsync(
			AST_GREP_COMMAND,
			["run", "--kind", kind, "--json", filePath],
			{ signal: combinedSignal(signal, AST_GREP_FILE_TIMEOUT_MS), maxBuffer: 2_000_000 },
		);
		const parsed = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		if (error && typeof error === "object" && error.name === "AbortError") {
			throw error;
		}
		const stdout = typeof error?.stdout === "string" ? error.stdout : "";
		if (error?.code === 1 && stdout.trim()) {
			const parsed = JSON.parse(stdout);
			return Array.isArray(parsed) ? parsed : [];
		}
		throw error;
	}
}

export function isSupportedFile(filePath) {
	return supportedRule(filePath) !== null;
}

export async function ensureAstGrepAvailable(state, signal) {
	if (state.availability === "ready") return true;
	if (state.availability === "unavailable") return false;
	try {
		await execFileAsync(AST_GREP_COMMAND, ["--version"], {
			signal,
			maxBuffer: 64_000,
		});
		state.availability = "ready";
		return true;
	} catch (error) {
		if (error && typeof error === "object" && error.name === "AbortError") {
			throw error;
		}
		state.availability = "unavailable";
		return false;
	}
}

export async function getContainers(filePath, signal) {
	const rule = supportedRule(filePath);
	if (!rule) return [];
	const containers = [];
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
