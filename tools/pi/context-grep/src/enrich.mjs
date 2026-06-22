import path from "node:path";
import { ensureAstGrepAvailable, getContainers, isSupportedFile } from "./ast.mjs";
import { parseBashSearchOutput, parseNativeGrepOutput } from "./parse.mjs";

const MAX_CONTAINERS = 10;
const MAX_CONTAINER_LINES = 35;
const MAX_ENRICHMENT_CHARS = 12_000;
const MAX_FILES_TO_SCAN = 12;
const HEADER =
	"\n\n── AST context (%COUNT% containers, deduplicated) ────────────────────────────\n\n";

function getTextContent(content) {
	return content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("");
}

function relativeDisplayPath(filePath, cwd) {
	const relative = path.relative(cwd, filePath);
	return (relative && !relative.startsWith("..") ? relative : filePath).replace(/\\/g, "/");
}

function chooseSmallestContainer(containers, lineNumber) {
	let winner = null;
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

function truncateSnippet(snippet) {
	const lines = snippet.split("\n");
	if (lines.length <= MAX_CONTAINER_LINES) return lines;
	const headCount = 18;
	const tailCount = 16;
	const omitted = lines.length - headCount - tailCount;
	return [...lines.slice(0, headCount), `… ${omitted} lines omitted …`, ...lines.slice(-tailCount)];
}

function formatBlock(entry, cwd) {
	const hitLines = [...entry.hitLines].sort((left, right) => left - right);
	const heading = `▶ ${relativeDisplayPath(entry.filePath, cwd)}:${entry.startLine}-${entry.endLine} [${entry.label}] (grep hits: [${hitLines.join(", ")}])`;
	const body = truncateSnippet(entry.snippet)
		.map((line) => `    ${line}`)
		.join("\n");
	return `${heading}\n${body}`;
}

function rankEntries(entries) {
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

function buildAppendix(entries, cwd) {
	const selected = rankEntries(entries).slice(0, MAX_CONTAINERS);
	if (selected.length === 0) return null;
	const blocks = [];
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

function aggregateHits(hitGroups, cwd) {
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

function groupHitsByFile(hits) {
	const grouped = new Map();
	for (const hit of hits) {
		if (!isSupportedFile(hit.filePath)) continue;
		const existing = grouped.get(hit.filePath) ?? new Set();
		existing.add(hit.lineNumber);
		grouped.set(hit.filePath, existing);
	}
	return grouped;
}

function parsedSearchResult({ toolName, text, cwd, command, inputPath }) {
	if (toolName === "grep") {
		return parseNativeGrepOutput({ text, cwd, inputPath });
	}
	return parseBashSearchOutput({ text, cwd, command });
}

export async function enrichSearchToolResult({
	toolName,
	content,
	cwd,
	command,
	inputPath,
	signal,
	sessionState,
	onAstGrepUnavailable,
}) {
	try {
		const text = getTextContent(content);
		if (!text.trim()) return null;
		const parsed = parsedSearchResult({ toolName, text, cwd, command, inputPath });
		if (!parsed) return null;
		const groupedHits = groupHitsByFile(parsed.hits);
		if (groupedHits.size === 0) return null;
		if (!(await ensureAstGrepAvailable(sessionState, signal))) {
			onAstGrepUnavailable?.();
			return null;
		}
		const aggregated = [];
		const containerCache = new Map();
		for (const fileEntry of aggregateHits(groupedHits, cwd)) {
			let containers = containerCache.get(fileEntry.filePath);
			if (!containers) {
				containers = await getContainers(fileEntry.filePath, signal);
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
						hitLines: new Set(),
					};
					aggregated.push(existing);
				}
				existing.hitLines.add(lineNumber);
			}
		}
		const appendix = buildAppendix(aggregated, cwd);
		if (!appendix) return null;
		return [...content, { type: "text", text: appendix }];
	} catch {
		return null;
	}
}
