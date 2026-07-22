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

  it('makes final save mean direct atomic month close after server validation', () => {
    expect(source).toContain('최종저장 · 월 결산');
    expect(source).toMatch(/fetchCashflowMonthCloseViaBff[\s\S]*validation\?\.canClose[\s\S]*closeCashflowMonthViaBff/);
    expect(source).toContain('expectedRevision: prepared.revision');
    expect(source).toContain('closeInput: monthCloseInput');
    expect(source).not.toContain('savePrivateCashflowDraft');
    expect(source).not.toContain('cashflowLease');
    expect(source).not.toContain('saveCashflowProjectionBatchViaBff');
    expect(source).toContain('normalizeCashflowMonthCloseCells(monthClosePinnedSource, yearMonth)');
    expect(source).not.toContain('projectionDrafts: drafts');
    expect(source).not.toContain('applyCashflowMonthCloseProjectionDrafts');
  });

  it('closes the month from one compact confirmation while preserving the server snapshot contract', () => {
    expect(source).toContain('결산 기준을 먼저 점검한 뒤, 준비된 경우에만 이 달의 수정을 잠급니다.');
    expect(source).toContain('월 결산 확정');
    expect(source).toContain('monthCloseResult?.dashboard?.managementChecks');
    expect(source).not.toContain('캐시플로 항목 사람 확인');
    expect(source).not.toContain('세금계산서·입금 일정</h3>');
    expect(source).toContain("decision: hasDepositValue ? 'CONFIRMED' : 'NOT_APPLICABLE'");
    expect(source).not.toContain('!monthCloseProgress.complete');
  });

  it('prefills immutable sheet-authored deposit facts for the compact month close', () => {
    expect(source).toContain('dashboard?.sheetDepositScheduleRows');
    expect(source).toContain('taxInvoiceIssuedDate: row.taxInvoiceIssuedDate');
    expect(source).toContain('expectedDepositDate: row.expectedDepositDate');
    expect(source).toContain('expectedDepositAmount: row.expectedDepositAmount');
    expect(source).toContain("decision: hasDepositValue ? 'CONFIRMED' : 'NOT_APPLICABLE'");
  });

  it('keeps all cashflow labels at a readable 12px minimum', () => {
    expect(source).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
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

  it('keeps Projection then ACTUAL row order and uses navy for difference rows', () => {
    expect(source.indexOf('data-cashflow-block="projection"')).toBeLessThan(source.indexOf('data-cashflow-block="actual"'));
    expect(source).toMatch(/renderModeLineRows\(mode, CASHFLOW_IN_LINES[\s\S]*renderSummaryRow\(mode, 'totalIn'\)[\s\S]*renderModeLineRows\(mode, CASHFLOW_OUT_LINES[\s\S]*renderSummaryRow\(mode, 'totalOut'\)[\s\S]*renderSummaryRow\(mode, 'net'\)/);
    expect(source).toContain('Projection - Actual 차이');
    expect(source).toContain('차이 항목만');
    expect(source).not.toContain('setDifferenceViewMode');
    expect(source).toContain("'bg-[#EAF0F5] text-[#17324D]'");
    expect(source).toContain("rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'");
    expect(source).toContain("input.isAltRow ? 'bg-slate-50' : 'bg-white'");
    expect(source).toContain('isAltRow: rowIndex % 2 === 1');
    expect(source).toContain("'text-emerald-700' : 'text-red-700'");
    expect(source).toContain("'bg-[#EAF0F5] text-sky-700'");
    expect(source).toContain('data-cashflow-settlement-actions className="grid gap-px overflow-hidden rounded-md border border-border bg-border');
    expect(source).toContain("surface: 'border-border bg-accent'");
    expect(source).toContain('text-card-foreground">주간 정산');
    expect(source).toContain('text-card-foreground">월 결산');
    expect(source).toContain('text-secondary-foreground">{check.title}');
    expect(source).toContain('text-muted-foreground">프로젝트 전체 기간 · BFF/JVM 서버 판정');
    expect(source).toContain('divide-y divide-border');
    expect(source).toContain('bg-accent px-2.5 py-1 font-semibold text-accent-foreground');
    expect(source).toContain('space-y-5 bg-background p-4');
    expect(source).not.toMatch(/FFF7DE|E4C974|D6A92C|FCE8A8/);
    expect(source).toContain('text-red-700');
    expect(source).not.toMatch(/(?:rose|amber|blue|indigo|violet)-\d+/);
  });

  it('shows week codes without redundant date ranges in both cashflow tables', () => {
    expect(source).toContain('{week.label}');
    expect(source).not.toContain('formatShortWeekRange');
    expect(source).not.toContain('week.weekStart.slice(5)');
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
    expect(source).not.toContain('세금계산서·입금 일정</h3>');
  });

  it('keeps the PPT summary as Projection, Actual, and monthly close only', () => {
    expect(source).toContain("renderRateTile('Projection', opsSummary.rates.projection)");
    expect(source).toContain("renderRateTile('Actual', opsSummary.rates.actual)");
    expect(source).toContain("renderRateTile('결산', opsSummary.rates.confirmation)");
    expect(source).not.toContain("renderRateTile('사람 확인', opsSummary.rates.confirmation)");
    expect(source).not.toContain('renderOpsStatusDonut');
  });

  it('shows the registered contract amount and full Projection amount together', () => {
    expect(source).toContain('프로젝트 등록 시 전체 계약 금액');
    expect(source).toContain('현재 Projection 작성 전체 금액');
    expect(source).toContain('projectionContractAmount');
    expect(source).toContain('projectionTotalIn');
    expect(source).not.toContain("? '총 계약금액 기준'");
  });

  it('keeps sheet sync explicit and uses the approved action label', () => {
    expect(source).toContain('handleRefreshSheetMirror');
    expect(source).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(source).toContain('stageCashflowSheetLabViaBff');
    expect(source).toContain('handleStagePinnedSheetValues(false, cashflowSheetMirror)');
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

  it('provides a Stage-only QA clock and an explicit persisted weekly settlement action', () => {
    expect(source).toContain('type="datetime-local"');
    expect(source).toContain('Stage QA 기준시각');
    expect(source).toContain('setCashflowMonthCloseQaDateTimeViaBff');
    expect(source).toContain('completeCashflowWeeklyUpdateViaBff');
    expect(source).toContain('주간 정산 완료');
    expect(source).toContain('completedBy');
    expect(source).toContain('기한 후 완료');
  });

  it('makes weekly and monthly settlement primary dashboard actions without a manual temporary-save button', () => {
    const operations = source.slice(source.indexOf('function renderOperationsPanel()'), source.indexOf('function renderOpsTimeline()'));
    expect(operations).toContain('data-cashflow-settlement-actions');
    expect(operations).toContain('주간 정산 완료');
    expect(operations).toContain('월 결산');
    expect(operations).toContain('handleOpenMonthCloseReview');
    expect(operations).toContain("monthCloseError || (monthCloseResult?.status !== 'CLOSED'");
    expect(operations).toContain('closeDeadline');
    expect(operations).not.toContain('작성자 전용 임시저장본을 저장했습니다.');
  });

  it('guides a blocked month close to the specific next action and records safe developer diagnostics', () => {
    expect(source).toContain('cashflow.month_close.review.open');
    expect(source).toContain('cashflow.month_close.preflight.blocked');
    expect(source).toContain('cashflow.month_close.preflight.sheet_refresh');
    expect(source).toContain('cashflow.month_close.status.load');
    expect(source).toContain('cashflow.weekly_settlement.complete');
    expect(source).toContain('시트 설정으로 이동');
    expect(source).toContain('시트 값 불러오기');
    expect(source).toContain('결산 상태 다시 확인');
    expect(source).toContain('recordDevtoolsLog');
    expect(source).toContain('toDevtoolsError');
  });

  it('prioritizes local sheet preflight over a failed server refresh and never shows stale reopen actions', () => {
    const preparation = source.slice(source.indexOf('const monthClosePreparation'), source.indexOf('const handleOpenMonthCloseReview'));
    expect(preparation.indexOf('if (monthCloseCellsState.error)')).toBeLessThan(preparation.indexOf('if (monthCloseError)'));
    expect(source).toContain("!monthCloseError && canRequestMonthReopen && monthCloseResult?.status === 'CLOSED'");
    expect(source).toContain("!monthCloseError && canReviewReopen && monthCloseResult?.status === 'REOPEN_REQUESTED'");
  });

  it('keeps Projection read-only and accepts values only through sheet import', () => {
    expect(source).toContain('현금흐름 관리시트');
    expect(source).not.toContain('캐시플로 진단시트');
    expect(source).not.toContain('수정 시작');
    expect(source).not.toContain('서버 확정 원장 합계');
    expect(source).toContain('조회 전용 · 값은 시트 값 불러오기로만 반영됩니다.');
    expect(source).not.toContain('openProjectionWeekEditing');
    expect(source).not.toContain('projectionDrafts: drafts');
    expect(source).not.toContain('financialYearChecks?.years.length');
    expect(source).not.toContain('시트 {fmt(check.sheet[field.key])} · 등록 {fmt(check.registered[field.key])}');
  });

  it('keeps adjacent-year navigation and renders annual-only ledgers without fake weeks', () => {
    expect(source).toContain('getCashflowSheetLabYearViewViaBff');
    expect(source).toContain('cashflowYearView');
    expect(source).not.toContain('data-cashflow-annual-summary="true"');
    expect(source).toContain('cashflowYearView.navigationYears');
    expect(source).toContain(': [selectedYear]');
    expect(source).toContain('canonicalAnnualTotal');
    expect(source).toContain('주차값으로 나누지 않고 시트 합계를 그대로 저장했습니다.');
    expect(source).toContain('data-cashflow-block="multi-year-view"');
    expect(source).toContain('data-cashflow-year-view={year}');
    expect(source).toContain('{String(year).slice(-2)}년');
    expect(source).toContain("start: { yearMonth: `${selectedYear}-01`, weekNo: 1 }");
    expect(source).toContain("end: { yearMonth: `${selectedYear}-12`, weekNo: 5 }");
  });

  it('shows who explicitly loaded the sheet values in the activity timeline', () => {
    expect(source).toContain('decodeActivityActor');
    expect(source).toContain('decodeURIComponent(text)');
    expect(source).toContain('`${actorName}님이`');
    expect(source).toContain('`${actorEmail} 계정으로`');
    expect(source).toContain('시트의 최신 값을 불러와 원장 반영 전 검증본으로 보관했습니다.');
    expect(source).toContain('latestCashflowEventSummary');
    expect(source).toContain('시트의 최신 값을 불러왔습니다.');
  });

  it('places prior annual totals before and later annual totals after the selected year weeks', () => {
    expect(source).toContain('`${year}-01`');
    expect(source).toContain('data-cashflow-year-view={year}');
    expect(source).toContain('previousAnnualYears');
    expect(source).toContain('followingAnnualYears');
    expect(source).toContain('renderAnnualSummaryCell');
    expect(source).toContain('{year}년');
    expect(source).toContain('누적');
    expect(source).toContain('합계');
    expect(source).not.toContain("'서버 값'");
    expect(source).not.toContain("'값 없음'");
  });

  it('keeps the last good month result during a same-month retry and lists every management finding', () => {
    expect(source).toContain('setMonthCloseResult((current) => current?.yearMonth === yearMonth ? current : null)');
    expect(source).toContain('check.findings?.length');
    expect(source).toContain('check.findings.map((finding)');
  });

  it('reloads both the canonical ledger and management checks after sheet apply', () => {
    expect(source).toMatch(/loadCashflowComparison\(\)[\s\S]*loadCashflowMonthClose\(\)/);
  });

  it('warns once for unsaved local changes without a cashflow edit session', () => {
    expect(source).not.toContain('임시저장 후 종료');
    expect(source).toContain('저장하지 않고 이동');
    expect(source).toContain('계속 작성');
    expect(source).toContain('discardChangesAndLeave');
    expect(source).not.toContain('cashflowLease.release');
    expect(source).toContain('blocker.proceed?.();');
    expect(source).not.toContain('hasActiveEditSession');
    expect(source).toContain('저장되지 않은 변경사항이 있습니다');
  });

  it('allows every active project-access role to close or request reopen while decisions stay Finance/Admin only', () => {
    expect(source).toContain("const canUseCashflowActions = role === 'pm' || role === 'finance' || role === 'admin'");
    expect(source).toContain("const canFinalizeMonth = role === 'viewer' || role === 'pm' || role === 'finance' || role === 'admin'");
    expect(source).toContain("const canCompleteWeekly = canFinalizeMonth || role === 'tenant_admin'");
    expect(source).toContain('const canRequestMonthReopen = canFinalizeMonth');
    expect(source).toContain("role === 'finance' || role === 'admin'");
    expect(source).toContain("monthCloseResult?.status !== 'OPEN'");
    expect(source).not.toContain('PM만 재오픈을 요청할 수 있습니다.');
    expect(source).toContain('Finance 또는 Admin만 재오픈 요청을 처리할 수 있습니다.');
  });
});
