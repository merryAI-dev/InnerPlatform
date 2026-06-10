import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const projectRoutesSource = readFileSync(resolve(repoRoot, 'server/bff/routes/projects.mjs'), 'utf8');

describe('project default bank statement policy', () => {
  it('seeds a default bank statement document whenever the project API creates a project', () => {
    expect(projectRoutesSource).toContain('DEFAULT_BANK_STATEMENT_COLUMNS');
    expect(projectRoutesSource).toContain('buildDefaultBankStatementDoc');
    expect(projectRoutesSource).toContain("projects/${projectPayload.id}/bank_statements/default");
    expect(projectRoutesSource).toContain('if (result.created) {');
    expect(projectRoutesSource).toContain('rows: []');
  });
});
