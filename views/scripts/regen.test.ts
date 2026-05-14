import { describe, expect, it } from 'vitest';
import { planRegen, type WorkspaceManifest } from './regen';

describe('planRegen', () => {
  it('emits a single task per scannable workspace', () => {
    const workspaces: WorkspaceManifest[] = [
      { name: 'service', sourceDir: 'service/src', hasSources: true },
      { name: 'extension', sourceDir: 'extension/src', hasSources: true },
      { name: 'cli', sourceDir: 'cli/src', hasSources: true },
    ];
    const plan = planRegen(workspaces);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0]?.output).toBe('docs/views/auto/service-components.svg');
    expect(plan.skipped).toEqual([]);
  });

  it('skips workspaces with no source files', () => {
    const workspaces: WorkspaceManifest[] = [
      { name: 'service', sourceDir: 'service/src', hasSources: false },
      { name: 'views', sourceDir: 'views/src', hasSources: true },
    ];
    const plan = planRegen(workspaces);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.workspace).toBe('views');
    expect(plan.skipped.map(s => s.name)).toEqual(['service']);
  });

  it('returns an empty plan when no workspaces have sources', () => {
    const plan = planRegen([
      { name: 'service', sourceDir: 'service/src', hasSources: false },
      { name: 'cli', sourceDir: 'cli/src', hasSources: false },
    ]);
    expect(plan.tasks).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  it('ignores workspaces named "views" only when explicitly excluded', () => {
    const plan = planRegen(
      [
        { name: 'views', sourceDir: 'views/src', hasSources: true },
        { name: 'service', sourceDir: 'service/src', hasSources: true },
      ],
      { exclude: ['views'] },
    );
    expect(plan.tasks.map(t => t.workspace)).toEqual(['service']);
    expect(plan.skipped.map(s => s.name)).toEqual(['views']);
  });
});
