import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import type { CashflowWeekTotals } from '../../data/types';

function fmtShort(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (absolute >= 1e4) return `${(value / 1e4).toFixed(0)}만`;
  return value.toLocaleString('ko-KR');
}

function emptyTotals(): CashflowWeekTotals {
  return { totalIn: 0, totalOut: 0, net: 0 };
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { yearMonth, weeks, isLoading, goPrevMonth, goNextMonth } = useCashflowWeeks();
  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);

  const byProjectWeek = useMemo(() => {
    const map = new Map<string, {
      projectionUpdated: boolean;
      projectionTotals: CashflowWeekTotals;
      actualTotals: CashflowWeekTotals;
    }>();
    for (const week of weeks.filter((item) => item.yearMonth === yearMonth)) {
      map.set(`${week.projectId}:${week.weekNo}`, {
        projectionUpdated: Boolean(week.projectionUpdated),
        projectionTotals: week.projectionTotals || emptyTotals(),
        actualTotals: week.actualTotals || emptyTotals(),
      });
    }
    return map;
  }, [weeks, yearMonth]);

  function openProject(projectId: string) {
    navigate(`/cashflow/projects/${projectId}?ym=${encodeURIComponent(yearMonth)}&view=compare`);
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="min-w-[220px] px-4 py-2 text-left font-bold">프로젝트</th>
                  <th className="min-w-[120px] px-3 py-2 text-left font-bold">담당자</th>
                  {monthWeeks.map((week) => (
                    <th key={week.weekNo} className="min-w-[170px] px-3 py-2 text-center font-bold">
                      <div>{week.label}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{week.weekStart}~{week.weekEnd}</div>
                    </th>
                  ))}
                  <th className="min-w-[120px] px-4 py-2 text-right font-bold">현금흐름</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-t border-border/30 transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="truncate font-semibold">{project.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{project.department} · {project.clientOrg}</p>
                    </td>
                    <td className="px-3 py-3 font-medium">{project.managerName}</td>
                    {monthWeeks.map((week) => {
                      const status = byProjectWeek.get(`${project.id}:${week.weekNo}`);
                      const projection = status?.projectionTotals || emptyTotals();
                      const actual = status?.actualTotals || emptyTotals();
                      const difference = projection.net - actual.net;
                      return (
                        <td key={week.weekNo} className={`px-3 py-3 ${status?.projectionUpdated ? '' : 'bg-red-50 dark:bg-red-950/30'}`}>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Projection</Badge>
                              <span className="font-semibold tabular-nums">{fmtShort(projection.net)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Actual</Badge>
                              <span className="font-semibold tabular-nums">{fmtShort(actual.net)}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                              <span>차이</span>
                              <span className={difference < 0 ? 'font-semibold text-red-700' : 'font-semibold text-slate-700'}>{fmtShort(difference)}</span>
                            </div>
                            {!status?.projectionUpdated ? <p className="text-center text-[10px] font-semibold text-red-700">Projection 미작성</p> : null}
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
                ))}
                {projects.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={monthWeeks.length + 3}>프로젝트가 없습니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {isLoading ? <div className="border-t border-border/40 px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div> : null}
          {!isLoading ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-3 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="h-4 px-1.5 text-[9px]">조회 전용</Badge>
              Projection과 Actual은 저장된 주차 합계이며, 최종 확정과 수정 잠금은 프로젝트별 월 결산 승인에서 처리합니다.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
