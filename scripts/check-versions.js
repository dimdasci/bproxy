#!/usr/bin/env node
/**
 * scripts/check-versions.js — Verify all version sources match root package.json.
 *
 * Exits 0 if all match, exits 1 with details on drift.
 * Intended for CI: included in `pnpm check`.
 *
 * Usage: node scripts/check-versions.js
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const expected = rootPkg.version;

const errors = [];

// ─── 1. Workspace package.json files ────────────────────────────────────

const workspaces = ["cli", "service", "extension", "shared", "views"];
for (const ws of workspaces) {
	const pkgPath = resolve(ROOT, ws, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		if (pkg.version !== expected) {
			errors.push(`${ws}/package.json: "${pkg.version}" (expected "${expected}")`);
		}
	} catch {
		// Optional workspace, skip
	}
}

// ─── 2. shared/src/version.ts ───────────────────────────────────────────

const versionTsPath = resolve(ROOT, "shared/src/version.ts");
const versionTs = readFileSync(versionTsPath, "utf8");
const match = versionTs.match(/export const VERSION = "([^"]*)"/);
if (match && match[1] !== expected) {
	errors.push(`shared/src/version.ts: "${match[1]}" (expected "${expected}")`);
}

// ─── 3. skill/SKILL.md frontmatter ─────────────────────────────────────

const skillPath = resolve(ROOT, "skill/SKILL.md");
try {
	const skill = readFileSync(skillPath, "utf8");
	const skillMatch = skill.match(/^\s*version:\s*"([^"]*)"/m);
	if (skillMatch && skillMatch[1] !== expected) {
		errors.push(`skill/SKILL.md: "${skillMatch[1]}" (expected "${expected}")`);
	}
} catch {
	// Optional, skip
}

// ─── Result ─────────────────────────────────────────────────────────────

if (errors.length > 0) {
	console.error(`\n✗ Version drift detected (root package.json = "${expected}"):\n`);
	for (const err of errors) {
		console.error(`  • ${err}`);
	}
	console.error(`\n  Fix: run "node scripts/sync-versions.js" and commit.\n`);
	process.exit(1);
}

console.log(`✓ All versions match: ${expected}`);
