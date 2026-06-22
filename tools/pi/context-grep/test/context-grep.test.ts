import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type { ToolContent } from "../src/enrich.ts";
import {
	enrichSearchToolResult,
	getContainers,
	parseBashSearchOutput,
	parseNativeGrepOutput,
} from "../src/index.ts";

const repoRoot = process.cwd();
const fixtureProject = path.resolve(repoRoot, "tools/pi/context-grep/test/fixtures/project");
const fixtureSource = path.resolve(fixtureProject, "src/search-target.ts");

function textContent(text: string): ToolContent[] {
	return [{ type: "text", text }];
}

describe("parseNativeGrepOutput", () => {
	it("parses file:line rows and ignores context rows", () => {
		const result = parseNativeGrepOutput({
			cwd: fixtureProject,
			inputPath: "src",
			text: [
				"search-target.ts-17- ",
				"search-target.ts:18:export function helper(value: string) {",
				"search-target.ts-19-   return value.trim();",
			].join("\n"),
		});

		assert.ok(result);
		assert.equal(result.hits.length, 1);
		assert.equal(result.hits[0]!.filePath, fixtureSource);
		assert.equal(result.hits[0]!.lineNumber, 18);
	});
});

describe("parseBashSearchOutput", () => {
	it("parses rg output with file paths", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'rg "helper" tools/pi/context-grep/test/fixtures/project/src -n',
			text: [
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:23:  return helper(value);",
			].join("\n"),
		});

		assert.ok(result);
		assert.equal(result.hits.length, 2);
		assert.equal(result.hits[0]!.filePath, fixtureSource);
		assert.equal(result.hits[1]!.lineNumber, 23);
	});

	it("parses single-file grep -n output by inferring the file from the command", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'grep -n "loadBaseConfig" service/src/config.ts',
			text: "20:export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {",
		});

		assert.ok(result);
		assert.equal(result.singleFile, path.resolve(repoRoot, "service/src/config.ts"));
		assert.equal(result.hits[0]!.lineNumber, 20);
	});

	it("skips path-list style output such as grep -l", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'grep -l "helper" tools/pi/context-grep/test/fixtures/project/src/*.ts',
			text: "tools/pi/context-grep/test/fixtures/project/src/search-target.ts",
		});

		assert.equal(result, null);
	});
});

describe("getContainers", () => {
	it("extracts validated TypeScript container kinds", async () => {
		const containers = await getContainers(fixtureSource);
		const labels = containers.map((container) => container.label);

		assert.ok(labels.includes("interface SearchShape"));
		assert.ok(labels.includes("type SearchResult"));
		assert.ok(labels.includes("method run"));
		assert.ok(labels.includes("fn helper"));
		assert.ok(labels.includes("fn handleThing"));
	});
});

describe("enrichSearchToolResult", () => {
	it("appends bounded AST context for supported bash search results", async () => {
		const sessionState: { availability: "unknown" | "ready" | "unavailable" } = {
			availability: "unknown",
		};
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'rg "helper" tools/pi/context-grep/test/fixtures/project/src -n',
			content: textContent(
				[
					"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
					"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:23:  return helper(value);",
				].join("\n"),
			),
			signal: undefined,
			sessionState,
		});

		assert.ok(result);
		// Original content + navigation map + AST context
		assert.ok(result.length >= 2);
		const astPart = result.find(
			(part) => "text" in part && (part.text as string).includes("── AST context"),
		);
		assert.ok(astPart && "text" in astPart);
		assert.match(astPart.text as string, /── AST context \(2 containers, deduplicated\)/);
		assert.match(astPart.text as string, /search-target\.ts:18-20 \[fn helper\]/);
		assert.match(astPart.text as string, /search-target\.ts:22-24 \[fn handleThing\]/);
	});

	it("uses a real bproxy source file for single-file grep validation", async () => {
		const sessionState: { availability: "unknown" | "ready" | "unavailable" } = {
			availability: "unknown",
		};
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'grep -n "loadBaseConfig" service/src/config.ts',
			content: textContent(
				"20:export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {",
			),
			signal: undefined,
			sessionState,
		});

		assert.ok(result);
		const block = result[1];
		assert.ok(block && "text" in block);
		assert.match(block.text as string, /service\/src\/config\.ts:20-\d+ \[fn loadBaseConfig\]/);
	});

	it("does not enrich unsupported log searches", async () => {
		const sessionState: { availability: "unknown" | "ready" | "unavailable" } = {
			availability: "unknown",
		};
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'rg "event" tools/pi/context-grep/test/fixtures/project/logs -n',
			content: textContent(
				[
					'tools/pi/context-grep/test/fixtures/project/logs/session.jsonl:1:{"event":"search","ok":true}',
					'tools/pi/context-grep/test/fixtures/project/logs/session.jsonl:2:{"event":"search","ok":false}',
				].join("\n"),
			),
			signal: undefined,
			sessionState,
		});

		assert.equal(result, null);
	});
});
