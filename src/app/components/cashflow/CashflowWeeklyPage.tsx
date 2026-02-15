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

function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString('ko-KR');
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { yearMonth, weeks, isLoading, goPrevMonth, goNextMonth } = useCashflowWeeks();

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);

  const byProjectWeek = useMemo(() => {
    const map = new Map<string, { pmSubmitted: boolean; adminClosed: boolean; net: number }>();
    for (const w of weeks.filter((x) => x.yearMonth === yearMonth)) {
      const key = `${w.projectId}:${w.weekNo}`;
      const actual = w.actual || {};
      const inTotal = Number(actual.MYSC_PREPAY_IN || 0)
        + Number(actual.SALES_IN || 0)
        + Number(actual.SALES_VAT_IN || 0)
        + Number(actual.TEAM_SUPPORT_IN || 0)
        + Number(actual.BANK_INTEREST_IN || 0);
      const outTotal = Number(actual.DIRECT_COST_OUT || 0)
        + Number(actual.INPUT_VAT_OUT || 0)
        + Number(actual.MYSC_LABOR_OUT || 0)
        + Number(actual.MYSC_PROFIT_OUT || 0)
        + Number(actual.SALES_VAT_OUT || 0)
        + Number(actual.TEAM_SUPPORT_OUT || 0)
        + Number(actual.BANK_INTEREST_OUT || 0);
      map.set(key, {
        pmSubmitted: Boolean(w.pmSubmitted),
        adminClosed: Boolean(w.adminClosed),
        net: inTotal - outTotal,
      });
    }
    return map;
  }, [weeks, yearMonth]);

  function openProject(projectId: string) {
    navigate(`/cashflow/projects/${projectId}?ym=${encodeURIComponent(yearMonth)}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="주간 캐시플로(전사)"
        description={`프로젝트별 주간 작성/결산 현황 · ${yearMonth}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goPrevMonth}>
              <ChevronLeft className="w-3.5 h-3.5" /> 이전 달
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goNextMonth}>
              다음 달 <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-2 text-left" style={{ fontWeight: 700, minWidth: 220 }}>프로젝트</th>
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 120 }}>담당자</th>
                  {monthWeeks.map((w) => (
                    <th key={w.weekNo} className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 140 }}>
                      <div>{w.label}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{w.weekStart}~{w.weekEnd}</div>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right" style={{ fontWeight: 700, minWidth: 120 }}>바로가기</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate" style={{ fontWeight: 600 }}>{p.name}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{p.department} · {p.clientOrg}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span style={{ fontWeight: 500 }}>{p.managerName}</span>
                    </td>
                    {monthWeeks.map((w) => {
                      const key = `${p.id}:${w.weekNo}`;
                      const status = byProjectWeek.get(key);
                      const pmSubmitted = Boolean(status?.pmSubmitted);
                      const adminClosed = Boolean(status?.adminClosed);
                      const net = status?.net ?? 0;
                      const chip = adminClosed
                        ? { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', label: '결산완료' }
                        : pmSubmitted
                          ? { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', label: '작성완료' }
                          : { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-300', label: '미작성' };

                      return (
                        <td key={w.weekNo} className="px-3 py-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] ${chip.bg} ${chip.text}`} style={{ fontWeight: 700 }}>
                              {chip.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              NET {fmtShort(net)}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px] gap-1.5"
                        onClick={() => openProject(p.id)}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        열기
                      </Button>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={monthWeeks.length + 3}>
                      프로젝트가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {isLoading && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div>
          )}
          {!isLoading && (
            <div className="px-4 py-3 text-[10px] text-muted-foreground border-t border-border/40">
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 mr-2">정의</Badge>
              작성완료=PM 작성완료 · 결산완료=관리자 결산확정
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

