import { useState, useMemo } from 'react';
import {
  Lock, SlidersHorizontal, ChevronDown, ChevronRight,
  Calculator, Wallet, TrendingUp, Info, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
import {
  BUDGET_ROWS, BUDGET_AUX_ROWS, BUDGET_META,
  fmtKRW, fmtPercent, fmtShort,
  type BudgetRow,
} from '../../data/budget-data';

// ═══════════════════════════════════════════════════════════════
// PortalBudget — 예산총괄 (리디자인 — 모바일 우선, 깨짐 방지)
// ═══════════════════════════════════════════════════════════════

const GROUP_LABELS: Record<string, string> = {
  g1: 'MYSC 인건비',
  g2: '직접사업비',
  g3: '업무추진비',
  g4: '팀지원금',
};

// 소진율 색상
function burnColor(rate: number): string {
  if (rate >= 0.8) return '#e11d48';
  if (rate >= 0.5) return '#f59e0b';
  if (rate > 0) return '#059669';
  return '#94a3b8';
}

export function PortalBudget() {
  const { myProject } = usePortalStore();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<BudgetRow | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const rows = BUDGET_ROWS;
  const meta = BUDGET_META;

  const toggleGroup = (gid: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });
  };

  // 그룹별 정리
  const groups = useMemo(() => {
    const groupMap: Record<string, { subtotal: BudgetRow; items: BudgetRow[] }> = {};
    const ungrouped: BudgetRow[] = [];
    rows.forEach(r => {
      if (r.rowType === 'TOTAL') return;
      if (!r.groupId) { ungrouped.push(r); return; }
      if (!groupMap[r.groupId]) groupMap[r.groupId] = { subtotal: r, items: [] };
      if (r.rowType === 'SUBTOTAL') groupMap[r.groupId].subtotal = r;
      else groupMap[r.groupId].items.push(r);
    });
    return { groupMap, ungrouped };
  }, [rows]);

  const total = rows.find(r => r.rowType === 'TOTAL');

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <PageHeader
          icon={Calculator}
          iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
          title="예산총괄"
          description={myProject ? myProject.name : '예산 현황'}
          badge={`${meta.year}년`}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: '총 예산', value: fmtShort(total?.initialBudget || 0), sub: fmtKRW(total?.initialBudget || 0) + '원', gradient: 'linear-gradient(135deg, #4f46e5, #7c3aed)', icon: Calculator },
            { label: '집행액', value: fmtShort(total?.spent || 0), sub: fmtKRW(total?.spent || 0) + '원', gradient: 'linear-gradient(135deg, #e11d48, #f43f5e)', icon: Wallet },
            { label: '잔액', value: fmtShort(total?.balance || 0), sub: fmtKRW(total?.balance || 0) + '원', gradient: 'linear-gradient(135deg, #0d9488, #059669)', icon: TrendingUp },
            { label: '소진율', value: fmtPercent(total?.burnRate || 0), sub: `${fmtKRW(total?.spent || 0)} / ${fmtKRW(total?.initialBudget || 0)}`, gradient: `linear-gradient(135deg, ${burnColor(total?.burnRate || 0)}, ${burnColor(total?.burnRate || 0)}88)`, icon: TrendingUp },
          ].map(k => (
            <Card key={k.label} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: k.gradient }}>
                    <k.icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground">{k.label}</p>
                    <p className="text-[16px] truncate" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{k.value}</p>
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1.5 truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Meta Bar */}
        <Card>
          <CardContent className="p-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
              <span className="text-muted-foreground">정산: <strong className="text-foreground">{meta.basis}</strong></span>
              <span className="text-muted-foreground">펀더: <strong className="text-foreground">{meta.funder}</strong></span>
              <span className="text-muted-foreground">업데이트: <strong className="text-foreground">{meta.lastUpdated}</strong></span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/40">
                  <Lock className="w-2 h-2" /> 고정
                </span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200/50 dark:border-rose-800/40">
                  <SlidersHorizontal className="w-2 h-2" /> 조정가능
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 소진율 바 총괄 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px]" style={{ fontWeight: 600 }}>전체 소진율</span>
              <span className="text-[13px]" style={{ fontWeight: 700, color: burnColor(total?.burnRate || 0) }}>
                {fmtPercent(total?.burnRate || 0)}
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${Math.min((total?.burnRate || 0) * 100, 100)}%`,
                background: `linear-gradient(90deg, ${burnColor(total?.burnRate || 0)}, ${burnColor(total?.burnRate || 0)}cc)`,
              }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span>집행 {fmtKRW(total?.spent || 0)}원</span>
              <span>잔액 {fmtKRW(total?.balance || 0)}원</span>
            </div>
          </CardContent>
        </Card>

        {/* ── 그룹별 카드 뷰 (테이블 대체) ── */}
        <div className="space-y-3">
          {Object.entries(groups.groupMap).map(([gid, group]) => {
            const isCollapsed = collapsedGroups.has(gid);
            const sub = group.subtotal;
            return (
              <Card key={gid} className="overflow-hidden">
                {/* 그룹 헤더 */}
                <button
                  className="w-full flex items-center gap-2 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => toggleGroup(gid)}
                >
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-[12px] flex-1" style={{ fontWeight: 600 }}>
                    {GROUP_LABELS[gid] || gid}
                  </span>
                  <div className="flex items-center gap-3 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span className="text-muted-foreground">예산 <strong className="text-foreground">{fmtShort(sub.initialBudget)}</strong></span>
                    <span className="text-muted-foreground">집행 <strong style={{ color: sub.spent > 0 ? '#e11d48' : undefined }}>{fmtShort(sub.spent)}</strong></span>
                    <span style={{ fontWeight: 600, color: burnColor(sub.burnRate) }}>{fmtPercent(sub.burnRate)}</span>
                  </div>
                </button>

                {/* 그룹 진행바 */}
                <div className="px-4 pt-1.5 pb-0.5">
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.min(sub.burnRate * 100, 100)}%`,
                      background: burnColor(sub.burnRate),
                    }} />
                  </div>
                </div>

                {/* 항목 테이블 */}
                {!isCollapsed && group.items.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-4 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>비목 / 세목</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>승인예산</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>소진금액</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 50 }}>소진율</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>잔액</th>
                          <th className="px-4 py-2 text-left hidden lg:table-cell" style={{ fontWeight: 600, minWidth: 120 }}>특이사항</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(row => (
                          <tr
                            key={row.id}
                            className="border-t border-border/30 hover:bg-muted/20 cursor-pointer transition-colors"
                            onClick={() => setSelectedRow(row)}
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0">
                                  {row.budgetCode && <p className="text-[10px] text-muted-foreground truncate">{row.budgetCode}</p>}
                                  <p className="truncate" style={{ fontWeight: 500 }}>{row.subCode}</p>
                                </div>
                                {row.fixType === 'FIXED' && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Lock className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">고정 항목</TooltipContent>
                                  </Tooltip>
                                )}
                                {row.fixType === 'ADJUSTABLE' && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <SlidersHorizontal className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">조정 가능</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {fmtKRW(row.initialBudget)}
                            </td>
                            <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: row.spent > 0 ? '#e11d48' : undefined }}>
                              {fmtKRW(row.spent)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="inline-flex items-center justify-center min-w-[40px] px-1.5 py-0.5 rounded text-[9px]"
                                style={{
                                  fontWeight: 600,
                                  color: burnColor(row.burnRate),
                                  background: `${burnColor(row.burnRate)}10`,
                                }}>
                                {fmtPercent(row.burnRate)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#059669' }}>
                              {fmtKRW(row.balance)}
                            </td>
                            <td className="px-4 py-2.5 hidden lg:table-cell max-w-[180px]">
                              {row.note ? (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <span className="text-muted-foreground truncate block text-[10px]">{row.note.slice(0, 40)}{row.note.length > 40 ? '...' : ''}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-[10px] max-w-[280px]">{row.note}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 소계 풋터 */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span className="text-muted-foreground">소계</span>
                  <span>예산 <strong>{fmtKRW(sub.initialBudget)}</strong></span>
                  <span>집행 <strong style={{ color: sub.spent > 0 ? '#e11d48' : undefined }}>{fmtKRW(sub.spent)}</strong></span>
                  <span className="ml-auto" style={{ fontWeight: 600, color: '#059669' }}>잔액 {fmtKRW(sub.balance)}</span>
                </div>
              </Card>
            );
          })}

          {/* 총계 */}
          {total && (
            <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/10">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] text-indigo-600 dark:text-indigo-400" style={{ fontWeight: 600 }}>총계</p>
                    <p className="text-[18px] text-indigo-700 dark:text-indigo-300" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtKRW(total.initialBudget)}원
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <div className="text-center">
                      <p className="text-[9px] text-muted-foreground">집행</p>
                      <p style={{ fontWeight: 700, color: '#e11d48' }}>{fmtKRW(total.spent)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] text-muted-foreground">잔액</p>
                      <p style={{ fontWeight: 700, color: '#059669' }}>{fmtKRW(total.balance)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] text-muted-foreground">소진율</p>
                      <p style={{ fontWeight: 700, color: burnColor(total.burnRate) }}>{fmtPercent(total.burnRate)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 보조 테이블 */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[12px]">예산 구성</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {BUDGET_AUX_ROWS.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-[11px]">
                  <span>{r.label}</span>
                  <div className="flex items-center gap-4" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontWeight: 500 }}>{fmtKRW(r.amount)}원</span>
                    <span className="text-muted-foreground w-[50px] text-right">{fmtPercent(r.ratio)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 행 상세 모달 */}
        <Dialog open={!!selectedRow} onOpenChange={open => !open && setSelectedRow(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-[14px]">항목 상세</DialogTitle></DialogHeader>
            {selectedRow && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={`text-[9px] h-4 px-1.5 ${selectedRow.fixType === 'FIXED' ? 'bg-blue-100 text-blue-700' : selectedRow.fixType === 'ADJUSTABLE' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedRow.fixType === 'FIXED' ? '고정' : selectedRow.fixType === 'ADJUSTABLE' ? '조정가능' : '일반'}
                  </Badge>
                  {selectedRow.category && <span className="text-[10px] text-muted-foreground">{selectedRow.category}</span>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    ['비목', selectedRow.budgetCode || '—'],
                    ['세목', selectedRow.subCode || '—'],
                    ['승인예산', fmtKRW(selectedRow.initialBudget) + '원'],
                    ['구성비', fmtPercent(selectedRow.composition)],
                    ['소진금액', fmtKRW(selectedRow.spent) + '원'],
                    ['소진율', fmtPercent(selectedRow.burnRate)],
                    ['잔액', fmtKRW(selectedRow.balance) + '원'],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <p className="text-[9px] text-muted-foreground mb-0.5">{l}</p>
                      <p style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{v || '—'}</p>
                    </div>
                  ))}
                </div>

                {selectedRow.note && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                    <p className="text-[10px] text-amber-700 dark:text-amber-300" style={{ fontWeight: 600 }}>
                      <Info className="w-3 h-3 inline mr-0.5" /> 특이사항
                    </p>
                    <p className="text-[11px] mt-1 break-words">{selectedRow.note}</p>
                  </div>
                )}

                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">소진율</p>
                  <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(selectedRow.burnRate * 100, 100)}%`,
                      background: burnColor(selectedRow.burnRate),
                    }} />
                  </div>
                  <div className="flex justify-between mt-1 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span>{fmtPercent(selectedRow.burnRate)}</span>
                    <span>잔액 {fmtKRW(selectedRow.balance)}원</span>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
