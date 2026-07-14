import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeklyPageSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'),
  'utf8',
);

describe('CashflowWeeklyPage status semantics', () => {
  it('keeps weekly status read-only and directs finalization to monthly close', () => {
    expect(cashflowWeeklyPageSource).toContain('title="주간 프로젝션 작성 현황(전사)"');
    expect(cashflowWeeklyPageSource).toContain('projectionUpdated: Boolean(w.projectionUpdated)');
    expect(cashflowWeeklyPageSource).toContain("label: 'Projection 저장'");
    expect(cashflowWeeklyPageSource).toContain('주차 상태는 조회용 · 최종 확정과 수정 잠금은 프로젝트별 월 결산에서 처리');
    expect(cashflowWeeklyPageSource).toContain('프로젝트별 주간 입력 현황');
    expect(cashflowWeeklyPageSource).not.toContain('주간 작성/결산 현황');
    expect(cashflowWeeklyPageSource).not.toContain('작성완료=Projection 저장');
    expect(cashflowWeeklyPageSource).not.toContain('결산완료=관리자 결산확정');
    expect(cashflowWeeklyPageSource).not.toContain('function hasProjectionInput');
    expect(cashflowWeeklyPageSource).not.toContain('pmSubmitted: Boolean(w.pmSubmitted)');
    expect(cashflowWeeklyPageSource).not.toContain('작성완료=PM 작성완료');
  });

  it('reads stored in/out totals from cashflow week docs instead of recomputing NET in the monitor', () => {
    expect(cashflowWeeklyPageSource).toContain('projectionTotals');
    expect(cashflowWeeklyPageSource).toContain('totals: w.projectionTotals || emptyTotals()');
    expect(cashflowWeeklyPageSource).toContain('입금 {fmtShort(totals.totalIn)}');
    expect(cashflowWeeklyPageSource).toContain('출금 {fmtShort(totals.totalOut)}');
    expect(cashflowWeeklyPageSource).not.toContain('chooseCashflowSheetForNet');
    expect(cashflowWeeklyPageSource).not.toContain('computeCashflowTotals');
    expect(cashflowWeeklyPageSource).not.toContain('NET {fmtShort');
    expect(cashflowWeeklyPageSource).not.toContain('actualTotals');
  });

  it('uses projection change alerts for 급변 warnings instead of projection-vs-actual variance', () => {
    expect(cashflowWeeklyPageSource).toContain('sheet?.projectionChangeAlert');
    expect(cashflowWeeklyPageSource).toContain('D-7 1천만↑');
    expect(cashflowWeeklyPageSource).toContain('주차 시작 7일 이내 Projection 1천만원 이상 변경');
    expect(cashflowWeeklyPageSource).not.toContain('computeVariance');
    expect(cashflowWeeklyPageSource).not.toContain('편차 20%');
  });

  it('uses red as the missing projection signal', () => {
    expect(cashflowWeeklyPageSource).toContain('const isMissingProjection = !projectionUpdated');
    expect(cashflowWeeklyPageSource).not.toContain('adminClosed: Boolean(w.adminClosed)');
    expect(cashflowWeeklyPageSource).toContain('빨간색</span>=미작성');
    expect(cashflowWeeklyPageSource).toContain('bg-red-50 dark:bg-red-950/30');
  });

  it('opens project cashflow directly on the projection tab', () => {
    expect(cashflowWeeklyPageSource).toContain('&view=projection');
    expect(cashflowWeeklyPageSource).toContain('프로젝션 바로가기');
    expect(cashflowWeeklyPageSource).toContain('프로젝션 열기');
  });

  it('requires a project-scoped cashflow lease before variance intent mutations', () => {
    expect(cashflowWeeklyPageSource).toContain('useCashflowEditLease');
    expect(cashflowWeeklyPageSource).toContain('varianceLeaseProjectId');
    expect(cashflowWeeklyPageSource).toContain('checkBeforeMutation');
    expect(cashflowWeeklyPageSource).toContain('EditLeaseDialogs');
    expect(cashflowWeeklyPageSource).toContain('30분 연장');
  });
});
