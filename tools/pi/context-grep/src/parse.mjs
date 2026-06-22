import { existsSync, statSync } from "node:fs";
import path from "node:path";

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

function normalizePath(value) {
	return value.replace(/\\/g, "/");
}

function unique(values) {
	return [...new Set(values)];
}

function splitLines(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function tokenizeShellish(command) {
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

function safeStat(filePath) {
	try {
		return statSync(filePath);
	} catch {
		return null;
	}
}

function existingAbsolutePath(token, cwd) {
	if (!token || token.startsWith("-")) return null;
	if (EXECUTABLE_TOKENS.has(token)) return null;
	const resolved = path.isAbsolute(token) ? token : path.resolve(cwd, token);
	return existsSync(resolved) ? resolved : null;
}

export function isSearchCommand(command) {
	return SEARCH_COMMAND_RE.test(command);
}

export function inferCommandSearchPaths(command, cwd) {
	const paths = [];
	for (const token of tokenizeShellish(command)) {
		const existing = existingAbsolutePath(token, cwd);
		if (existing) paths.push(existing);
	}
	return unique(paths);
}

function searchBasesForBash(command, cwd) {
	const commandPaths = inferCommandSearchPaths(command, cwd);
	const bases = [cwd];
	for (const candidate of commandPaths) {
		const stat = safeStat(candidate);
		if (!stat) continue;
		bases.push(stat.isDirectory() ? candidate : path.dirname(candidate));
	}
	return unique(bases);
}

function resolveExistingFile(rawPath, bases) {
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

function buildHit(filePath, lineNumber) {
	return {
		filePath,
		lineNumber,
		displayPath: normalizePath(filePath),
	};
}

function parseDirectRows(text, bases) {
	const hits = [];
	for (const line of splitLines(text)) {
		if (!line || line === "No matches found") continue;
		if (CONTEXT_ROW_RE.test(line)) continue;
		const match = DIRECT_MATCH_RE.exec(line);
		if (!match) continue;
		const [, rawPath, rawLine] = match;
		const lineNumber = Number.parseInt(rawLine, 10);
		if (!Number.isFinite(lineNumber) || lineNumber < 1) continue;
		const filePath = resolveExistingFile(rawPath, bases);
		if (!filePath) continue;
		hits.push(buildHit(filePath, lineNumber));
	}
	return hits;
}

function inferSingleFile(command, cwd) {
	const commandPaths = inferCommandSearchPaths(command, cwd);
	for (let index = commandPaths.length - 1; index >= 0; index -= 1) {
		const candidate = commandPaths[index];
		const stat = safeStat(candidate);
		if (stat?.isFile()) return candidate;
	}
	return null;
}

function parseSingleFileRows(text, singleFile) {
	const hits = [];
	for (const line of splitLines(text)) {
		const match = SINGLE_FILE_MATCH_RE.exec(line);
		if (!match) continue;
		const [, rawLine] = match;
		const lineNumber = Number.parseInt(rawLine, 10);
		if (!Number.isFinite(lineNumber) || lineNumber < 1) continue;
		hits.push(buildHit(singleFile, lineNumber));
	}
	return hits;
}

function searchBasesForNativeGrep(cwd, inputPath) {
	if (!inputPath) return [cwd];
	const absoluteInput = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
	const stat = safeStat(absoluteInput);
	if (!stat) return [cwd];
	return [stat.isDirectory() ? absoluteInput : path.dirname(absoluteInput), cwd];
}

export function parseNativeGrepOutput({ text, cwd, inputPath }) {
	const hits = parseDirectRows(text, searchBasesForNativeGrep(cwd, inputPath));
	return hits.length > 0 ? { kind: "grep", hits } : null;
}

export function parseBashSearchOutput({ text, cwd, command }) {
	if (!isSearchCommand(command)) return null;
	const directHits = parseDirectRows(text, searchBasesForBash(command, cwd));
	if (directHits.length >= 2) {
		return { kind: "bash", hits: directHits };
	}
	const singleFile = inferSingleFile(command, cwd);
	if (!singleFile) return null;
	const singleFileHits = parseSingleFileRows(text, singleFile);
	if (singleFileHits.length === 0) return null;
	return { kind: "bash", hits: singleFileHits, singleFile };
}
