import path from "node:path";

import type { AstContainer } from "./ast.ts";
import { ensureAstGrepAvailable, getContainers, isSupportedFile } from "./ast.ts";
import { buildNavigationMap } from "./navigate.ts";
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

const MAX_CONTAINERS = 10;
const MAX_CONTAINER_LINES = 35;
const MAX_ENRICHMENT_CHARS = 12_000;
const MAX_FILES_TO_SCAN = 12;
const HEADER =
	"\n\n── AST context (%COUNT% containers, deduplicated) ────────────────────────────\n\n";

interface AggregatedEntry {
	key: string;
	filePath: string;
	startLine: number;
	endLine: number;
	label: string;
	snippet: string;
	hitLines: Set<number>;
}

function getTextContent(content: ToolContent[]): string {
	return content
		.filter((entry): entry is TextContent => entry.type === "text")
		.map((entry) => entry.text)
		.join("");
}

function relativeDisplayPath(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath);
	return (relative && !relative.startsWith("..") ? relative : filePath).replace(/\\/g, "/");
}

function chooseSmallestContainer(
	containers: AstContainer[],
	lineNumber: number,
): AstContainer | null {
	let winner: AstContainer | null = null;
	for (const container of containers) {
		if (lineNumber < container.startLine || lineNumber > container.endLine) continue;
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

function truncateSnippet(snippet: string): string[] {
	const lines = snippet.split("\n");
	if (lines.length <= MAX_CONTAINER_LINES) return lines;
	const headCount = 18;
	const tailCount = 16;
	const omitted = lines.length - headCount - tailCount;
	return [...lines.slice(0, headCount), `… ${omitted} lines omitted …`, ...lines.slice(-tailCount)];
}

function formatBlock(entry: AggregatedEntry, cwd: string): string {
	const hitLines = [...entry.hitLines].sort((left, right) => left - right);
	const heading = `▶ ${relativeDisplayPath(entry.filePath, cwd)}:${entry.startLine}-${entry.endLine} [${entry.label}] (grep hits: [${hitLines.join(", ")}])`;
	const body = truncateSnippet(entry.snippet)
		.map((line) => `    ${line}`)
		.join("\n");
	return `${heading}\n${body}`;
}

function rankEntries(entries: AggregatedEntry[]): AggregatedEntry[] {
	return [...entries].sort((left, right) => {
		if (right.hitLines.size !== left.hitLines.size) {
			return right.hitLines.size - left.hitLines.size;
		}
		const leftPath = left.filePath;
		const rightPath = right.filePath;
		if (leftPath !== rightPath) return leftPath.localeCompare(rightPath);
		return left.startLine - right.startLine;
	});
}

function buildAppendix(entries: AggregatedEntry[], cwd: string): string | null {
	const selected = rankEntries(entries).slice(0, MAX_CONTAINERS);
	if (selected.length === 0) return null;
	const blocks: string[] = [];
	for (const entry of selected) {
		const block = `${formatBlock(entry, cwd)}\n\n`;
		const tentativeHeader = HEADER.replace("%COUNT%", String(blocks.length + 1));
		const tentativeOutput = tentativeHeader + blocks.join("") + block;
		if (tentativeOutput.length > MAX_ENRICHMENT_CHARS) break;
		blocks.push(block);
	}
	if (blocks.length === 0) return null;
	return (HEADER.replace("%COUNT%", String(blocks.length)) + blocks.join("")).trimEnd();
}

interface FileEntry {
	filePath: string;
	hitLines: Set<number>;
	displayPath: string;
}

function aggregateHits(hitGroups: Map<string, Set<number>>, cwd: string): FileEntry[] {
	return [...hitGroups.entries()]
		.map(([filePath, hitLines]) => ({
			filePath,
			hitLines,
			displayPath: relativeDisplayPath(filePath, cwd),
		}))
		.sort((left, right) => {
			if (right.hitLines.size !== left.hitLines.size)
				return right.hitLines.size - left.hitLines.size;
			return left.displayPath.localeCompare(right.displayPath);
		})
		.slice(0, MAX_FILES_TO_SCAN);
}

function groupHitsByFile(hits: ParsedHit[]): Map<string, Set<number>> {
	const grouped = new Map<string, Set<number>>();
	for (const hit of hits) {
		if (!isSupportedFile(hit.filePath)) continue;
		const existing = grouped.get(hit.filePath) ?? new Set<number>();
		existing.add(hit.lineNumber);
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
		const aggregated: AggregatedEntry[] = [];
		const containerCache = new Map<string, AstContainer[]>();
		for (const fileEntry of aggregateHits(groupedHits, input.cwd)) {
			let containers = containerCache.get(fileEntry.filePath);
			if (!containers) {
				containers = await getContainers(fileEntry.filePath, input.signal);
				containerCache.set(fileEntry.filePath, containers);
			}
			for (const lineNumber of fileEntry.hitLines) {
				const container = chooseSmallestContainer(containers, lineNumber);
				if (!container) continue;
				const key = `${fileEntry.filePath}:${container.startLine}:${container.endLine}`;
				let existing = aggregated.find((entry) => entry.key === key);
				if (!existing) {
					existing = {
						key,
						filePath: fileEntry.filePath,
						startLine: container.startLine,
						endLine: container.endLine,
						label: container.label,
						snippet: container.snippet,
						hitLines: new Set<number>(),
					};
					aggregated.push(existing);
				}
				existing.hitLines.add(lineNumber);
			}
		}

		// Build navigation map with all hits (including those without containers)
		const navMap = buildNavigationMap({
			hits: parsed.hits,
			containers: containerCache,
			cwd: input.cwd,
			command: input.command,
			text,
		});

		const appendix = buildAppendix(aggregated, input.cwd);

		// If neither navigation map nor AST context is available, skip enrichment
		if (!navMap && !appendix) return null;

		const enrichedParts: ToolContent[] = [...input.content];
		if (navMap) enrichedParts.push({ type: "text", text: navMap });
		if (appendix) enrichedParts.push({ type: "text", text: appendix });
		return enrichedParts;
	} catch {
		return null;
	}
}
