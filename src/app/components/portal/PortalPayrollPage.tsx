import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, CheckCircle2, CircleDollarSign, Info, AlertTriangle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { usePayroll } from '../../data/payroll-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  createPlatformApiClient,
  fetchPortalPayrollSummaryViaBff,
  type PortalPayrollSummaryResult,
} from '../../lib/platform-bff-client';
import { addMonthsToYearMonth, computePlannedPayDate, getSeoulTodayIso, subtractBusinessDays } from '../../platform/business-days';
import { fmtShort } from '../../data/budget-data';
import { resolveProjectPayrollLiquidity, type PayrollLiquidityQueueItem } from '../../platform/payroll-liquidity';
import { resolvePortalProjectReadModel } from './portal-read-model';

export function PortalPayrollPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { activeProjectId, myProject, transactions } = usePortalStore();
  const { orgId } = useFirebase();
  const {
    schedules,
    runs,
    monthlyCloses,
    upsertSchedule,
    acknowledgePayrollRun,
    acknowledgeMonthlyClose,
  } = usePayroll();
  const apiClient = useMemo(() => createPlatformApiClient(import.meta.env), []);
  const [payrollSummary, setPayrollSummary] = useState<PortalPayrollSummaryResult | null>(null);

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);

  const projectId = activeProjectId || myProject?.id || '';
  const projectReadModel = useMemo(() => resolvePortalProjectReadModel({
    summaryProject: payrollSummary?.project,
    fallbackProject: myProject,
    activeProjectId: projectId,
  }), [myProject, payrollSummary?.project, projectId]);
  const schedule = useMemo(
    () => payrollSummary?.schedule ?? (schedules.find((s) => s.projectId === projectId) || null),
    [payrollSummary?.schedule, projectId, schedules],
  );
  const run = useMemo(
    () => payrollSummary?.currentRun ?? (runs.find((r) => r.projectId === projectId && r.yearMonth === yearMonth) || null),
    [payrollSummary?.currentRun, projectId, runs, yearMonth],
  );
  const monthlyClosePrev = useMemo(() => monthlyCloses.find((c) => c.projectId === projectId && c.yearMonth === prevYearMonth) || null, [monthlyCloses, prevYearMonth, projectId]);
  const projectTransactions = useMemo(() => {
    return transactions.filter((tx) => tx.projectId === projectId);
  }, [projectId, transactions]);

  const [dayInput, setDayInput] = useState<string>(schedule ? String(schedule.dayOfMonth) : '');
  const day = Math.max(1, Math.min(31, Number.parseInt(dayInput || '0', 10) || 0));

  const preview = useMemo(() => {
    if (!day || day < 1 || day > 31) return null;
    const planned = computePlannedPayDate(yearMonth, day);
    const notice = subtractBusinessDays(planned, 3);
    return { planned, notice };
  }, [day, yearMonth]);

  const needsPayrollAck = !!(run && today >= run.noticeDate && !run.acknowledged);
  const needsMonthlyCloseAck = !!(monthlyClosePrev && monthlyClosePrev.status === 'DONE' && !monthlyClosePrev.acknowledged);
  const queueItems = useMemo(() => (
    myProject
      ? resolveProjectPayrollLiquidity({
          project: myProject,
          runs,
          transactions: projectTransactions,
          today,
        })
      : []
  ), [myProject, projectTransactions, runs, today]);
  const activeQueueItem = useMemo(() => {
    const summaryQueueItem = payrollSummary?.queue?.[0];
    if (summaryQueueItem) return {
      ...summaryQueueItem,
      projectShortName: summaryQueueItem.projectShortName || summaryQueueItem.projectId,
    } satisfies PayrollLiquidityQueueItem;
    return queueItems[0] || null;
  }, [payrollSummary?.queue, queueItems]);

  useEffect(() => {
    if (!authUser?.uid || !orgId) return;
    let cancelled = false;

    void fetchPortalPayrollSummaryViaBff({
      tenantId: orgId,
      actor: authUser,
      client: apiClient,
    })
      .then((summary) => {
        if (!cancelled) setPayrollSummary(summary);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[PortalPayrollPage] payroll-summary fetch failed; using store fallback:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, authUser, orgId]);

  useEffect(() => {
    if (!schedule || dayInput) return;
    setDayInput(String(schedule.dayOfMonth));
  }, [dayInput, schedule]);

  async function onSave() {
    if (!projectId) return;
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      toast.error('지급일은 1-31 사이여야 합니다');
      return;
    }
    try {
      await upsertSchedule({ projectId, dayOfMonth: day, active: true });
      toast.success('인건비 지급일을 저장했습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '저장에 실패했습니다');
    }
  }

  async function onAckPayroll() {
    if (!run) return;
    try {
      await acknowledgePayrollRun(run.id);
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

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CircleDollarSign}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
        title="인건비 지급 준비"
        description="지급일을 등록해 두면 지급 창 D-3부터 D+3까지 잔액 여력과 지급 확정 상태를 함께 점검할 수 있습니다."
        badge={payrollSummary?.project.shortName || myProject?.shortName || myProject?.id || ''}
      />

      {(needsPayrollAck || needsMonthlyCloseAck) && (
        <Card className="border-rose-200/60 dark:border-rose-800/40 bg-rose-50/50 dark:bg-rose-950/10">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[12px]" style={{ fontWeight: 700 }}>확인이 필요한 공지가 있습니다</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  지급 예정 또는 월간 정산 완료 공지를 확인해 주세요. Admin이 확인 여부를 추적합니다.
                </p>
              </div>
            </div>

            {needsPayrollAck && run && (
              <div className="p-3 rounded-lg bg-background border border-rose-200/50 dark:border-rose-800/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px]" style={{ fontWeight: 700 }}>
                      인건비 지급 예정: {run.plannedPayDate}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      공지일: {run.noticeDate} (3영업일 전)
                    </p>
                  </div>
                  <Button size="sm" className="h-8 text-[12px] gap-1.5" onClick={onAckPayroll}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                  </Button>
                </div>
              </div>
            )}

            {needsMonthlyCloseAck && monthlyClosePrev && (
              <div className="p-3 rounded-lg bg-background border border-rose-200/50 dark:border-rose-800/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px]" style={{ fontWeight: 700 }}>
                      월간 정산 완료 확인: {monthlyClosePrev.yearMonth}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      완료일: {monthlyClosePrev.doneAt ? new Date(monthlyClosePrev.doneAt).toLocaleDateString('ko-KR') : '-'}
                    </p>
                  </div>
                  <Button size="sm" className="h-8 text-[12px] gap-1.5" onClick={onAckMonthlyClose}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <PortalPayrollLiquidityDetail
        item={activeQueueItem}
        onOpenBankStatements={() => navigate('/portal/bank-statements')}
        onOpenWeeklyExpenses={() => navigate('/portal/weekly-expenses')}
      />

      <Card>
        <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-teal-600" />
              <p className="text-[13px]" style={{ fontWeight: 700 }}>인건비 지급일 등록</p>
              {projectReadModel.statusLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {projectReadModel.statusLabel}
                </Badge>
              )}
              {schedule ? (
                <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">설정됨</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">미설정</Badge>
              )}
            </div>
          {projectReadModel.projectMetaLabel && (
            <p className="text-[11px] text-muted-foreground">{projectReadModel.projectName} · {projectReadModel.projectMetaLabel}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <Label className="text-[11px]">매월 지급일 (1-31)</Label>
              <Input
                className="mt-1 h-9 text-[12px]"
                inputMode="numeric"
                value={dayInput}
                placeholder="예: 25"
                onChange={(e) => setDayInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              />
            </div>
            <div className="md:col-span-2">
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50 h-full">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px]" style={{ fontWeight: 600 }}>미리보기 ({yearMonth})</p>
                    {preview ? (
                      <div className="text-[11px] text-muted-foreground mt-1 space-y-1">
                        <p>지급 예정일: <span className="text-foreground" style={{ fontWeight: 700 }}>{preview.planned}</span></p>
                        <p>공지 시작일: <span className="text-foreground" style={{ fontWeight: 700 }}>{preview.notice}</span> (3영업일 전)</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">지급일을 입력하면 자동 계산됩니다.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" className="h-9 text-[12px] gap-1.5" onClick={onSave} disabled={!projectId}>
              <CircleDollarSign className="w-4 h-4" /> 저장
            </Button>
          </div>
        </CardContent>
      </Card>

      {run && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[13px]" style={{ fontWeight: 700 }}>이번달 인건비 상태</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-[11px]">
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-muted-foreground">지급 예정일</p>
                <p style={{ fontWeight: 800 }} className="mt-1">{run.plannedPayDate}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-muted-foreground">공지일</p>
                <p style={{ fontWeight: 800 }} className="mt-1">{run.noticeDate}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-muted-foreground">내 확인</p>
                <p style={{ fontWeight: 800 }} className="mt-1">{run.acknowledged ? '확인' : '미확인'}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-muted-foreground">지급 상태</p>
                <p style={{ fontWeight: 800 }} className="mt-1">{run.paidStatus}</p>
              </div>
            </div>
            {!activeQueueItem && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                현재는 지급 창 바깥입니다. 지급일 3일 전부터 이 화면에 잔액 strip과 위험 상태가 자동으로 열립니다.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const PAYROLL_STATUS_STYLES: Record<PayrollLiquidityQueueItem['status'], string> = {
  insufficient_balance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  payment_unconfirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  baseline_missing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  balance_unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function payrollStatusLabel(status: PayrollLiquidityQueueItem['status']) {
  if (status === 'insufficient_balance') return '잔액 부족 위험';
  if (status === 'payment_unconfirmed') return '지급 확인 필요';
  if (status === 'baseline_missing') return '기준 지급액 없음';
  if (status === 'balance_unknown') return '잔액 데이터 없음';
  return '이번 지급 창 안정';
}

function PortalPayrollLiquidityDetail({
  item,
  onOpenBankStatements,
  onOpenWeeklyExpenses,
}: {
  item: PayrollLiquidityQueueItem | null;
  onOpenBankStatements: () => void;
  onOpenWeeklyExpenses: () => void;
}) {
  if (!item) {
    return (
      <Card data-testid="portal-payroll-detail-empty">
        <CardContent className="p-4">
          <p className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>
            이번 지급 창이 아직 열리지 않았습니다.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            지급일 D-3부터 D+3까지 잔액 strip과 위험 경고가 자동으로 이 화면에 열립니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="portal-payroll-liquidity-detail">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge className={`text-[10px] ${PAYROLL_STATUS_STYLES[item.status]}`}>
                {payrollStatusLabel(item.status)}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                지급 창 {item.windowStart} ~ {item.windowEnd}
              </span>
            </div>
            <p className="text-[16px] text-foreground" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              지급일 {item.plannedPayDate}
            </p>
            <p className="text-[11px] text-muted-foreground">{item.statusReason}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] lg:min-w-[260px]">
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <p className="text-muted-foreground">직전 확정 지급액</p>
              <p className="mt-1 text-foreground" style={{ fontWeight: 700 }}>
                {item.expectedPayrollAmount !== null ? `${fmtShort(item.expectedPayrollAmount)}원` : '-'}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <p className="text-muted-foreground">현재 잔액</p>
              <p className="mt-1 text-foreground" style={{ fontWeight: 700 }}>
                {item.currentBalance !== null ? `${fmtShort(item.currentBalance)}원` : '-'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[12px] text-foreground" style={{ fontWeight: 700 }}>
            D-3 ~ D+3 잔액 strip
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {item.dayBalances.map((entry) => {
              const isRisk = item.expectedPayrollAmount !== null
                && entry.balance !== null
                && entry.balance < item.expectedPayrollAmount;
              return (
                <div
                  key={entry.date}
                  className={`rounded-xl border px-3 py-3 ${
                    isRisk
                      ? 'border-rose-200/70 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/10'
                      : 'border-border/60 bg-muted/20'
                  }`}
                >
                  <p className="text-[10px] text-muted-foreground">{entry.date.slice(5)}</p>
                  <p className="mt-1 text-[12px] text-foreground" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {entry.balance !== null ? `${fmtShort(entry.balance)}원` : '-'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 text-[11px] gap-1.5" onClick={onOpenBankStatements}>
            통장내역 열기 <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1.5" onClick={onOpenWeeklyExpenses}>
            사업비 입력(주간) 열기 <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
