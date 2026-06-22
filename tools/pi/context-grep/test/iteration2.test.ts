import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type { EnrichSearchToolResultInput, ToolContent } from "../src/enrich.ts";
import {
	buildNavigationMap,
	classifyHitKind,
	classifyPathKind,
	enrichSearchToolResult,
	inferTaskFocus,
	isSearchCommand,
	parseBashSearchOutput,
} from "../src/index.ts";

const repoRoot = process.cwd();
const fixtureProject = path.resolve(repoRoot, "tools/pi/context-grep/test/fixtures/project");
const fixtureSource = path.resolve(fixtureProject, "src/search-target.ts");

function textContent(text: string): ToolContent[] {
	return [{ type: "text", text }];
}

function sessionState(): EnrichSearchToolResultInput["sessionState"] {
	return { availability: "unknown" };
}

// ─── Iteration 2: Hardening ────────────────────────────────────────────────────

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

	it("does not parse output from heredoc containing grep commands", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: 'bash <<EOF\ngrep -rn "helper" tools/pi/context-grep/test/fixtures/project/src\nEOF',
			text: [
				"tools/pi/context-grep/test/fixtures/project/src/search-target.ts:18:export function helper(value: string) {",
			].join("\n"),
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

	it("preserves matched line text in single-file mode", () => {
		const result = parseBashSearchOutput({
			cwd: repoRoot,
			command: `grep -n "helper" ${fixtureSource}`,
			text: "18:export function helper(value: string) {",
		});

		assert.ok(result);
		assert.equal(result.hits[0]!.lineText, "export function helper(value: string) {");
	});
});

// ─── Iteration 2: Navigation map ──────────────────────────────────────────────

describe("classifyPathKind", () => {
	it("classifies test files", () => {
		assert.equal(classifyPathKind("service/src/__tests__/nick-scoping.test.ts"), "test");
		assert.equal(classifyPathKind("service/src/routes.spec.ts"), "test");
		assert.equal(classifyPathKind("test/integration/run.ts"), "test");
	});

	it("classifies docs", () => {
		assert.equal(classifyPathKind("docs/internal/plans/roadmap.md"), "docs");
		assert.equal(classifyPathKind("README.md"), "docs");
		assert.equal(classifyPathKind("CHANGELOG.md"), "docs");
	});

	it("classifies config", () => {
		assert.equal(classifyPathKind("tsconfig.json"), "config");
		assert.equal(classifyPathKind(".eslintrc.js"), "config");
		assert.equal(classifyPathKind("biome.json"), "config");
	});

	it("classifies generated", () => {
		assert.equal(classifyPathKind("dist/index.js"), "generated");
		assert.equal(classifyPathKind("node_modules/foo/index.js"), "generated");
		assert.equal(classifyPathKind("shared/src/types.d.ts"), "generated");
	});

	it("classifies fixtures", () => {
		assert.equal(
			classifyPathKind("tools/pi/context-grep/test/fixtures/project/src/search-target.ts"),
			"fixture",
		);
		assert.equal(classifyPathKind("test/__snapshots__/foo.snap"), "fixture");
	});

	it("classifies production code", () => {
		assert.equal(classifyPathKind("service/src/routes/session-actions.ts"), "production");
		assert.equal(classifyPathKind("shared/src/sessions.ts"), "production");
		assert.equal(classifyPathKind("cli/src/commands/fill.ts"), "production");
	});
});

describe("classifyHitKind", () => {
	it("classifies definition with container on start line", () => {
		const hit = {
			filePath: "service/src/config.ts",
			lineNumber: 20,
			lineText: "export function loadBaseConfig(env) {",
		};
		const container = { label: "fn loadBaseConfig", startLine: 20, endLine: 45 };
		assert.equal(classifyHitKind(hit, container), "definition");
	});

	it("classifies reference in production code", () => {
		const hit = {
			filePath: "service/src/routes/handler.ts",
			lineNumber: 35,
			lineText: "  const config = loadBaseConfig();",
		};
		assert.equal(classifyHitKind(hit, null), "reference");
	});

	it("classifies import line", () => {
		const hit = {
			filePath: "service/src/lifecycle.ts",
			lineNumber: 3,
			lineText: 'import { loadBaseConfig } from "./config.js";',
		};
		assert.equal(classifyHitKind(hit, null), "import");
	});

	it("classifies assertion in test file", () => {
		const hit = {
			filePath: "service/src/__tests__/nick-scoping.test.ts",
			lineNumber: 73,
			lineText: "    expect(result.sort()).toEqual([]);",
		};
		assert.equal(classifyHitKind(hit, null), "assertion");
	});

	it("classifies diagnostic from output", () => {
		const hit = {
			filePath: "service/src/routes.ts",
			lineNumber: 12,
			lineText: "error[E0001]: unused variable `x`",
		};
		assert.equal(classifyHitKind(hit, null), "diagnostic");
	});

	it("classifies docs file", () => {
		const hit = {
			filePath: "docs/internal/decisions.md",
			lineNumber: 5,
			lineText: "## ADR-3: Session lifecycle",
		};
		assert.equal(classifyHitKind(hit, null), "docs");
	});
});

describe("inferTaskFocus", () => {
	it("infers tests focus from command path", () => {
		const result = inferTaskFocus({
			command: 'grep -n ".sort()" service/src/__tests__/nick-scoping.test.ts',
			text: "73:    expect(result.sort()).toEqual([]);\n85:    arr.sort();",
			hits: [{ filePath: "service/src/__tests__/nick-scoping.test.ts", lineText: "sort()" }],
		});
		assert.ok(result);
		assert.equal(result.focus, "tests");
	});

	it("infers diagnostics from output", () => {
		const result = inferTaskFocus({
			command: 'rg "loadBaseConfig" service/src -n',
			text: "FAIL service/src/__tests__/config.test.ts\nAssertionError: expected undefined",
			hits: [{ filePath: "service/src/config.ts", lineText: "loadBaseConfig" }],
		});
		assert.ok(result);
		assert.equal(result.focus, "diagnostics");
	});

	it("infers definitions from identifier-shaped query", () => {
		const result = inferTaskFocus({
			command: 'rg "loadBaseConfig" service/src -n',
			text: "service/src/config.ts:20:export function loadBaseConfig(",
			hits: [{ filePath: "service/src/config.ts", lineText: "loadBaseConfig" }],
		});
		assert.ok(result);
		assert.equal(result.focus, "definitions");
	});

	it("infers docs focus from markdown path", () => {
		const result = inferTaskFocus({
			command: 'grep -rn "session" docs/',
			text: "docs/public/solution/service.md:5:## Session lifecycle",
			hits: [{ filePath: "docs/public/solution/service.md", lineText: "session" }],
		});
		assert.ok(result);
		assert.equal(result.focus, "docs");
	});

	it("returns null when focus is ambiguous", () => {
		const result = inferTaskFocus({
			command: 'rg "foo bar baz" .',
			text: "a.ts:1:foo bar baz\nb.ts:2:foo bar baz",
			hits: [
				{ filePath: "a.ts", lineText: "foo bar baz" },
				{ filePath: "b.ts", lineText: "foo bar baz" },
			],
		});
		assert.equal(result, null);
	});
});

describe("buildNavigationMap", () => {
	it("builds a navigation map with lanes", () => {
		const hits = [
			{
				filePath: "/repo/service/src/__tests__/nick-scoping.test.ts",
				lineNumber: 73,
				lineText: "    expect(result.sort()).toEqual([]);",
				displayPath: "service/src/__tests__/nick-scoping.test.ts",
			},
			{
				filePath: "/repo/service/src/routes/session-actions.ts",
				lineNumber: 25,
				lineText: "export function validateSession(nick: string) {",
				displayPath: "service/src/routes/session-actions.ts",
			},
			{
				filePath: "/repo/shared/src/sessions.ts",
				lineNumber: 11,
				lineText: "export function isValidNick(nick: string): boolean {",
				displayPath: "shared/src/sessions.ts",
			},
		];

		const containers = new Map([
			[
				"/repo/service/src/routes/session-actions.ts",
				[{ startLine: 25, endLine: 40, label: "fn validateSession" }],
			],
			["/repo/shared/src/sessions.ts", [{ startLine: 11, endLine: 15, label: "fn isValidNick" }]],
		]);

		const result = buildNavigationMap({
			hits,
			containers,
			cwd: "/repo",
			command: 'grep -n ".sort()" service/src/__tests__/nick-scoping.test.ts',
			text: "73:    expect(result.sort()).toEqual([]);\n85:    arr.sort();",
		});

		assert.ok(result);
		assert.match(result, /Navigation map/);
		assert.match(result, /Likely focus: tests/);
		assert.match(result, /Primary candidates:/);
		assert.match(result, /Suggested reads:/);
	});

	it("returns null when fewer than 2 hits", () => {
		const result = buildNavigationMap({
			hits: [
				{
					filePath: "/repo/src/foo.ts",
					lineNumber: 1,
					lineText: "x",
					displayPath: "src/foo.ts",
				},
			],
			containers: new Map(),
			cwd: "/repo",
			command: 'rg "x"',
			text: "src/foo.ts:1:x",
		});

		assert.equal(result, null);
	});

	it("respects character limit", () => {
		const hits = Array.from({ length: 50 }, (_, i) => ({
			filePath: `/repo/src/file${i}.ts`,
			lineNumber: 10,
			lineText: `const thing${i} = something;`,
			displayPath: `src/file${i}.ts`,
		}));

		const result = buildNavigationMap({
			hits,
			containers: new Map(),
			cwd: "/repo",
			command: 'rg "thing" src/ -n',
			text: hits.map((h) => `${h.displayPath}:${h.lineNumber}:${h.lineText}`).join("\n"),
		});

		assert.ok(result);
		assert.ok(result.length <= 3000);
	});
});

// ─── Replay fixtures from June 20 session ──────────────────────────────────────

describe("replay fixtures — June 20 session patterns", () => {
	it("Sonar test sort: enriches grep targeting test file .sort()", async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: `grep -n "run" ${fixtureSource}`,
			content: textContent(["11:	run(query: string) {"].join("\n")),
			signal: undefined,
			sessionState: state,
		});

		assert.ok(result);
		// Should have navigation map and/or AST context
		const allText = result.map((p) => p.text).join("");
		assert.match(allText, /AST context/);
	});

	it("heredoc false positive: does not enrich node inline script", async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: `node -e "const lines = require('fs').readFileSync('${fixtureSource}').toString().split('\\n'); lines.forEach((l,i) => { if(/grep|rg/.test(l)) console.log((i+1)+':'+l); })"`,
			content: textContent("18:export function helper(value: string) {"),
			signal: undefined,
			sessionState: state,
		});

		// Should NOT be enriched because it's a node -e command
		assert.equal(result, null);
	});

	it("broad multi-term query: handles pipe-separated identifiers", async () => {
		const state = sessionState();
		const result = await enrichSearchToolResult({
			toolName: "bash",
			cwd: repoRoot,
			command: `rg "helper|handleThing" tools/pi/context-grep/test/fixtures/project/src -n`,
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
		const allText = result.map((p) => p.text).join("");
		assert.match(allText, /AST context/);
	});

	it("docs search with no code: grep in .md files produces no AST enrichment", async () => {
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

		// Markdown files are not AST-supported, so no enrichment
		assert.equal(result, null);
	});
});
