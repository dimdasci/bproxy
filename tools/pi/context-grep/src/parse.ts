import type { Stats } from "node:fs";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface ParsedHit {
	filePath: string;
	lineNumber: number;
	lineText: string;
	displayPath: string;
}

export interface ParsedSearchResult {
	kind: "grep" | "bash";
	hits: ParsedHit[];
	singleFile?: string;
}

const DIRECT_MATCH_RE = /^(.+?):(\d+):(.*)$/;
const CONTEXT_ROW_RE = /^(.+?)-(\d+)-\s?(.*)$/;
const SINGLE_FILE_MATCH_RE = /^(\d+):(.*)$/;
const SEARCH_COMMAND_RE = /(^|[\s;(|&])(rg|grep)(?=$|[\s;)|&])/;
const EXECUTABLE_TOKENS = new Set([
	"rg",
	"grep",
	"find",
	"xargs",
	"sort",
	"uniq",
	"head",
	"tail",
	"cut",
	"awk",
	"sed",
]);

/**
 * Patterns that indicate the command is a script/heredoc rather than a direct
 * shell search command. If the command starts with one of these, even if it
 * contains `grep`/`rg` text, it is not treated as a search command.
 */
const SCRIPT_COMMAND_PREFIXES: RegExp[] = [
	/^\s*node\b/,
	/^\s*python3?\b/,
	/^\s*ruby\b/,
	/^\s*perl\b/,
	/^\s*deno\b/,
	/^\s*bun\b/,
	/^\s*ts-node\b/,
	/^\s*tsx\b/,
	/^\s*npx\b/,
];

/**
 * Patterns indicating heredoc, inline script, or process substitution that
 * may contain grep/rg text without the shell command being a search.
 */
const HEREDOC_PATTERNS: RegExp[] = [
	/<<[-~]?\s*['"]?\w+['"]?/, // heredoc: <<EOF, <<'EOF', <<-EOF
	/\bnode\s+-e\b/, // node -e "...grep..."
	/\bpython3?\s+-c\b/, // python -c "..."
	/\bruby\s+-e\b/, // ruby -e "..."
	/\bperl\s+-e\b/, // perl -e "..."
];

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function splitLines(text: string): string[] {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function tokenizeShellish(command: string): string[] {
	const matches = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? [];
	return matches.map((token) => {
		if (
			(token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith("'") && token.endsWith("'"))
		) {
			return token.slice(1, -1);
		}
		return token;
	});
}

function safeStat(filePath: string): Stats | null {
	try {
		return statSync(filePath);
	} catch {
		return null;
	}
}

function existingAbsolutePath(token: string, cwd: string): string | null {
	if (!token || token.startsWith("-")) return null;
	if (EXECUTABLE_TOKENS.has(token)) return null;
	const resolved = path.isAbsolute(token) ? token : path.resolve(cwd, token);
	return existsSync(resolved) ? resolved : null;
}

export function isSearchCommand(command: string): boolean {
	if (!SEARCH_COMMAND_RE.test(command)) return false;

	// Reject commands that are script invocations whose *text* contains grep/rg
	// but whose executed binary is an interpreter, not a search tool.
	for (const prefix of SCRIPT_COMMAND_PREFIXES) {
		if (prefix.test(command)) return false;
	}

	// Reject heredoc / inline-script patterns
	for (const pattern of HEREDOC_PATTERNS) {
		if (pattern.test(command)) return false;
	}

	return true;
}

export function inferCommandSearchPaths(command: string, cwd: string): string[] {
	const paths: string[] = [];
	for (const token of tokenizeShellish(command)) {
		const existing = existingAbsolutePath(token, cwd);
		if (existing) paths.push(existing);
	}
	return unique(paths);
}

function searchBasesForBash(command: string, cwd: string): string[] {
	const commandPaths = inferCommandSearchPaths(command, cwd);
	const bases = [cwd];
	for (const candidate of commandPaths) {
		const stat = safeStat(candidate);
		if (!stat) continue;
		bases.push(stat.isDirectory() ? candidate : path.dirname(candidate));
	}
	return unique(bases);
}

function resolveExistingFile(rawPath: string, bases: string[]): string | null {
	if (!rawPath) return null;
	if (path.isAbsolute(rawPath)) {
		const absolute = path.normalize(rawPath);
		const stat = safeStat(absolute);
		return stat?.isFile() ? absolute : null;
	}
	for (const base of bases) {
		const candidate = path.resolve(base, rawPath);
		const stat = safeStat(candidate);
		if (stat?.isFile()) return candidate;
	}
	return null;
}

function buildHit(filePath: string, lineNumber: number, lineText: string): ParsedHit {
	return {
		filePath,
		lineNumber,
		lineText: lineText ?? "",
		displayPath: normalizePath(filePath),
	};
}

function parseDirectRows(text: string, bases: string[]): ParsedHit[] {
	const hits: ParsedHit[] = [];
	for (const line of splitLines(text)) {
		if (!line || line === "No matches found") continue;
		if (CONTEXT_ROW_RE.test(line)) continue;
		const match = DIRECT_MATCH_RE.exec(line);
		if (!match) continue;
		const rawPath = match[1]!;
		const rawLine = match[2]!;
		const lineText = match[3] ?? "";
		const lineNumber = Number.parseInt(rawLine, 10);
		if (!Number.isFinite(lineNumber) || lineNumber < 1) continue;
		const filePath = resolveExistingFile(rawPath, bases);
		if (!filePath) continue;
		hits.push(buildHit(filePath, lineNumber, lineText));
	}
	return hits;
}

function inferSingleFile(command: string, cwd: string): string | null {
	const commandPaths = inferCommandSearchPaths(command, cwd);
	for (let index = commandPaths.length - 1; index >= 0; index -= 1) {
		const candidate = commandPaths[index];
		if (!candidate) continue;
		const stat = safeStat(candidate);
		if (stat?.isFile()) return candidate;
	}
	return null;
}

function parseSingleFileRows(text: string, singleFile: string): ParsedHit[] {
	const hits: ParsedHit[] = [];
	for (const line of splitLines(text)) {
		const match = SINGLE_FILE_MATCH_RE.exec(line);
		if (!match) continue;
		const rawLine = match[1]!;
		const lineText = match[2] ?? "";
		const lineNumber = Number.parseInt(rawLine, 10);
		if (!Number.isFinite(lineNumber) || lineNumber < 1) continue;
		hits.push(buildHit(singleFile, lineNumber, lineText));
	}
	return hits;
}

function searchBasesForNativeGrep(cwd: string, inputPath?: string): string[] {
	if (!inputPath) return [cwd];
	const absoluteInput = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
	const stat = safeStat(absoluteInput);
	if (!stat) return [cwd];
	return [stat.isDirectory() ? absoluteInput : path.dirname(absoluteInput), cwd];
}

export function parseNativeGrepOutput(input: {
	text: string;
	cwd: string;
	inputPath?: string;
}): ParsedSearchResult | null {
	const hits = parseDirectRows(input.text, searchBasesForNativeGrep(input.cwd, input.inputPath));
	return hits.length > 0 ? { kind: "grep", hits } : null;
}

export function parseBashSearchOutput(input: {
	text: string;
	cwd: string;
	command: string;
}): ParsedSearchResult | null {
	if (!isSearchCommand(input.command)) return null;
	const directHits = parseDirectRows(input.text, searchBasesForBash(input.command, input.cwd));
	if (directHits.length >= 2) {
		return { kind: "bash", hits: directHits };
	}
	const singleFile = inferSingleFile(input.command, input.cwd);
	if (!singleFile) return null;
	const singleFileHits = parseSingleFileRows(input.text, singleFile);
	if (singleFileHits.length === 0) return null;
	return { kind: "bash", hits: singleFileHits, singleFile };
}
