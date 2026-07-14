import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowMonitorSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowMonitorPage.tsx'),
  'utf8',
);

describe('CashflowMonitorPage shell contract', () => {
  it('prioritizes read-only weekly history and the planning office page', () => {
    expect(cashflowMonitorSource).toContain('캐시플로 모니터링 허브');
    expect(cashflowMonitorSource).toContain('/cashflow/weekly');
    expect(cashflowMonitorSource).toContain('/cashflow/export');
    expect(cashflowMonitorSource).toContain('주간 입력 이력');
    expect(cashflowMonitorSource).toContain('경영기획실 페이지');
    expect(cashflowMonitorSource).toContain('최종 확정과 수정 잠금은 월 결산에서 처리합니다.');
    expect(cashflowMonitorSource).toContain('조회 전용');
    expect(cashflowMonitorSource).toContain('기존 제출 이력');
    expect(cashflowMonitorSource).toContain('기존 결산 이력');
    expect(cashflowMonitorSource).not.toContain('작성 대기');
    expect(cashflowMonitorSource).not.toContain('결산 대기');
    expect(cashflowMonitorSource).not.toContain('결산 완료');
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
});
