import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { fmtShort } from '../../data/budget-data';
import { HR_EVENT_COLORS, HR_EVENT_LABELS } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import {
  PROJECT_STATUS_LABELS, SETTLEMENT_TYPE_SHORT, BASIS_LABELS,
} from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import {
  createPlatformApiClient,
  fetchPortalDashboardSummaryViaBff,
  type PortalDashboardSummaryResult,
} from '../../lib/platform-bff-client';

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

type DashboardPayrollQueueItem = NonNullable<PortalDashboardSummaryResult['payrollQueue']['item']>;
type DashboardSummaryRequestState = {
  projectId: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

const PORTAL_PAYROLL_BADGE_STYLES: Record<string, string> = {
  insufficient_balance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  payment_unconfirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  baseline_missing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  balance_unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function portalPayrollLabel(status: string) {
  if (status === 'insufficient_balance') return '잔액 부족 위험';
  if (status === 'payment_unconfirmed') return '지급 확인 필요';
  if (status === 'baseline_missing') return '기준 지급액 없음';
  if (status === 'balance_unknown') return '잔액 데이터 없음';
  return '이번 지급 창 안정';
}

function PortalDashboardSummaryStateCard({
  description,
  loading,
  title,
}: {
  description: string;
  loading: boolean;
  title: string;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${loading ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-600'}`}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="space-y-1.5">
            <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-slate-950">{title}</h2>
            <p className="text-[12px] leading-6 text-slate-600">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalDashboard() {
  const navigate = useNavigate();
  const { isLoading, portalUser, myProject } = usePortalStore();
  const { user: authUser } = useAuth();
  const { acknowledgePayrollRun, acknowledgeMonthlyClose } = usePayroll();
  const { orgId } = useFirebase();
  const apiClient = useMemo(() => createPlatformApiClient(import.meta.env), []);
  const [dashboardSummary, setDashboardSummary] = useState<PortalDashboardSummaryResult | null>(null);
  const [dashboardSummaryRequestState, setDashboardSummaryRequestState] = useState<DashboardSummaryRequestState>({
    projectId: '',
    status: 'idle',
  });
  const currentProjectId = myProject?.id || '';
  const currentProjectIdRef = useRef(currentProjectId);
  const latestDashboardSummaryRequestIdRef = useRef(0);
  const activeDashboardSummary = dashboardSummary?.project?.id === currentProjectId
    ? dashboardSummary
    : null;
  currentProjectIdRef.current = currentProjectId;

  async function refreshDashboardSummary(options?: {
    mode?: 'blocking' | 'background';
    projectId?: string;
  }) {
    const targetProjectId = options?.projectId ?? currentProjectId;
    if (!authUser?.uid || !orgId || !targetProjectId) return null;
    const requestId = latestDashboardSummaryRequestIdRef.current + 1;
    latestDashboardSummaryRequestIdRef.current = requestId;
    if ((options?.mode ?? 'background') === 'blocking') {
      setDashboardSummaryRequestState({
        projectId: targetProjectId,
        status: 'loading',
      });
    }

    try {
      const summary = await fetchPortalDashboardSummaryViaBff({
        tenantId: orgId,
        actor: authUser,
        projectId: targetProjectId,
        client: apiClient,
      });
      if (latestDashboardSummaryRequestIdRef.current === requestId) {
        setDashboardSummary(summary);
        setDashboardSummaryRequestState({
          projectId: targetProjectId,
          status: summary.project?.id === targetProjectId ? 'ready' : 'error',
        });
        if (summary.project?.id !== targetProjectId) {
          console.warn('[PortalDashboard] dashboard-summary project mismatch:', {
            expectedProjectId: targetProjectId,
            receivedProjectId: summary.project?.id,
          });
        }
      }
      return summary;
    } catch (error) {
      if (latestDashboardSummaryRequestIdRef.current === requestId) {
        console.warn('[PortalDashboard] dashboard-summary fetch failed:', error);
        setDashboardSummaryRequestState({
          projectId: targetProjectId,
          status: 'error',
        });
      }
      return null;
    }
  }

  useEffect(() => {
    if (!authUser?.uid || !orgId || !currentProjectId) {
      setDashboardSummary(null);
      setDashboardSummaryRequestState({
        projectId: '',
        status: 'idle',
      });
      return undefined;
    }

    setDashboardSummary((current) => (current?.project?.id === currentProjectId ? current : null));
    void refreshDashboardSummary({
      mode: 'blocking',
      projectId: currentProjectId,
    });

    return () => {
      latestDashboardSummaryRequestIdRef.current += 1;
    };
  }, [apiClient, authUser, currentProjectId, orgId]);

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

  const activeSummaryRequestStatus = dashboardSummaryRequestState.projectId === currentProjectId
    ? dashboardSummaryRequestState.status
    : (!activeDashboardSummary && Boolean(currentProjectId) ? 'loading' : 'idle');

  if (!activeDashboardSummary && activeSummaryRequestStatus === 'loading') {
    return (
      <PortalDashboardSummaryStateCard
        loading
        title="대시보드 요약을 불러오는 중입니다."
        description="선택한 사업의 최신 운영 요약을 확인한 뒤 대시보드를 표시합니다."
      />
    );
  }

  if (!activeDashboardSummary && activeSummaryRequestStatus === 'error') {
    return (
      <PortalDashboardSummaryStateCard
        loading={false}
        title="대시보드 요약을 지금 불러올 수 없습니다."
        description="요약 데이터가 준비되지 않아 현재 상태를 추정해서 보여주지 않습니다. 잠시 후 다시 확인해주세요."
      />
    );
  }

  const summaryProject = activeDashboardSummary?.project;
  const projectStatusLabel = summaryProject?.status
    ? PROJECT_STATUS_LABELS[summaryProject.status as keyof typeof PROJECT_STATUS_LABELS] || summaryProject.status
    : '-';
  const projectSettlementLabel = summaryProject?.settlementType
    ? SETTLEMENT_TYPE_SHORT[summaryProject.settlementType as keyof typeof SETTLEMENT_TYPE_SHORT] || summaryProject.settlementType
    : '-';
  const projectBasisLabel = summaryProject?.basis
    ? BASIS_LABELS[summaryProject.basis as keyof typeof BASIS_LABELS] || summaryProject.basis
    : '-';
  const projectContractAmount = typeof summaryProject?.contractAmount === 'number' && summaryProject.contractAmount > 0
    ? `${fmtShort(summaryProject.contractAmount)}원`
    : '-';
  const dashboardSurface = activeDashboardSummary?.surface;
  const financeSummaryItems = activeDashboardSummary?.financeSummaryItems ?? [
    { label: '총 입금', value: '-' },
    { label: '총 출금', value: '-' },
    { label: '잔액', value: '-' },
    { label: '소진율', value: '-' },
  ];
  const dashboardSubmissionRows = activeDashboardSummary?.submissionRows ?? [];
  const currentWeek = activeDashboardSummary?.currentWeek;
  const issueItems = activeDashboardSummary?.surface?.visibleIssues ?? [];
  const notices = activeDashboardSummary?.notices ?? {
    payrollAck: null,
    monthlyCloseAck: null,
    hrAlerts: {
      count: 0,
      items: [],
      overflowCount: 0,
    },
  };
  const payrollQueue = activeDashboardSummary?.payrollQueue ?? {
    item: null,
    riskItems: [],
  };
  const shouldShowPayrollQueue = Boolean(payrollQueue.item && payrollQueue.item.status !== 'clear');

  async function onAckPayroll() {
    const targetProjectId = currentProjectId;
    const targetRunId = notices.payrollAck?.runId;
    if (!targetRunId) return;
    try {
      await acknowledgePayrollRun(targetRunId);
      setDashboardSummary((current) => {
        if (!current) return current;
        if (current.project?.id !== targetProjectId) return current;
        if (current.notices.payrollAck?.runId !== targetRunId) return current;
        return {
          ...current,
          notices: {
            ...current.notices,
            payrollAck: null,
          },
        };
      });
      await refreshDashboardSummary({
        mode: 'background',
        projectId: currentProjectIdRef.current || targetProjectId,
      });
      toast.success('공지 확인이 기록되었습니다');
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || '확인 처리에 실패했습니다');
    }
  }

  async function onAckMonthlyClose() {
    const targetProjectId = currentProjectId;
    const targetCloseId = notices.monthlyCloseAck?.closeId;
    if (!targetCloseId) return;
    try {
      await acknowledgeMonthlyClose(targetCloseId);
      setDashboardSummary((current) => {
        if (!current) return current;
        if (current.project?.id !== targetProjectId) return current;
        if (current.notices.monthlyCloseAck?.closeId !== targetCloseId) return current;
        return {
          ...current,
          notices: {
            ...current.notices,
            monthlyCloseAck: null,
          },
        };
      });
      await refreshDashboardSummary({
        mode: 'background',
        projectId: currentProjectIdRef.current || targetProjectId,
      });
      toast.success('월간 정산 확인이 기록되었습니다');
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || '확인 처리에 실패했습니다');
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-300 bg-slate-200/80 shadow-sm">
        <CardContent className="p-5 md:p-6">
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="h-5 rounded-full bg-[#e8f0fb] px-2 text-[10px] font-semibold text-[#1b4f8f]">
                  {projectStatusLabel}
                </Badge>
                <Badge variant="outline" className="h-5 rounded-full border-slate-300 px-2 text-[10px] font-semibold text-slate-600">
                  {projectSettlementLabel}
                </Badge>
                <Badge variant="outline" className="h-5 rounded-full border-slate-300 px-2 text-[10px] font-semibold text-slate-600">
                  {projectBasisLabel}
                </Badge>
              </div>
              <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-slate-950">
                {summaryProject?.name || '내 사업'}
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
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {summaryProject?.clientOrg || '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">담당자</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {summaryProject?.managerName || '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">사업비 총액</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {projectContractAmount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">이번 주 Projection</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {dashboardSurface?.currentWeekLabel || '-'} · {dashboardSurface?.projection?.label || '미작성'}
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
                        <div className="mt-1 text-[14px] font-semibold text-slate-900">{dashboardSurface?.projection?.label || '미작성'}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface?.projection?.detail || '이번 주 제출 상태를 확인하지 못했습니다.'}</div>
                      </div>
                      <Badge variant="outline" className={`rounded-full ${(dashboardSurface?.projection?.label || '미작성') === '미작성' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {dashboardSurface?.projection?.label || '미작성'}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-600">최근 Projection 수정</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-900">
                      {formatKstDateTime(dashboardSurface?.projection?.latestUpdatedAt)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">사업비 입력</div>
                        <div className="mt-1 text-[14px] font-semibold text-slate-900">{dashboardSurface?.expense?.label || '확인 필요'}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{dashboardSurface?.expense?.detail || '사업비 입력 상태를 확인하지 못했습니다.'}</div>
                      </div>
                      <Badge variant="outline" className={`rounded-full ${accountingToneBadgeClassName(dashboardSurface?.expense?.tone || 'muted')}`}>
                        {dashboardSurface?.expense?.label || '확인 필요'}
                      </Badge>
                    </div>
                  </div>
                  {issueItems.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {issueItems.map((item) => (
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
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-slate-950">
                내 제출 현황
              </h2>
              <p className="text-[11px] text-slate-500">
                제출 상태를 한 번에 확인합니다.
              </p>
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              {currentWeek ? `${currentWeek.label} · ${currentWeek.weekStart} ~ ${currentWeek.weekEnd}` : '-'}
            </div>
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

      {(notices.payrollAck || notices.monthlyCloseAck || notices.hrAlerts.items.length > 0) && (
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

            {notices.payrollAck && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    인건비 지급 예정: {notices.payrollAck.plannedPayDate}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    공지일: {notices.payrollAck.noticeDate} (지급일 3영업일 전)
                  </p>
                </div>
                <Button size="sm" className="h-8 text-[12px] gap-1.5 shrink-0" onClick={onAckPayroll}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {notices.monthlyCloseAck && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    월간 정산 완료 확인: {notices.monthlyCloseAck.yearMonth}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    완료일: {notices.monthlyCloseAck.doneAt ? new Date(notices.monthlyCloseAck.doneAt).toLocaleDateString('ko-KR') : '-'}
                  </p>
                </div>
                <Button size="sm" className="h-8 text-[12px] gap-1.5 shrink-0" onClick={onAckMonthlyClose}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {notices.hrAlerts.items.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>인사 공지 (미확인)</p>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => navigate('/portal/change-requests')}>
                    확인하러 가기
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {notices.hrAlerts.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <span className={`inline-flex h-4 items-center rounded px-1.5 text-[9px] ${HR_EVENT_COLORS[item.eventType as keyof typeof HR_EVENT_COLORS] || 'bg-slate-100 text-slate-700'}`}>
                          {HR_EVENT_LABELS[item.eventType as keyof typeof HR_EVENT_LABELS] || item.eventType}
                        </span>
                        <span className="ml-2 truncate">{item.employeeName} · {item.effectiveDate}</span>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{item.projectId}</Badge>
                    </div>
                  ))}
                  {notices.hrAlerts.overflowCount > 0 && (
                    <p className="text-[10px] text-muted-foreground">외 {notices.hrAlerts.overflowCount}건</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {shouldShowPayrollQueue && (
        <PortalPayrollQueueCard
          item={payrollQueue.item}
          riskItems={payrollQueue.riskItems}
          onOpenDetail={() => navigate('/portal/payroll')}
          onOpenBankStatements={() => navigate('/portal/bank-statements')}
        />
      )}
    </div>
  );
}

function PortalPayrollQueueCard({
  item,
  riskItems,
  onOpenDetail,
  onOpenBankStatements,
}: {
  item: DashboardPayrollQueueItem | null;
  riskItems: DashboardPayrollQueueItem[];
  onOpenDetail: () => void;
  onOpenBankStatements: () => void;
}) {
  return (
    <Card data-testid="portal-payroll-liquidity-card" className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <h2 className="flex items-center justify-between gap-2 text-[13px]" style={{ fontWeight: 700 }}>
          <span className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CircleDollarSign className="h-4 w-4" />
            </div>
            인건비 지급 Queue
          </span>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onOpenDetail}>
            상세 보기
          </Button>
        </h2>
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
                    <Badge className={`text-[10px] ${PORTAL_PAYROLL_BADGE_STYLES[risk.status] || PORTAL_PAYROLL_BADGE_STYLES.clear}`}>
                      {portalPayrollLabel(risk.status)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">지급일 {risk.plannedPayDate}</span>
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
