#!/usr/bin/env node
/**
 * scripts/sync-versions.js — Propagate root package.json version everywhere.
 *
 * Single source of truth: root package.json "version" field.
 * Targets: workspace package.jsons, shared/src/version.ts, skill/SKILL.md frontmatter.
 *
 * Usage: node scripts/sync-versions.js
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version = rootPkg.version;

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`ERROR: Invalid version in root package.json: "${version}"`);
	process.exit(1);
}

console.log(`▸ Syncing version: ${version}`);

// ─── 1. Workspace package.json files ────────────────────────────────────

const workspaces = ["cli", "service", "extension", "shared", "views"];
for (const ws of workspaces) {
	const pkgPath = resolve(ROOT, ws, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		if (pkg.version !== version) {
			pkg.version = version;
			writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
			console.log(`  ✓ ${ws}/package.json → ${version}`);
		} else {
			console.log(`  · ${ws}/package.json (already ${version})`);
		}
	} catch {
		console.log(`  · ${ws}/package.json (not found, skipped)`);
	}
}

// ─── 2. shared/src/version.ts ───────────────────────────────────────────

const versionTsPath = resolve(ROOT, "shared/src/version.ts");
const versionTs = readFileSync(versionTsPath, "utf8");
const updatedVersionTs = versionTs.replace(
	/export const VERSION = "[^"]*"/,
	`export const VERSION = "${version}"`,
);
if (updatedVersionTs !== versionTs) {
	writeFileSync(versionTsPath, updatedVersionTs);
	console.log(`  ✓ shared/src/version.ts → ${version}`);
} else {
	console.log(`  · shared/src/version.ts (already ${version})`);
}

// ─── 3. skill/SKILL.md frontmatter ─────────────────────────────────────

const skillPath = resolve(ROOT, "skill/SKILL.md");
try {
	const skill = readFileSync(skillPath, "utf8");
	const lines = skill.split("\n");
	let updated = false;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trimStart().startsWith("version:")) {
			const indent = lines[i].slice(0, lines[i].indexOf("version:"));
			lines[i] = `${indent}version: "${version}"`;
			updated = true;
			break;
		}
	}
	if (updated) {
		const result = lines.join("\n");
		if (result !== skill) {
			writeFileSync(skillPath, result);
			console.log(`  ✓ skill/SKILL.md → ${version}`);
		} else {
			console.log(`  · skill/SKILL.md (already ${version})`);
		}
	} else {
		console.log(`  · skill/SKILL.md (no version line found, skipped)`);
	}
} catch {
	console.log(`  · skill/SKILL.md (not found, skipped)`);
}

console.log(`\n✓ All versions synced to ${version}`);
