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

  it('shows settlement type labels instead of O/X settlement flags', () => {
    expect(source).toContain('정산 유형');
    expect(source).toContain('normalizeSettlementType(p.settlementType)');
    expect(source).toContain('SETTLEMENT_TYPE_SHORT[normalizeSettlementType(p.settlementType)]');
    expect(source).not.toContain('p.isSettled ?');
  });

  it('shows the business owner from registeredBy fields', () => {
    expect(source).toContain('사업 담당자');
    expect(source).toContain('p.registeredByName || p.managerName');
  });
});
