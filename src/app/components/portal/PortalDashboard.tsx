import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Calculator, ArrowRight,
  TrendingUp, AlertTriangle,
  CheckCircle2, CircleDollarSign,
  ArrowUpRight, ArrowDownRight, BarChart3,
  Loader2,
  FileSpreadsheet,
  ClipboardList,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { usePortalStore } from '../../data/portal-store';
import { useHrAnnouncements, HR_EVENT_LABELS, HR_EVENT_COLORS } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { TRANSACTIONS } from '../../data/mock-data';
import { fmtShort } from '../../data/budget-data';
import {
  PROJECT_STATUS_LABELS, SETTLEMENT_TYPE_SHORT, BASIS_LABELS,
  type Transaction,
  normalizeProjectFundInputMode,
} from '../../data/types';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { getOrgCollectionPath } from '../../lib/firebase';
import {
  isPayrollLiquidityRiskStatus,
  resolveProjectPayrollLiquidity,
  type PayrollLiquidityQueueItem,
} from '../../platform/payroll-liquidity';
import { buildPortalDashboardSurface } from '../../platform/portal-dashboard-surface';

// ═══════════════════════════════════════════════════════════════
// PortalDashboard — 내 사업 현황
// ═══════════════════════════════════════════════════════════════

function formatKstDateTime(value: string | undefined): string {
  if (!value) return '아직 수정 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '아직 수정 없음';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '--';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')} KST`;
}

function issueToneClassName(tone: 'neutral' | 'warn' | 'danger') {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100';
}

function accountingToneBadgeClassName(tone: 'muted' | 'warning' | 'danger' | 'success') {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function PortalDashboard() {
  const navigate = useNavigate();
  const { isLoading, portalUser, myProject, changeRequests, weeklySubmissionStatuses } = usePortalStore();
  const { getProjectAlerts } = useHrAnnouncements();
  const { runs, monthlyCloses, acknowledgePayrollRun, acknowledgeMonthlyClose } = usePayroll();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [liveTransactions, setLiveTransactions] = useState<Transaction[] | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!myProject || !portalUser) {
    return (
      <Card data-testid="portal-dashboard-blocked-state" className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1b4f8f] text-white shadow-sm">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-900">첫 사업 연결이 아직 끝나지 않았습니다</h1>
                <p className="text-[13px] leading-6 text-slate-600">
                  PM 포털은 배정된 사업을 기준으로 이번 주 정산, 통장내역, 예산 반영을 이어갑니다. 사업이 보이지 않으면 먼저 연결 상태를 확인하세요.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button className="gap-2" onClick={() => navigate('/portal/project-settings')}>
                사업 연결 확인하기
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => navigate('/portal/change-requests')}>
                관리자에게 요청 남기기
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  useEffect(() => {
    if (!firestoreEnabled || !db) {
      setLiveTransactions(null);
      return;
    }

    const unsubs: Unsubscribe[] = [];

    const txQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'transactions')),
      where('projectId', '==', myProject.id),
    );

    unsubs.push(
      onSnapshot(txQuery, (snap) => {
        setLiveTransactions(snap.docs.map((d) => d.data() as Transaction));
      }, (err) => {
        console.error('[PortalDashboard] transactions listen error:', err);
        toast.error('거래 데이터를 불러오지 못했습니다');
        setLiveTransactions(null);
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [db, firestoreEnabled, orgId, myProject.id]);

  const myTx = (liveTransactions ?? TRANSACTIONS).filter(t => t.projectId === myProject.id);
  const myChanges = changeRequests.filter(r => r.projectId === myProject.id);

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);
  const payrollRun = runs.find((r) => r.projectId === myProject.id && r.yearMonth === yearMonth) || null;
  const monthlyClosePrev = monthlyCloses.find((c) => c.projectId === myProject.id && c.yearMonth === prevYearMonth) || null;
  const hrAlerts = getProjectAlerts(myProject.id).filter((a) => !a.acknowledged);
  const needsPayrollAck = !!(payrollRun && today >= payrollRun.noticeDate && !payrollRun.acknowledged);
  const needsMonthlyCloseAck = !!(monthlyClosePrev && monthlyClosePrev.status === 'DONE' && !monthlyClosePrev.acknowledged);

  async function onAckPayroll() {
    if (!payrollRun) return;
    try {
      await acknowledgePayrollRun(payrollRun.id);
      toast.success('공지 확인이 기록되었습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '확인 처리에 실패했습니다');
    }
  }

  async function onAckMonthlyClose() {
    if (!monthlyClosePrev) return;
    try {
      await acknowledgeMonthlyClose(monthlyClosePrev.id);
      toast.success('월간 정산 확인이 기록되었습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '확인 처리에 실패했습니다');
    }
  }

  // 재무 KPI
  const totalIn = myTx.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amounts.bankAmount, 0);
  const totalOut = myTx.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amounts.bankAmount, 0);
  const balance = totalIn - totalOut;
  const burnRate = myProject.contractAmount > 0 ? totalOut / myProject.contractAmount : 0;
  const payrollQueueItems = useMemo(() => resolveProjectPayrollLiquidity({
    project: myProject,
    runs,
    transactions: myTx,
    today,
  }), [myProject, myTx, runs, today]);
  const payrollRiskItems = useMemo(
    () => payrollQueueItems.filter((item) => isPayrollLiquidityRiskStatus(item.status)),
    [payrollQueueItems],
  );
  const payrollDetail = payrollQueueItems[0] || null;
  const dashboardSurface = useMemo(() => buildPortalDashboardSurface({
    projectId: myProject.id,
    weeklySubmissionStatuses,
    todayIso: today,
    changeRequestCount: myChanges.filter((change) => change.state === 'SUBMITTED').length,
    hrAlertCount: hrAlerts.length,
    payrollRiskCount: payrollRiskItems.length,
  }), [hrAlerts.length, myChanges, myProject.id, payrollRiskItems.length, today, weeklySubmissionStatuses]);
  const currentFundInputMode = normalizeProjectFundInputMode(myProject.fundInputMode);
  const shouldShowPayrollQueue = Boolean(payrollDetail && payrollDetail.status !== 'clear');
  const primaryActions = currentFundInputMode === 'DIRECT_ENTRY'
    ? [
      { label: '사업비 입력', description: '이번 주 정산대장을 바로 입력하고 저장합니다.', to: '/portal/weekly-expenses', icon: FileSpreadsheet },
      { label: '캐시플로', description: `${dashboardSurface.currentWeekLabel} Projection을 확인하고 수정합니다.`, to: '/portal/cashflow', icon: BarChart3 },
      { label: '내 제출 현황', description: '이번 주 Projection과 사업비 입력 작성 여부를 확인합니다.', to: '/portal/submissions', icon: ClipboardList },
      { label: '예산 편집', description: '예산 구조와 실제 집행 기준을 정리합니다.', to: '/portal/budget', icon: Calculator },
    ]
    : [
      { label: '통장내역', description: '원본 업로드와 분류가 필요한 거래를 먼저 정리합니다.', to: '/portal/bank-statements', icon: CircleDollarSign },
      { label: '사업비 입력', description: '주간 입력과 저장 상태를 정리합니다.', to: '/portal/weekly-expenses', icon: FileSpreadsheet },
      { label: '캐시플로', description: `${dashboardSurface.currentWeekLabel} Projection을 확인하고 수정합니다.`, to: '/portal/cashflow', icon: BarChart3 },
      { label: '내 제출 현황', description: '이번 주 Projection과 사업비 입력 작성 여부를 확인합니다.', to: '/portal/submissions', icon: ClipboardList },
    ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,0.9fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="h-5 rounded-full bg-[#e8f0fb] px-2 text-[10px] font-semibold text-[#1b4f8f]">
                    {PROJECT_STATUS_LABELS[myProject.status]}
                  </Badge>
                  <Badge variant="outline" className="h-5 rounded-full border-slate-300 px-2 text-[10px] font-semibold text-slate-600">
                    {SETTLEMENT_TYPE_SHORT[myProject.settlementType]}
                  </Badge>
                  <Badge variant="outline" className="h-5 rounded-full border-slate-300 px-2 text-[10px] font-semibold text-slate-600">
                    {BASIS_LABELS[myProject.basis]}
                  </Badge>
                </div>
                <h2 className="mt-3 truncate text-[30px] font-semibold tracking-[-0.04em] text-slate-950">
                  {myProject.name}
                </h2>
                <p className="mt-2 text-[13px] leading-6 text-slate-600">
                  {portalUser.name}님이 담당 중인 사업입니다. 발주기관, 정산 기준, 예산 흐름과 현재 작업 상태를 한 화면에서 확인합니다.
                </p>
                <div className="mt-4 grid gap-3 text-[12px] text-slate-600 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">발주기관</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-900">{myProject.clientOrg || '-'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">사업비 총액</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-900">
                      {myProject.contractAmount > 0 ? `${fmtShort(myProject.contractAmount)}원` : '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">이번 주 Projection</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-900">
                      {dashboardSurface.currentWeekLabel} · {dashboardSurface.projection.label}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-slate-300 bg-white px-4 text-[12px] font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={() => navigate('/portal/project-settings')}
                >
                  프로젝트 설정
                </Button>
                <Button
                  className="h-10 rounded-xl bg-[#1b4f8f] px-4 text-[12px] font-semibold text-white hover:bg-[#163f72]"
                  onClick={() => navigate('/portal/weekly-expenses')}
                >
                  사업비 입력 열기
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-semibold text-slate-900">이번 주 정산 상태</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-600">이번 주 Projection</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-900">{dashboardSurface.projection.label}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface.projection.detail}</div>
                </div>
                <Badge variant="outline" className={`rounded-full ${dashboardSurface.projection.label === '미작성' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {dashboardSurface.projection.label}
                </Badge>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-600">최근 Projection 수정</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-900">
                    {formatKstDateTime(dashboardSurface.projection.latestUpdatedAt)}
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-600">사업비 입력</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-900">{dashboardSurface.expense.label}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface.expense.detail}</div>
                </div>
                <Badge variant="outline" className={`rounded-full ${accountingToneBadgeClassName(dashboardSurface.expense.tone)}`}>
                  {dashboardSurface.expense.label}
                </Badge>
              </div>
            </div>

            {dashboardSurface.visibleIssues.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-slate-600">처리 필요</div>
                <div className="flex flex-wrap gap-2">
                  {dashboardSurface.visibleIssues.map((item) => (
                    <button
                      key={item.label}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors ${issueToneClassName(item.tone)}`}
                      onClick={() => navigate(item.to)}
                    >
                      <span>{item.label}</span>
                      <span>{item.count}건</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 중요 공지 (인건비 / 월간정산 / 퇴사·전배) */}
      {(needsPayrollAck || needsMonthlyCloseAck || hrAlerts.length > 0) && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1b4f8f]" />
              <div className="min-w-0">
                <p className="text-[12px]" style={{ fontWeight: 800 }}>운영 확인 필요</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  인건비 지급/월간정산 확인, 인력변경(퇴사·전배 등) 관련 공지를 확인해주세요.
                </p>
              </div>
            </div>

            {needsPayrollAck && payrollRun && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    인건비 지급 예정: {payrollRun.plannedPayDate}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    공지일: {payrollRun.noticeDate} (지급일 3영업일 전)
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-[12px] gap-1.5 shrink-0"
                  onClick={onAckPayroll}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {needsMonthlyCloseAck && monthlyClosePrev && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    월간 정산 완료 확인: {monthlyClosePrev.yearMonth}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    완료일: {monthlyClosePrev.doneAt ? new Date(monthlyClosePrev.doneAt).toLocaleDateString('ko-KR') : '-'}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-[12px] gap-1.5 shrink-0"
                  onClick={onAckMonthlyClose}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {hrAlerts.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>인사 공지 (미확인)</p>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => navigate('/portal/change-requests')}>
                    확인하러 가기
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {hrAlerts.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <span className={`text-[9px] h-4 px-1.5 inline-flex items-center rounded ${HR_EVENT_COLORS[a.eventType]}`}>
                          {HR_EVENT_LABELS[a.eventType]}
                        </span>
                        <span className="ml-2 truncate">{a.employeeName} · {a.effectiveDate}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{a.projectId}</Badge>
                    </div>
                  ))}
                  {hrAlerts.length > 3 && (
                    <p className="text-[10px] text-muted-foreground">외 {hrAlerts.length - 3}건</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {shouldShowPayrollQueue && (
        <PortalPayrollQueueCard
          item={payrollDetail}
          riskItems={payrollRiskItems}
          onOpenDetail={() => navigate('/portal/payroll')}
          onOpenBankStatements={() => navigate('/portal/bank-statements')}
        />
      )}

      {/* 재무 KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '총 입금', value: fmtShort(totalIn), icon: ArrowUpRight },
          { label: '총 출금', value: fmtShort(totalOut), icon: ArrowDownRight },
          { label: '잔액', value: fmtShort(balance), icon: TrendingUp },
          { label: '소진율', value: `${(burnRate * 100).toFixed(1)}%`, icon: BarChart3 },
        ].map(k => (
          <Card key={k.label} className="border-slate-200 bg-white shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f0fb] text-[#1b4f8f]">
                <k.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{k.label}</p>
                <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-slate-950" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {k.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] text-slate-900">이번 주 바로 작업</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 pt-0 md:grid-cols-2 xl:grid-cols-4">
          {primaryActions.map((action) => (
            <button
              key={action.label}
              className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition-colors hover:bg-slate-100"
              onClick={() => navigate(action.to)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#1b4f8f] shadow-sm ring-1 ring-slate-200">
                  <action.icon className="h-4 w-4" />
                </div>
                <ArrowRight className="mt-1 h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4">
                <p className="text-[14px] font-semibold text-slate-950">{action.label}</p>
                <p className="mt-1 text-[12px] leading-6 text-slate-600">{action.description}</p>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const PORTAL_PAYROLL_BADGE_STYLES: Record<PayrollLiquidityQueueItem['status'], string> = {
  insufficient_balance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  payment_unconfirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  baseline_missing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  balance_unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function portalPayrollLabel(status: PayrollLiquidityQueueItem['status']) {
  if (status === 'insufficient_balance') return '잔액 부족 위험';
  if (status === 'payment_unconfirmed') return '지급 확인 필요';
  if (status === 'baseline_missing') return '기준 지급액 없음';
  if (status === 'balance_unknown') return '잔액 데이터 없음';
  return '이번 지급 창 안정';
}

function PortalPayrollQueueCard({
  item,
  riskItems,
  onOpenDetail,
  onOpenBankStatements,
}: {
  item: PayrollLiquidityQueueItem | null;
  riskItems: PayrollLiquidityQueueItem[];
  onOpenDetail: () => void;
  onOpenBankStatements: () => void;
}) {
  return (
    <Card data-testid="portal-payroll-liquidity-card" className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-[13px]">
          <span className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CircleDollarSign className="h-4 w-4" />
            </div>
            인건비 지급 Queue
          </span>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onOpenDetail}>
            상세 보기
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!item ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-[12px] text-muted-foreground">
            활성 지급 창이 열리면 지급일 D-3부터 D+3까지 잔액 위험을 여기서 바로 확인할 수 있습니다.
          </div>
        ) : riskItems.length > 0 ? (
          riskItems.map((risk) => (
            <div key={risk.runId} className="rounded-xl border border-rose-200/60 bg-rose-50/60 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/10">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${PORTAL_PAYROLL_BADGE_STYLES[risk.status]}`}>
                      {portalPayrollLabel(risk.status)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      지급일 {risk.plannedPayDate}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>
                    예상 인건비 {risk.expectedPayrollAmount !== null ? `${fmtShort(risk.expectedPayrollAmount)}원` : '-'} · 최저 잔액 {risk.worstBalance !== null ? `${fmtShort(risk.worstBalance)}원` : '-'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{risk.statusReason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" className="h-8 text-[11px] gap-1.5" onClick={onOpenBankStatements}>
                    통장내역 열기
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1.5" onClick={onOpenDetail}>
                    지급 상세
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : item.status === 'clear' ? (
          <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-4 py-4 dark:border-emerald-900/40 dark:bg-emerald-950/10">
            <p className="text-[12px] text-emerald-800 dark:text-emerald-200" style={{ fontWeight: 700 }}>
              이번 지급 창에는 바로 대응이 필요한 위험이 없습니다.
            </p>
            <p className="mt-1 text-[11px] text-emerald-700/90 dark:text-emerald-300/90">
              지급일 {item.plannedPayDate} · 예상 인건비 {item.expectedPayrollAmount !== null ? `${fmtShort(item.expectedPayrollAmount)}원` : '-'} · 현재 잔액 {item.currentBalance !== null ? `${fmtShort(item.currentBalance)}원` : '-'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/30">
            <p className="text-[12px] text-slate-800 dark:text-slate-100" style={{ fontWeight: 700 }}>
              이번 지급 창은 열렸지만 아직 판정 기준이 충분하지 않습니다.
            </p>
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              {item.statusReason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
