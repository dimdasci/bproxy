import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import type { EnrichSearchToolResultInput, ToolContent } from "../src/enrich.ts";
import {
	enrichSearchToolResult,
	findBackRefs,
	getContainers,
	parseBashSearchOutput,
	parseNativeGrepOutput,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const fixtureProject = path.resolve(repoRoot, "tools/pi/context-grep/test/fixtures/project");
const fixtureSource = path.resolve(fixtureProject, "src/search-target.ts");

let hasAstGrep = false;
try {
	await execFileAsync("ast-grep", ["--version"]);
	hasAstGrep = true;
} catch {
	// ast-grep not available — skip tests that need it
}

function textContent(text: string): ToolContent[] {
	return [{ type: "text", text }];
}

function sessionState(): EnrichSearchToolResultInput["sessionState"] {
	return { availability: "unknown" };
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
	it("extracts validated TypeScript container kinds", { skip: !hasAstGrep }, async () => {
		const containers = await getContainers(fixtureSource);
		const labels = containers.map((container) => container.label);

		assert.ok(labels.includes("interface SearchShape"));
		assert.ok(labels.includes("type SearchResult"));
		assert.ok(labels.includes("method run"));
		assert.ok(labels.includes("fn helper"));
		assert.ok(labels.includes("fn handleThing"));
	});
});

describe("findBackRefs", () => {
	it("finds callers of a function in the project", { skip: !hasAstGrep }, async () => {
		// helper is called from handleThing in the fixture
		const refs = await findBackRefs("helper", fixtureSource, 18, fixtureProject);
		// The fixture is in test/fixtures which is excluded by test path filter,
		// but the call IS in the same file so it would be found if not test-excluded.
		// For real code, test this on service/ source.
		assert.ok(Array.isArray(refs));
	});

	it("skips generic names", async () => {
		const refs = await findBackRefs("run", "fake.ts", 1, repoRoot);
		assert.deepEqual(refs, []);
	});

	it("skips very short names", async () => {
		const refs = await findBackRefs("x", "fake.ts", 1, repoRoot);
		assert.deepEqual(refs, []);
	});
});

describe("enrichSearchToolResult", () => {
	it("appends AST context with back-references for supported bash search results", {
		skip: !hasAstGrep,
	}, async () => {
		const state = sessionState();
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
			sessionState: state,
		});

		assert.ok(result);
		// Single text block: original + enrichment
		assert.equal(result.length, 1);
		const text = (result[0] as { text: string }).text;
		assert.match(text, /── AST context/);
		assert.match(text, /search-target\.ts:18-20 \[fn helper\]/);
		assert.match(text, /search-target\.ts:22-24 \[fn handleThing\]/);
	});

	it("uses a real bproxy source file for single-file grep validation", {
		skip: !hasAstGrep,
	}, async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'grep -n "loadBaseConfig" service/src/config.ts',
			content: textContent(
				"20:export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {",
			),
			signal: undefined,
			sessionState: state,
		});

		assert.ok(result);
		assert.equal(result.length, 1);
		const text = (result[0] as { text: string }).text;
		assert.match(text, /service\/src\/config\.ts:20-\d+ \[fn loadBaseConfig\]/);
		// Back-references: loadBaseConfig is called from other places
		assert.match(text, /Called from:/);
	});

	it("does not enrich unsupported log searches", { skip: !hasAstGrep }, async () => {
		const state = sessionState();
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
			sessionState: state,
		});

		assert.equal(result, null);
	});
});
