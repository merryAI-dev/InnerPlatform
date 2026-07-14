import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowProjectSheet.tsx'), 'utf8');

describe('CashflowProjectSheet monthly close shell', () => {
  it('uses the single BFF/JVM month-close contract and removes weekly close actions', () => {
    expect(source).toContain('fetchCashflowMonthCloseViaBff');
    expect(source).toContain('closeCashflowMonthViaBff');
    expect(source).toContain('requestCashflowMonthReopenViaBff');
    expect(source).toContain('decideCashflowMonthReopenViaBff');
    expect(source).not.toContain('handleCloseWeek');
    expect(source).not.toContain('handleSubmitWeek');
    expect(source).not.toContain('handleCompleteProjectionWeek');
    expect(source).not.toContain('renderSheetTable');
    expect(source).not.toContain('settleWeek');
  });

  it('makes final save mean atomic month close after private draft and server validation', () => {
    expect(source).toContain('최종저장 · 월 결산');
    expect(source).toMatch(/await savePrivateCashflowDraft\(monthCloseInput, mutationLease\);[\s\S]*fetchCashflowMonthCloseViaBff[\s\S]*validation\?\.canClose[\s\S]*closeCashflowMonthViaBff/);
    expect(source).toContain('expectedRevision: prepared.revision');
    expect(source).not.toContain('saveCashflowProjectionBatchViaBff');
    expect(source).toContain('projectionDrafts: drafts');
    expect(source).toContain('applyCashflowMonthCloseProjectionDrafts');
  });

  it('requires explicit human decisions for 160 cells and five deposit rows', () => {
    expect(source).toContain('monthCloseProgress.confirmedCells');
    expect(source).toContain('monthCloseProgress.confirmedDepositRows');
    expect(source).toContain('캐시플로 항목 사람 확인');
    expect(source).toContain("requiredDecision === 'CONFIRMED' ? '확인' : '해당 없음'");
    expect(source).toContain("decision: 'CONFIRMED'");
    expect(source).toContain("decision: 'NOT_APPLICABLE'");
    expect(source).toContain('!monthCloseProgress.complete');
  });

  it('prefills immutable sheet-authored deposit facts and edits only actual facts', () => {
    expect(source).toContain('dashboard?.sheetDepositScheduleRows');
    expect(source).toContain('taxInvoiceIssuedDate: row.taxInvoiceIssuedDate');
    expect(source).toContain('expectedDepositDate: row.expectedDepositDate');
    expect(source).toContain('expectedDepositAmount: row.expectedDepositAmount');
    expect(source).toContain('readOnly');
    expect(source).toContain('hasSheetSource');
    expect(source).toContain('disabled={!canEdit || hasSheetSource}');
    expect(source).toContain('actualDepositDate: event.target.value');
    expect(source).toContain('actualDepositAmount: value');
  });

  it('consumes composed dashboard totals, comparison, summary, metadata, and validation', () => {
    expect(source).toContain('monthCloseResult?.dashboard?.totals?.[mode]?.weeks?.find');
    expect(source).toContain('cashflowSnapshot?.readModel?.range?.[mode]');
    expect(source).toContain('rangeStart: cashflowSnapshotRange.start');
    expect(source).toContain('rangeEnd: cashflowSnapshotRange.end');
    expect(source).toContain('monthCloseResult.dashboard.comparison');
    expect(source).toContain('dashboard?.summary?.projectionProgressPercent');
    expect(source).toContain("monthCloseSheetMetadataValue('businessType')");
    expect(source).toContain("monthCloseSheetControlValue('deposit')");
    expect(source).toContain("monthCloseSheetControlValue('unpaid')");
    expect(source).toContain('입금 합계 (BO9)');
    expect(source).toContain('미지급 표시값 (BP9)');
    expect(source).toContain('dashboard?.validation?.blockers');
    expect(source).not.toContain('computeCashflowDerivedTotals');
    expect(source).not.toContain('computeOpeningCashflowTotals');
    expect(source).not.toContain('monthSummaries.reduce');
  });

  it('keeps the ready placeholder out of the issue count', () => {
    expect(source).not.toContain("inbox.push({ id: 'all-clear'");
    expect(source).toContain('{opsSummary.status.count}건');
    expect(source).toContain('visibleInbox.length === 0');
  });

  it('keeps Projection then ACTUAL row order and shows only blue difference rows', () => {
    expect(source.indexOf('data-cashflow-block="projection"')).toBeLessThan(source.indexOf('data-cashflow-block="actual"'));
    expect(source).toMatch(/renderModeLineRows\(mode, CASHFLOW_IN_LINES[\s\S]*renderSummaryRow\(mode, 'totalIn'\)[\s\S]*renderModeLineRows\(mode, CASHFLOW_OUT_LINES[\s\S]*renderSummaryRow\(mode, 'totalOut'\)[\s\S]*renderSummaryRow\(mode, 'net'\)/);
    expect(source).toContain('Projection - Actual 차이');
    expect(source).toContain('차이 항목만');
    expect(source).not.toContain('setDifferenceViewMode');
    expect(source).toContain("'bg-blue-50 text-blue-700'");
  });

  it('keeps sheet sync explicit and uses the approved action label', () => {
    expect(source).toContain('handleRefreshSheetMirror');
    expect(source).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(source).toContain('stageCashflowSheetLabViaBff');
    expect(source).toContain('시트값 불러오기');
    expect(source).not.toContain('시트 연동하기');
    expect(source).not.toContain('최신값 다시 가져오기');
    expect(source).not.toContain('setInterval');
  });

  it('keeps an unlinked project usable and guides the user to sheet setup', () => {
    expect(source).toContain('시트가 아직 연결되지 않았습니다.');
    expect(source).toContain('시트를 연결하지 않아도 캐시플로우는 조회할 수 있습니다.');
    expect(source).toContain('시트 연동 설정');
    expect(source).toContain('cashflowSnapshot?.comparison?.months || []');
    expect(source).toContain('comparisonWeek?.lines?.find');
  });

  it('shows month close only as a compact board action instead of a standalone panel', () => {
    expect(source).not.toContain('data-cashflow-block="month-close"');
    expect(source).toContain('type="month"');
    expect(source).toContain('최종저장 · 월 결산');
    expect(source).toContain('재오픈 요청');
  });

  it('offers the exact three in-app exit choices and releases only on exit', () => {
    expect(source).toContain('임시저장 후 종료');
    expect(source).toContain('저장하지 않고 종료');
    expect(source).toContain('계속 작성');
    expect(source).toContain('discardChangesAndLeave');
    expect(source).toContain('await cashflowLease.release();');
    expect(source).toMatch(/savePrivateCashflowDraft\(\);[\s\S]*const released = await cashflowLease\.release\(\);[\s\S]*if \(!released\) throw new Error/);
    expect(source).toContain('blocker.proceed?.();');
    expect(source).toContain('hasDirty || hasActiveEditSession');
    expect(source).toContain('수정 세션을 종료할까요?');
  });

  it('gates PM close and Finance/Admin reopen decisions while viewer stays read-only', () => {
    expect(source).toContain("const isPm = role === 'pm'");
    expect(source).toContain("role === 'finance' || role === 'admin'");
    expect(source).toContain("monthCloseResult?.status === 'OPEN'");
    expect(source).toContain('PM만 재오픈을 요청할 수 있습니다.');
    expect(source).toContain('Finance 또는 Admin만 재오픈 요청을 처리할 수 있습니다.');
  });
});
