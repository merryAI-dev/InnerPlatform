import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { fetchCashflowWeeklyComplianceViaBff, type CashflowWeeklyCompliancePage } from '../../lib/platform-bff-client';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import type { CashflowWeekTotals } from '../../data/types';

function emptyTotals(): CashflowWeekTotals {
  return { totalIn: 0, totalOut: 0, net: 0 };
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { yearMonth, weeks, isLoading, goPrevMonth, goNextMonth } = useCashflowWeeks();
  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const [canonicalHistory, setCanonicalHistory] = useState<Record<string, CashflowWeeklyCompliancePage>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!user?.idToken || projects.length === 0) {
      setCanonicalHistory({});
      return;
    }
    let active = true;
    setHistoryLoading(true);
    void Promise.allSettled(projects.map(async (project) => ({
      projectId: project.id,
      page: await fetchCashflowWeeklyComplianceViaBff({ tenantId: orgId, actor: user, projectId: project.id, limit: 50 }),
    }))).then((results) => {
      if (!active) return;
      const next: Record<string, CashflowWeeklyCompliancePage> = {};
      const errors: Record<string, string> = {};
      results.forEach((result, index) => {
        const projectId = projects[index]?.id;
        if (!projectId) return;
        if (result.status === 'fulfilled') next[projectId] = result.value.page;
        else errors[projectId] = '주간 정산 이력을 불러오지 못했습니다.';
      });
      setCanonicalHistory(next);
      setHistoryErrors(errors);
      setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [orgId, projects, user, yearMonth]);

  async function loadMoreHistory(projectId: string) {
    const current = canonicalHistory[projectId];
    if (!user?.idToken || !current?.nextCursor || detailLoading) return;
    setDetailLoading(true);
    try {
      const page = await fetchCashflowWeeklyComplianceViaBff({ tenantId: orgId, actor: user, projectId, limit: 50, cursor: current.nextCursor });
      if (page.nextCursor && (page.nextCursor === current.nextCursor || current.items.length >= 5_000)) {
        setHistoryErrors((value) => ({ ...value, [projectId]: '이력 페이지가 반복되어 추가 조회를 중단했습니다.' }));
        return;
      }
      setCanonicalHistory((value) => ({ ...value, [projectId]: { ...page, items: [...current.items, ...page.items] } }));
    } catch {
      setHistoryErrors((value) => ({ ...value, [projectId]: '추가 주간 정산 이력을 불러오지 못했습니다.' }));
    } finally {
      setDetailLoading(false);
    }
  }

  const byProjectWeek = useMemo(() => {
    const map = new Map<string, {
      projectionTotals: CashflowWeekTotals;
      actualTotals: CashflowWeekTotals;
    }>();
    for (const week of weeks.filter((item) => item.yearMonth === yearMonth)) {
      map.set(`${week.projectId}:${week.weekNo}`, {
        projectionTotals: week.projectionTotals || emptyTotals(),
        actualTotals: week.actualTotals || emptyTotals(),
      });
    }
    return map;
  }, [weeks, yearMonth]);

  function openProject(projectId: string) {
    navigate(`/cashflow/projects/${projectId}?ym=${encodeURIComponent(yearMonth)}&view=compare#projection-actual-comparison`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="전사 현금흐름 현황"
        description={`프로젝트별 Projection·Actual·차이 · ${yearMonth}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={goPrevMonth}>
              <ChevronLeft className="h-3.5 w-3.5" /> 이전 달
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={goNextMonth}>
              다음 달 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="w-full min-w-[1260px] border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="sticky left-0 top-0 z-40 min-w-[220px] border-b bg-slate-50 px-4 py-2 text-left font-bold">프로젝트</th>
                  <th className="sticky left-[220px] top-0 z-40 min-w-[120px] border-b bg-slate-50 px-3 py-2 text-left font-bold">담당자</th>
                  <th className="sticky left-[340px] top-0 z-40 min-w-[210px] border-b border-r bg-slate-50 px-3 py-2 text-left font-bold">요약</th>
                  {monthWeeks.map((week) => (
                    <th key={week.weekNo} className="sticky top-0 z-30 min-w-[170px] border-b bg-slate-50 px-3 py-2 text-center font-bold">
                      <div>{week.label}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{week.weekStart}~{week.weekEnd}</div>
                    </th>
                  ))}
                  <th className="sticky top-0 z-30 min-w-[120px] border-b bg-slate-50 px-4 py-2 text-right font-bold">현금흐름</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const projectWeeks = monthWeeks.map((week) => byProjectWeek.get(`${project.id}:${week.weekNo}`));
                  const projectHistory = canonicalHistory[project.id];
                  const projectStatuses = projectHistory?.items || [];
                  const completedSettlementCount = monthWeeks.filter((week) => {
                    const status = projectStatuses.find((item) => item.yearMonth === yearMonth && item.weekNo === week.weekNo)?.status;
                    return status === 'ON_TIME' || status === 'COMPLETED_LATE';
                  }).length;
                  return (
                  <tr key={project.id} className="border-t border-border/30 transition-colors hover:bg-muted/20">
                    <td className="sticky left-0 z-20 bg-white px-4 py-3">
                      <p className="truncate font-semibold">{project.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{project.department} · {project.clientOrg}</p>
                    </td>
                    <td className="sticky left-[220px] z-20 bg-white px-3 py-3 font-medium">{project.managerName}</td>
                    <td className="sticky left-[340px] z-20 border-r bg-white px-3 py-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">상태</span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            {historyLoading && !projectHistory ? '확인 중' : historyErrors[project.id] ? '조회 오류' : completedSettlementCount === monthWeeks.length ? '완료' : '미완료'} {projectHistory ? `${completedSettlementCount}/${monthWeeks.length}` : ''}
                          </Badge>
                        </div>
                        {projectHistory ? <div className="flex items-center justify-between gap-2 text-[10px]"><span className="text-muted-foreground">누적 준수</span><span>기한 내 {projectHistory.onTimeCount.toLocaleString('ko-KR')} · 미준수 {projectHistory.missedCount.toLocaleString('ko-KR')}</span></div> : null}
                        <button type="button" className="text-[10px] font-semibold text-teal-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" onClick={() => setDetailProjectId(project.id)}>주간 정산 자세히</button>
                      </div>
                    </td>
                    {monthWeeks.map((week) => {
                      const status = byProjectWeek.get(`${project.id}:${week.weekNo}`);
                      const projection = status?.projectionTotals || emptyTotals();
                      const actual = status?.actualTotals || emptyTotals();
                      const difference = projection.net - actual.net;
                      const compliance = projectStatuses.find((item) => item.yearMonth === yearMonth && item.weekNo === week.weekNo);
                      const settlementCompleted = compliance?.status === 'ON_TIME' || compliance?.status === 'COMPLETED_LATE';
                      return (
                        <td key={week.weekNo} className={`px-3 py-3 ${settlementCompleted ? '' : 'bg-red-50 dark:bg-red-950/30'}`}>
                          <div className="space-y-1.5">
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              {!projectHistory ? historyLoading ? '확인 중' : '조회 오류' : settlementCompleted ? '완료' : '미완료'}
                            </Badge>
                            <div className="border-t border-border/40 pt-2">
                              <div className="text-[12px] font-semibold text-muted-foreground">Projection-Actual 차이</div>
                              <div className={`mt-1 text-[16px] font-bold tabular-nums ${difference < 0 ? 'text-red-700' : 'text-slate-800'}`}>
                                {difference.toLocaleString('ko-KR')}원
                              </div>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={() => openProject(project.id)}>
                        <ExternalLink className="h-3.5 w-3.5" /> 현금흐름 보기
                      </Button>
                    </td>
                  </tr>
                  );
                })}
                {projects.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={monthWeeks.length + 4}>프로젝트가 없습니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {isLoading ? <div className="border-t border-border/40 px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div> : null}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(detailProjectId)} onOpenChange={(open) => { if (!open) setDetailProjectId(''); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[900px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{projects.find((project) => project.id === detailProjectId)?.name || '프로젝트'} 주간 정산 이력</AlertDialogTitle>
            <AlertDialogDescription>JVM 프로젝트 원장의 모든 주차별 준수 상태입니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[60dvh] overflow-auto rounded-md border" role="region" aria-label="프로젝트 주간 정산 전체 이력" tabIndex={0}>
            {(canonicalHistory[detailProjectId]?.items || []).length > 0 ? (
              <table className="w-full min-w-[820px] border-collapse text-[11px]">
                <caption className="sr-only">대상 주차, 마감기한, 완료 여부, 준수 상태, 처리 결과, 완료시각, 완료자</caption>
                <thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2 text-left">대상 주차</th><th className="px-3 py-2 text-left">마감기한</th><th className="px-3 py-2 text-left">완료 여부</th><th className="px-3 py-2 text-left">준수 상태</th><th className="px-3 py-2 text-left">처리 결과</th><th className="px-3 py-2 text-left">완료시각</th><th className="px-3 py-2 text-left">완료자</th></tr></thead>
                <tbody>{(canonicalHistory[detailProjectId]?.items || []).map((week) => {
                  const completed = week.status === 'ON_TIME' || week.status === 'COMPLETED_LATE';
                  return <tr key={`${week.yearMonth}:${week.weekNo}:${week.operationId || week.status}`} className="border-t"><th className="px-3 py-2 text-left">{week.yearMonth} {week.weekNo}주차</th><td className="px-3 py-2">{new Date(week.deadline).toLocaleString('ko-KR')}</td><td className="px-3 py-2 font-semibold">{completed ? '완료' : '미완료'}</td><td className="px-3 py-2">{week.status === 'ON_TIME' ? '기한 내 완료' : week.status === 'COMPLETED_LATE' ? '기한 후 완료·미준수' : week.status === 'MISSED' ? '기한 경과·미준수' : '완료 대기'}</td><td className="px-3 py-2">{week.updateResult === 'CHANGED' ? '변경사항 반영 완료' : week.updateResult === 'NO_CHANGES' ? '변경사항 없음' : '-'}</td><td className="px-3 py-2">{week.completedAt ? new Date(week.completedAt).toLocaleString('ko-KR') : '-'}</td><td className="px-3 py-2 break-all">{week.completedBy || '-'}</td></tr>;
                })}</tbody>
              </table>
            ) : historyLoading ? <p role="status" className="p-8 text-center text-[12px] text-muted-foreground">주간 정산 이력을 불러오는 중입니다.</p> : historyErrors[detailProjectId] ? <div role="alert" className="p-8 text-center text-[12px] text-red-700">{historyErrors[detailProjectId]}</div> : <p className="p-8 text-center text-[12px] text-muted-foreground">저장된 주간 정산 이력이 없습니다.</p>}
          </div>
          {canonicalHistory[detailProjectId]?.nextCursor ? <Button type="button" variant="outline" disabled={detailLoading} onClick={() => void loadMoreHistory(detailProjectId)}>{detailLoading ? '추가 이력 불러오는 중…' : '이전 이력 더 불러오기'}</Button> : null}
          <AlertDialogFooter><AlertDialogCancel>닫기</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
