import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  TrendingUp, AlertTriangle,
  CheckCircle2, CircleDollarSign, ShieldCheck,
  BarChart3,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import {
  collection,
  getDocs,
  query,
  where,
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
} from '../../data/types';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { resolveCurrentCashflowWeek } from '../../platform/cashflow-export-surface';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { getOrgCollectionPath } from '../../lib/firebase';
import {
  isPayrollLiquidityRiskStatus,
  resolveProjectPayrollLiquidity,
  type PayrollLiquidityQueueItem,
} from '../../platform/payroll-liquidity';
import { resolvePayrollRunReview } from '../../platform/payroll-review';
import { buildPortalDashboardSurface } from '../../platform/portal-dashboard-surface';
import {
  resolveWeeklyAccountingProductStatus,
  resolveWeeklyAccountingSnapshot,
} from '../../platform/weekly-accounting-state';
import {
  getPayrollReviewStatusLabel,
  getPayrollReviewStatusTone,
} from '../../platform/payroll-display';

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

function submissionBadgeClassName(tone: 'neutral' | 'warning' | 'danger' | 'success') {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function PortalDashboard() {
  const navigate = useNavigate();
  const { isLoading, portalUser, myProject, weeklySubmissionStatuses, projects } = usePortalStore();
  const { getProjectAlerts } = useHrAnnouncements();
  const { runs, monthlyCloses, acknowledgePayrollRun, acknowledgeMonthlyClose } = usePayroll();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [liveTransactions, setLiveTransactions] = useState<Transaction[] | null>(null);
  const [transactionsFetchState, setTransactionsFetchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const projectId = myProject?.id || '';

  useEffect(() => {
    if (!projectId || !firestoreEnabled || !db) {
      setLiveTransactions(null);
      setTransactionsFetchState('ready');
      return;
    }

    let isCancelled = false;
    setTransactionsFetchState('loading');

    const txQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'transactions')),
      where('projectId', '==', projectId),
    );

    void getDocs(txQuery)
      .then((snap) => {
        if (isCancelled) return;
        setLiveTransactions(snap.docs.map((d) => d.data() as Transaction));
        setTransactionsFetchState('ready');
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error('[PortalDashboard] transactions fetch error:', err);
        toast.error('거래 데이터를 불러오지 못했습니다');
        setLiveTransactions(null);
        setTransactionsFetchState('error');
      });

    return () => {
      isCancelled = true;
    };
  }, [db, firestoreEnabled, orgId, projectId]);

  const myTx = (liveTransactions ?? (!firestoreEnabled ? TRANSACTIONS : [])).filter(t => t.projectId === projectId);

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);
  const payrollRun = runs.find((r) => r.projectId === projectId && r.yearMonth === yearMonth) || null;
  const monthlyClosePrev = monthlyCloses.find((c) => c.projectId === projectId && c.yearMonth === prevYearMonth) || null;
  const hrAlerts = projectId ? getProjectAlerts(projectId).filter((a) => !a.acknowledged) : [];
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
  const burnRate = myProject && myProject.contractAmount > 0 ? totalOut / myProject.contractAmount : 0;
  const payrollQueueItems = useMemo(() => (
    myProject
      ? resolveProjectPayrollLiquidity({
          project: myProject,
          runs,
          transactions: myTx,
          today,
        })
      : []
  ), [myProject, myTx, runs, today]);
  const payrollRiskItems = useMemo(
    () => payrollQueueItems.filter((item) => isPayrollLiquidityRiskStatus(item.status)),
    [payrollQueueItems],
  );
  const payrollDetail = payrollQueueItems[0] || null;
  const payrollReview = useMemo(() => (
    payrollRun && transactionsFetchState === 'ready'
      ? resolvePayrollRunReview({
          run: payrollRun,
          transactions: myTx,
          today,
        })
      : null
  ), [myTx, payrollRun, today, transactionsFetchState]);
  const needsPayrollReviewAttention = Boolean(
    payrollReview?.needsPmReview
      || payrollReview?.hasMissingCandidate
      || payrollReview?.needsAdminConfirm,
  );
  const assignedProjects = useMemo(() => {
    if (!portalUser) return myProject ? [myProject] : [];
    const projectIds = Array.isArray(portalUser.projectIds) && portalUser.projectIds.length > 0
      ? portalUser.projectIds
      : portalUser.projectId ? [portalUser.projectId] : [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const ordered = projectIds
      .map((projectId) => projectMap.get(projectId))
      .filter((project): project is NonNullable<typeof project> => Boolean(project));
    if (ordered.length > 0) return ordered;
    return myProject ? [myProject] : [];
  }, [myProject, portalUser, projects]);
  const currentWeek = useMemo(() => resolveCurrentCashflowWeek(today), [today]);
  const weeklyStatusMap = useMemo(() => {
    const map = new Map<string, typeof weeklySubmissionStatuses[number]>();
    weeklySubmissionStatuses.forEach((status) => {
      map.set(`${status.projectId}-${status.yearMonth}-w${status.weekNo}`, status);
    });
    return map;
  }, [weeklySubmissionStatuses]);
  const dashboardSubmissionRows = useMemo(() => {
    if (!currentWeek) return [];
    return assignedProjects.map((project) => {
      const status = weeklyStatusMap.get(`${project.id}-${currentWeek.yearMonth}-w${currentWeek.weekNo}`);
      const snapshot = resolveWeeklyAccountingSnapshot(status);
      const expenseStatus = resolveWeeklyAccountingProductStatus({ snapshot });
      return {
        id: project.id,
        name: project.name,
        shortName: project.shortName || project.id,
        projectionInputLabel: snapshot.projectionEdited ? '입력됨' : '미입력',
        projectionDoneLabel: snapshot.projectionDone ? '제출 완료' : '미완료',
        expenseLabel: expenseStatus.label,
        expenseTone: (expenseStatus.tone === 'muted'
          ? 'neutral'
          : expenseStatus.tone) as 'neutral' | 'warning' | 'danger' | 'success',
        latestProjectionUpdatedAt: status?.projectionUpdatedAt || status?.projectionEditedAt,
      };
    });
  }, [assignedProjects, currentWeek, weeklyStatusMap]);
  const dashboardSurface = useMemo(() => buildPortalDashboardSurface({
    projectId,
    weeklySubmissionStatuses,
    todayIso: today,
    hrAlertCount: hrAlerts.length,
    payrollRiskCount: payrollRiskItems.length,
  }), [hrAlerts.length, payrollRiskItems.length, projectId, today, weeklySubmissionStatuses]);
  const shouldShowPayrollQueue = Boolean(payrollDetail && payrollDetail.status !== 'clear');

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
  const financeSummaryItems = [
    { label: '총 입금', value: fmtShort(totalIn) },
    { label: '총 출금', value: fmtShort(totalOut) },
    { label: '잔액', value: fmtShort(balance) },
    { label: '소진율', value: `${(burnRate * 100).toFixed(1)}%` },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-slate-300 bg-slate-200/80 shadow-sm">
        <CardContent className="p-5 md:p-6">
          <div className="space-y-5">
            <div className="space-y-3">
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
              <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-slate-950">
                {myProject.name}
              </h2>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {financeSummaryItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)]"
                >
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {item.label}
                  </div>
                  <div
                    className="mt-2 text-[23px] font-semibold tracking-[-0.03em] text-slate-950"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="h-full rounded-2xl border border-slate-300 bg-slate-300/35 px-4 py-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">프로젝트 상세</div>
                <div className="space-y-2">
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">발주기관</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">{myProject.clientOrg || '-'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">담당자</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">{portalUser.name}</div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">사업비 총액</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {myProject.contractAmount > 0 ? `${fmtShort(myProject.contractAmount)}원` : '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">이번 주 Projection</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {dashboardSurface.currentWeekLabel} · {dashboardSurface.projection.label}
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-full rounded-2xl border border-slate-300 bg-slate-300/35 px-4 py-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">이번 주 작업 상태</div>
                <div className="space-y-2">
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">Projection</div>
                        <div className="mt-1 text-[14px] font-semibold text-slate-900">{dashboardSurface.projection.label}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface.projection.detail}</div>
                      </div>
                      <Badge variant="outline" className={`rounded-full ${dashboardSurface.projection.label === '미작성' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {dashboardSurface.projection.label}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">최근 Projection 수정</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {formatKstDateTime(dashboardSurface.projection.latestUpdatedAt)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">사업비 입력</div>
                        <div className="mt-1 text-[14px] font-semibold text-slate-900">{dashboardSurface.expense.label}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface.expense.detail}</div>
                      </div>
                      <Badge variant="outline" className={`rounded-full ${accountingToneBadgeClassName(dashboardSurface.expense.tone)}`}>
                        {dashboardSurface.expense.label}
                      </Badge>
                    </div>
                  </div>
                  {dashboardSurface.visibleIssues.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
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
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-300 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200/80 pb-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-[15px] font-semibold tracking-[-0.02em] text-slate-950">
                내 제출 현황
              </CardTitle>
              <p className="text-[11px] text-slate-500">
                제출 상태를 한 번에 확인합니다.
              </p>
            </div>
            {currentWeek && (
              <div className="text-[11px] font-medium text-slate-500">
                {currentWeek.label} · {currentWeek.weekStart} ~ {currentWeek.weekEnd}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-100/90">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500" style={{ minWidth: 220 }}>
                    사업
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500" style={{ minWidth: 180 }}>
                    Projection
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500" style={{ minWidth: 180 }}>
                    사업비 입력
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500" style={{ minWidth: 180 }}>
                    최근 Projection 수정
                  </th>
                </tr>
              </thead>
              <tbody>
                {dashboardSubmissionRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200/70 transition-colors hover:bg-slate-50/70">
                    <td className="px-3 py-3 align-top">
                      <div className="text-[12px] font-semibold text-slate-950">{row.name}</div>
                      <div className="mt-1 text-[10px] font-medium text-slate-500">{row.shortName}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className={submissionBadgeClassName(row.projectionInputLabel === '입력됨' ? 'success' : 'neutral')}>
                          {row.projectionInputLabel}
                        </Badge>
                        <Badge variant="outline" className={submissionBadgeClassName(row.projectionDoneLabel === '제출 완료' ? 'success' : 'warning')}>
                          {row.projectionDoneLabel}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge variant="outline" className={submissionBadgeClassName(row.expenseTone)}>
                        {row.expenseLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 align-top text-[11px] font-medium text-slate-600">
                      {formatKstDateTime(row.latestProjectionUpdatedAt)}
                    </td>
                  </tr>
                ))}
                {dashboardSubmissionRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-[12px] text-slate-500">
                      이번 주 기준 제출 상태를 표시할 사업이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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

      {needsPayrollReviewAttention && payrollReview && (
        <Card data-testid="portal-payroll-review-card" className="border-border/60 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-[12px]" style={{ fontWeight: 800 }}>인건비 적요 검토</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  통장 적요를 먼저 보고 PM이 1차 판단을 남기면, 그 다음 Admin이 월 지급만 최종 확정합니다.
                </p>
              </div>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${
              payrollReview.hasMissingCandidate
                ? 'border-rose-200 bg-rose-50'
                : payrollReview.needsAdminConfirm
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`text-[10px] ${getPayrollReviewStatusTone(payrollReview.pmReviewStatus)}`}>
                  {payrollReview.needsAdminConfirm
                    ? 'Admin 최종 확정 대기'
                    : getPayrollReviewStatusLabel(payrollReview.pmReviewStatus)}
                </Badge>
                <Badge variant="outline" className="text-[10px] border-white/70 bg-white/70 text-slate-700">
                  후보 {payrollReview.candidateCount}건
                </Badge>
                {payrollReview.pendingDecisionCount > 0 && (
                  <Badge variant="outline" className="text-[10px] border-white/70 bg-white/70 text-slate-700">
                    남은 판단 {payrollReview.pendingDecisionCount}건
                  </Badge>
                )}
              </div>
              <p className="text-[12px]" style={{ fontWeight: 700 }}>
                {payrollReview.hasMissingCandidate
                  ? '이번 달 인건비 후보가 없습니다'
                  : payrollReview.needsAdminConfirm
                    ? 'Admin 최종 확정 대기'
                    : `PM 1차 검토 필요 · 남은 판단 ${payrollReview.pendingDecisionCount}건`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {payrollReview.hasMissingCandidate
                  ? '후보 없음은 정상 종료가 아닙니다. 통장내역을 직접 보고 적요를 확인해 주세요.'
                  : payrollReview.needsAdminConfirm
                    ? 'PM 검토가 끝났습니다. Admin이 월 지급 확정만 남겨둔 상태입니다.'
                    : `${payrollReview.candidateCount}건 후보가 잡혔습니다. 맞음/아님/보류로 먼저 닫아 주세요.`}
              </p>
            </div>

            <div className="flex items-center justify-end">
              <Button size="sm" className="h-8 text-[11px] gap-1.5" onClick={() => navigate('/portal/payroll')}>
                인건비 검토 열기 <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
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
