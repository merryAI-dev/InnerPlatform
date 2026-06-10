import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  ExternalLink,
  FolderPlus,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import {
  formatSettlementSheetPolicySummary,
  normalizeSettlementSheetPolicy,
  normalizeProjectFundInputMode,
  PROJECT_FUND_INPUT_MODE_LABELS,
} from '../../data/types';
import {
  provisionProjectEvidenceDriveRootViaBff,
} from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { SETTLEMENT_COLUMNS, type ImportRow } from '../../platform/settlement-csv';
import { resolvePortalHappyPath } from '../../platform/portal-happy-path';

function settlementCell(row: ImportRow, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  if (index < 0) return '';
  return String(row.cells?.[index] ?? '');
}

export function PortalWeeklyExpensePage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const {
    isLoading: portalStoreLoading,
    activeProjectId,
    portalUser,
    myProject,
    ledgers,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    expenseSheetRows,
    bankStatementRows,
  } = usePortalStore();
  const [projectDriveProvisioning, setProjectDriveProvisioning] = useState(false);

  const projectId = activeProjectId || myProject?.id || '';
  const projectName = myProject?.name || '내 사업';
  const visibleExpenseSheets = useMemo(() => (
    expenseSheets.length > 0
      ? expenseSheets
      : [{ id: 'default', name: '기본 탭', rows: expenseSheetRows, order: 0 }]
  ), [expenseSheets, expenseSheetRows]);
  const activeSheetName = useMemo(() => {
    return visibleExpenseSheets.find((sheet) => sheet.id === activeExpenseSheetId)?.name || visibleExpenseSheets[0]?.name || '기본 탭';
  }, [visibleExpenseSheets, activeExpenseSheetId]);
  const bankStatementCount = bankStatementRows?.rows?.length || 0;
  const happyPath = useMemo(() => resolvePortalHappyPath({
    authUser,
    portalUser,
    project: myProject,
    ledgers,
  }), [authUser, portalUser, myProject, ledgers]);
  const fundInputMode = normalizeProjectFundInputMode(myProject?.fundInputMode);
  const isDirectEntryMode = fundInputMode === 'DIRECT_ENTRY';
  const expenseDashboardRows = useMemo(() => expenseSheetRows || [], [expenseSheetRows]);
  const settlementSheetPolicy = useMemo(
    () => normalizeSettlementSheetPolicy(myProject?.settlementSheetPolicy, myProject?.fundInputMode),
    [myProject?.fundInputMode, myProject?.settlementSheetPolicy],
  );
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

  const weeklySetupPanel = useMemo(() => {
    if (portalStoreLoading) return null;
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
        description: '통장내역을 먼저 올리면 선택 반영과 사람 확인 기준으로 바로 이어집니다.',
        toneClass: 'border-cyan-200/70 bg-cyan-50/70',
        actionLabel: '통장내역 열기',
        actionKind: 'bank' as const,
      };
    }
    if (!happyPath.canUseEvidenceWorkflow) {
      return {
        title: '증빙 폴더 연결을 마치면 제출 흐름이 더 빨라집니다',
        description: '기본 폴더를 준비하면 저장된 지출 행 기준으로 증빙 파일을 이어서 관리할 수 있습니다.',
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
    portalStoreLoading,
  ]);

  const requestRouteNavigation = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  const requestSheetSwitch = useCallback((sheetId: string) => {
    if (sheetId === activeExpenseSheetId) return;
    setActiveExpenseSheet(sheetId);
  }, [activeExpenseSheetId, setActiveExpenseSheet]);

  const provisionProjectDriveRoot = useCallback(async () => {
    if (!projectId) return;
    setProjectDriveProvisioning(true);
    try {
      const result = await provisionProjectEvidenceDriveRootViaBff({
        tenantId: orgId,
        actor: bffActor,
        projectId,
      });
      toast.success(`기본 폴더 연결 완료: ${result.folderName}`);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '기본 폴더 생성에 실패했습니다.'));
    } finally {
      setProjectDriveProvisioning(false);
    }
  }, [bffActor, orgId, projectId]);

  if (!projectId) {
    return (
      <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/70 p-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-[20px] font-extrabold text-slate-900">주간 사업비 화면을 열 준비가 아직 끝나지 않았습니다</h1>
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
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">사업비 입력(주간)</h2>
              <Badge variant="outline" className="text-[10px]">
                {PROJECT_FUND_INPUT_MODE_LABELS[fundInputMode]}
              </Badge>
            </div>
            <p className="max-w-4xl text-[12px] text-muted-foreground">
              {isDirectEntryMode
                ? '직접 입력형 지출정보도 저장된 행 기준으로 확인합니다.'
                : bankStatementCount > 0
                  ? '통장내역 기준본에서 이어서 작업합니다. 선택 반영된 지출정보와 저장 상태를 확인합니다.'
                  : '통장내역 기준본을 먼저 만들면 이 화면에서 선택 반영된 지출내역을 확인할 수 있습니다.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50/80 px-3 py-2.5">
              <Badge variant="secondary" className="text-[10px]">
                현재 탭: {activeSheetName}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                지출 {expenseDashboardRows.length.toLocaleString('ko-KR')}건
              </Badge>
              {!isDirectEntryMode && (
                <Badge variant="outline" className="text-[10px]">
                  {bankStatementCount > 0 ? `통장내역 ${bankStatementCount.toLocaleString('ko-KR')}건 연결` : '통장내역 기준본 미준비'}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                주간 화면은 저장된 행을 보여주고 이동만 담당합니다. Projection/Actual 비교는 캐시플로 화면에서 확인합니다.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Button
              size="sm"
              data-testid="weekly-expense-bank-statement-action"
              onClick={() => requestRouteNavigation('/portal/bank-statements')}
            >
              {bankStatementCount > 0 ? '통장내역 선택' : '통장내역 열기'}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestRouteNavigation('/portal/cashflow')}
            >
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
            {!happyPath.canUseEvidenceWorkflow && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void provisionProjectDriveRoot()}
                disabled={projectDriveProvisioning || !happyPath.canOpenWeeklyExpenses}
              >
                {projectDriveProvisioning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                기본 폴더 준비
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestRouteNavigation('/portal/project-select')}
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
                  <div className="shrink-0">
                    {weeklySetupPanel.actionKind === 'drive' ? (
                      <Button
                        size="sm"
                        onClick={() => void provisionProjectDriveRoot()}
                        disabled={projectDriveProvisioning || !happyPath.canOpenWeeklyExpenses}
                      >
                        {projectDriveProvisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                        {weeklySetupPanel.actionLabel}
                      </Button>
                    ) : weeklySetupPanel.actionKind === 'settings' ? (
                      <Button size="sm" onClick={() => requestRouteNavigation('/portal/project-select')}>
                        {weeklySetupPanel.actionLabel}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements')}>
                        {weeklySetupPanel.actionLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-xl border bg-slate-50/80 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">저장/반영 상태</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatSettlementSheetPolicySummary(settlementSheetPolicy)}</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {expenseDashboardRows.length.toLocaleString('ko-KR')}건의 지출내역을 현재 탭에서 확인합니다. 계산과 검증은 Java API 저장 경로에서 확정합니다.
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

      <Card data-testid="weekly-expense-dashboard-surface" className="overflow-hidden rounded-lg">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[13px] font-bold text-slate-900">{projectName} 지출정보</p>
              <p className="mt-1 text-[12px] text-slate-500">
                선택 반영된 지출내역을 저장 상태 기준으로 확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[11px]">총 {expenseDashboardRows.length.toLocaleString('ko-KR')}건</Badge>
              <Badge variant="outline" className="text-[11px]">저장 행 기준</Badge>
              <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements')}>
                통장내역 선택
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {expenseDashboardRows.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] border-collapse text-[12px]">
                <thead className="bg-slate-100">
                  <tr>
                    {['No.', '거래일시', '해당 주차', '비목', '세목', '지급처', '상세 적요', '사업비 사용액', '통장에 찍힌 입/출금액', '통장잔액'].map((header) => (
                      <th key={header} className="border-b border-r px-3 py-2 text-left font-semibold text-slate-700">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenseDashboardRows.map((row, rowIndex) => (
                    <tr key={row.tempId || rowIndex} className="border-b bg-white">
                      <td className="border-r px-3 py-2 text-slate-500">{settlementCell(row, 'No.') || rowIndex + 1}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '거래일시')}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '해당 주차')}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '비목')}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '세목')}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '지급처')}</td>
                      <td className="border-r px-3 py-2">{settlementCell(row, '상세 적요')}</td>
                      <td className="border-r px-3 py-2 text-right font-medium">{settlementCell(row, '사업비 사용액')}</td>
                      <td className="border-r px-3 py-2 text-right">{settlementCell(row, '통장에 찍힌 입/출금액')}</td>
                      <td className="border-r px-3 py-2 text-right">{settlementCell(row, '통장잔액')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-5 py-10 text-center">
              <p className="text-[14px] font-semibold text-slate-900">반영된 지출내역이 없습니다</p>
              <p className="max-w-md text-[12px] leading-6 text-slate-500">
                통장내역에서 반영할 거래를 선택하면 이 화면에 저장 기준 지출정보가 표시됩니다.
              </p>
              <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements')}>
                통장내역 선택
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
