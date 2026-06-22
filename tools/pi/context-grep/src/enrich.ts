import path from "node:path";
import type { AstContainer } from "./ast.ts";
import {
	ensureAstGrepAvailable,
	extractName,
	findEnclosing,
	getContainers,
	isSupportedFile,
} from "./ast.ts";
import { findBackRefs } from "./backrefs.ts";
import type { ParsedHit } from "./parse.ts";
import { parseBashSearchOutput, parseNativeGrepOutput } from "./parse.ts";

export interface TextContent {
	type: "text";
	text: string;
}

export interface OtherContent {
	type: string;
	[key: string]: unknown;
}

export type ToolContent = TextContent | OtherContent;

export interface EnrichSearchToolResultInput {
	toolName: "bash" | "grep";
	content: ToolContent[];
	cwd: string;
	command?: string;
	inputPath?: string;
	signal?: AbortSignal;
	sessionState: {
		availability: "unknown" | "ready" | "unavailable";
	};
	onAstGrepUnavailable?: () => void;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_CONTAINERS = 10;
const MAX_CONTAINER_LINES = 35;
const MAX_ENRICHMENT_CHARS = 12_000;
const MAX_FILES_TO_SCAN = 12;

// ─── Types ───────────────────────────────────────────────────────────────────

interface EnrichedContainer {
	filePath: string;
	startLine: number;
	endLine: number;
	label: string;
	snippet: string;
	grepHits: number[];
	backRefs: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTextContent(content: ToolContent[]): string {
	return content
		.filter((entry): entry is TextContent => entry.type === "text")
		.map((entry) => entry.text)
		.join("");
}

function shortenPath(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath);
	return (relative && !relative.startsWith("..") ? relative : filePath).replace(/\\/g, "/");
}

function truncateSnippet(text: string): string {
	const lines = text.split("\n");
	if (lines.length <= MAX_CONTAINER_LINES) return text;
	const head = lines.slice(0, 12);
	const tail = lines.slice(-5);
	return [...head, "        ...", ...tail].join("\n");
}

function groupHitsByFile(hits: ParsedHit[]): Map<string, number[]> {
	const grouped = new Map<string, number[]>();
	for (const hit of hits) {
		if (!isSupportedFile(hit.filePath)) continue;
		const existing = grouped.get(hit.filePath) ?? [];
		existing.push(hit.lineNumber);
		grouped.set(hit.filePath, existing);
	}
	return grouped;
}

function parsedSearchResult(input: {
	toolName: "bash" | "grep";
	text: string;
	cwd: string;
	command?: string;
	inputPath?: string;
}) {
	if (input.toolName === "grep") {
		return parseNativeGrepOutput({ text: input.text, cwd: input.cwd, inputPath: input.inputPath });
	}
	return parseBashSearchOutput({ text: input.text, cwd: input.cwd, command: input.command! });
}

// ─── Enrichment pipeline ─────────────────────────────────────────────────────

export async function enrichSearchToolResult(
	input: EnrichSearchToolResultInput,
): Promise<ToolContent[] | null> {
	try {
		const text = getTextContent(input.content);
		if (!text.trim()) return null;

		const parsed = parsedSearchResult({
			toolName: input.toolName,
			text,
			cwd: input.cwd,
			command: input.command,
			inputPath: input.inputPath,
		});
		if (!parsed) return null;

		const groupedHits = groupHitsByFile(parsed.hits);
		if (groupedHits.size === 0) return null;

		if (!(await ensureAstGrepAvailable(input.sessionState, input.signal))) {
			input.onAstGrepUnavailable?.();
			return null;
		}

		// Map hits to enclosing containers, deduplicating
		const enrichedMap = new Map<string, EnrichedContainer>();
		const containerCache = new Map<string, AstContainer[]>();

		// Sort files by hit count (most hits first), cap at MAX_FILES
		const fileEntries = [...groupedHits.entries()]
			.sort((a, b) => b[1].length - a[1].length)
			.slice(0, MAX_FILES_TO_SCAN);

		for (const [filePath, hitLines] of fileEntries) {
			let containers = containerCache.get(filePath);
			if (!containers) {
				containers = await getContainers(filePath, input.signal);
				containerCache.set(filePath, containers);
			}

			for (const lineNumber of hitLines) {
				const container = findEnclosing(lineNumber, containers);
				if (!container) continue;

				const key = `${filePath}:${container.startLine}`;
				const existing = enrichedMap.get(key);
				if (existing) {
					existing.grepHits.push(lineNumber);
				} else {
					enrichedMap.set(key, {
						filePath,
						startLine: container.startLine,
						endLine: container.endLine,
						label: container.label,
						snippet: container.snippet,
						grepHits: [lineNumber],
						backRefs: [],
					});
				}
			}
		}

		if (enrichedMap.size === 0) return null;

		// Rank by grep hit density (most hits first)
		const ranked = [...enrichedMap.values()].sort((a, b) => b.grepHits.length - a.grepHits.length);
		const top = ranked.slice(0, MAX_CONTAINERS);

		// Find back-references for definitions (grep hit lands on definition line)
		for (const container of top) {
			const isDefinition = container.grepHits.includes(container.startLine);
			if (!isDefinition) continue;

			const name = extractName(container.label);
			container.backRefs = await findBackRefs(
				name,
				container.filePath,
				container.startLine,
				input.cwd,
				input.signal,
			);
		}

		// Format output: single block appended to original
		const enrichment = formatEnrichment(top, input.cwd);
		if (!enrichment) return null;

		// Return original content with enrichment appended as single text block
		const originalText = text;
		return [{ type: "text", text: originalText + enrichment }];
	} catch {
		return null;
	}
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatEnrichment(containers: EnrichedContainer[], cwd: string): string | null {
	if (containers.length === 0) return null;

	let output = `\n\n── AST context (${containers.length} containers, deduplicated) ────────────────────────────\n\n`;
	let charCount = 0;

	for (const container of containers) {
		if (charCount > MAX_ENRICHMENT_CHARS) break;

		const shortFile = shortenPath(container.filePath, cwd);
		const hitsStr = container.grepHits.sort((a, b) => a - b).join(", ");

		let entry = `▶ ${shortFile}:${container.startLine}-${container.endLine} [${container.label}] (grep hits: [${hitsStr}])\n`;

		// Back-references
		if (container.backRefs.length > 0) {
			entry += "  │\n";
			entry += "  │ Called from:\n";
			for (const ref of container.backRefs) {
				entry += `  │   ${ref}\n`;
			}
			entry += "  │\n";
		}

		// Truncated function body
		const body = truncateSnippet(container.snippet);
		for (const line of body.split("\n")) {
			entry += `    ${line}\n`;
		}
		entry += "\n";

		charCount += entry.length;
		output += entry;
	}

	return output;
}
