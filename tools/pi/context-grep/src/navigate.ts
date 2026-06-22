import path from "node:path";

import type { ParsedHit } from "./parse.ts";

export type PathKind = "production" | "test" | "docs" | "config" | "generated" | "fixture";
export type HitKind =
	| "definition"
	| "reference"
	| "assertion"
	| "diagnostic"
	| "config"
	| "docs"
	| "import";

export interface TaskFocus {
	focus: string;
	reason: string;
}

interface NavigationEntry {
	filePath: string;
	lineNumber: number;
	lineText: string;
	displayPath: string;
	containerLabel: string | null;
	pathKind: string;
	hitKind: string;
}

const MAX_MAP_ROWS = 8;
const MAX_SUGGESTED_READS = 6;
const MAX_MAP_CHARS = 3_000;

const HEADER = "\n\n── Navigation map ─────────────────────────────\n";

// ─── Path-kind classification ──────────────────────────────────────────────────

const TEST_PATH_RE =
	/(^|[/\\])(__tests__|test|tests|spec|__mocks__|__fixtures__)[/\\]|\.(?:test|spec|e2e)\.[^/\\]+$/;
const DOCS_PATH_RE =
	/(^|[/\\])(docs|README|CHANGELOG|CONTRIBUTING|LICENSE|AGENTS)\b|\.(md|mdx|rst|txt)$/i;
const CONFIG_PATH_RE =
	/(^|[/\\])(\.?(?:eslint|prettier|tsconfig|biome|vitest|jest|babel|webpack|rollup|vite|turbo|nx|package))[^/\\]*\.(json|ya?ml|toml|js|ts|mjs|cjs)$|^\./;
const GENERATED_PATH_RE =
	/(^|[/\\])(dist|build|out|coverage|node_modules|\.next|auto)[/\\]|\.(min|bundle)\.[^/\\]+$|\.d\.ts$/;
const FIXTURE_PATH_RE = /(^|[/\\])(fixtures?|__fixtures__|snapshots?|__snapshots__)[/\\]/;

/**
 * Classify a file path into one of: production, test, docs, config, generated, fixture.
 */
export function classifyPathKind(filePath: string): PathKind {
	const normalized = filePath.replace(/\\/g, "/");
	if (GENERATED_PATH_RE.test(normalized)) return "generated";
	if (FIXTURE_PATH_RE.test(normalized)) return "fixture";
	if (TEST_PATH_RE.test(normalized)) return "test";
	if (DOCS_PATH_RE.test(normalized)) return "docs";
	if (CONFIG_PATH_RE.test(normalized)) return "config";
	return "production";
}

// ─── Hit-kind classification ───────────────────────────────────────────────────

const DEFINITION_LABELS = new Set([
	"fn",
	"class",
	"interface",
	"type",
	"struct",
	"enum",
	"trait",
	"impl",
]);
const ASSERTION_RE =
	/\b(assert|expect|should|describe|it|test|beforeEach|afterEach|beforeAll|afterAll)\b/;
const DIAGNOSTIC_RE =
	/\b(FAIL|ERROR|WARN|error\[|warning\[|AssertionError|SyntaxError|TypeError|eslint|biome|sonar|tsc)\b/i;
const IMPORT_EXPORT_RE = /^\s*(import|export)\b/;

/**
 * Classify a hit by its role.
 */
export function classifyHitKind(
	hit: { lineText: string; filePath: string; lineNumber?: number },
	container: { label: string; startLine: number; endLine: number } | null,
): HitKind {
	const pathKind = classifyPathKind(hit.filePath);
	if (pathKind === "docs") return "docs";
	if (pathKind === "config") return "config";

	const text = hit.lineText ?? "";

	if (DIAGNOSTIC_RE.test(text)) return "diagnostic";

	// Check container-based definition before import/export, since
	// "export function foo()" is a definition, not just an import.
	if (container) {
		const tag = container.label.split(" ")[0] ?? "";
		if (DEFINITION_LABELS.has(tag)) {
			// Check if the hit is on or near the definition line itself
			if (container.startLine === hit.lineNumber) return "definition";
			// Within the first 3 lines is likely the signature
			if (hit.lineNumber !== undefined && hit.lineNumber - container.startLine < 3)
				return "definition";
		}
	}

	if (IMPORT_EXPORT_RE.test(text)) return "import";

	if (pathKind === "test" && ASSERTION_RE.test(text)) return "assertion";
	if (pathKind === "test") return "assertion";

	return "reference";
}

// ─── Task-focus inference ──────────────────────────────────────────────────────

/**
 * Infer the likely task focus from command, output text, and hit distribution.
 */
export function inferTaskFocus(input: {
	command?: string;
	text: string;
	hits: Array<{ filePath: string; lineText: string }>;
}): TaskFocus | null {
	const cmd = input.command ?? "";

	// Check for test-focused command paths
	if (/(__tests__|\.test\.|\.spec\.|test\/|tests\/|spec\/)/.test(cmd)) {
		return { focus: "tests", reason: "command targets test paths" };
	}

	// Check output for diagnostic signals
	if (/\b(FAIL|AssertionError|expected|Sonar|rule)\b/i.test(input.text)) {
		return { focus: "diagnostics", reason: "output contains failure/diagnostic signals" };
	}

	// Check output for compiler/linter signals
	if (/\b(tsc|eslint|Biome|error\[|warning\[)\b/.test(input.text)) {
		return { focus: "diagnostics", reason: "output contains linter/compiler signals" };
	}

	// Check if most hits are in test files
	const testHits = input.hits.filter((h) => classifyPathKind(h.filePath) === "test").length;
	if (input.hits.length > 0 && testHits / input.hits.length > 0.6) {
		return { focus: "tests", reason: "majority of matches are in test files" };
	}

	// Check for docs-focused command or results
	if (/\.(md|mdx|rst|txt)\b|docs\//.test(cmd)) {
		return { focus: "docs", reason: "command targets documentation paths" };
	}
	const docHits = input.hits.filter((h) => classifyPathKind(h.filePath) === "docs").length;
	if (input.hits.length > 0 && docHits / input.hits.length > 0.5) {
		return { focus: "docs", reason: "majority of matches are in documentation" };
	}

	// Check if query looks like an identifier (single CamelCase or snake_case term)
	const identifierQueryRe = /^[A-Za-z_$][\w$]*$/;
	// Try to extract the search pattern from the command (handle quotes properly)
	const quotedQueryMatch = cmd.match(/(?:rg|grep)\s+(?:-[^\s]*\s+)*["']([^"']+)["']/);
	const unquotedQueryMatch = cmd.match(/(?:rg|grep)\s+(?:-[^\s]*\s+)*([^\s"'|>]+)/);
	const queryText = quotedQueryMatch?.[1] ?? unquotedQueryMatch?.[1];
	if (queryText && identifierQueryRe.test(queryText)) {
		return { focus: "definitions", reason: "query resembles an identifier name" };
	}

	return null;
}

// ─── Lane assignment ───────────────────────────────────────────────────────────

const LANE_ORDER = [
	"Primary candidates",
	"Definitions / contracts",
	"Implementation candidates",
	"Tests / behavior specs",
	"Docs / config",
	"Diagnostics / build output",
];

function laneForEntry(entry: NavigationEntry): string {
	switch (entry.hitKind) {
		case "definition":
			return "Definitions / contracts";
		case "assertion":
			return "Tests / behavior specs";
		case "diagnostic":
			return "Diagnostics / build output";
		case "docs":
		case "config":
			return "Docs / config";
		case "import":
			return "Implementation candidates";
		case "reference":
		default:
			if (entry.pathKind === "test") return "Tests / behavior specs";
			if (entry.pathKind === "docs" || entry.pathKind === "config") return "Docs / config";
			return "Implementation candidates";
	}
}

function focusLane(focus: string): string | null {
	switch (focus) {
		case "tests":
			return "Tests / behavior specs";
		case "diagnostics":
			return "Diagnostics / build output";
		case "definitions":
			return "Definitions / contracts";
		case "docs":
			return "Docs / config";
		default:
			return null;
	}
}

// ─── Suggested reads ───────────────────────────────────────────────────────────

interface SuggestedRead {
	path: string;
	reason: string;
}

function buildSuggestedReads(entries: NavigationEntry[], focus: TaskFocus | null): SuggestedRead[] {
	const seen = new Set<string>();
	const reads: SuggestedRead[] = [];

	// If there's a focused lane, prioritize entries from that lane
	const primaryLane = focus ? focusLane(focus.focus) : null;

	const sortedEntries = [...entries].sort((a, b) => {
		const aIsPrimary = primaryLane && laneForEntry(a) === primaryLane ? 0 : 1;
		const bIsPrimary = primaryLane && laneForEntry(b) === primaryLane ? 0 : 1;
		if (aIsPrimary !== bIsPrimary) return aIsPrimary - bIsPrimary;
		// Diversify by file path
		return a.filePath.localeCompare(b.filePath);
	});

	for (const entry of sortedEntries) {
		if (reads.length >= MAX_SUGGESTED_READS) break;
		if (seen.has(entry.filePath)) continue;
		seen.add(entry.filePath);

		let reason: string;
		const lane = laneForEntry(entry);
		if (lane === primaryLane) {
			reason = primaryLaneReason(entry);
		} else {
			reason = secondaryReason(entry);
		}

		reads.push({ path: entry.displayPath, reason });
	}

	return reads;
}

function primaryLaneReason(entry: NavigationEntry): string {
	switch (entry.pathKind) {
		case "test":
			return "failing/behavioral entrypoint";
		case "docs":
			return "documentation target";
		case "config":
			return "configuration target";
		default:
			if (entry.hitKind === "definition") return "definition site";
			if (entry.hitKind === "diagnostic") return "diagnostic source";
			return "primary match";
	}
}

function secondaryReason(entry: NavigationEntry): string {
	switch (entry.hitKind) {
		case "definition":
			return "contract/type definition";
		case "assertion":
			return "test coverage";
		case "diagnostic":
			return "error source";
		case "import":
			return "import/re-export site";
		case "docs":
			return "documentation reference";
		case "config":
			return "configuration";
		default:
			if (entry.pathKind === "test") return "related test";
			return "implementation reference";
	}
}

// ─── Navigation map builder ────────────────────────────────────────────────────

/**
 * Build a navigation map from enriched hit entries.
 */
export function buildNavigationMap(input: {
	hits: ParsedHit[];
	containers: Map<string, Array<{ startLine: number; endLine: number; label: string }>>;
	cwd: string;
	command?: string;
	text: string;
}): string | null {
	if (input.hits.length < 2) return null;

	// Build navigation entries with classifications
	const entries: NavigationEntry[] = [];
	for (const hit of input.hits) {
		const pathKind = classifyPathKind(hit.displayPath);
		const container = findContainerForHit(hit, input.containers);
		const hitKind = classifyHitKind(hit, container);

		entries.push({
			filePath: hit.filePath,
			lineNumber: hit.lineNumber,
			lineText: hit.lineText ?? "",
			displayPath: relativeDisplayPath(hit.filePath, input.cwd),
			containerLabel: container?.label ?? null,
			pathKind,
			hitKind,
		});
	}

	if (entries.length < 2) return null;

	const focus = inferTaskFocus({ command: input.command, text: input.text, hits: input.hits });

	// Assign entries to lanes
	const lanes = new Map<string, NavigationEntry[]>();
	for (const entry of entries) {
		const lane = laneForEntry(entry);
		if (!lanes.has(lane)) lanes.set(lane, []);
		lanes.get(lane)!.push(entry);
	}

	// Build primary candidates: if we have a focus, pull from that lane
	const primaryLane = focus ? focusLane(focus.focus) : null;
	if (primaryLane && lanes.has(primaryLane)) {
		const primaryEntries = lanes.get(primaryLane)!;
		// Move the top entries from primary lane into "Primary candidates"
		const existingPrimary = lanes.get("Primary candidates") ?? [];
		const toPromote = primaryEntries.slice(0, 3);
		lanes.set("Primary candidates", [...existingPrimary, ...toPromote]);
		lanes.set(
			primaryLane,
			primaryEntries.filter((e) => !toPromote.includes(e)),
		);
	}

	// Remove empty lanes
	for (const [lane, laneEntries] of lanes) {
		if (laneEntries.length === 0) lanes.delete(lane);
	}

	if (lanes.size === 0) return null;

	// Format the map
	let output = HEADER;

	if (focus) {
		output += `Likely focus: ${focus.focus}\n`;
		output += `Reason: ${focus.reason}\n`;
	}

	output += "\n";

	let rowCount = 0;
	const orderedLanes = LANE_ORDER.filter((lane) => lanes.has(lane));

	for (const laneName of orderedLanes) {
		if (rowCount >= MAX_MAP_ROWS) break;
		const laneEntries = deduplicateByFile(lanes.get(laneName)!);

		output += `${laneName}:\n`;
		for (const entry of laneEntries) {
			if (rowCount >= MAX_MAP_ROWS) break;
			rowCount += 1;
			const label = entry.containerLabel ? ` [${entry.containerLabel}]` : "";
			const preview = entry.lineText ? ` ${entry.lineText.trim().slice(0, 60)}` : "";
			output += `${rowCount}. ${entry.displayPath}:${entry.lineNumber}${label}${preview}\n`;
		}
		output += "\n";
	}

	// Suggested reads
	const reads = buildSuggestedReads(entries, focus);
	if (reads.length > 0) {
		output += "Suggested reads:\n";
		for (const read of reads) {
			output += `- ${read.path} — ${read.reason}\n`;
		}
	}

	// Enforce character cap
	if (output.length > MAX_MAP_CHARS) {
		output = output.slice(0, MAX_MAP_CHARS - 4) + "\n…\n";
	}

	return output.trimEnd();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function relativeDisplayPath(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath);
	return (relative && !relative.startsWith("..") ? relative : filePath).replace(/\\/g, "/");
}

function findContainerForHit(
	hit: ParsedHit,
	containers: Map<string, Array<{ startLine: number; endLine: number; label: string }>>,
): { label: string; startLine: number; endLine: number } | null {
	const fileContainers = containers.get(hit.filePath);
	if (!fileContainers || fileContainers.length === 0) return null;

	let winner: { label: string; startLine: number; endLine: number } | null = null;
	for (const container of fileContainers) {
		if (hit.lineNumber < container.startLine || hit.lineNumber > container.endLine) continue;
		if (!winner) {
			winner = container;
			continue;
		}
		const winnerSpan = winner.endLine - winner.startLine;
		const candidateSpan = container.endLine - container.startLine;
		if (candidateSpan < winnerSpan) winner = container;
	}
	return winner;
}

function deduplicateByFile(entries: NavigationEntry[]): NavigationEntry[] {
	const seen = new Set<string>();
	const result: NavigationEntry[] = [];
	for (const entry of entries) {
		const key = `${entry.filePath}:${entry.lineNumber}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}
	return result.slice(0, 4); // max 4 per lane to avoid one lane dominating
}
