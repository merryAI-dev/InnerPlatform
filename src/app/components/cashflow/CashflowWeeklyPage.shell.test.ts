import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'), 'utf8');

describe('CashflowWeeklyPage read-only status surface', () => {
  it('shows persisted Projection, Actual, and their difference', () => {
    expect(source).toContain('title="전사 현금흐름 현황"');
    expect(source).toContain('projectionTotals: week.projectionTotals || emptyTotals()');
    expect(source).toContain('actualTotals: week.actualTotals || emptyTotals()');
    expect(source).toContain('const difference = projection.net - actual.net');
    expect(source).toContain('Projection·Actual·차이');
    expect(source).toContain('Projection-Actual 일치 여부');
    expect(source).toContain('Projection-Actual 차액');
  });

  it('keeps the project summary visible and uses weekly settlement completion states', () => {
    expect(source).toContain('sticky top-0');
    expect(source).toContain('sticky left-0');
    expect(source).toContain('>요약<');
    expect(source).toContain('fetchCashflowWeeklyComplianceViaBff');
    expect(source).toContain("status === 'ON_TIME' || status === 'COMPLETED_LATE'");
    expect(source).toContain("week.status === 'MISSED'");
    expect(source).toContain("'완료 대기'");
    expect(source).toContain("settlementCompleted ? '완료' : '미완료'");
    expect(source).toContain("completedSettlementCount === monthWeeks.length ? '완료' : '미완료'");
    expect(source).not.toContain('결산 완료');
    expect(source).not.toContain('D-7');
    expect(source).not.toContain('최종 확정과 수정 잠금은 프로젝트별 월 결산 승인에서 처리합니다.');
    expect(source).toContain("toLocaleString('ko-KR')");
    expect(source).toContain('limit: 50');
    expect(source).toContain('이전 이력 더 불러오기');
    expect(source).toContain('page.nextCursor === current.nextCursor');
    expect(source).not.toContain('fetchCashflowMonthCloseViaBff');
  });

  it('is read-only and routes detailed work to the project cashflow screen', () => {
    expect(source).not.toContain('useCashflowEditLease');
    expect(source).not.toContain('updateVarianceFlag');
    expect(source).not.toContain('EditLeaseDialogs');
    expect(source).not.toContain('checkBeforeMutation');
    expect(source).toContain('&view=compare');
    expect(source).toContain('#projection-actual-comparison');
    expect(source).toContain('현금흐름 보기');
  });
});
