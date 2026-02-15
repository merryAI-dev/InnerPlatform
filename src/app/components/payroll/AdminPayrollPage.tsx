import { useMemo, useState } from 'react';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAppStore } from '../../data/store';
import { usePayroll } from '../../data/payroll-store';
import type { PayrollPaidStatus } from '../../data/types';
import { addDays, addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { fmtShort } from '../../data/budget-data';

const PAID_COLORS: Record<PayrollPaidStatus, string> = {
  UNKNOWN: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  AUTO_MATCHED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  CONFIRMED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  MISSING: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

function paidLabel(status: PayrollPaidStatus): string {
  if (status === 'AUTO_MATCHED') return '자동매칭';
  if (status === 'CONFIRMED') return '확정';
  if (status === 'MISSING') return '미지급?';
  return '미확인';
}

export function AdminPayrollPage() {
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

  const closeByProjectPrev = useMemo(() => {
    const map = new Map<string, typeof monthlyCloses[number]>();
    monthlyCloses.forEach((c) => {
      if (c.yearMonth === prevYearMonth) map.set(c.projectId, c);
    });
    return map;
  }, [monthlyCloses, prevYearMonth]);

  const payrollKpis = useMemo(() => {
    const list = projects.map((p) => runByProject.get(p.id)).filter(Boolean) as typeof runs;
    const due = list.filter((r) => today >= r.noticeDate).length;
    const unacked = list.filter((r) => today >= r.noticeDate && !r.acknowledged).length;
    const unconfirmed = list.filter((r) => today >= r.plannedPayDate && r.paidStatus !== 'CONFIRMED').length;
    return { due, unacked, unconfirmed };
  }, [projects, runByProject, runs, today]);

  const monthlyKpis = useMemo(() => {
    const list = projects.map((p) => closeByProjectPrev.get(p.id)).filter(Boolean) as typeof monthlyCloses;
    const done = list.filter((c) => c.status === 'DONE').length;
    const pendingAck = list.filter((c) => c.status === 'DONE' && !c.acknowledged).length;
    return { done, pendingAck };
  }, [projects, closeByProjectPrev, monthlyCloses]);

  function getMatchedPayrollTxIds(projectId: string, plannedPayDate?: string): string[] {
    if (!plannedPayDate) return [];
    const start = addDays(plannedPayDate, -2);
    const end = addDays(plannedPayDate, 2);
    return transactions
      .filter((t) => (
        t.projectId === projectId
        && t.cashflowCategory === 'LABOR_COST'
        && t.direction === 'OUT'
        && t.state === 'APPROVED'
        && t.dateTime >= start
        && t.dateTime <= end
      ))
      .map((t) => t.id);
  }

  const txDialog = useMemo(() => {
    const projectId = txDialogProjectId || '';
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId) || null;
    const run = runByProject.get(projectId) || null;
    const plannedPayDate = run?.plannedPayDate;
    const candidateIds = run?.matchedTxIds?.length
      ? run.matchedTxIds
      : getMatchedPayrollTxIds(projectId, plannedPayDate);
    const txList = transactions
      .filter((t) => candidateIds.includes(t.id))
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    return { project, run, txList, candidateIds };
  }, [getMatchedPayrollTxIds, projects, runByProject, transactions, txDialogProjectId]);

  async function onConfirmPaid(projectId: string) {
    const run = runByProject.get(projectId);
    if (!run) return;
    const matched = run.matchedTxIds?.length ? run.matchedTxIds : getMatchedPayrollTxIds(projectId, run.plannedPayDate);
    try {
      await confirmPayrollPaid(run.id, matched);
      toast.success('인건비 지급을 확정했습니다');
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
        description="인건비 공지(3영업일 전) 인지 여부, 지급 여부(거래 자동매칭+확정), 월간정산 현황을 관리합니다"
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
                    <TableHead className="text-[11px] text-right">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => {
                    const schedule = scheduleByProject.get(p.id);
                    const run = runByProject.get(p.id);
                    const paidStatus = run?.paidStatus || 'UNKNOWN';
                    const ack = run?.acknowledged;
                    const showAckWarn = run ? (today >= run.noticeDate && !ack) : false;
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
                          <Badge className={`text-[10px] ${PAID_COLORS[paidStatus]}`}>
                            {paidLabel(paidStatus)}
                          </Badge>
                          {paidStatus !== 'CONFIRMED' && run?.plannedPayDate && today >= run.plannedPayDate && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {run.matchedTxIds?.length
                                ? `${run.matchedTxIds.length}건 매칭`
                                : `${getMatchedPayrollTxIds(p.id, run.plannedPayDate).length}건 후보`}
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
                              내역
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={!run || paidStatus === 'CONFIRMED'}
                              onClick={() => onConfirmPaid(p.id)}
                            >
                              <CheckCircle2 className="w-3 h-3" /> 지급확정
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {projects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-[12px] text-muted-foreground py-8">
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
          <p>인건비 후보 거래는 <Badge variant="outline" className="text-[10px]">LABOR_COST · OUT · APPROVED</Badge> 기준으로 지급 예정일 ±2일 범위에서 자동 매칭됩니다.</p>
          <p>PM 인지는 공지일(지급일 3영업일 전)부터 “미확인”으로 표시됩니다.</p>
          <p>월간정산 완료 후 PM 확인을 받아야 “완료(확인)”으로 마무리됩니다.</p>
        </CardContent>
      </Card>

      <Dialog open={!!txDialogProjectId} onOpenChange={(open) => { if (!open) setTxDialogProjectId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              인건비 사용내역 {txDialog?.project?.shortName ? `· ${txDialog.project.shortName}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">
              지급 예정일: <span className="text-foreground" style={{ fontWeight: 700 }}>{txDialog?.run?.plannedPayDate || '-'}</span>
              <span className="mx-2">·</span>
              범위: 지급일 ±2일
            </div>

            {(!txDialog || txDialog.txList.length === 0) ? (
              <div className="p-4 rounded-lg bg-muted/30 border border-border/40 text-[12px] text-muted-foreground">
                후보 거래가 없습니다. (LABOR_COST · OUT · APPROVED · 지급일±2일)
              </div>
            ) : (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">일자</TableHead>
                      <TableHead className="text-[11px]">메모</TableHead>
                      <TableHead className="text-[11px] text-right">금액</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txDialog.txList.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-[11px]">{t.dateTime}</TableCell>
                        <TableCell className="text-[11px]">
                          <div style={{ fontWeight: 600 }}>{t.counterparty}</div>
                          <div className="text-[10px] text-muted-foreground line-clamp-1">{t.memo}</div>
                        </TableCell>
                        <TableCell className="text-[11px] text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtShort(t.amounts.bankAmount)}원
                        </TableCell>
                      </TableRow>
                    ))}
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
              disabled={!txDialog?.run || (txDialog.run.paidStatus === 'CONFIRMED')}
              onClick={() => {
                if (!txDialog?.project?.id) return;
                onConfirmPaid(txDialog.project.id).finally(() => setTxDialogProjectId(null));
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> 지급확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
