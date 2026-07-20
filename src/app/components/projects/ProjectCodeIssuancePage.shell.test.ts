import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectCodeIssuancePage.tsx'), 'utf8');

describe('ProjectCodeIssuancePage', () => {
  it('reuses the formal registration review surface in management-planning mode', () => {
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('reviewStage="managementPlanning"');
  });
});
