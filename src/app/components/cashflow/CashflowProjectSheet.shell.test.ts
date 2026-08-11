import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowProjectSheet.tsx'), 'utf8');

describe('CashflowProjectSheet monthly close shell', () => {
  it('labels the cumulative target month separately from its cycle deadline', () => {
    expect(source).toContain('까지 ${monthCloseResult.dashboard.summary.targetYearMonth}월 결산');
  });

  it('uses the approval-backed BFF/JVM month-close contract and removes weekly close actions', () => {
    expect(source).toContain('fetchCashflowMonthCloseViaBff');
    expect(source).toContain('requestCashflowMonthCloseViaBff');
    expect(source).toContain('fetchCurrentCashflowMonthCloseRequestViaBff');
    expect(source).not.toContain('closeCashflowMonthViaBff');
    expect(source).toContain('requestCashflowMonthReopenViaBff');
    expect(source).toContain('decideCashflowMonthReopenViaBff');
    expect(source).not.toContain('handleCloseWeek');
    expect(source).not.toContain('handleSubmitWeek');
    expect(source).not.toContain('handleCompleteProjectionWeek');
    expect(source).not.toContain('renderSheetTable');
    expect(source).not.toContain('settleWeek');
  });

  it('makes final save create an approval request after server validation', () => {
    expect(source).toContain('누적 월결산 승인 요청');
    expect(source).toMatch(/fetchCashflowMonthCloseViaBff[\s\S]*requestCashflowMonthCloseViaBff/);
    expect(source).not.toContain('prepared.dashboard?.validation?.canClose');
    expect(source).toContain('expectedRevision: prepared.revision');
    expect(source).toContain('expectedOpeningBalances: reviewedOpeningBalances');
    expect(source).toContain('closeInput: monthCloseInput');
    expect(source).not.toContain('savePrivateCashflowDraft');
    expect(source).not.toContain('cashflowLease');
    expect(source).not.toContain('saveCashflowProjectionBatchViaBff');
    expect(source).toContain('normalizeCashflowMonthCloseCells(monthClosePinnedSource, yearMonth)');
    expect(source).not.toContain('projectionDrafts: drafts');
    expect(source).not.toContain('applyCashflowMonthCloseProjectionDrafts');
  });

  it('shows submission success only after the BFF persists a pending request', () => {
    const pendingGuard = source.indexOf("if (request.status !== 'PENDING')");
    const successToast = source.indexOf("toast.success('월결산 결재 요청을 제출했습니다.');");

    expect(pendingGuard).toBeGreaterThan(-1);
    expect(successToast).toBeGreaterThan(pendingGuard);
    expect(source).not.toContain('월 결산 승인을 요청했습니다.');
  });

  it('requires an explicit human review before the compact month close is enabled', () => {
    expect(source).toContain('결산 기준과 서버가 고정한 누적 범위를 점검');
    expect(source).toContain('월 결산 승인 요청');
    expect(source).not.toContain('managementDecisions');
    expect(source).not.toContain('캐시플로 항목 사람 확인');
    expect(source).not.toContain('세금계산서·입금 일정</h3>');
    expect(source).toContain('monthCloseHumanReviewed');
    expect(source).toContain('humanReviewed: monthCloseHumanReviewed');
    expect(source).toContain('시트의 값과 일치하는지 직접 확인했습니다.');
    expect(source).toContain('위 누적 범위의 모든 주차가 수정 불가 상태로 잠깁니다.');
    expect(source).not.toContain('<span>주요 관리 항목</span>');
    expect(source).not.toMatch(/>확인<\/Button>/);
    expect(source).not.toMatch(/>해당 없음<\/Button>/);
    expect(source).not.toContain('!monthCloseProgress.complete');
    expect(source).toContain('monthCloseResult?.dashboard?.cumulativeCloseScope');
    expect(source).toContain('const throughMonth = previousYearMonth(selectedMonth)');
    expect(source).toContain('scope?.throughMonth === throughMonth');
    expect(source).toContain('prepared.dashboard?.cumulativeCloseScope');
    expect(source).toContain('cumulativeRequestScope.fromMonth} ~ {cumulativeRequestScope.throughMonth');
    expect(source).toContain('서버 고정 범위');
    expect(source).toContain('cumulativeRequestScope.monthCount');
    expect(source).toContain('cumulativeRequestScope.weekCount');
    expect(source).toContain('cumulativeRequestScope.cellCount');
    expect(source).not.toContain('cumulativeRequestMonthCount *');
    expect(source).toContain('cumulativeRequestScope.source.spreadsheetUrl');
    expect(source).toContain('저장 대상 시트 열기');
  });

  it('locks the pending month immediately and ignores stale request reads', () => {
    expect(source).toContain('isCashflowMonthCloseRequestLocked(monthCloseRequest?.status)');
    expect(source).toContain('isCashflowWeekLockedByRange(monthCloseRequest.lockRange');
    expect(source).toContain("['PENDING', 'APPROVING', 'UNCERTAIN'].includes(monthCloseRequest?.status || '')");
    expect(source).toContain("['CLOSED', 'PENDING', 'APPROVED', 'REOPEN_REQUESTED'].includes(monthCloseStatus || '')");
    expect(source).toContain('disabled={monthCloseRequestLocked}');
    expect(source).toContain('monthCloseCurrentRequestGenerationRef');
    expect(source).toContain('shouldApplyCashflowMonthCloseRequestResult({');
    expect(source).toContain('selectedYearMonth: selectedYearMonthRef.current');
    expect(source).toContain('monthCloseCurrentRequestGenerationRef.current += 1;');
  });

  it('initializes the pinned source before effects read its revision', () => {
    const declaration = source.indexOf('const monthClosePinnedSource = useMemo');
    const revisionEffect = source.indexOf(
      '[yearMonth, monthClosePinnedSource?.sourceRevision, monthClosePinnedSource?.targetRevisionAtFetch]',
    );
    expect(declaration).toBeGreaterThan(-1);
    expect(revisionEffect).toBeGreaterThan(declaration);
  });

  it('prefills immutable sheet-authored deposit facts for the compact month close', () => {
    expect(source).toContain('dashboard?.sheetDepositScheduleRows');
    expect(source).toContain('taxInvoiceIssuedDate: row.taxInvoiceIssuedDate');
    expect(source).toContain('expectedDepositDate: row.expectedDepositDate');
    expect(source).toContain('expectedDepositAmount: row.expectedDepositAmount');
    expect(source).not.toContain('hasDepositValue');
  });

  it('keeps all cashflow labels at a readable 12px minimum', () => {
    expect(source).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
  });

  it('consumes composed dashboard totals, comparison, summary, sheet metadata, and validation', () => {
    expect(source).toContain('monthCloseResult?.dashboard?.totals?.[mode]?.weeks?.find');
    expect(source).toContain('const canonicalReadModel = monthCloseResult?.dashboard?.canonical');
    expect(source).toContain('canonicalReadModel?.range?.[mode]');
    expect(source).not.toContain('fetchCashflowSnapshotViaBff');
    expect(source).not.toContain('loadCashflowComparison');
    expect(source).not.toContain('cashflowSnapshot');
    expect(source).toContain('month?.comparison?.weeks');
    expect(source).toContain('projectionSummary?.projectionSalesAndVatTotal');
    expect(source).toContain('dashboard?.projectionActualSummary');
    expect(source).toContain('CashflowCanonicalSummary');
    expect(source).toContain('summary={dashboard?.projectionActualSummary}');
    expect(source).toContain('loading={monthCloseLoading}');
    expect(source).toContain('error={Boolean(monthCloseError)}');
    expect(source).not.toContain('projectionSummary?.settlementMatches');
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

  it('applies the server opening balance without recreating month-close reads during hydration', () => {
    expect(source).toContain('monthCloseRequestGenerationRef');
    expect(source).toContain('requestGeneration === monthCloseRequestGenerationRef.current');
    expect(source).toContain('monthCloseResult?.dashboard?.openingBalances?.selectedYear === selectedYear');
    expect(source).toContain('const canonicalReadModel = monthCloseResult?.dashboard?.canonical');
    expect(source).toContain('const reviewedOpeningBalances = monthCloseResult?.dashboard?.openingBalances');
    expect(source).toContain('carryForwardCashflowRunningBalances({');
    expect(source).toContain('priorWeeklyNet: Number(priorServerWeek?.net || 0)');
    expect(source).toContain('annualOpeningBalance: openingBalance');
    expect(source).toContain('serverRunningNets: serverWeeks.map');
    expect(source).toContain('weekTotals.at(-1)?.net ?? openingBalance');
    expect(source).toMatch(/\}, \[orgId, projectId, resolveBffActor, selectedYear, user\?\.uid, yearMonth\]\);/);
  });

  it('renders JVM canonical formula results instead of the pinned Sheet formulas', () => {
    expect(source).toContain('function getCanonicalDerivedAmount');
    expect(source).toContain("monthCloseResult?.dashboard?.canonical?.months");
    expect(source).toContain('check?.totalIn');
    expect(source).toContain('check?.totalOut');
    expect(source).toContain('check?.net');
    expect(source).toContain('getCanonicalDerivedAmount(mode, week.yearMonth, week.weekNo, kind)');
    expect(source).not.toContain('function getPinnedDerivedAmount');
  });

  it('drops the inbox card but keeps the issue count badge', () => {
    expect(source).not.toContain("inbox.push({ id: 'all-clear'");
    expect(source).toContain('{opsSummary.status.count}건');
    expect(source).not.toContain('visibleInbox');
    expect(source).not.toContain('text-muted-foreground">확인할 항목</div>');
    expect(source).not.toContain('xl:max-h-[126px]');
  });

  it('allows the current user to be selected as organization head', () => {
    expect(source).not.toContain('.filter((member) => member.uid !== user?.uid)');
    expect(source).not.toContain('member.uid !== project?.registeredById');
    expect(source).not.toContain('member.uid !== project?.managerId');
  });

  it('labels rate tiles by loading, over, under, and OK', () => {
    expect(source).toContain('function rateStatusLabel');
    expect(source).toContain("if (monthCloseLoading || !monthCloseResult?.dashboard) return '확인 중';");
    expect(source).toContain("if (percent === 100) return 'OK';");
    expect(source).toContain("return percent > 100 ? '초과' : '미달';");
    expect(source).not.toContain("rate.percent === 100 ? 'OK' : '확인 중'");
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
    expect(source).toContain('프로젝트 조직장');
    expect(source).toContain('project-executive-approver');
    expect(source).toContain("toast.error('먼저 프로젝트 조직장을 선택해 주세요.')");
    expect(source).not.toContain('월 결산 승인 조직장을 선택하세요');
    expect(source).toContain('saveCashflowMonthCloseApproverViaBff');
    expect(source).toContain('text-secondary-foreground">{check.title}');
    expect(source).toContain('text-muted-foreground">프로젝트 전체 기간 · BFF/JVM 서버 판정');
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

  it('keeps monthly labels while making a closed month a gray locked column group', () => {
    expect(source).toContain('const weeklyStatusByWeek = new Map');
    expect(source).toContain('const monthCloseStatusByMonth = new Map');
    expect(source).toContain('const monthGroups = visibleWeeks.reduce');
    expect(source).toContain('colSpan={month.weeks.length}');
    expect(source).toContain("month.yearMonth.replace('-', '년 ')}월");
    expect(source).toContain('LockKeyhole');
    expect(source).toContain("['CLOSED', 'PENDING', 'APPROVED', 'REOPEN_REQUESTED'].includes(monthCloseStatus || '')");
    expect(source).toContain('cashflowWeekSurface(input.monthCloseStatus, input.weeklyStatus, input.closeOverdue)');
    // 지난 달은 월 결산 상태가, 이번 달은 주간 정산 상태가 앞선다.
    expect(source).toContain("if (closeOverdue) return 'bg-red-100';");
    expect(source).toContain('월 결산 기한 초과');
    expect(source).toContain("return 'bg-emerald-50'");
    expect(source).toContain("return 'bg-red-50'");
    expect(source).toContain("return 'bg-yellow-50'");
    expect(source).toContain("? '주간 정산 완료'");
    expect(source).not.toContain('월 결산 전');
  });

  it('keeps explicit zero ledger values distinct from unentered cells outside the as-of comparison range', () => {
    expect(source).toContain('Object.prototype.hasOwnProperty.call(amounts, params.lineId)');
    expect(source).not.toContain("? Boolean(comparisonLine?.projectionHadValue)");
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
    expect(source).toContain('프로젝트 등록 계약금액');
    expect(source).toContain('전체 사업기간 Projection 매출액+매출부가세');
    expect(source).toContain('projectionContractAmount');
    expect(source).toContain('projectionSalesAndVatTotal');
    expect(source).toContain('contractDifference');
    expect(source).toContain('contractCoveragePercent');
    expect(source).toContain('계약금액 0원');
    expect(source).not.toContain("? '총 계약금액 기준'");
  });

  it('keeps sheet sync explicit and uses the approved action label', () => {
    expect(source).toContain('handleRefreshSheetMirror');
    expect(source).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(source).toContain('stageCashflowSheetLabViaBff');
    expect(source).not.toContain('handleStagePinnedSheetValues(false, cashflowSheetMirror)');
    expect(source).toContain('시트 값 가져와 덮어쓰기');
    expect(source).toContain('handleRefreshAndApplySheetValues');
    expect(source).toContain('fetchCashflowActivityViaBff');
    expect(source).toContain('MYSCube 시트 덮어쓰기');
    expect(source).toContain('replaceAllActualSources');
    expect(source).not.toContain('시트 연동하기');
    expect(source).not.toContain('최신값 다시 가져오기');
    expect(source).not.toContain('setInterval');
  });

  it('probes sheet freshness on entry without a full read', () => {
    // 진입은 modifiedTime 만 싸게 대조한다. 시트 풀 리드(checkCashflowSheetChangesViaBff)는
    // 진입 경로에서 사라졌고, 사용자가 '시트 불러오기' 를 누를 때만 일어난다.
    expect(source).toContain('probeCashflowSheetFreshnessViaBff');
    expect(source).toContain('setCashflowSheetFreshness');
    expect(source).toContain('sheetChangedSinceMirror');
    expect(source).not.toContain('checkCashflowSheetChangesViaBff');
    expect(source).not.toContain('const sheetChangeCount = [');
    expect(source).not.toContain('변경 ${sheetChangeCount.toLocaleString()}건');
    // 단일 버튼은 고정된 시트 값을 가져온 뒤 같은 계약으로 덮어쓴다.
    expect(source).toContain('시트 변경됨 · 가져와 덮어쓰기');
    expect(source).not.toContain('onClick={handleOpenSheetReviewDialog}');
    expect(source).toContain('시트 이동');
    expect(source).toContain('href={configuredSheetUrl}');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).not.toContain('pendingAutoStageRevision');
    expect(source).not.toContain('setPendingAutoStageRevision');

    const checkFlow = source.slice(
      source.indexOf('const checkSheetChanges = async'),
      source.indexOf('void checkSheetChanges();'),
    );
    expect(checkFlow).not.toContain('applyCashflowSheetLabViaBff');
    expect(source).toMatch(/expectedMirrorRevision: sourceMirror\.sourceRevision,\s*\.\.\.\(replaceAllActualSources/);
    expect(checkFlow).not.toContain('refreshCashflowSheetLabMirrorViaBff');
  });

  it('keeps the sheet refresh loading state open until the successful response is processed', () => {
    expect(source).toContain('CashflowSheetSyncOverlay');
    expect(source).toContain('{sheetRefreshLoading ? <CashflowSheetSyncOverlay operation="refresh" /> : null}');
    expect(source).toContain('inert={sheetRefreshLoading || undefined}');
    expect(source).toContain('aria-busy={sheetRefreshLoading}');
    expect(source).not.toContain('setSheetRefreshResult');
    expect(source).not.toContain('setSheetStageDialog');
    expect(source).not.toContain('handingOffToAutoStage');
  });

  it('reuses the staged run when a closed-month change needs a reason', () => {
    expect(source).toContain("bffErrorCode(finalError) === 'cashflow_closed_month_reason_required'");
    expect(source).toContain('lateSheetChangeReason.trim(),');
    expect(source).toContain('lateSheetFormulaAccepted,');
    expect(source).toContain('closedMonthChangeReason');
    expect(source).toContain('마감 후 시트값 변경');
    expect(source).toContain('사유와 함께 반영');
    expect(source).not.toContain('renderSheetStageReviewGrid');
    expect(source).not.toContain('sheetStageDialog');
    expect(source).not.toContain('캐시플로 항목 사람 확인');
  });

  it('asks before applying a sheet whose displayed formulas differ from the JVM calculation', () => {
    expect(source).toContain("bffErrorCode(finalError) === 'cashflow_formula_mismatch_confirmation_required'");
    expect(source).toContain('cashflowFormulaMismatchesFromError');
    expect(source).toContain('pending.acceptPendingApprovalDifferences');
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
    expect(source).toContain('monthCloseResult?.dashboard?.canonical?.range?.[mode]');
    expect(source).toContain('getServerReadCell({ targetYearMonth: week.yearMonth');
  });

  it('shows the server service account immediately in project sheet setup', () => {
    expect(source).toContain('setCashflowSystemAccountEmail(response.systemAccountEmail || response.accessPolicy?.serviceAccountEmail');
    expect(source).toContain('먼저 서비스 계정을 Google Sheet 편집자로 공유해 주세요.');
    expect(source).toContain('{cashflowSystemAccountEmail}');
    expect(source).toContain('계정 복사');
  });

  it('keeps legacy closed snapshots as evidence-only without rendering annual-year views', () => {
    expect(source).toContain("snapshotCompatibility?.status === 'LEGACY_EVIDENCE_ONLY'");
    expect(source).toContain('이전 형식의 월 결산입니다.');
    expect(source).toContain('재오픈 승인 후 시트값을 다시 반영하고 재결산');
    expect(source).not.toContain('fetchCashflowSnapshotViaBff');
    expect(source).toContain('resolveCashflowEvidenceScope({');
    expect(source).toContain('liveYearView: null');
    expect(source).not.toContain('getCashflowSheetLabYearViewViaBff');
    expect(source).not.toContain('data-cashflow-block="multi-year-view"');
    expect(source).not.toContain('data-cashflow-year-view');
    expect(source).toContain('const sheetDashboardMetadata = cashflowEvidenceScope.sheetMetadata');
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
    expect(source).toContain('누적 월결산 승인 요청');
    expect(source).toContain('재오픈 요청');
  });

  it('provides an explicit persisted weekly settlement action without a Stage QA clock', () => {
    expect(source).not.toContain('Stage QA 기준시각');
    expect(source).not.toContain('setCashflowMonthCloseQaDateTimeViaBff');
    expect(source).toContain('completeCashflowWeeklyUpdateViaBff');
    expect(source).toContain('주간 정산 완료');
    expect(source).toContain('completedBy');
    expect(source).toContain('기한 후 완료');
    expect(source).toContain("updateResult: weeklyUpdateResult");
    expect(source).toContain("['CHANGED', '변경사항 반영 완료'");
    expect(source).toContain("['NO_CHANGES', '변경사항 없음'");
    expect(source).toContain('대상 주차와 그 이후 15개 재무주차(총 16주·256칸)의 JVM 저장 Projection 값을 확인합니다.');
    expect(source).toContain(".sort((left, right) => left.localeCompare(right))");
    expect(source).toContain("weeklyProjectionWarning ? '무시하고 반영' : '반영'");
    expect(source).not.toContain('선택한 결과로 완료');
    expect(source).toContain('서버가 확인한 미입력 항목');
    expect(source).not.toContain('ZERO(0원)는 작성값이며 EMPTY(미입력)는 완료할 수 없습니다.');
    expect(source).not.toContain('Cashflow weekly lock no longer matches');
    expect(source).toContain('weeklyProjectionValidation(error)');
    expect(source).toContain('fetchCashflowWeeklyComplianceViaBff');
    expect(source).toContain("week.status === 'ON_TIME'");
    expect(source).toContain("week.status === 'COMPLETED_LATE'");
  });

  // 계약 변경(2026-08-09): sticky 는 가장 가까운 스크롤 조상에만 붙는다
  // (w3c/csswg-drafts#9140). 표마다 독립 overflow-x 래퍼를 두면 주차 헤더의
  // sticky top 이 죽고 두 표의 가로 스크롤이 어긋나므로, 스크롤 컨테이너를
  // 하나로 합쳐 그 사실 자체를 고정한다.
  it('keeps Projection and Actual inside one shared scroll container so sticky headers work', () => {
    expect(source).toContain('aria-label="Projection과 Actual 현금흐름 스크롤 표"');
    // 컨테이너는 하나이고, 세로(max-height)와 가로 스크롤을 모두 소유한다.
    expect(source).toContain('max-h-[calc(100vh-240px)] space-y-5 overflow-auto scroll-smooth');
    expect(source).not.toContain('overflow-x-auto scroll-smooth');
    // 두 표는 같은 컨테이너 안의 비스크롤 블록이다 — sticky 조상이 되면 안 된다.
    expect(source.indexOf('data-cashflow-block="projection"')).toBeGreaterThan(source.indexOf('ref={cashflowBoardScrollRef}'));
    expect(source.indexOf('data-cashflow-block="actual"')).toBeGreaterThan(source.indexOf('data-cashflow-block="projection"'));
    expect(source).not.toContain('onScroll=');
  });

  it('makes weekly and monthly settlement primary dashboard actions without a manual temporary-save button', () => {
    const operations = source.slice(source.indexOf('function renderOperationsPanel()'), source.indexOf('function renderOpsTimeline()'));
    expect(operations).toContain('data-cashflow-settlement-actions');
    expect(operations).toContain('주간 정산 완료');
    expect(operations).toContain('월 결산');
    expect(operations).toContain('handleOpenMonthCloseReview');
    expect(operations).not.toContain('목요일 자정 업데이트');
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

  it('shows a saved sheet structure error and its failing cells in the cashflow dashboard', () => {
    expect(source).toContain('시트 연동 오류: ');
    expect(source).toContain('cashflowSheetMirror.lastRefreshError.diagnostics');
    expect(source).toContain('diagnostic.sourceCell');
    expect(source).toContain('시트 설정');
    expect(source).not.toContain('min-w-0 truncate">시트 연동 오류');
  });

  it('locks the cashflow screen with the shared sheet sync overlay while a sheet refresh is running', () => {
    expect(source).toContain('CashflowSheetSyncOverlay');
    expect(source).toContain('inert={sheetRefreshLoading || undefined}');
    expect(source).toContain('<CashflowSheetSyncOverlay operation="refresh" />');
  });

  it('resumes the same staged sheet apply after an uncertain server response', () => {
    expect(source).toContain('getCashflowSheetLabApplyStatusViaBff');
    expect(source).toContain('isCashflowSheetApplyResultUncertain(finalError)');
    expect(source).toContain("status.status !== 'APPLYING'");
    expect(source).toContain('setLateSheetApply(stage)');
    expect(source).toContain('setSheetApplyResumeRequired(true)');
    expect(source).toContain('같은 작업 이어서 완료');
    expect(source).toContain('!sheetStageApplyLoading && !sheetApplyResumeRequired');
    expect(source).toContain('!sheetApplyResumeRequired && (');
  });

  it('uses the sheets-lab one-way apply contract and does not turn post-apply reads into a failed save', () => {
    const applyStart = source.indexOf('const handleApplyStagedSheetValues');
    const applyFlow = source.slice(applyStart, source.indexOf('const handleStagePinnedSheetValues', applyStart));
    expect(applyFlow).toContain('replaceAllActualSources: true');
    expect(applyFlow).toContain('pendingApprovalDifferenceCount: stage.pendingApprovalDifferenceCount');
    expect(applyFlow).toContain('pendingApprovalDifferenceManifestHash: stage.pendingApprovalDifferenceManifestHash');
    expect(applyFlow).toContain('acceptPendingApprovalDifferences');
    expect(applyFlow).not.toContain('applyRiskCandidates: true');
    expect(applyFlow).toContain('void Promise.allSettled([');
    expect(applyFlow).not.toContain('await Promise.all([\n        loadCashflowEvents(),\n        loadCashflowMonthClose(),\n      ]);');
    const refreshStart = source.indexOf('const handleRefreshSheetMirror');
    const refreshFlow = source.slice(refreshStart, source.indexOf('const handleMonthClosePreparationAction', refreshStart));
    expect(refreshFlow).toContain('sourceYear: cashflowSheetConfig.sourceYear');
    expect(refreshFlow).not.toContain('sourceYear: selectedYear');
  });

  it('stops after staging closed-month differences until a reason is explicitly confirmed', () => {
    const stageStart = source.indexOf('const applyStageResult = async');
    const stageFlow = source.slice(
      stageStart,
      source.indexOf('setSheetRefreshLoading(true)', stageStart),
    );
    expect(stageFlow).toContain('result.closedMonthDifferences?.length');
    expect(stageFlow).toContain('setLateSheetApply(result)');
    expect(stageFlow.indexOf('setLateSheetApply(result)')).toBeLessThan(stageFlow.indexOf('handleApplyStagedSheetValues(result)'));
    expect(source).toContain('이미 결산이 완료된 월의 값이 시트에서 변경되었습니다. 사유를 남기면 변경 이력과 경고 횟수에 함께 기록됩니다. 그래도 반영할까요?');
    expect(source).not.toContain('결산 마감일이 지난 값');
    expect(source).toContain('!lateSheetChangeReason.trim() || !lateSheetDiffComplete');
    expect(source).toContain('closedMonthDifferenceManifestHash');
    expect(source).toContain('closedMonthDifferenceCount');
    expect(source).toContain('lateSheetChangeReason.trim(),');
  });

  it('runs the same main-page sheet action in refresh, stage, then apply order', () => {
    const actionStart = source.indexOf('const handleRefreshAndApplySheetValues');
    const action = source.slice(actionStart, source.indexOf('const handleOpenSheetOnboarding', actionStart));
    expect(action).toContain('await handleRefreshSheetMirror()');
    expect(action).toContain('await handleStagePinnedSheetValues(true, mirror)');
    expect(source).toContain('result.pendingApprovalDifferences?.length');
    expect(source).toContain('setPendingApprovalStage(result)');
    expect(source).toContain("handleApplyStagedSheetValues(stage, '', false, true)");
    expect(source).toContain("operation: 'cashflow.sheet_sync.one_click'");
  });

  it('prioritizes local sheet preflight over a failed server refresh and never shows stale reopen actions', () => {
    const preparation = source.slice(source.indexOf('const monthClosePreparation'), source.indexOf('const handleOpenMonthCloseReview'));
    expect(preparation.indexOf('if (monthCloseCellsState.error)')).toBeLessThan(preparation.indexOf('if (monthCloseError)'));
    expect(source).toContain("!monthCloseError && canRequestMonthReopen && monthCloseRequest?.status === 'APPROVED'");
    expect(source).toContain("!monthCloseError && canReviewReopen && monthCloseRequest?.status === 'REOPEN_REQUESTED'");
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

  it('keeps the selected-year board self-contained', () => {
    expect(source).not.toContain('getCashflowSheetLabYearViewViaBff');
    expect(source).not.toContain('cashflowYearView');
    expect(source).not.toContain('data-cashflow-block="multi-year-view"');
    expect(source).not.toContain('data-cashflow-year-view');
    expect(source).toContain('monthCloseResult?.dashboard?.canonical?.months');
    expect(source).not.toContain('cashflowSnapshotRange');
  });

  it('shows who explicitly loaded the sheet values in the activity timeline', () => {
    expect(source).toContain('decodeActivityActor');
    expect(source).toContain('decodeURIComponent(text)');
    expect(source).toContain('`${actorName}님이`');
    expect(source).toContain('`${actorEmail} 계정으로`');
    expect(source).toContain('시트의 최신 값을 불러와 MYSCube 시트 반영 전 검증본으로 보관했습니다.');
    expect(source).toContain('latestCashflowEventSummary');
    expect(source).toContain('시트의 최신 값을 불러왔습니다.');
  });

  it('keeps exact applied history in General Activity and searchable', () => {
    expect(source).not.toContain('AppliedCellHistory');
    expect(source).toContain('실제 반영 기록');
    expect(source).toContain('aria-label="실제 반영 기록 검색"');
    expect(source).toContain("event.beforeState === 'EMPTY'");
    expect(source).toContain("event.beforeState === 'ZERO'");
    expect(source).toContain("event.afterState === 'EMPTY'");
    expect(source).not.toContain('source {event.sourceDetail || event.source ||');
    expect(source).not.toContain('operation {event.operation || event.type}');
    expect(source).toContain('aria-label="마감 후 변경 후보 전체 목록"');
  });

  it('does not globally truncate exact General Activity rows', () => {
    const mergeSource = source.slice(source.indexOf('function mergeCashflowEvents'), source.indexOf('function diffColorExplanation'));
    expect(mergeSource).not.toContain('.slice(');
  });

  it('loads and retries general activity sources independently without hiding loaded events', () => {
    expect(source).toContain("from './cashflow-activity-loader'");
    expect(source).toContain('fetchCashflowActivityViaBff({ tenantId: orgId, actor, projectId, source })');
    expect(source).toContain('setCashflowEvents((current) => mergeCashflowEvents(current, response.events))');
    expect(source).toContain('cashflowEventErrors.map');
    expect(source).toContain('onClick={() => void loadCashflowEventSource(failure.source)}');
    expect(source).toContain('실제 반영 기록을 불러오는 중입니다.');
    expect(source).toContain('아직 표시할 변경 기록이 없습니다.');
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("setCashflowEventsError(resolveApiErrorMessage(error, '변경 이력을 불러오지 못했습니다.'))");
  });

  it('awaits activity sources sequentially instead of starting them in parallel', () => {
    expect(source).toContain('loadCashflowActivitySourcesSequentially(');
    expect(source).toContain('await loadCashflowEventSource(source, generation)');
    expect(source).not.toContain('CASHFLOW_ACTIVITY_SOURCES.forEach((source) => void loadCashflowEventSource(source, generation))');
  });

  it('defines the shared activity reload used after sheet and month-close mutations', () => {
    expect(source).toContain('const loadCashflowEvents = useCallback(async (): Promise<void> => {');
    expect(source).toContain('void loadCashflowEvents();');
  });

  it('uses the server KST comparison week and totals only the visible comparison scope', () => {
    expect(source).toContain('monthCloseResult?.dashboard?.summary?.comparisonAsOfWeek');
    expect(source).toContain('resolveCashflowComparisonScope({');
    expect(source).toContain('comparisonWeeks.reduce');
    expect(source).toContain('comparisonAnnualYears.reduce');
    expect(source).toContain('const cashflowTotalPeriodLabel = comparisonScope.periodLabel');
    expect(source).not.toContain("const totalProjection = projectLineTotalFor('projection', lineId)");
    expect(source).not.toContain("const totalActual = projectLineTotalFor('actual', lineId)");
  });

  it('shows the restored JVM Projection completeness warning', () => {
    expect(source).toContain('서버가 확인한 미입력 항목');
    expect(source).toContain('Projection 미입력 주차와 항목');
  });

  it('renders annual carry-forward and future totals around the selected year weekly ledger', () => {
    expect(source).toContain('const weeklyYear = canonicalReadModel?.weeklyYear');
    expect(source).toContain('annualYearsFor(weeklyYear)');
    expect(source).not.toContain('CASHFLOW_STANDARD_ANNUAL_YEARS');
    expect(source).toContain('canonicalCashflowAnnualTotalFor(canonicalAnnualTotals, year, mode)');
    expect(source).toContain('canonicalReadModel?.annualTotals || []');
    expect(source).not.toContain('dashboard?.canonical as');
    expect(source).not.toContain('summarizeCanonicalCashflowYear');
    expect(source).toContain('const previousAnnualYears = annualYears.filter((year) => year < Number(weeklyYear))');
    expect(source).toContain('const followingAnnualYears = annualYears.filter((year) => year > Number(weeklyYear))');
    expect(source).toContain('const renderAnnualSummaryCell');
    expect(source).not.toContain('cashflowSheetMirror?.sheetFacts?.annualCashflowTotals');
    expect(source).toContain('annualYears.some((year) => !annualTotalFor(year, mode)?.lineStates?.[lineId])');
    expect(source).toContain('Total');
    expect(source).toContain('const visibleWeeks = annualWeeks');
    expect(source).toContain('openingBalances?.selectedYear === selectedYear');
    expect(source).toContain('annualOpeningBalance: openingBalance');
    expect(source).not.toContain("'서버 값'");
    expect(source).not.toContain("'값 없음'");
    expect(source).toContain('>미입력</');
    expect(source).not.toContain('>확인 불가</');
  });

  it('never renders synthetic zero cashflow values after the canonical read fails', () => {
    expect(source).toContain('shouldHideCashflowValuesAfterLoadError');
    expect(source).toContain('현금흐름 데이터를 불러오지 못했습니다.');
  });

  it('aligns the Projection - Actual table to the same annual, weekly, and Total contract as the cashflow board', () => {
    expect(source).toContain('resolveCashflowComparisonScope');
    expect(source).toContain('monthCloseResult?.dashboard?.summary?.comparisonAsOfWeek');
    expect(source).toContain('visibleComparisonWeeks');
    expect(source).toContain('visibleComparisonAnnualYears');
    expect(source).toContain('comparisonWeeks.reduce');
    expect(source).not.toContain('const cashflowTotalPeriodLabel = `${previousAnnualYears[0] || selectedYear}년 ~ ${followingAnnualYears.at(-1) || selectedYear}년`');
    expect(source).not.toContain('const mirroredAnnualTotals = useMemo');
    expect(source).toContain('const annualTotalFor = (year: number');
    expect(source).not.toContain("const totalProjection = projectLineTotalFor('projection', lineId)");
    expect(source).not.toContain("const totalActual = projectLineTotalFor('actual', lineId)");
    expect(source).toContain('{previousComparisonAnnualYears.map((year) => (');
    expect(source).toContain('{followingComparisonAnnualYears.map((year) => (');
    expect(source).toContain('previousComparisonAnnualYears.includes(cell.year)');
    expect(source).toContain('followingComparisonAnnualYears.includes(cell.year)');
    expect(source).toContain('row.totalCell.difference');
    expect(source).toContain('difference: hasValue ? projection - actual : null');
    expect(source).not.toContain("pinned.state === 'VALUE' || pinned.state === 'ZERO'");
    expect(source).toContain('monthCloseResult?.dashboard?.canonical?.months?.find');
    expect(source).toContain('const columnCount = visibleComparisonAnnualYears.length + visibleComparisonWeeks.length + 1');
  });

  it('keeps the last good month result during a same-month retry and lists every management finding', () => {
    expect(source).toContain('setMonthCloseResult((current) => current?.yearMonth === yearMonth ? current : null)');
    expect(source).toContain('check.findings?.length');
    expect(source).toContain('check.findings.map((finding)');
  });

  it('reloads the canonical ledger and management checks together after sheet apply', () => {
    expect(source).toContain('loadCashflowMonthClose()');
    expect(source).not.toContain('loadCashflowComparison');
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
    expect(source).toContain("const canFinalizeMonth = role === 'viewer' || role === 'pm' || role === 'finance' || role === 'admin' || role === 'tenant_admin'");
    expect(source).toContain("const canCompleteWeekly = canFinalizeMonth || role === 'tenant_admin'");
    expect(source).toContain('const canRequestMonthReopen = canFinalizeMonth');
    expect(source).toContain("role === 'finance' || role === 'admin'");
    expect(source).not.toContain("monthCloseResult?.status !== 'OPEN'");
    expect(source).not.toContain('PM만 재오픈을 요청할 수 있습니다.');
    expect(source).toContain('Finance 또는 Admin만 재오픈 요청을 처리할 수 있습니다.');
  });
});
