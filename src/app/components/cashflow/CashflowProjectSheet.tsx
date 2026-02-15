import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ClipboardList, CircleDollarSign, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PageHeader } from '../layout/PageHeader';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId, type CashflowWeekSheet } from '../../data/types';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { useAuth } from '../../data/auth-store';

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '').trim().replaceAll(',', '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

const IN_LINES: CashflowSheetLineId[] = [
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
];

const OUT_LINES: CashflowSheetLineId[] = [
  'DIRECT_COST_OUT',
  'INPUT_VAT_OUT',
  'MYSC_LABOR_OUT',
  'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT',
  'BANK_INTEREST_OUT',
];

const ALL_LINES: CashflowSheetLineId[] = [...IN_LINES, ...OUT_LINES];

function sumLines(map: Partial<Record<CashflowSheetLineId, number>> | undefined, lineIds: CashflowSheetLineId[]): number {
  const src = map || {};
  return lineIds.reduce((acc, id) => acc + (Number(src[id]) || 0), 0);
}

function resolveWeekDoc(weeks: CashflowWeekSheet[], projectId: string, yearMonth: string, weekNo: number): CashflowWeekSheet | undefined {
  return weeks.find((w) => w.projectId === projectId && w.yearMonth === yearMonth && w.weekNo === weekNo);
}

export function CashflowProjectSheet({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { user } = useAuth();
  const role = user?.role;
  const isPm = role === 'pm';
  const canClose = role === 'admin' || role === 'finance' || role === 'tenant_admin';
  const canEdit = isPm || canClose;

  const {
    yearMonth,
    weeks,
    isLoading,
    goPrevMonth,
    goNextMonth,
    upsertLineAmount,
    submitWeekAsPm,
    closeWeekAsAdmin,
  } = useCashflowWeeks();

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const projectWeeks = useMemo(() => weeks.filter((w) => w.projectId === projectId && w.yearMonth === yearMonth), [projectId, weeks, yearMonth]);

  const [mode, setMode] = useState<'projection' | 'actual'>('projection');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    // Clear drafts when switching month to avoid writing into wrong docs.
    setDrafts({});
  }, [yearMonth, projectId]);

  const weekMeta = useMemo(() => {
    const map: Record<number, { pmSubmitted: boolean; adminClosed: boolean }> = {};
    for (const def of monthWeeks) {
      const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, def.weekNo);
      map[def.weekNo] = {
        pmSubmitted: Boolean(doc?.pmSubmitted),
        adminClosed: Boolean(doc?.adminClosed),
      };
    }
    return map;
  }, [monthWeeks, projectId, projectWeeks, yearMonth]);

  const rowTotals = useMemo(() => {
    const totals: Record<CashflowSheetLineId, number> = Object.fromEntries(ALL_LINES.map((id) => [id, 0])) as any;
    for (const def of monthWeeks) {
      const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, def.weekNo);
      const src = (mode === 'projection' ? doc?.projection : doc?.actual) || {};
      for (const lineId of ALL_LINES) {
        totals[lineId] += Number(src[lineId]) || 0;
      }
    }
    return totals;
  }, [monthWeeks, mode, projectId, projectWeeks, yearMonth]);

  const weekTotals = useMemo(() => {
    return monthWeeks.map((def) => {
      const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, def.weekNo);
      const src = (mode === 'projection' ? doc?.projection : doc?.actual) || {};
      const totalIn = sumLines(src, IN_LINES);
      const totalOut = sumLines(src, OUT_LINES);
      return {
        weekNo: def.weekNo,
        totalIn,
        totalOut,
        net: totalIn - totalOut,
      };
    });
  }, [monthWeeks, mode, projectId, projectWeeks, yearMonth]);

  const monthTotals = useMemo(() => {
    const totalIn = weekTotals.reduce((acc, w) => acc + w.totalIn, 0);
    const totalOut = weekTotals.reduce((acc, w) => acc + w.totalOut, 0);
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [weekTotals]);

  async function commitCell(input: {
    weekNo: number;
    lineId: CashflowSheetLineId;
    value: string;
  }) {
    if (!canEdit) return;
    const amount = parseAmount(input.value);
    await upsertLineAmount({
      projectId,
      yearMonth,
      weekNo: input.weekNo,
      mode,
      lineId: input.lineId,
      amount,
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CircleDollarSign}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
        title="프로젝트 캐시플로(주간)"
        description={`${projectName} · ${yearMonth}`}
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

      <Tabs value={mode} onValueChange={(v) => (v === 'projection' || v === 'actual') && setMode(v)}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="projection" className="gap-2">
            <ClipboardList className="w-4 h-4" />
            Projection
          </TabsTrigger>
          <TabsTrigger value="actual" className="gap-2">
            <ClipboardCheck className="w-4 h-4" />
            Actual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projection">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-[11px]">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-2 text-left" style={{ fontWeight: 700, minWidth: 180 }}>항목</th>
                      {monthWeeks.map((w) => (
                        <th key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: 150 }}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{w.label}</span>
                            {weekMeta[w.weekNo]?.adminClosed ? (
                              <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">결산</Badge>
                            ) : weekMeta[w.weekNo]?.pmSubmitted ? (
                              <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0">작성</Badge>
                            ) : (
                              <Badge className="h-4 px-1 text-[9px] bg-slate-500/10 text-slate-600 dark:text-slate-300 border-0">미작성</Badge>
                            )}
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{w.weekStart} ~ {w.weekEnd}</div>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: 120 }}>월 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* IN group */}
                    <tr className="bg-emerald-50/40 dark:bg-emerald-950/10">
                      <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>입금 (Projection)</td>
                    </tr>
                    {IN_LINES.map((lineId) => (
                      <tr key={lineId} className="border-t border-border/30">
                        <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                        {monthWeeks.map((w) => {
                          const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, w.weekNo);
                          const current = (doc?.projection?.[lineId] ?? 0) as number;
                          const key = `${mode}:${w.weekNo}:${lineId}`;
                          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : (current ? String(current) : '');
                          return (
                            <td key={w.weekNo} className="px-3 py-1.5 text-right">
                              <Input
                                value={value}
                                inputMode="numeric"
                                className="h-8 text-[11px] text-right"
                                placeholder="0"
                                disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                onBlur={() => {
                                  const nextValue = drafts[key] ?? value;
                                  setDrafts((prev) => {
                                    const clone = { ...prev };
                                    delete clone[key];
                                    return clone;
                                  });
                                  void commitCell({ weekNo: w.weekNo, lineId, value: nextValue });
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(rowTotals[lineId] || 0)}
                        </td>
                      </tr>
                    ))}

                    {/* OUT group */}
                    <tr className="border-t border-border/50 bg-rose-50/30 dark:bg-rose-950/10">
                      <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>출금 (Projection)</td>
                    </tr>
                    {OUT_LINES.map((lineId) => (
                      <tr key={lineId} className="border-t border-border/30">
                        <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                        {monthWeeks.map((w) => {
                          const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, w.weekNo);
                          const current = (doc?.projection?.[lineId] ?? 0) as number;
                          const key = `${mode}:${w.weekNo}:${lineId}`;
                          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : (current ? String(current) : '');
                          return (
                            <td key={w.weekNo} className="px-3 py-1.5 text-right">
                              <Input
                                value={value}
                                inputMode="numeric"
                                className="h-8 text-[11px] text-right"
                                placeholder="0"
                                disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                onBlur={() => {
                                  const nextValue = drafts[key] ?? value;
                                  setDrafts((prev) => {
                                    const clone = { ...prev };
                                    delete clone[key];
                                    return clone;
                                  });
                                  void commitCell({ weekNo: w.weekNo, lineId, value: nextValue });
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(rowTotals[lineId] || 0)}
                        </td>
                      </tr>
                    ))}

                    {/* Totals */}
                    <tr className="border-t border-border/50 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 800 }}>입금 합계</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#059669' }}>
                          {fmt(w.totalIn)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#059669' }}>
                        {fmt(monthTotals.totalIn)}
                      </td>
                    </tr>
                    <tr className="border-t border-border/30 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 800 }}>출금 합계</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#e11d48' }}>
                          {fmt(w.totalOut)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#e11d48' }}>
                        {fmt(monthTotals.totalOut)}
                      </td>
                    </tr>
                    <tr className="border-t border-border/30 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 900 }}>NET</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 900, color: w.net >= 0 ? '#059669' : '#e11d48' }}>
                          {fmt(w.net)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: monthTotals.net >= 0 ? '#059669' : '#e11d48' }}>
                        {fmt(monthTotals.net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {isLoading && (
                <div className="px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actual">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-[11px]">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-2 text-left" style={{ fontWeight: 700, minWidth: 180 }}>항목</th>
                      {monthWeeks.map((w) => (
                        <th key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: 150 }}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{w.label}</span>
                            {weekMeta[w.weekNo]?.adminClosed ? (
                              <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">결산</Badge>
                            ) : weekMeta[w.weekNo]?.pmSubmitted ? (
                              <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0">작성</Badge>
                            ) : (
                              <Badge className="h-4 px-1 text-[9px] bg-slate-500/10 text-slate-600 dark:text-slate-300 border-0">미작성</Badge>
                            )}
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{w.weekStart} ~ {w.weekEnd}</div>
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            {!weekMeta[w.weekNo]?.pmSubmitted && isPm && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] gap-1"
                                onClick={() => void submitWeekAsPm({ projectId, yearMonth, weekNo: w.weekNo })}
                              >
                                <CheckCircle2 className="w-3 h-3" /> 작성완료
                              </Button>
                            )}
                            {!weekMeta[w.weekNo]?.adminClosed && canClose && (
                              <Button
                                size="sm"
                                className="h-7 text-[10px] gap-1"
                                onClick={() => void closeWeekAsAdmin({ projectId, yearMonth, weekNo: w.weekNo })}
                                style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
                              >
                                <CheckCircle2 className="w-3 h-3" /> 결산완료
                              </Button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: 120 }}>월 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-emerald-50/40 dark:bg-emerald-950/10">
                      <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>입금 (Actual)</td>
                    </tr>
                    {IN_LINES.map((lineId) => (
                      <tr key={lineId} className="border-t border-border/30">
                        <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                        {monthWeeks.map((w) => {
                          const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, w.weekNo);
                          const current = (doc?.actual?.[lineId] ?? 0) as number;
                          const key = `${mode}:${w.weekNo}:${lineId}`;
                          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : (current ? String(current) : '');
                          return (
                            <td key={w.weekNo} className="px-3 py-1.5 text-right">
                              <Input
                                value={value}
                                inputMode="numeric"
                                className="h-8 text-[11px] text-right"
                                placeholder="0"
                                disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                onBlur={() => {
                                  const nextValue = drafts[key] ?? value;
                                  setDrafts((prev) => {
                                    const clone = { ...prev };
                                    delete clone[key];
                                    return clone;
                                  });
                                  void commitCell({ weekNo: w.weekNo, lineId, value: nextValue });
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(rowTotals[lineId] || 0)}
                        </td>
                      </tr>
                    ))}

                    <tr className="border-t border-border/50 bg-rose-50/30 dark:bg-rose-950/10">
                      <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>출금 (Actual)</td>
                    </tr>
                    {OUT_LINES.map((lineId) => (
                      <tr key={lineId} className="border-t border-border/30">
                        <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                        {monthWeeks.map((w) => {
                          const doc = resolveWeekDoc(projectWeeks, projectId, yearMonth, w.weekNo);
                          const current = (doc?.actual?.[lineId] ?? 0) as number;
                          const key = `${mode}:${w.weekNo}:${lineId}`;
                          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : (current ? String(current) : '');
                          return (
                            <td key={w.weekNo} className="px-3 py-1.5 text-right">
                              <Input
                                value={value}
                                inputMode="numeric"
                                className="h-8 text-[11px] text-right"
                                placeholder="0"
                                disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                                onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                                onBlur={() => {
                                  const nextValue = drafts[key] ?? value;
                                  setDrafts((prev) => {
                                    const clone = { ...prev };
                                    delete clone[key];
                                    return clone;
                                  });
                                  void commitCell({ weekNo: w.weekNo, lineId, value: nextValue });
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(rowTotals[lineId] || 0)}
                        </td>
                      </tr>
                    ))}

                    <tr className="border-t border-border/50 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 800 }}>입금 합계</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#059669' }}>
                          {fmt(w.totalIn)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#059669' }}>
                        {fmt(monthTotals.totalIn)}
                      </td>
                    </tr>
                    <tr className="border-t border-border/30 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 800 }}>출금 합계</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#e11d48' }}>
                          {fmt(w.totalOut)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#e11d48' }}>
                        {fmt(monthTotals.totalOut)}
                      </td>
                    </tr>
                    <tr className="border-t border-border/30 bg-muted/40">
                      <td className="px-4 py-2" style={{ fontWeight: 900 }}>NET</td>
                      {weekTotals.map((w) => (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 900, color: w.net >= 0 ? '#059669' : '#e11d48' }}>
                          {fmt(w.net)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: monthTotals.net >= 0 ? '#059669' : '#e11d48' }}>
                        {fmt(monthTotals.net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {isLoading && (
                <div className="px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
