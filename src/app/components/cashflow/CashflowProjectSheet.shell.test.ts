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

  it('requires explicit human decisions for 160 cells, five deposit rows, and four management checks', () => {
    expect(source).toContain('monthCloseProgress.confirmedCells');
    expect(source).toContain('monthCloseProgress.confirmedDepositRows');
    expect(source).toContain('monthCloseProgress.confirmedManagementChecks');
    expect(source).toContain('monthCloseResult?.dashboard?.managementChecks');
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

  it('consumes composed dashboard totals, comparison, summary, sheet metadata, and validation', () => {
    expect(source).toContain('monthCloseResult?.dashboard?.totals?.[mode]?.weeks?.find');
    expect(source).toContain('cashflowSnapshot?.readModel?.range?.[mode]');
    expect(source).toContain('rangeStart: cashflowSnapshotRange.start');
    expect(source).toContain('rangeEnd: cashflowSnapshotRange.end');
    expect(source).toContain('monthCloseResult.dashboard.comparison');
    expect(source).toContain('dashboard?.summary?.projectionProgressPercent');
    expect(source).toContain('cashflowSheetMirror.sheetFacts?.metadata');
    expect(source).toContain("['사업 타입', sheetDashboardMetadata.businessType?.value]");
    expect(source).toContain("['전용 계좌사업', sheetDashboardMetadata.accountType?.value]");
    expect(source).toContain("['정산 여부', sheetDashboardMetadata.settlementStatus?.value]");
    expect(source).toContain('세금계산서 발행일 · 입금일 · 입금액');
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

  it('places the operations dashboard before comparison and the monthly board', () => {
    const operations = source.indexOf('{renderOperationsPanel()}');
    const comparison = source.indexOf('data-cashflow-block="comparison"');
    const monthlyBoard = source.lastIndexOf('{renderUnifiedMonthlyBoard()}');
    expect(operations).toBeGreaterThan(-1);
    expect(operations).toBeLessThan(comparison);
    expect(comparison).toBeLessThan(monthlyBoard);
    expect(source).toContain('dashboardTitle');
    expect(source).toContain("'시트 설정'");
    expect(source).not.toContain('변경 내용 검토');
  });

  it('keeps the dashboard information order from the PPT before the comparison table', () => {
    const metadata = source.indexOf('sheetDashboardMetadata');
    const summary = source.indexOf('{dashboardSummary}');
    const management = source.indexOf('주요 관리 항목');
    const comparison = source.indexOf('data-cashflow-block="comparison"');
    expect(metadata).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(metadata);
    expect(management).toBeGreaterThan(summary);
    expect(comparison).toBeGreaterThan(management);
  });

  it('keeps the dashboard deposit schedule as a compact sheet-confirmed note', () => {
    expect(source).toContain('세금계산서 발행일 · 입금일 · 입금액 주별 확인됨');
    expect(source.match(/<h3 className="text-\[13px\] font-bold text-slate-950">세금계산서·입금 일정<\/h3>/g)).toHaveLength(1);
  });

  it('keeps the PPT summary as Projection, Actual, and monthly close only', () => {
    expect(source).toContain("renderRateTile('Projection', opsSummary.rates.projection)");
    expect(source).toContain("renderRateTile('Actual', opsSummary.rates.actual)");
    expect(source).toContain("renderRateTile('결산', opsSummary.rates.confirmation)");
    expect(source).not.toContain("renderRateTile('사람 확인', opsSummary.rates.confirmation)");
    expect(source).not.toContain('renderOpsStatusDonut');
  });

  it('keeps sheet sync explicit and uses the approved action label', () => {
    expect(source).toContain('handleRefreshSheetMirror');
    expect(source).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(source).toContain('stageCashflowSheetLabViaBff');
    expect(source).toContain('시트값 불러오기');
    expect(source).toContain('시트 값 불러오기');
    expect(source).toContain('fetchCashflowActivityViaBff');
    expect(source).toContain('원장 덮어쓰기');
    expect(source).toContain('replaceAllActualSources');
    expect(source).not.toContain('시트 연동하기');
    expect(source).not.toContain('최신값 다시 가져오기');
    expect(source).not.toContain('setInterval');
  });

  it('keeps an unlinked project usable and guides the user to sheet setup', () => {
    expect(source).toContain("cashflowSheetConfig ? '시트 설정' : '시트 연결'");
    expect(source).toContain('시트를 연결하지 않아도 캐시플로우는 조회할 수 있습니다.');
    expect(source).toContain('시트 설정에서 직접 시트값을 가져올 때만 고정합니다.');
    expect(source).toContain('!cashflowSheetConfigLoaded || cashflowSheetConfig || !projectId');
    expect(source).toContain('myscube:cashflow-sheet-onboarding:');
    expect(source).toContain('캐시플로우 시트 연동 시작하기');
    expect(source).toContain('나중에 하기');
    expect(source).toContain('설정 후에도 자동으로 값을 가져오지 않습니다.');
    expect(source).toContain('cashflowSnapshot?.comparison?.months || []');
    expect(source).toContain('comparisonWeek?.lines?.find');
  });

  it('keeps the operations dashboard as the first visible cashflow block', () => {
    expect(source).not.toContain('시트가 아직 연결되지 않았습니다.');
    const operations = source.indexOf('{renderOperationsPanel()}');
    const comparison = source.indexOf('data-cashflow-block="comparison"');
    expect(operations).toBeGreaterThan(-1);
    expect(operations).toBeLessThan(comparison);
  });

  it('shows month close only as a compact board action instead of a standalone panel', () => {
    expect(source).not.toContain('data-cashflow-block="month-close"');
    expect(source).toContain('type="month"');
    expect(source).toContain('최종저장 · 월 결산');
    expect(source).toContain('재오픈 요청');
  });

  it('keeps the board action next to the settlement status without a manual temporary-save button', () => {
    const boardHeader = source.slice(source.indexOf('현금흐름 관리시트'), source.indexOf('{financialYearChecks?.years.length'));
    expect(boardHeader).toContain('월 결산');
    expect(boardHeader).not.toContain('작성자 전용 임시저장본을 저장했습니다.');
  });

  it('opens only the selected Projection week and keeps multi-year sheet checks visible', () => {
    expect(source).toContain('현금흐름 관리시트');
    expect(source).not.toContain('캐시플로 진단시트');
    expect(source).not.toContain('수정 시작');
    expect(source).not.toContain('서버 확정 원장 합계');
    expect(source).toContain('openProjectionWeekEditing');
    expect(source).toContain('financialYearChecks?.years.length');
    expect(source).toContain('시트 연도값 없음');
    expect(source).toContain('시트 {fmt(check.sheet[field.key])} · 등록 {fmt(check.registered[field.key])}');
  });

  it('keeps the detailed board on one year while showing the adjacent annual source values', () => {
    expect(source).toContain('getCashflowSheetLabYearViewViaBff');
    expect(source).toContain('cashflowYearView?.navigationYears');
    expect(source).toContain('cashflowSheetMirror?.sheetFacts?.annualCashflowTotals');
    expect(source).toContain('[selectedYear - 1, selectedYear, selectedYear + 1]');
    expect(source).toContain('data-cashflow-block="multi-year-view"');
    expect(source).toContain("'주차값 집계'");
    expect(source).toContain("'일부 주차 합계'");
    expect(source).toContain("'연간 합계'");
    expect(source).toContain("'합계 불일치'");
    expect(source).toContain('오류 없이 다음 불러오기 때 반영됩니다.');
    expect(source).toContain("start: { yearMonth: `${selectedYear}-01`, weekNo: 1 }");
    expect(source).toContain("end: { yearMonth: `${selectedYear}-12`, weekNo: 5 }");
  });

  it('shows who explicitly loaded the sheet values in the activity timeline', () => {
    expect(source).toContain('`${event.actorName}님이`');
    expect(source).toContain('`${event.actorEmail} 계정으로`');
    expect(source).toContain('시트의 최신 값을 불러와 기준값으로 저장했습니다.');
    expect(source).toContain('누가 언제 시트 값을 불러오고 월 결산했는지 확인할 수 있습니다.');
  });

  it('places adjacent annual totals around weekly columns and lets users open each year view', () => {
    expect(source).toContain('data-cashflow-annual-summary="true"');
    expect(source).toContain('`${year}-01`');
    expect(source).toContain('data-cashflow-year-view={year}');
    expect(source).toContain('annualSourceLabel(total?.[mode])} · 보기');
    expect(source).not.toContain("'서버 값'");
    expect(source).not.toContain("'값 없음'");
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
