import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import type { EnrichSearchToolResultInput, ToolContent } from "../src/enrich.ts";
import { enrichSearchToolResult, isSearchCommand, parseBashSearchOutput } from "../src/index.ts";

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

// ─── Hardening: heredoc/script false positive rejection ────────────────────────

describe("isSearchCommand — heredoc/script-analysis false positives", () => {
	it("rejects node -e with grep in the script text", () => {
		assert.equal(isSearchCommand('node -e "const x = grep(data)"'), false);
	});

	it("rejects node script that contains rg in variable names", () => {
		assert.equal(isSearchCommand("node scripts/analyze-sessions.mjs --filter rg"), false);
	});

	it("rejects python -c with grep-like pattern", () => {
		assert.equal(isSearchCommand('python3 -c "import re; re.grep(pattern, text)"'), false);
	});

	it("rejects heredoc containing grep", () => {
		assert.equal(isSearchCommand('cat <<EOF\ngrep "hello" file.txt\nEOF'), false);
	});

	it("rejects heredoc with dash form", () => {
		assert.equal(isSearchCommand('bash <<-SCRIPT\nrg "term" src/\nSCRIPT'), false);
	});

	it("rejects npx commands even with grep args", () => {
		assert.equal(isSearchCommand("npx tsx scripts/find-grep-usage.ts"), false);
	});

	it("accepts a real grep command", () => {
		assert.equal(isSearchCommand('grep -rn "Session" service/src/'), true);
	});

	it("accepts a piped grep command", () => {
		assert.equal(isSearchCommand('find . -name "*.ts" | grep -v node_modules'), true);
	});

	it("accepts rg with flags", () => {
		assert.equal(isSearchCommand('rg "handleRequest" service/src -n --type ts'), true);
	});

	it("accepts grep after semicolon", () => {
		assert.equal(isSearchCommand('cd service && grep -rn "config" src/'), true);
	});
});

// ─── Parser fixtures ───────────────────────────────────────────────────────────

describe("parseBashSearchOutput — grep -rn fixture", () => {
	it("parses grep -rn output with file paths", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'grep -rn "helper" tools/pi/context-grep/test/fixtures/project/src',
			text: [
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:23:  return helper(value);",
			].join("\n"),
		});

		assert.ok(result);
		assert.equal(result.kind, "bash");
		assert.equal(result.hits.length, 2);
		assert.equal(result.hits[0]!.filePath, fixtureSource);
		assert.equal(result.hits[0]!.lineNumber, 18);
		assert.equal(result.hits[0]!.lineText, "export function helper(value: string) {");
		assert.equal(result.hits[1]!.lineNumber, 23);
		assert.equal(result.hits[1]!.lineText, "  return helper(value);");
	});
});

describe("parseBashSearchOutput — heredoc/script negative fixtures", () => {
	it("does not parse output from a node script that analyzed grep output", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command:
				"node -e \"const fs = require('fs'); const lines = fs.readFileSync('session.log').toString().split('\\n').filter(l => /grep|rg/.test(l)); console.log(lines.join('\\n'))\"",
			text: [
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:23:  return helper(value);",
			].join("\n"),
		});

		assert.equal(result, null);
	});

	it("does not parse output from python script containing grep text", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: "python3 -c \"import subprocess; subprocess.run(['grep', '-n', 'test'])\"",
			text: "tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
		});

		assert.equal(result, null);
	});
});

describe("parseBashSearchOutput — lineText preservation", () => {
	it("preserves matched line text in direct-match parsing", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'rg "helper|handleThing" tools/pi/context-grep/test/fixtures/project/src -n',
			text: [
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:23:  return helper(value);",
			].join("\n"),
		});

		assert.ok(result);
		assert.equal(result.hits[0]!.lineText, "export function helper(value: string) {");
		assert.equal(result.hits[1]!.lineText, "  return helper(value);");
	});
});

// ─── End-to-end enrichment ─────────────────────────────────────────────────────

describe("enrichment — single-block output with back-references", () => {
	it("produces single text block with original + AST context", { skip: !hasAstGrep }, async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'rg "helper|handleThing" tools/pi/context-grep/test/fixtures/project/src -n',
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
		// Single block: original text + enrichment appended
		assert.equal(result.length, 1);
		const text = (result[0] as { text: string }).text;

		// Original output preserved at top
		assert.match(text, /^tools\/pi\/context-grep/);

		// AST context appended
		assert.match(text, /── AST context/);
		assert.match(text, /\[fn helper\]/);
		assert.match(text, /\[fn handleThing\]/);
	});

	it("includes back-references for real bproxy definitions", { skip: !hasAstGrep }, async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'rg "loadBaseConfig" service/src -n',
			content: textContent(
				[
					"service/src/config.ts:20:export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {",
					"service/src/index.ts:20:\t\t\tconst config = loadBaseConfig();",
					"service/src/index.ts:26:\t\t\tconst config = loadBaseConfig();",
				].join("\n"),
			),
			signal: undefined,
			sessionState: state,
		});

		assert.ok(result);
		assert.equal(result.length, 1);
		const text = (result[0] as { text: string }).text;

		// Has AST context
		assert.match(text, /── AST context/);
		assert.match(text, /\[fn loadBaseConfig\]/);

		// Has back-references (loadBaseConfig is called from other files)
		assert.match(text, /Called from:/);
	});

	it("heredoc false positive: does not enrich node inline script", {
		skip: !hasAstGrep,
	}, async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: `node -e "const lines = require('fs').readFileSync('${fixtureSource}').toString().split('\\n'); lines.forEach((l,i) => { if(/grep|rg/.test(l)) console.log((i+1)+':'+l); })"`,
			content: textContent("18:export function helper(value: string) {"),
			signal: undefined,
			sessionState: state,
		});

		assert.equal(result, null);
	});

	it("does not enrich markdown/docs searches", { skip: !hasAstGrep }, async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: 'grep -rn "session" docs/',
			content: textContent(
				[
					"docs/internal/plans/phases/09-tooling.md:5:status: In progress",
					"docs/internal/plans/phases/09-tooling.md:10:## Phase 9: Agent search tooling",
				].join("\n"),
			),
			signal: undefined,
			sessionState: state,
		});

		assert.equal(result, null);
	});
});
