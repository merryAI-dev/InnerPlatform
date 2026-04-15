import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectListPage.tsx'), 'utf8');

describe('ProjectListPage shell contract', () => {
  it('keeps the monitoring presets visible for admin exception detection', () => {
    expect(source).toContain('data-testid="project-monitoring-presets"');
    expect(source).toContain('data-testid="project-monitoring-preset-no-ledger"');
    expect(source).toContain('data-testid="project-monitoring-preset-pending-approval"');
    expect(source).toContain('data-testid="project-monitoring-preset-missing-evidence"');
    expect(source).toContain('원장 없음');
    expect(source).toContain('승인 대기');
    expect(source).toContain('증빙 미제출');
  });
});
