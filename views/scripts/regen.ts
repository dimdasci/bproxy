#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkspaceManifest {
	name: string;
	sourceDir: string;
	hasSources: boolean;
}

export interface RegenTask {
	workspace: string;
	sourceDir: string;
	output: string;
}

export interface RegenPlan {
	tasks: readonly RegenTask[];
	skipped: readonly { name: string; reason: string }[];
}

export interface PlanOptions {
	exclude?: readonly string[];
}

export function planRegen(
	workspaces: readonly WorkspaceManifest[],
	options: PlanOptions = {},
): RegenPlan {
	const exclude = new Set(options.exclude ?? []);
	const tasks: RegenTask[] = [];
	const skipped: { name: string; reason: string }[] = [];

	for (const ws of workspaces) {
		if (exclude.has(ws.name)) {
			skipped.push({ name: ws.name, reason: "excluded by config" });
			continue;
		}
		if (!ws.hasSources) {
			skipped.push({ name: ws.name, reason: "no source files" });
			continue;
		}
		tasks.push({
			workspace: ws.name,
			sourceDir: ws.sourceDir,
			output: `docs/views/auto/${ws.name}-components.svg`,
		});
	}

	return { tasks, skipped };
}

// ─── CLI ───────────────────────────────────────────────────────────────

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Workspaces scanned by views:regen. Update when Phase 1 adds shared/, service/, etc.
// shared/ is types-only (no runtime components) — excluded from component graphs.
// See docs/solution/views.md § Diagram Set: auto/*.svg covers runtime workspaces only.
export const KNOWN_WORKSPACES = ["service", "extension", "cli"] as const;

function hasAnySourceFiles(dir: string): boolean {
	if (!existsSync(dir)) return false;
	let found = false;
	const walk = (d: string): void => {
		if (found) return;
		for (const entry of readdirSync(d)) {
			const full = join(d, entry);
			const st = statSync(full);
			if (st.isDirectory()) walk(full);
			else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) found = true;
			if (found) return;
		}
	};
	walk(dir);
	return found;
}

function discoverWorkspaces(): WorkspaceManifest[] {
	return KNOWN_WORKSPACES.map((name) => {
		const sourceDir = join(repoRoot, name, "src");
		return { name, sourceDir, hasSources: hasAnySourceFiles(sourceDir) };
	});
}

function runDependencyCruiser(task: RegenTask): void {
	const outputDir = resolve(repoRoot, dirname(task.output));
	mkdirSync(outputDir, { recursive: true });

	const configPath = resolve(repoRoot, ".dependency-cruiser.cjs");
	const dot = execSync(
		`npx depcruise --output-type dot --config "${configPath}" "${task.sourceDir}"`,
		{ cwd: repoRoot, encoding: "utf-8" },
	);

	const outputPath = resolve(repoRoot, task.output);

	try {
		execSync("which dot", { stdio: "ignore" });
		const svg = execSync("dot -Tsvg", {
			cwd: repoRoot,
			encoding: "utf-8",
			input: dot,
		});
		writeFileSync(outputPath, svg);
	} catch {
		const dotPath = outputPath.replace(/\.svg$/, ".dot");
		writeFileSync(dotPath, dot);
		process.stdout.write(
			`    ⚠ graphviz not found — wrote ${dotPath} instead. Install with: brew install graphviz\n`,
		);
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const workspaces = discoverWorkspaces();
	const plan = planRegen(workspaces);

	if (plan.tasks.length === 0) {
		process.stdout.write("No scannable workspaces — nothing to regenerate.\n");
		for (const s of plan.skipped) {
			process.stdout.write(`  · ${s.name}: ${s.reason}\n`);
		}
		process.exit(0);
	}

	process.stdout.write("Regenerating component graphs:\n");
	for (const task of plan.tasks) {
		process.stdout.write(`  · ${task.workspace} → ${task.output}\n`);
		runDependencyCruiser(task);
	}
	process.stdout.write("Done. Commit any SVGs that changed.\n");
}
