import { describe, expect, it } from 'vitest';
import { auditViews, loadView, type View } from './audit';

describe('loadView', () => {
  it('parses valid frontmatter and returns a typed view', () => {
    const content = `---
layer: c2
sources:
  - service/src/**
  - shared/**
relatedAdrs: [ADR-007]
---

# Containers
`;
    const result = loadView('docs/views/02-containers.md', content);
    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.slug).toBe('02-containers');
      expect(result.data.layer).toBe('c2');
      expect(result.data.sources).toEqual(['service/src/**', 'shared/**']);
      expect(result.data.relatedAdrs).toEqual(['ADR-007']);
    }
  });

  it('surfaces a structured error when a required field is missing', () => {
    const content = `---
layer: c2
---

# missing sources
`;
    const result = loadView('docs/views/broken.md', content);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/sources/i);
    }
  });

  it('surfaces a structured error when layer has an invalid value', () => {
    const content = `---
layer: not-a-layer
sources: [service/src/**]
---
`;
    const result = loadView('docs/views/broken.md', content);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/layer/);
    }
  });

  it('surfaces an error when no frontmatter block is present', () => {
    const result = loadView('docs/views/broken.md', '# just a title\n');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/frontmatter/i);
    }
  });

  it('surfaces an error on malformed YAML', () => {
    const content = `---
layer: c2
sources:
  - service/src/**
  this is not valid yaml: : :
---
`;
    const result = loadView('docs/views/broken.md', content);
    expect('error' in result).toBe(true);
  });
});

describe('auditViews', () => {
  const views: View[] = [
    {
      slug: '02-containers',
      path: 'docs/views/02-containers.md',
      sources: ['shared/**', 'service/src/**'],
    },
    {
      slug: '03-deployment',
      path: 'docs/views/03-deployment.md',
      sources: ['extension/manifest.json'],
    },
    {
      slug: '06-threat-model',
      path: 'docs/views/06-threat-model.md',
      sources: ['service/src/auth.ts'],
    },
  ];

  it('reports clean when no source globs match the diff', () => {
    const report = auditViews(views, ['README.md', 'tsconfig.json']);
    expect(report.affected).toEqual([]);
    expect(report.clean.map(v => v.slug)).toEqual(['02-containers', '03-deployment', '06-threat-model']);
  });

  it('flags a view whose source glob matches a changed file and the view itself is untouched', () => {
    const report = auditViews(views, ['service/src/auth.ts']);
    expect(report.affected).toHaveLength(2); // matches 02-containers (service/src/**) and 06-threat-model (exact)
    const containers = report.affected.find(a => a.view.slug === '02-containers');
    expect(containers).toBeDefined();
    expect(containers?.viewTouched).toBe(false);
    expect(containers?.matchedSources).toContain('service/src/auth.ts');
  });

  it('marks the view as touched when the diff also includes the view file', () => {
    const report = auditViews(views, ['service/src/auth.ts', 'docs/views/06-threat-model.md']);
    const threat = report.affected.find(a => a.view.slug === '06-threat-model');
    expect(threat?.viewTouched).toBe(true);
  });

  it('handles glob patterns including double-star', () => {
    const report = auditViews(views, ['shared/protocol/envelope.ts']);
    const containers = report.affected.find(a => a.view.slug === '02-containers');
    expect(containers).toBeDefined();
    expect(containers?.matchedSources).toEqual(['shared/protocol/envelope.ts']);
  });

  it('returns an empty affected list when sources are empty (defensive)', () => {
    const report = auditViews(
      [{ slug: 'edge', path: 'docs/views/edge.md', sources: [] }],
      ['service/src/auth.ts'],
    );
    expect(report.affected).toEqual([]);
  });
});
