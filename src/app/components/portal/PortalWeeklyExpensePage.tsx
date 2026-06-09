import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ExternalLink,
  Loader2,
  Send,
} from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import {
  formatSettlementSheetPolicySummary,
  normalizeSettlementSheetPolicy,
  normalizeProjectFundInputMode,
  PROJECT_FUND_INPUT_MODE_LABELS,
  type CashflowWeekSheet,
  type Transaction,
  type TransactionState,
} from '../../data/types';
import type { ImportRow } from '../../platform/settlement-csv';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
} from '../../lib/platform-bff-client';
import { splitLooseNameList } from '../../platform/name-list';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { readDevAuthHarnessConfig } from '../../platform/dev-harness';
import { detectParticipationRisk } from '../../platform/participation-risk-rules';
import { normalizeBudgetLabel } from '../../platform/budget-labels';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { resolvePortalHappyPath } from '../../platform/portal-happy-path';
import { resolveWeeklyExpenseSavePolicy } from '../../platform/weekly-expense-save-policy';
import { usePortalNavigationGuard } from './PortalLayout';
const GoogleSheetMigrationWizard = lazy(
  () => import('./GoogleSheetMigrationWizard').then((module) => ({ default: module.GoogleSheetMigrationWizard })),
);
const SettlementLedgerPage = lazy(
  () => import('../cashflow/SettlementLedgerPage').then((module) => ({ default: module.SettlementLedgerPage })),
);

function formatWon(value: number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${Math.trunc(amount).toLocaleString('ko-KR')}원` : '-';
}

export function PortalWeeklyExpensePage() {
  const navigate = useNavigate();
  const { registerNavigationHandler } = usePortalNavigationGuard();
  const weeklyExpenseSavePolicy = resolveWeeklyExpenseSavePolicy();
  const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();
  const { orgId } = useFirebase();
  const {
    isLoading: portalStoreLoading,
    activeProjectId,
    portalUser,
    myProject,
    ledgers,
    transactions,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    evidenceRequiredMap,
    sheetSources,
    saveEvidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    expenseSheetRows,
    bankStatementRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetPlanRows,
    budgetCodeBook,
    budgetTreeV2,
    saveBankStatementRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
    markSheetSourceApplied,
    weeklySubmissionStatuses,
  } = usePortalStore();
  const {
    yearMonth: cashflowYearMonth,
    isLoading: cashflowLoading,
    submitWeekAsPm,
    ensureProjectCashflowSnapshot,
    getReadModelForProjectMonth,
  } = useCashflowWeeks();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const weeklyDirectApiMode = isPlatformApiEnabled();
  const [googleSheetImportOpen, setGoogleSheetImportOpen] = useState(false);
  const [hasUnsavedSettlementChanges, setHasUnsavedSettlementChanges] = useState(false);
  const [isSettlementSaving, setIsSettlementSaving] = useState(false);
  const [participationRiskWarning, setParticipationRiskWarning] = useState<{
    yearMonth: string;
    weekNo: number;
    txIds: string[];
    overLimitMembers: { memberName: string; groupLabel: string; totalRate: number }[];
  } | null>(null);

  const projectId = activeProjectId || myProject?.id || '';
  const projectName = myProject?.name || '내 사업';
  const ledgerUserRole = portalUser?.role === 'pm' ? 'pm' : 'admin';
  const visibleExpenseSheets = useMemo(() => (
    expenseSheets.length > 0
      ? expenseSheets
      : [{ id: 'default', name: '기본 탭', rows: expenseSheetRows, order: 0 }]
  ), [expenseSheets, expenseSheetRows]);
  const activeSheetName = useMemo(() => {
    return visibleExpenseSheets.find((sheet) => sheet.id === activeExpenseSheetId)?.name || visibleExpenseSheets[0]?.name || '기본 탭';
  }, [visibleExpenseSheets, activeExpenseSheetId]);
  const bankStatementCount = bankStatementRows?.rows?.length || 0;
  const cashflowReadModel = useMemo(
    () => getReadModelForProjectMonth(projectId, cashflowYearMonth),
    [cashflowYearMonth, getReadModelForProjectMonth, projectId],
  );
  const cashflowSummary = useMemo(() => {
    const projectionOut = Number(cashflowReadModel?.projection.monthTotals.totalOut || 0);
    const actualOut = Number(cashflowReadModel?.actual.monthTotals.totalOut || 0);
    return {
      projectionOut,
      actualOut,
      varianceOut: actualOut - projectionOut,
    };
  }, [cashflowReadModel]);

  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [projectId, ledgers]);
  const happyPath = useMemo(() => resolvePortalHappyPath({
    authUser,
    portalUser,
    project: myProject,
    ledgers,
  }), [authUser, portalUser, myProject, ledgers]);
  const isENaraProject = myProject?.settlementType === 'TYPE5' || myProject?.accountType === 'DEDICATED';
  const fundInputMode = normalizeProjectFundInputMode(myProject?.fundInputMode);
  const isDirectEntryMode = fundInputMode === 'DIRECT_ENTRY';
  const expenseRowCount = expenseSheetRows?.length || 0;
  const weeklySetupPanel = useMemo(() => {
    if (!happyPath.canOpenWeeklyExpenses) {
      return {
        title: '주간 사업비를 시작하려면 먼저 사업 연결이 필요합니다',
        description: '사업 배정이 끝나면 이 화면과 통장내역, 예산 화면을 같은 기준으로 사용할 수 있습니다.',
        toneClass: 'border-amber-200/70 bg-amber-50/70',
        actionLabel: '사업 설정 열기',
        actionKind: 'settings' as const,
      };
    }
    if (!isDirectEntryMode && bankStatementCount === 0) {
      return {
        title: '이번 주 원본이 아직 없습니다',
        description: '통장내역을 먼저 올리면 이 탭이 자동 분류와 사람 확인 기준으로 바로 이어집니다.',
        toneClass: 'border-cyan-200/70 bg-cyan-50/70',
        actionLabel: '통장내역 열기',
        actionKind: 'bank' as const,
      };
    }
    if (!weeklyDirectApiMode && !happyPath.canUseEvidenceWorkflow) {
      return {
        title: '증빙 폴더 연결을 마치면 제출 흐름이 더 빨라집니다',
        description: '기본 폴더를 준비하면 행 저장 후 바로 증빙 폴더 생성, 업로드, 동기화를 이어갈 수 있습니다.',
        toneClass: 'border-amber-200/70 bg-amber-50/70',
        actionLabel: '기본 폴더 준비',
        actionKind: 'drive' as const,
      };
    }
    return null;
  }, [
    bankStatementCount,
    happyPath.canOpenWeeklyExpenses,
    happyPath.canUseEvidenceWorkflow,
    isDirectEntryMode,
    weeklyDirectApiMode,
  ]);
  const settlementSheetPolicy = useMemo(
    () => normalizeSettlementSheetPolicy(myProject?.settlementSheetPolicy, myProject?.fundInputMode),
    [myProject?.fundInputMode, myProject?.settlementSheetPolicy],
  );
  const effectiveBudgetCodeBook = useMemo(() => {
    const orderedCodes: string[] = [];
    const subCodesByCode = new Map<string, Set<string>>();
    const pushEntry = (rawCode?: string | null, rawSub?: string | null) => {
      const code = normalizeBudgetLabel(rawCode || '');
      const sub = normalizeBudgetLabel(rawSub || '');
      if (!code || !sub) return;
      if (!subCodesByCode.has(code)) {
        subCodesByCode.set(code, new Set());
        orderedCodes.push(code);
      }
      subCodesByCode.get(code)!.add(sub);
    };

    const pushCode = (rawCode?: string | null) => {
      const code = normalizeBudgetLabel(rawCode || '');
      if (!code) return;
      if (!subCodesByCode.has(code)) {
        subCodesByCode.set(code, new Set());
        orderedCodes.push(code);
      }
      return code;
    };

    if (budgetTreeV2?.codes && budgetTreeV2.codes.length > 0) {
      budgetTreeV2.codes.forEach((entry) => {
        const code = pushCode(entry.code);
        if (!code) return;
        entry.subItems.forEach((subItem) => pushEntry(code, subItem.subCode));
      });
    } else {
      budgetCodeBook.forEach((entry) => {
        const code = pushCode(entry.code);
        if (!code) return;
        entry.subCodes.forEach((subCode) => pushEntry(code, subCode));
      });
      (budgetPlanRows || []).forEach((row) => pushEntry(row.budgetCode, row.subCode));
    }

    return orderedCodes.map((code) => ({
      code,
      subCodes: Array.from(subCodesByCode.get(code) || []),
    })).filter((entry) => entry.subCodes.length > 0);
  }, [budgetCodeBook, budgetPlanRows, budgetTreeV2?.codes]);

  const authorOptions = useMemo(() => {
    const names = new Set<string>();
    const collectNames = (value?: string | null) => {
      splitLooseNameList(value).forEach((name) => names.add(name));
    };
    participationEntries
      .filter((e) => e.projectId === projectId)
      .forEach((e) => {
        collectNames(e.memberName);
      });
    collectNames(portalUser?.name);
    collectNames(myProject?.managerName);
    collectNames(myProject?.settlementSupportName);
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [participationEntries, projectId, portalUser?.name, myProject?.managerName, myProject?.settlementSupportName]);

  const bffActor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: authUser?.role || portalUser?.role || 'pm',
    idToken: authUser?.idToken,
    googleAccessToken: authUser?.googleAccessToken,
  }), [
    authUser?.uid,
    authUser?.email,
    authUser?.role,
    authUser?.idToken,
    authUser?.googleAccessToken,
    portalUser?.id,
    portalUser?.email,
    portalUser?.role,
  ]);
  const handleAddTransaction = useCallback((tx: Transaction) => {
    void addTransaction(tx).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 저장에 실패했습니다.'));
    });
  }, [addTransaction]);

  const handleUpdateTransaction = useCallback((txId: string, updates: Partial<Transaction>) => {
    void updateTransaction(txId, updates).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 수정에 실패했습니다.'));
    });
  }, [updateTransaction]);

  useEffect(() => {
    if (!projectId) return;
    void ensureProjectCashflowSnapshot(projectId);
  }, [ensureProjectCashflowSnapshot, projectId]);

  const handleSaveExpenseSheetRows = useCallback(async (rows: ImportRow[]) => {
    const persistedRows = await saveExpenseSheetRows(rows);
    if (projectId) {
      try {
        await ensureProjectCashflowSnapshot(projectId, { force: true });
      } catch (error) {
        console.warn('[PortalWeeklyExpense] cashflow summary refresh failed:', error);
      }
    }
    return persistedRows;
  }, [ensureProjectCashflowSnapshot, projectId, saveExpenseSheetRows]);

  const handleSubmitWeek = useCallback(async ({ yearMonth, weekNo, txIds }: {
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => {
    const riskCheck = detectParticipationRisk(participationEntries);
    if (riskCheck.hasOverLimit) {
      setParticipationRiskWarning({
        yearMonth,
        weekNo,
        txIds,
        overLimitMembers: riskCheck.overLimitMembers.map((m) => ({
          memberName: m.memberName,
          groupLabel: m.groupLabel,
          totalRate: m.totalRate,
        })),
      });
      return;
    }
    let updatedCount = 0;
    try {
      await submitWeekAsPm({ projectId, yearMonth, weekNo });
      for (const txId of txIds) {
        await changeTransactionState(txId, 'SUBMITTED');
        updatedCount += 1;
      }
      toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
    } catch (err) {
      const fallback = updatedCount > 0
        ? `주간 제출은 저장됐지만 거래 상태 ${updatedCount}/${txIds.length}건만 갱신했습니다.`
        : '주간 제출 처리에 실패했습니다';
      toast.error(resolveApiErrorMessage(err, fallback));
      throw err;
    }
  }, [changeTransactionState, participationEntries, projectId, submitWeekAsPm]);

  const handleChangeTransactionState = useCallback((txId: string, newState: TransactionState, reason?: string) => {
    void changeTransactionState(txId, newState, reason).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 상태 변경에 실패했습니다.'));
    });
  }, [changeTransactionState]);

  const requestRouteNavigation = useCallback((path: string, label: string) => {
    if (isSettlementSaving) {
      toast.message(`${label} 이동은 저장이 끝난 뒤 가능합니다.`);
      return;
    }
    navigate(path);
  }, [isSettlementSaving, navigate]);

  useEffect(() => {
    registerNavigationHandler(() => {
      if (isSettlementSaving) return true;
      return false;
    });
    return () => registerNavigationHandler(null);
  }, [isSettlementSaving, registerNavigationHandler]);

  useEffect(() => {
    if (!isSettlementSaving) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSettlementSaving]);

  const requestSheetSwitch = useCallback((sheetId: string) => {
    if (sheetId === activeExpenseSheetId) return;
    setActiveExpenseSheet(sheetId);
  }, [activeExpenseSheetId, setActiveExpenseSheet]);

  if (!projectId) {
    return (
      <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/70 p-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-[20px] font-extrabold tracking-[-0.03em] text-slate-900">주간 사업비 화면을 열 준비가 아직 끝나지 않았습니다</h1>
          <p className="text-[13px] leading-6 text-slate-600">
            사업 배정이 끝나면 이번 주 입력 탭, 통장내역, 증빙 흐름을 같은 기준으로 이어서 사용할 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate('/portal/project-select')}>사업 선택하기</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/portal/project-select')}>프로젝트 선택으로 이동</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-background/95 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold">사업비 입력(주간)</h2>
              <Badge variant="outline" className="text-[10px]">
                {PROJECT_FUND_INPUT_MODE_LABELS[fundInputMode]}
              </Badge>
              {isENaraProject && (
                <Badge variant="outline" className="text-[10px]">
                  TYPE5 / 전용계좌
                </Badge>
              )}
            </div>
            <p className="max-w-4xl text-[12px] text-muted-foreground">
              {isDirectEntryMode
                ? '주간 사업비 시트 또는 엑셀 템플릿으로 직접 입력합니다. Actual은 저장 후 캐시플로에서 확인합니다.'
                : bankStatementCount > 0
                  ? '통장내역 기준본에서 이어서 작업합니다. 이 화면에서 분류 확인, 행 입력, 저장까지 바로 마무리하세요.'
                  : '통장내역 기준본을 먼저 만들면 이 화면에서 바로 입력과 저장을 이어갈 수 있습니다.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50/80 px-3 py-2.5">
              <Badge variant="secondary" className="text-[10px]">
                현재 탭: {activeSheetName}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                거래 {expenseRowCount}건
              </Badge>
              {!isDirectEntryMode && (
                <Badge variant="outline" className="text-[10px]">
                  {bankStatementCount > 0 ? `통장내역 ${bankStatementCount}건 연결` : '통장내역 기준본 미준비'}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                {isDirectEntryMode
                  ? '원본 입력은 이 화면입니다.'
                  : bankStatementCount > 0
                    ? '원본 기준과 같은 흐름으로 저장하고 Actual 반영 결과를 확인합니다.'
                    : '원본 기준본을 준비하면 이 화면에서 바로 이어서 저장할 수 있습니다.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap xl:justify-end">
          {isDirectEntryMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                data-testid="weekly-expense-bank-statement-action"
                onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}
              >
                기존 통장내역 가져오기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              data-testid="weekly-expense-bank-statement-action"
              onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}
            >
              {bankStatementCount > 0 ? '통장내역 검토' : '통장내역 열기'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            data-testid="weekly-expense-cashflow-action"
            onClick={() => requestRouteNavigation('/portal/cashflow', '캐시플로')}
          >
            <BarChart3 className="h-4 w-4" />
            캐시플로 보기
          </Button>
          {myProject?.evidenceDriveRootFolderLink && (
            <Button asChild variant="outline" size="sm">
              <a href={myProject.evidenceDriveRootFolderLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                기본 폴더 열기
              </a>
            </Button>
          )}
            <Button
              variant="outline"
              size="sm"
            onClick={() => requestRouteNavigation('/portal/project-select', '사업 선택')}
          >
            사업 선택
          </Button>
          </div>
        </div>
          <div className={`mt-4 grid gap-3 ${weeklySetupPanel ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]' : ''}`}>
          {weeklySetupPanel ? (
            <Card data-testid="weekly-expense-setup-panel" className={weeklySetupPanel.toneClass}>
              <CardContent className="px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">지금 해야 할 일</p>
                    <p className="text-[15px] font-semibold text-slate-900">{weeklySetupPanel.title}</p>
                    <p className="max-w-4xl text-[12px] leading-6 text-slate-600">{weeklySetupPanel.description}</p>
                  </div>
                  {weeklySetupPanel.actionLabel && (
                    <div className="shrink-0">
                      {weeklySetupPanel.actionKind === 'drive' ? null : weeklySetupPanel.actionKind === 'settings' ? (
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/project-select', '사업 선택')}>
                          {weeklySetupPanel.actionLabel}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}>
                          {weeklySetupPanel.actionLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-xl border bg-slate-50/80 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">입력 정책</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatSettlementSheetPolicySummary(settlementSheetPolicy)}</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {expenseRowCount}건의 거래를 현재 탭에서 관리합니다. 저장된 행은 Actual 반영 기준으로 사용됩니다.
            </div>
          </div>
          <div className="rounded-xl border bg-slate-50/80 px-4 py-3" data-testid="weekly-expense-cashflow-summary">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cashflow {cashflowYearMonth}</div>
              {cashflowLoading && !cashflowReadModel ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground">Projection</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">{formatWon(cashflowSummary.projectionOut)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Actual</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">{formatWon(cashflowSummary.actualOut)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">차이</div>
                <div className={`mt-0.5 text-sm font-semibold ${cashflowSummary.varianceOut > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {formatWon(cashflowSummary.varianceOut)}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {visibleExpenseSheets.map((sheet) => (
            <Button
              key={sheet.id}
              variant={sheet.id === activeExpenseSheetId ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => requestSheetSwitch(sheet.id)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      </div>

      <VarianceFlagBanner
        projectId={projectId}
        pmName={portalUser?.name || 'PM'}
        pmUid={portalUser?.id || ''}
      />
      <Suspense
        fallback={(
          <div className="rounded-xl border bg-background px-4 py-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              사업비 시트를 불러오는 중입니다…
            </div>
          </div>
        )}
      >
        <SettlementLedgerPage
          projectId={projectId}
          projectName={projectName}
          transactions={transactions}
          defaultLedgerId={defaultLedgerId}
          onAddTransaction={handleAddTransaction}
          onUpdateTransaction={handleUpdateTransaction}
          authorOptions={authorOptions}
          budgetCodeBook={effectiveBudgetCodeBook}
          budgetTreeV2={budgetTreeV2}
          hideYearControls
          hideCountBadge
          saveMode={weeklyExpenseSavePolicy.mode}
          autoSaveIdleMs={weeklyExpenseSavePolicy.idleMs}
          showSaveStatusButton={weeklyExpenseSavePolicy.showStatusButton}
          evidenceRequiredMap={evidenceRequiredMap}
          onSaveEvidenceRequiredMap={saveEvidenceRequiredMap}
          sheetRows={expenseSheetRows}
          onSaveSheetRows={handleSaveExpenseSheetRows}
          onSubmitWeek={handleSubmitWeek}
          onChangeTransactionState={handleChangeTransactionState}
          currentUserName={portalUser?.name || 'PM'}
          currentUserId={portalUser?.id || 'pm'}
          userRole={ledgerUserRole}
          allowEditSubmitted
          comments={comments}
          onAddComment={addComment}
          workflowMode={fundInputMode}
          settlementSheetPolicy={settlementSheetPolicy}
          basis={myProject?.basis}
          onDirtyStateChange={setHasUnsavedSettlementChanges}
          onSavingStateChange={setIsSettlementSaving}
          weeklySubmissionStatuses={weeklySubmissionStatuses}
          discardChangesRequestToken={0}
        />
      </Suspense>
      {isSettlementSaving && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex min-h-[22rem] w-[min(92vw,56rem)] max-w-none flex-col items-center justify-center gap-6 rounded-[28px] border bg-background px-8 py-10 shadow-2xl sm:px-12 sm:py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-[2rem]">사업비 입력을 저장하고 있습니다</p>
              <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">저장이 끝날 때까지 잠시 기다려 주세요.</p>
            </div>
          </div>
        </div>
      )}
      {googleSheetImportOpen && (
        <Suspense fallback={null}>
            <GoogleSheetMigrationWizard
              open={googleSheetImportOpen}
              onOpenChange={setGoogleSheetImportOpen}
              orgId={orgId}
              projectId={projectId}
              projectName={projectName}
              projectSettlementType={myProject?.settlementType}
              projectAccountType={myProject?.accountType}
              activeSheetName={activeSheetName}
              bffActor={bffActor}
              expenseSheetRows={expenseSheetRows || []}
              budgetPlanRows={budgetPlanRows || []}
              evidenceRequiredMap={evidenceRequiredMap}
              sheetSources={sheetSources}
              devHarnessEnabled={devHarnessConfig.enabled}
              ensureGoogleWorkspaceAccess={ensureGoogleWorkspaceAccess}
              saveBudgetPlanRows={saveBudgetPlanRows}
              saveBudgetCodeBook={saveBudgetCodeBook}
              saveBankStatementRows={saveBankStatementRows}
              saveEvidenceRequiredMap={saveEvidenceRequiredMap}
              markSheetSourceApplied={markSheetSourceApplied}
            />
        </Suspense>
      )}
      {/* 참여율 이상 탐지 경고 모달 */}
      <AlertDialog open={!!participationRiskWarning} onOpenChange={(open) => { if (!open) setParticipationRiskWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ 참여율 초과 경고</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>아래 인력의 참여율이 100%를 초과합니다. 확인 후 제출하세요.</p>
                <ul className="space-y-1 mt-2">
                  {participationRiskWarning?.overLimitMembers.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-rose-700 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      {m.memberName} — {m.groupLabel} 합산 {m.totalRate}%
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-[11px] mt-2">
                  계속 진행하면 제출이 완료됩니다. 참여율 관리는 인사 설정에서 수정하세요.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setParticipationRiskWarning(null)}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                if (!participationRiskWarning) return;
                const { yearMonth, weekNo, txIds } = participationRiskWarning;
                setParticipationRiskWarning(null);
                let updatedCount = 0;
                try {
                  await submitWeekAsPm({ projectId, yearMonth, weekNo });
                  for (const txId of txIds) {
                    await changeTransactionState(txId, 'SUBMITTED');
                    updatedCount += 1;
                  }
                  toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
                } catch (err) {
                  const fallback = updatedCount > 0
                    ? `주간 제출은 저장됐지만 거래 상태 ${updatedCount}/${txIds.length}건만 갱신했습니다.`
                    : '주간 제출 처리에 실패했습니다';
                  toast.error(resolveApiErrorMessage(err, fallback));
                }
              }}
            >
              이해했습니다, 제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// ── PM 편차 확인 배너 ──

function VarianceFlagBanner({
  projectId,
  pmName,
  pmUid,
}: {
  projectId: string;
  pmName: string;
  pmUid: string;
}) {
  const { weeks } = useCashflowWeeks();
  const [replyText, setReplyText] = useState('');
  const [replyingId, setReplyingId] = useState<string | null>(null);

  // Find all OPEN flags for this project
  const openFlags = useMemo(() => {
    return weeks.filter(
      (w) =>
        w.projectId === projectId &&
        w.varianceFlag?.status === 'OPEN',
    );
  }, [weeks, projectId]);

  const { updateVarianceFlag } = useCashflowWeeks();

  const handleReply = (sheet: CashflowWeekSheet) => {
    if (!replyText.trim() || !sheet.varianceFlag) return;
    const now = new Date().toISOString();
    const nextFlag = {
      ...sheet.varianceFlag,
      status: 'REPLIED' as const,
      pmReply: replyText.trim(),
      pmRepliedBy: pmName,
      pmRepliedByUid: pmUid,
      pmRepliedAt: now,
    };
    const nextHistory = [
      ...(sheet.varianceHistory || []),
      { id: `vf-${Date.now()}`, action: 'REPLY' as const, actor: pmName, actorUid: pmUid, content: replyText.trim(), timestamp: now },
    ];
    updateVarianceFlag({ sheetId: sheet.id, varianceFlag: nextFlag, varianceHistory: nextHistory }).catch(console.error);
    setReplyText('');
    setReplyingId(null);
  };

  if (openFlags.length === 0) return null;

  return (
    <div className="space-y-2">
      {openFlags.map((sheet) => {
        const flag = sheet.varianceFlag!;
        const weekLabel = `${sheet.yearMonth} ${sheet.weekNo}주`;
        const isReplying = replyingId === sheet.id;

        return (
          <div
            key={sheet.id}
            className="flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
                  관리자 확인요청 | {weekLabel}
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                  "{flag.reason}"
                </p>
                <p className="text-[9px] text-amber-600/70 mt-0.5">
                  {flag.flaggedBy} · {flag.flaggedAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              {!isReplying && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100"
                  onClick={() => setReplyingId(sheet.id)}
                >
                  답변
                </Button>
              )}
            </div>
            {isReplying && (
              <div className="flex gap-2 ml-6">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="사유를 입력하세요..."
                  className="flex-1 h-8 rounded-md border bg-background px-2.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleReply(sheet);
                    if (e.key === 'Escape') setReplyingId(null);
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 text-[11px] gap-1 px-3"
                  onClick={() => handleReply(sheet)}
                  disabled={!replyText.trim()}
                >
                  <Send className="h-3 w-3" />
                  전송
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
