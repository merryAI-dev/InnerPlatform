import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CircleDollarSign,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAppStore } from '../../data/store';
import { usePayroll } from '../../data/payroll-store';
import type {
  PayrollCandidateReviewDecision,
  PayrollPaidStatus,
  PayrollReviewCandidate,
  PayrollReviewStatus,
  PayrollRun,
} from '../../data/types';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { fmtShort } from '../../data/budget-data';
import {
  isPayrollLiquidityRiskStatus,
  resolvePayrollLiquidityQueue,
  type PayrollLiquidityQueueItem,
} from '../../platform/payroll-liquidity';
import { resolvePayrollRunReview } from '../../platform/payroll-review';
import {
  getPayrollDecisionLabel,
  getPayrollDecisionTone,
  getPayrollPaidStatusLabel,
  getPayrollPaidStatusTone,
  getPayrollReviewStatusLabel,
  getPayrollReviewStatusTone,
} from '../../platform/payroll-display';

const LIQUIDITY_STATUS_STYLES: Record<PayrollLiquidityQueueItem['status'], string> = {
  insufficient_balance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  payment_unconfirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  baseline_missing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  balance_unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function payrollLiquidityLabel(status: PayrollLiquidityQueueItem['status']): string {
  if (status === 'insufficient_balance') return '잔액 부족 위험';
  if (status === 'payment_unconfirmed') return '지급 확인 필요';
  if (status === 'baseline_missing') return '기준 지급액 없음';
  if (status === 'balance_unknown') return '잔액 데이터 없음';
  return '안정';
}

function getPayrollReviewStatus(run?: PayrollRun | null): PayrollReviewStatus {
  return run?.pmReviewStatus || 'PENDING';
}

function getPayrollReviewStatusDetail(run?: PayrollRun | null): string {
  const status = getPayrollReviewStatus(run);
  if (!run) return '지급 대상을 찾을 수 없습니다.';
  if (status === 'COMPLETED') return 'PM이 원본 적요를 보고 지급 여부를 먼저 판단했습니다.';
  if (status === 'MISSING_CANDIDATE') return '검토해야 할 후보가 없어 수동 확인이 필요한 상태입니다.';
  return 'PM이 원본 적요를 먼저 검토해야 최종 확정이 가능합니다.';
}

function getReviewCandidates(run?: PayrollRun | null): PayrollReviewCandidate[] {
  return run?.reviewCandidates ?? [];
}

function getReviewDecisionSummary(run?: PayrollRun | null): Record<PayrollCandidateReviewDecision, number> {
  const summary: Record<PayrollCandidateReviewDecision, number> = {
    PENDING: 0,
    PAYROLL: 0,
    NOT_PAYROLL: 0,
    HOLD: 0,
  };
  for (const candidate of getReviewCandidates(run)) {
    summary[candidate.decision] += 1;
  }
  return summary;
}

function hasPayrollDecision(run?: PayrollRun | null): boolean {
  return getReviewDecisionSummary(run).PAYROLL > 0;
}

function canFinalizePayroll(run?: PayrollRun | null): boolean {
  return Boolean(
    run
    && run.paidStatus !== 'CONFIRMED'
    && getPayrollReviewStatus(run) === 'COMPLETED'
    && hasPayrollDecision(run),
  );
}

function getFinalConfirmBlockReason(run?: PayrollRun | null): string {
  if (!run) return '인건비 지급 대상을 찾을 수 없습니다.';
  if (run.paidStatus === 'CONFIRMED') return '이미 최종 확정된 지급입니다.';
  const status = getPayrollReviewStatus(run);
  if (status === 'MISSING_CANDIDATE') return 'PM이 확인할 인건비 후보가 없어 최종 확정할 수 없습니다.';
  if (status !== 'COMPLETED') return 'PM이 원본 적요를 먼저 검토해야 합니다.';
  if (!hasPayrollDecision(run)) return 'PAYROLL 판단이 최소 1건 있어야 최종 확정할 수 있습니다.';
  return '';
}

function getFinalConfirmMatchedTxIds(run?: PayrollRun | null): string[] {
  if (!run) return [];
  const payrollCandidateIds = getReviewCandidates(run)
    .filter((candidate) => candidate.decision === 'PAYROLL')
    .map((candidate) => candidate.txId);
  if (payrollCandidateIds.length > 0) return [...new Set(payrollCandidateIds)];
  if (run.matchedTxIds?.length) return [...new Set(run.matchedTxIds)];
  return [];
}

export function AdminPayrollPage() {
  const navigate = useNavigate();
  const { projects, transactions } = useAppStore();
  const {
    schedules,
    runs,
    monthlyCloses,
    confirmPayrollPaid,
    markMonthlyCloseDone,
  } = usePayroll();
  const [tab, setTab] = useState<'payroll' | 'monthly'>('payroll');
  const [txDialogProjectId, setTxDialogProjectId] = useState<string | null>(null);

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);

  const scheduleByProject = useMemo(() => {
    const map = new Map<string, typeof schedules[number]>();
    schedules.forEach((s) => map.set(s.projectId, s));
    return map;
  }, [schedules]);

  const runByProject = useMemo(() => {
    const map = new Map<string, typeof runs[number]>();
    runs.forEach((r) => {
      if (r.yearMonth === yearMonth) map.set(r.projectId, r);
    });
    return map;
  }, [runs, yearMonth]);
  const effectiveRunByProject = useMemo(() => {
    const map = new Map<string, PayrollRun>();
    for (const project of projects) {
      const run = runByProject.get(project.id);
      if (!run) continue;
      const review = resolvePayrollRunReview({
        run,
        transactions: transactions.filter((transaction) => transaction.projectId === project.id),
        today,
      });
      map.set(project.id, {
        ...run,
        reviewCandidates: review.reviewCandidates,
        pmReviewStatus: review.pmReviewStatus,
        paidStatus: review.paidStatus,
        missingCandidateAlertAt: review.missingCandidateAlertAt,
      });
    }
    return map;
  }, [projects, runByProject, today, transactions]);

  const closeByProjectPrev = useMemo(() => {
    const map = new Map<string, typeof monthlyCloses[number]>();
    monthlyCloses.forEach((c) => {
      if (c.yearMonth === prevYearMonth) map.set(c.projectId, c);
    });
    return map;
  }, [monthlyCloses, prevYearMonth]);

  const payrollKpis = useMemo(() => {
    const list = projects.map((p) => effectiveRunByProject.get(p.id)).filter(Boolean) as PayrollRun[];
    const due = list.filter((r) => today >= r.noticeDate).length;
    const unacked = list.filter((r) => today >= r.noticeDate && !r.acknowledged).length;
    const unconfirmed = list.filter((r) => today >= r.plannedPayDate && r.paidStatus !== 'CONFIRMED').length;
    return { due, unacked, unconfirmed };
  }, [effectiveRunByProject, projects, today]);

  const monthlyKpis = useMemo(() => {
    const list = projects.map((p) => closeByProjectPrev.get(p.id)).filter(Boolean) as typeof monthlyCloses;
    const done = list.filter((c) => c.status === 'DONE').length;
    const pendingAck = list.filter((c) => c.status === 'DONE' && !c.acknowledged).length;
    return { done, pendingAck };
  }, [projects, closeByProjectPrev, monthlyCloses]);
  const reviewKpis = useMemo(() => {
    const list = projects.map((project) => effectiveRunByProject.get(project.id)).filter(Boolean) as PayrollRun[];
    return {
      pending: list.filter((run) => getPayrollReviewStatus(run) === 'PENDING').length,
      missingCandidate: list.filter((run) => getPayrollReviewStatus(run) === 'MISSING_CANDIDATE').length,
      finalConfirm: list.filter((run) => canFinalizePayroll(run)).length,
    };
  }, [effectiveRunByProject, projects]);

  const liquidityQueue = useMemo(() => resolvePayrollLiquidityQueue({
    projects,
    runs,
    transactions,
    today,
  }), [projects, runs, transactions, today]);
  const liquidityRiskQueue = useMemo(
    () => liquidityQueue.filter((item) => isPayrollLiquidityRiskStatus(item.status)),
    [liquidityQueue],
  );
  const liquiditySetupQueue = useMemo(
    () => liquidityQueue.filter((item) => !isPayrollLiquidityRiskStatus(item.status) && item.status !== 'clear'),
    [liquidityQueue],
  );

  const txDialog = useMemo(() => {
    const projectId = txDialogProjectId || '';
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId) || null;
    const run = effectiveRunByProject.get(projectId) || runByProject.get(projectId) || null;
    const candidateIds = getReviewCandidates(run).length
      ? getReviewCandidates(run).map((candidate) => candidate.txId)
      : run?.matchedTxIds?.length
        ? run.matchedTxIds
        : [];
    const reviewSummary = getReviewDecisionSummary(run);
    const reviewCandidateByTxId = new Map(
      getReviewCandidates(run).map((candidate) => [candidate.txId, candidate]),
    );
    const txList = transactions
      .filter((t) => candidateIds.includes(t.id))
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    return {
      project,
      run,
      txList,
      candidateIds,
      reviewSummary,
      reviewCandidateByTxId,
      canFinalize: canFinalizePayroll(run),
      finalConfirmBlockReason: getFinalConfirmBlockReason(run),
    };
  }, [effectiveRunByProject, projects, runByProject, transactions, txDialogProjectId]);

  async function onConfirmPaid(projectId: string) {
    const run = effectiveRunByProject.get(projectId) || runByProject.get(projectId);
    if (!run) return;
    const blockReason = getFinalConfirmBlockReason(run);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    const matched = getFinalConfirmMatchedTxIds(run);
    try {
      await confirmPayrollPaid(run.id, matched);
      toast.success('인건비 지급을 확정했습니다');
      setTxDialogProjectId(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '지급 확정에 실패했습니다');
    }
  }

  async function onMarkMonthlyDone(projectId: string) {
    try {
      await markMonthlyCloseDone({ projectId, yearMonth: prevYearMonth });
      toast.success('월간 정산 완료로 표시했습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '월간 정산 처리에 실패했습니다');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CircleDollarSign}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
        title="인건비/월간정산 운영"
        description="PM이 적요를 먼저 검토하고, Admin이 월 지급을 최종 확정합니다. 공지 인지와 월간정산 확인도 같은 화면에서 추적합니다."
        badge={`${yearMonth}`}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[12px] gap-1.5"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </Button>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '공지 대상(이번달)', value: payrollKpis.due, icon: Clock, gradient: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#4f46e5' },
          { label: '미인지(이번달)', value: payrollKpis.unacked, icon: AlertTriangle, gradient: 'linear-gradient(135deg, #e11d48, #f43f5e)', color: '#e11d48' },
          { label: '미확정 지급', value: payrollKpis.unconfirmed, icon: FileText, gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#d97706' },
          { label: `${prevYearMonth} 정산 완료`, value: monthlyKpis.done, icon: CalendarCheck2, gradient: 'linear-gradient(135deg, #059669, #0d9488)', color: '#059669' },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: k.gradient }}>
                <k.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className="text-[18px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k.color }}>
                  {k.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="h-9">
          <TabsTrigger value="payroll" className="text-[12px] gap-1.5">
            <CircleDollarSign className="w-3.5 h-3.5" />
            인건비 공지/지급
          </TabsTrigger>
          <TabsTrigger value="monthly" className="text-[12px] gap-1.5">
            <CalendarCheck2 className="w-3.5 h-3.5" />
            월간정산 ({prevYearMonth})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payroll" className="mt-3 space-y-3">
          <Card data-testid="admin-payroll-liquidity-queue">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] flex items-center justify-between gap-2">
                <span>인건비 지급 Queue</span>
                <Badge variant="outline" className="text-[10px]">
                  위험 {liquidityRiskQueue.length}건
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <p className="text-[11px] text-muted-foreground">
                지급일 D-3부터 D+3까지 잔액과 지급 확정 여부를 함께 봅니다. 정상 예정건은 숨기고, 바로 개입이 필요한 건만 올립니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                  PM 검토 대기 {reviewKpis.pending}건
                </Badge>
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                  후보 없음 {reviewKpis.missingCandidate}건
                </Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                  최종 확정 가능 {reviewKpis.finalConfirm}건
                </Badge>
              </div>

              {liquidityRiskQueue.length === 0 ? (
                <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-4 py-4 text-[12px] text-emerald-800">
                  현재 열린 지급 창에서 즉시 대응이 필요한 인건비 위험은 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {liquidityRiskQueue.map((item) => (
                    <div
                      key={item.runId}
                      className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>
                              {item.projectShortName}
                            </p>
                            <Badge className={`text-[10px] ${LIQUIDITY_STATUS_STYLES[item.status]}`}>
                              {payrollLiquidityLabel(item.status)}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            지급일 {item.plannedPayDate} · 예상 인건비 {item.expectedPayrollAmount !== null ? `${fmtShort(item.expectedPayrollAmount)}원` : '-'} · 최저 잔액 {item.worstBalance !== null ? `${fmtShort(item.worstBalance)}원` : '-'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{item.statusReason}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            onClick={() => setTxDialogProjectId(item.projectId)}
                          >
                            후보내역 보기
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            onClick={() => navigate(`/projects/${item.projectId}`)}
                          >
                            프로젝트 열기
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {liquiditySetupQueue.length > 0 && (
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
                  <p className="text-[11px] text-slate-700" style={{ fontWeight: 700 }}>
                    설정 보완 필요 {liquiditySetupQueue.length}건
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    직전 확정 지급액 또는 잔액 데이터가 부족한 사업은 대시보드 위험열에 올리지 않고 여기서만 보입니다.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">프로젝트별 인건비 상태 ({yearMonth})</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">프로젝트</TableHead>
                      <TableHead className="text-[11px]">지급일(매월)</TableHead>
                      <TableHead className="text-[11px]">이번달 지급 예정</TableHead>
                      <TableHead className="text-[11px]">공지일(3영업일)</TableHead>
                      <TableHead className="text-[11px]">인지</TableHead>
                      <TableHead className="text-[11px]">지급</TableHead>
                      <TableHead className="text-[11px]">PM 검토</TableHead>
                      <TableHead className="text-[11px] text-right">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {projects.map((p) => {
                    const schedule = scheduleByProject.get(p.id);
                    const run = effectiveRunByProject.get(p.id) || runByProject.get(p.id);
                    const paidStatus = run?.paidStatus || 'UNKNOWN';
                    const reviewStatus = getPayrollReviewStatus(run);
                    const reviewSummary = getReviewDecisionSummary(run);
                    const ack = run?.acknowledged;
                    const showAckWarn = run ? (today >= run.noticeDate && !ack) : false;
                    const canFinalize = canFinalizePayroll(run);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-[11px]" style={{ fontWeight: 600 }}>
                          {p.shortName || p.id}
                          <div className="text-[10px] text-muted-foreground">{p.name}</div>
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {schedule ? `${schedule.dayOfMonth}일` : <span className="text-muted-foreground">미설정</span>}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {run?.plannedPayDate || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {run?.noticeDate || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {!run ? (
                            <Badge variant="outline" className="text-[10px]">-</Badge>
                          ) : ack ? (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                              확인
                            </Badge>
                          ) : (
                            <Badge className={`text-[10px] ${showAckWarn ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                              미확인
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          <Badge className={`text-[10px] ${getPayrollPaidStatusTone(paidStatus)}`}>
                            {getPayrollPaidStatusLabel(paidStatus)}
                          </Badge>
                          {paidStatus !== 'CONFIRMED' && run?.plannedPayDate && today >= run.plannedPayDate && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {run.matchedTxIds?.length
                                ? `${run.matchedTxIds.length}건 매칭`
                                : `${getReviewCandidates(run).length}건 후보`}
                          </div>
                        )}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {!run ? (
                            <Badge variant="outline" className="text-[10px]">-</Badge>
                          ) : (
                            <div className="space-y-1">
                              <Badge className={`text-[10px] ${getPayrollReviewStatusTone(reviewStatus)}`}>
                                {getPayrollReviewStatusLabel(reviewStatus)}
                              </Badge>
                              <div className="text-[10px] text-muted-foreground">
                                인건비 {reviewSummary.PAYROLL} · 보류 {reviewSummary.HOLD} · 아님 {reviewSummary.NOT_PAYROLL}
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              disabled={!run?.plannedPayDate}
                              onClick={() => setTxDialogProjectId(p.id)}
                            >
                              후보 내역
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={!run || paidStatus === 'CONFIRMED'}
                              onClick={() => setTxDialogProjectId(p.id)}
                            >
                              <CheckCircle2 className="w-3 h-3" /> {canFinalize ? '최종 확정' : '검토'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {projects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-[12px] text-muted-foreground py-8">
                        프로젝트가 없습니다
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">프로젝트별 월간정산 현황 ({prevYearMonth})</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">프로젝트</TableHead>
                    <TableHead className="text-[11px]">상태</TableHead>
                    <TableHead className="text-[11px]">PM 확인</TableHead>
                    <TableHead className="text-[11px]">완료일</TableHead>
                    <TableHead className="text-[11px] text-right">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => {
                    const close = closeByProjectPrev.get(p.id);
                    const status = close?.status || 'OPEN';
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-[11px]" style={{ fontWeight: 600 }}>
                          {p.shortName || p.id}
                          <div className="text-[10px] text-muted-foreground">{p.name}</div>
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {status === 'DONE' ? (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">완료</Badge>
                          ) : (
                            <Badge className="text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">진행중</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {close?.status === 'DONE' ? (
                            close.acknowledged ? (
                              <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">확인</Badge>
                            ) : (
                              <Badge className="text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">미확인</Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="text-[10px]">-</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {close?.doneAt ? new Date(close.doneAt).toLocaleDateString('ko-KR') : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] gap-1"
                            disabled={status === 'DONE'}
                            onClick={() => onMarkMonthlyDone(p.id)}
                          >
                            <CalendarCheck2 className="w-3 h-3" /> 정산완료
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {monthlyKpis.pendingAck > 0 && (
                <div className="mt-3 text-[11px] text-muted-foreground">
                  <span style={{ fontWeight: 600 }}>{monthlyKpis.pendingAck}개 사업</span>에서 PM 확인이 아직 완료되지 않았습니다.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Hint */}
      <Card className="border-border/50">
        <CardContent className="p-4 text-[11px] text-muted-foreground space-y-1.5">
          <p style={{ fontWeight: 600 }} className="text-foreground">운영 기준</p>
          <p>인건비 후보 거래는 <Badge variant="outline" className="text-[10px]">APPROVED · OUT · 적요/거래처/인건비 항목</Badge> 기준으로 지급일 ±3영업일 창에서 보수적으로 탐지합니다.</p>
          <p>PM 인지는 공지일(지급일 3영업일 전)부터 “미확인”으로 표시됩니다.</p>
          <p>월간정산 완료 후 PM 확인을 받아야 “완료(확인)”으로 마무리됩니다.</p>
        </CardContent>
      </Card>

      <Dialog open={!!txDialogProjectId} onOpenChange={(open) => { if (!open) setTxDialogProjectId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              인건비 사용내역 · PM 검토 {txDialog?.project?.shortName ? `· ${txDialog.project.shortName}` : ''}
            </DialogTitle>
            <DialogDescription>
              지급일 기준 인건비 후보 거래와 PM 검토 결과를 확인한 뒤, 필요한 경우 최종 지급 확정을 진행합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              지급 예정일: <span className="text-foreground" style={{ fontWeight: 700 }}>{txDialog?.run?.plannedPayDate || '-'}</span>
              <span className="mx-2">·</span>
              범위: 지급일 ±3영업일
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">PM 검토 상태</p>
                  <p className="text-[13px]" style={{ fontWeight: 700 }}>{getPayrollReviewStatusLabel(getPayrollReviewStatus(txDialog?.run))}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{getPayrollReviewStatusDetail(txDialog?.run)}</p>
                </div>
                <Badge className={`text-[10px] ${getPayrollReviewStatusTone(getPayrollReviewStatus(txDialog?.run))}`}>
                  {getPayrollReviewStatusLabel(getPayrollReviewStatus(txDialog?.run))}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <div className="rounded-md bg-background/80 px-2 py-1.5">
                  인건비 {txDialog?.reviewSummary?.PAYROLL ?? 0}
                </div>
                <div className="rounded-md bg-background/80 px-2 py-1.5">
                  보류 {txDialog?.reviewSummary?.HOLD ?? 0}
                </div>
                <div className="rounded-md bg-background/80 px-2 py-1.5">
                  미지급 {txDialog?.reviewSummary?.NOT_PAYROLL ?? 0}
                </div>
                <div className="rounded-md bg-background/80 px-2 py-1.5">
                  대기 {txDialog?.reviewSummary?.PENDING ?? 0}
                </div>
              </div>
              {!txDialog?.canFinalize && (
                <p className="mt-2 text-[11px] text-amber-700">
                  {txDialog?.finalConfirmBlockReason || '최종 확정은 PM 검토 완료와 PAYROLL 판단이 필요합니다.'}
                </p>
              )}
            </div>

            {(!txDialog || txDialog.txList.length === 0) ? (
              <div className="p-4 rounded-lg bg-muted/30 border border-border/40 text-[12px] text-muted-foreground">
                후보 거래가 없습니다. (APPROVED · OUT · 적요/거래처/인건비 항목 · 지급일±3영업일)
              </div>
            ) : (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">일자</TableHead>
                      <TableHead className="text-[11px]">메모</TableHead>
                      <TableHead className="text-[11px]">PM 판단</TableHead>
                      <TableHead className="text-[11px] text-right">금액</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txDialog.txList.map((t) => {
                      const reviewCandidate = txDialog.reviewCandidateByTxId.get(t.id);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="text-[11px]">{t.dateTime}</TableCell>
                          <TableCell className="text-[11px]">
                            <div style={{ fontWeight: 600 }}>{t.counterparty}</div>
                            <div className="text-[10px] text-muted-foreground line-clamp-1">{t.memo}</div>
                          </TableCell>
                          <TableCell className="text-[11px]">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${getPayrollDecisionTone(reviewCandidate?.decision || 'PENDING')}`}
                            >
                              {getPayrollDecisionLabel(reviewCandidate?.decision || 'PENDING')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[11px] text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtShort(t.amounts.bankAmount)}원
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setTxDialogProjectId(null)}>
              닫기
            </Button>
            <Button
              size="sm"
              className="h-8 text-[12px] gap-1.5"
              disabled={!txDialog?.run || !txDialog.canFinalize}
              onClick={() => {
                if (!txDialog?.project?.id) return;
                onConfirmPaid(txDialog.project.id);
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> 최종 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
