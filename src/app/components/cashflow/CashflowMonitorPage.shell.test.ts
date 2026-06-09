import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowMonitorSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowMonitorPage.tsx'),
  'utf8',
);

describe('CashflowMonitorPage shell contract', () => {
  it('prioritizes weekly monitoring and the planning office page', () => {
    expect(cashflowMonitorSource).toContain('캐시플로 모니터링 허브');
    expect(cashflowMonitorSource).toContain('/cashflow/weekly');
    expect(cashflowMonitorSource).toContain('/cashflow/export');
    expect(cashflowMonitorSource).toContain('주간 모니터링');
    expect(cashflowMonitorSource).toContain('경영기획실 페이지');
    expect(cashflowMonitorSource).not.toContain('CashflowExportPage');
  });

  it('hides unfinished analysis and reconciliation entry points', () => {
    expect(cashflowMonitorSource).not.toContain('/cashflow/analytics');
    expect(cashflowMonitorSource).not.toContain('분석 대시보드');
    expect(cashflowMonitorSource).not.toContain('/bank-reconciliation');
    expect(cashflowMonitorSource).not.toContain('은행 대조');
    expect(cashflowMonitorSource).not.toContain('상태 우선, 추출은 다음 단계');
    expect(cashflowMonitorSource).not.toContain('엑셀 내보내기 열기');
  });

  it('hydrates all project cashflow snapshots through the Java read channel', () => {
    expect(cashflowMonitorSource).toContain('ensureProjectCashflowSnapshots');
    expect(cashflowMonitorSource).toContain('projects.map((project) => project.id)');
    expect(cashflowMonitorSource).toContain('void ensureProjectCashflowSnapshots(projectIds)');
  });
});
