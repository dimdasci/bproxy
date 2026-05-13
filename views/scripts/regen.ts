#!/usr/bin/env tsx
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      skipped.push({ name: ws.name, reason: 'excluded by config' });
      continue;
    }
    if (!ws.hasSources) {
      skipped.push({ name: ws.name, reason: 'no source files' });
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Workspaces scanned by views:regen. Update when Phase 1 adds shared/, service/, etc.
const KNOWN_WORKSPACES = ['shared', 'service', 'extension', 'cli'] as const;

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
  return KNOWN_WORKSPACES.map(name => {
    const sourceDir = join(repoRoot, name, 'src');
    return { name, sourceDir, hasSources: hasAnySourceFiles(sourceDir) };
  });
}

function runDependencyCruiser(_task: RegenTask): void {
  // Intentionally not wired in Phase 0.7: there is no production source code yet.
  // Phase 1 adds dependency-cruiser to the workspace and this function should:
  //   1. invoke `npx dependency-cruiser --output-type dot <sourceDir> | dot -Tsvg > <output>`
  //   2. ensure docs/views/auto/ exists
  //   3. respect ADR-012 dep-cruiser config
  // Until then, this function is a stub; planRegen still reports the workspace as scannable
  // if sources exist, so the CLI surfaces meaningful output when Phase 1 lands.
  throw new Error('dependency-cruiser invocation is wired in Phase 1; this code path is unreachable in v1.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const workspaces = discoverWorkspaces();
  const plan = planRegen(workspaces);

  if (plan.tasks.length === 0) {
    process.stdout.write('No scannable workspaces — nothing to regenerate.\n');
    for (const s of plan.skipped) {
      process.stdout.write(`  · ${s.name}: ${s.reason}\n`);
    }
    process.exit(0);
  }

  process.stdout.write('Regenerating component graphs:\n');
  for (const task of plan.tasks) {
    process.stdout.write(`  · ${task.workspace} → ${task.output}\n`);
    runDependencyCruiser(task);
  }
  process.stdout.write('Done. Commit any SVGs that changed.\n');
}
