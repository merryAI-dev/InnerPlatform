import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, CircleDollarSign, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { usePortalStore } from '../../data/portal-store';
import { usePayroll } from '../../data/payroll-store';
import { addMonthsToYearMonth, computePlannedPayDate, getSeoulTodayIso, subtractBusinessDays } from '../../platform/business-days';

export function PortalPayrollPage() {
  const { portalUser, myProject } = usePortalStore();
  const {
    schedules,
    runs,
    monthlyCloses,
    upsertSchedule,
    acknowledgePayrollRun,
    acknowledgeMonthlyClose,
  } = usePayroll();

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);

  const projectId = portalUser?.projectId || myProject?.id || '';
  const schedule = useMemo(() => schedules.find((s) => s.projectId === projectId) || null, [projectId, schedules]);
  const run = useMemo(() => runs.find((r) => r.projectId === projectId && r.yearMonth === yearMonth) || null, [projectId, runs, yearMonth]);
  const monthlyClosePrev = useMemo(() => monthlyCloses.find((c) => c.projectId === projectId && c.yearMonth === prevYearMonth) || null, [monthlyCloses, prevYearMonth, projectId]);

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
        title="인건비 지급일 & 공지"
        description="사업별 인건비 지급일을 등록하면, 지급일 3영업일 전에 공지가 자동으로 노출됩니다."
        badge={myProject?.shortName || myProject?.id || ''}
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

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-teal-600" />
            <p className="text-[13px]" style={{ fontWeight: 700 }}>인건비 지급일 등록</p>
            {schedule ? (
              <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">설정됨</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">미설정</Badge>
            )}
          </div>

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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

