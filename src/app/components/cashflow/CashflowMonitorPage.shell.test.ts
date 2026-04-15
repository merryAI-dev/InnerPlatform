import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowMonitorSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowMonitorPage.tsx'),
  'utf8',
);

describe('CashflowMonitorPage shell contract', () => {
  it('frames cashflow as a monitoring hub with export as a subtool', () => {
    expect(cashflowMonitorSource).toContain('캐시플로 모니터링 허브');
    expect(cashflowMonitorSource).toContain('/cashflow/weekly');
    expect(cashflowMonitorSource).toContain('/cashflow/analytics');
    expect(cashflowMonitorSource).toContain('/bank-reconciliation');
    expect(cashflowMonitorSource).toContain('/cashflow/export');
    expect(cashflowMonitorSource).toContain('주간 모니터링');
    expect(cashflowMonitorSource).toContain('분석 대시보드');
    expect(cashflowMonitorSource).toContain('은행 대조');
    expect(cashflowMonitorSource).toContain('엑셀 내보내기');
    expect(cashflowMonitorSource).not.toContain('CashflowExportPage');
  });
});
