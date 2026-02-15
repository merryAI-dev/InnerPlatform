import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, FileText, Users } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { usePortalStore } from '../../data/portal-store';
import { EXPENSE_STATUS_COLORS, EXPENSE_STATUS_LABELS, fmtShort } from '../../data/budget-data';
import type { ExpenseSetStatus } from '../../data/budget-data';
import { STATE_LABELS, type ChangeRequestState } from '../../data/personnel-change-data';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { getSeoulTodayIso } from '../../platform/business-days';

function sortIsoDesc(a: string | undefined, b: string | undefined): number {
  return String(b || '').localeCompare(String(a || ''));
}

const EXPENSE_TABS: Array<{ label: string; value: ExpenseSetStatus | 'ALL' }> = [
  { label: '전체', value: 'ALL' },
  { label: '제출', value: 'SUBMITTED' },
  { label: '승인', value: 'APPROVED' },
  { label: '반려', value: 'REJECTED' },
];

const CHANGE_TABS: Array<{ label: string; value: ChangeRequestState | 'ALL' }> = [
  { label: '전체', value: 'ALL' },
  { label: '제출됨', value: 'SUBMITTED' },
  { label: '승인', value: 'APPROVED' },
  { label: '반려', value: 'REJECTED' },
  { label: '수정요청', value: 'REVISION_REQUESTED' },
];

export function PortalSubmissionsPage() {
  const navigate = useNavigate();
  const { portalUser, myProject, expenseSets, changeRequests } = usePortalStore();
  const { yearMonth, goPrevMonth, goNextMonth, getWeeksForProject } = useCashflowWeeks();

  const [expenseTab, setExpenseTab] = useState<ExpenseSetStatus | 'ALL'>('SUBMITTED');
  const [changeTab, setChangeTab] = useState<ChangeRequestState | 'ALL'>('SUBMITTED');

  const todayIso = getSeoulTodayIso();
  const todayYearMonth = todayIso.slice(0, 7);
  const projectId = portalUser?.projectId || myProject?.id || '';

  const myExpenseSets = useMemo(() => {
    if (!projectId) return [];
    return expenseSets
      .filter((s) => s.projectId === projectId)
      .slice()
      .sort((a, b) => sortIsoDesc(a.updatedAt, b.updatedAt));
  }, [expenseSets, projectId]);

  const myChanges = useMemo(() => {
    if (!projectId) return [];
    return changeRequests
      .filter((c) => c.projectId === projectId)
      .slice()
      .sort((a, b) => sortIsoDesc(a.requestedAt, b.requestedAt));
  }, [changeRequests, projectId]);

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const myCashflowWeeks = useMemo(() => (projectId ? getWeeksForProject(projectId).filter((w) => w.yearMonth === yearMonth) : []), [getWeeksForProject, projectId, yearMonth]);
  const byWeekNo = useMemo(() => {
    const map = new Map<number, { pmSubmitted: boolean; adminClosed: boolean }>();
    for (const w of myCashflowWeeks) {
      map.set(w.weekNo, { pmSubmitted: Boolean(w.pmSubmitted), adminClosed: Boolean(w.adminClosed) });
    }
    return map;
  }, [myCashflowWeeks]);

  const filteredExpenses = useMemo(() => {
    if (expenseTab === 'ALL') return myExpenseSets;
    return myExpenseSets.filter((s) => s.status === expenseTab);
  }, [expenseTab, myExpenseSets]);

  const filteredChanges = useMemo(() => {
    if (changeTab === 'ALL') return myChanges;
    return myChanges.filter((c) => c.state === changeTab);
  }, [changeTab, myChanges]);

  if (!portalUser || !myProject) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardList}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="내 제출 현황"
        description="제출한 항목의 진행 상태(제출/승인/반려)를 한 곳에서 확인합니다."
        badge={myProject.shortName || myProject.id}
        actions={(
          <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={() => navigate('/portal')}>
            <ExternalLink className="w-3.5 h-3.5" /> 대시보드로
          </Button>
        )}
      />

      {/* Expense Sets */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-500" />
              사업비 세트
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/expenses')}>
              상세 보기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={expenseTab} onValueChange={(v) => setExpenseTab(v as any)}>
            <TabsList className="w-full sm:w-fit">
              {EXPENSE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-[11px]">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={expenseTab} className="mt-3">
              <div className="space-y-2">
                {filteredExpenses.slice(0, 12).map((s) => (
                  <div key={s.id} className="p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>{s.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" /> {s.period}
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>합계 {fmtShort(s.totalGross)}원</span>
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge className={`text-[9px] h-4 px-1.5 ${EXPENSE_STATUS_COLORS[s.status]}`}>
                          {EXPENSE_STATUS_LABELS[s.status]}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          업데이트 {String(s.updatedAt || '').slice(0, 10)}
                        </span>
                      </div>
                    </div>
                    {s.status === 'REJECTED' && s.rejectedReason && (
                      <div className="mt-2 p-2 rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[10px] text-rose-700 dark:text-rose-300">
                        반려 사유: {s.rejectedReason}
                      </div>
                    )}
                  </div>
                ))}
                {filteredExpenses.length === 0 && (
                  <div className="py-8 text-center text-[12px] text-muted-foreground">
                    해당 상태의 사업비 세트가 없습니다.
                  </div>
                )}
                {filteredExpenses.length > 12 && (
                  <div className="pt-2 text-center">
                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => navigate('/portal/expenses')}>
                      더 보기 ({filteredExpenses.length - 12}건) <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Change Requests */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <Users className="w-4 h-4 text-violet-500" />
              인력변경 신청
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/change-requests')}>
              상세 보기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={changeTab} onValueChange={(v) => setChangeTab(v as any)}>
            <TabsList className="w-full flex flex-wrap justify-start">
              {CHANGE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-[11px]">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={changeTab} className="mt-3">
              <div className="space-y-2">
                {filteredChanges.slice(0, 10).map((c) => (
                  <div key={c.id} className="p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>{c.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          적용일 {c.effectiveDate} · 요청 {String(c.requestedAt || '').slice(0, 10)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">
                        {STATE_LABELS[c.state]}
                      </Badge>
                    </div>
                    {(c.state === 'REJECTED' || c.state === 'REVISION_REQUESTED') && c.reviewComment && (
                      <div className="mt-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-[10px] text-amber-800 dark:text-amber-200">
                        {c.state === 'REJECTED' ? '반려 사유: ' : '수정 요청: '}
                        {c.reviewComment}
                      </div>
                    )}
                  </div>
                ))}
                {filteredChanges.length === 0 && (
                  <div className="py-8 text-center text-[12px] text-muted-foreground">
                    해당 상태의 신청이 없습니다.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Cashflow */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-teal-600" />
              캐시플로(주간) 작성/결산
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/cashflow')}>
              시트 열기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[11px] text-muted-foreground">
              {yearMonth} 기준
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goPrevMonth}>
                <ChevronLeft className="w-3 h-3" /> 이전
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goNextMonth}>
                다음 <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 160 }}>주차</th>
                  <th className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 120 }}>상태</th>
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 220 }}>기간</th>
                </tr>
              </thead>
              <tbody>
                {monthWeeks.map((w) => {
                  const meta = byWeekNo.get(w.weekNo);
                  const pmSubmitted = Boolean(meta?.pmSubmitted);
                  const adminClosed = Boolean(meta?.adminClosed);
                  const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                  const status = adminClosed
                    ? { label: '결산완료', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
                    : pmSubmitted
                      ? { label: '작성완료', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
                      : { label: '미작성', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' };

                  return (
                    <tr key={w.weekNo} className={`border-t border-border/30 ${isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : ''}`}>
                      <td className="px-3 py-2">
                        <span style={{ fontWeight: 700 }}>{w.label}</span>
                        {isThisWeek && (
                          <Badge className="ml-2 h-4 px-1 text-[9px] bg-teal-500/15 text-teal-700 dark:text-teal-300 border-0">이번 주</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] ${status.cls}`} style={{ fontWeight: 800 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {w.weekStart} ~ {w.weekEnd}
                      </td>
                    </tr>
                  );
                })}
                {monthWeeks.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-[12px] text-muted-foreground" colSpan={3}>
                      주차 정보가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

