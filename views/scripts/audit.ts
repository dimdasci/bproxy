#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { minimatch } from "minimatch";
import { type ViewFrontmatter, viewSchema } from "../src/lib/view-schema";

export interface View {
	slug: string;
	path: string;
	sources: readonly string[];
}

export interface AffectedView {
	view: View;
	matchedSources: readonly string[];
	viewTouched: boolean;
}

export interface AuditReport {
	affected: readonly AffectedView[];
	clean: readonly View[];
}

export interface LoadedView {
	slug: string;
	path: string;
	data: ViewFrontmatter;
}

export interface LoadError {
	path: string;
	error: string;
}

export function loadView(path: string, content: string): LoadedView | LoadError {
	const match = /^---\n([\s\S]*?)\n---/.exec(content);
	if (!match) return { path, error: "no YAML frontmatter block" };
	let parsed: unknown;
	try {
		parsed = yamlLoad(match[1] ?? "");
	} catch (e) {
		return { path, error: `YAML parse error: ${(e as Error).message}` };
	}
	const result = viewSchema.safeParse(parsed);
	if (!result.success) {
		const issue = result.error.issues[0];
		const field = issue?.path.join(".") || "(root)";
		return { path, error: `${field}: ${issue?.message ?? "invalid"}` };
	}
	const slug = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
	return { slug, path, data: result.data };
}

export function auditViews(views: readonly View[], changedFiles: readonly string[]): AuditReport {
	const affected: AffectedView[] = [];
	const clean: View[] = [];

	for (const view of views) {
		if (view.sources.length === 0) {
			clean.push(view);
			continue;
		}
		const matchedSources = changedFiles.filter((f) =>
			view.sources.some((glob) => minimatch(f, glob)),
		);
		const viewTouched = changedFiles.includes(view.path);
		if (matchedSources.length > 0) {
			affected.push({ view, matchedSources, viewTouched });
		} else {
			clean.push(view);
		}
	}

	return { affected, clean };
}

// ─── CLI ───────────────────────────────────────────────────────────────

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function discoverViews(viewsDir: string): { views: View[]; errors: LoadError[] } {
	const views: View[] = [];
	const errors: LoadError[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.endsWith(".md")) continue;
			const rel = relative(repoRoot, full);
			const result = loadView(rel, readFileSync(full, "utf8"));
			if ("error" in result) {
				errors.push(result);
			} else {
				views.push({ slug: result.slug, path: result.path, sources: result.data.sources });
			}
		}
	};
	walk(viewsDir);
	return { views, errors };
}

function getChangedFiles(base: string): string[] {
	const raw = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" });
	return raw
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

function formatErrors(errors: readonly LoadError[]): string[] {
	if (errors.length === 0) return [];
	const lines = ["Frontmatter validation errors:"];
	for (const e of errors) lines.push(`  \u2717 ${e.path}  ${e.error}`);
	lines.push("");
	return lines;
}

function formatAffected(affected: AuditReport["affected"]): string[] {
	const lines = ["Views potentially affected by this branch:"];
	for (const a of affected) {
		const icon = a.viewTouched ? "\u2713" : "\u26a0";
		lines.push(
			`  ${icon} ${a.view.slug.padEnd(24)} touched-sources: ${a.matchedSources.length}  view-touched: ${a.viewTouched ? "yes" : "no"}`,
		);
		for (const m of a.matchedSources.slice(0, 4)) lines.push(`      ${m}`);
		if (a.matchedSources.length > 4)
			lines.push(`      \u2026 +${a.matchedSources.length - 4} more`);
	}
	return lines;
}

function formatReport(report: AuditReport, errors: readonly LoadError[]): string {
	const lines: string[] = [...formatErrors(errors)];

	const hasAffected = report.affected.length > 0;
	if (!hasAffected && errors.length === 0) {
		lines.push("No views affected by changes in this branch.");
		return lines.join("\n");
	}

	if (hasAffected) {
		lines.push(...formatAffected(report.affected));
	}

	for (const v of report.clean) {
		lines.push(`  \u2713 ${v.slug.padEnd(24)} (no source globs matched)`);
	}
	lines.push(
		"",
		"Helpers exit 0 regardless of findings. Review each \u26a0 (and any \u2717) and decide whether the view needs an update.",
	);
	return lines.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const base = process.argv[2] ?? "origin/main";
	const viewsDir = join(repoRoot, "docs/public/views");
	const { views, errors } = discoverViews(viewsDir);
	const changed = getChangedFiles(base);
	const report = auditViews(views, changed);
	process.stdout.write(formatReport(report, errors) + "\n");
}
