import { useState, useMemo, useCallback } from 'react';
import {
  Lock, SlidersHorizontal, ChevronDown, ChevronRight,
  Calculator, Wallet, TrendingUp, Info,
  ArrowUp, ArrowDown,
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
import { toast } from 'sonner';
import {
  BUDGET_CODE_BOOK, BUDGET_META,
  fmtKRW, fmtPercent, fmtShort,
  type BudgetRow,
} from '../../data/budget-data';
import type { BudgetPlanRow } from '../../data/types';
import { parseNumber } from '../../platform/csv-utils';
import { SETTLEMENT_COLUMNS } from '../../platform/settlement-csv';

// ═══════════════════════════════════════════════════════════════
// PortalBudget — 예산총괄 (리디자인 — 모바일 우선, 깨짐 방지)
// ═══════════════════════════════════════════════════════════════

const GROUP_LABELS: Record<string, string> = {
  g1: 'MYSC 인건비',
  g2: '직접사업비',
  g3: '업무추진비',
  g4: '팀지원금',
};

const GROUP_CODES: Array<{ id: string; codes: string[] }> = [
  { id: 'g1', codes: ['1. 인건비'] },
  { id: 'g2', codes: ['2. 프로그램 운영비'] },
  { id: 'g3', codes: ['3. 업무 추진비'] },
  { id: 'g4', codes: ['4. 팀지원금'] },
];

function resolveGroupId(budgetCode: string): string | undefined {
  return GROUP_CODES.find((g) => g.codes.includes(budgetCode))?.id;
}

// 소진율 색상
function burnColor(rate: number): string {
  if (rate >= 0.8) return '#e11d48';
  if (rate >= 0.5) return '#f59e0b';
  if (rate > 0) return '#059669';
  return '#94a3b8';
}

export function PortalBudget() {
  const { myProject, expenseSheetRows, budgetPlanRows, saveBudgetPlanRows } = usePortalStore();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<BudgetRow | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draftRows, setDraftRows] = useState<Array<{
    budgetCode: string;
    subCode: string;
    initialBudget: string;
    revisedBudget: string;
  }>>([]);

  const meta = BUDGET_META;

  const toggleGroup = (gid: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });
  };

  const planMap = useMemo(() => {
    const map = new Map<string, BudgetPlanRow>();
    (budgetPlanRows || []).forEach((row) => {
      const key = `${row.budgetCode}|${row.subCode}`;
      map.set(key, row);
    });
    return map;
  }, [budgetPlanRows]);

  const spentMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!expenseSheetRows) return map;
    const budgetCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비목');
    const subCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '세목');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || bankAmountIdx < 0) return map;
    for (const row of expenseSheetRows) {
      const budgetCode = String(row.cells[budgetCodeIdx] || '').trim();
      const subCode = String(row.cells[subCodeIdx] || '').trim();
      if (!budgetCode || !subCode) continue;
      const amount = parseNumber(String(row.cells[bankAmountIdx] || '')) ?? 0;
      if (amount === 0) continue;
      const key = `${budgetCode}|${subCode}`;
      map.set(key, (map.get(key) || 0) + amount);
    }
    return map;
  }, [expenseSheetRows]);

  const formatInput = useCallback((value: string) => {
    const num = parseNumber(value);
    if (num == null) return '';
    return num.toLocaleString('ko-KR');
  }, []);

  const formatInputLive = useCallback((value: string) => {
    const trimmed = value.replace(/[^0-9.,-]/g, '');
    return formatInput(trimmed);
  }, [formatInput]);

  const startEdit = useCallback(() => {
    const next = BUDGET_CODE_BOOK.flatMap((entry) => (
      entry.subCodes.map((subCode) => {
        const key = `${entry.code}|${subCode}`;
        const existing = planMap.get(key);
        return {
          budgetCode: entry.code,
          subCode,
          initialBudget: existing?.initialBudget ? existing.initialBudget.toLocaleString('ko-KR') : '',
          revisedBudget: existing?.revisedBudget ? existing.revisedBudget.toLocaleString('ko-KR') : '',
        };
      })
    ));
    setDraftRows(next);
    setEditMode(true);
  }, [planMap]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setDraftRows([]);
  }, []);

  const saveSettings = useCallback(async () => {
    if (!saveBudgetPlanRows) return;
    const normalized: BudgetPlanRow[] = draftRows.map((row) => {
      const initial = parseNumber(row.initialBudget) ?? 0;
      const revised = parseNumber(row.revisedBudget) ?? 0;
      return {
        budgetCode: row.budgetCode,
        subCode: row.subCode,
        initialBudget: initial,
        revisedBudget: revised,
      };
    }).filter((row) => row.initialBudget > 0 || (row.revisedBudget ?? 0) > 0);

    setSettingsSaving(true);
    try {
      await saveBudgetPlanRows(normalized);
      setEditMode(false);
      setDraftRows([]);
      toast.success('예산이 저장되었습니다.');
    } catch (err) {
      console.error('[PortalBudget] save failed:', err);
      toast.error('예산 저장에 실패했습니다.');
    } finally {
      setSettingsSaving(false);
    }
  }, [draftRows, saveBudgetPlanRows]);

  const budgetItems = useMemo(() => {
    const items: BudgetRow[] = BUDGET_CODE_BOOK.flatMap((entry) => (
      entry.subCodes.map((subCode) => {
        const key = `${entry.code}|${subCode}`;
        const plan = planMap.get(key);
        const initial = plan?.initialBudget ?? 0;
        const revised = plan?.revisedBudget ?? 0;
        const effective = revised > 0 ? revised : initial;
        const spent = spentMap.get(key) ?? 0;
        const balance = effective - spent;
        const burnRate = effective > 0 ? spent / effective : 0;
        return {
          id: key,
          projectId: myProject?.id || '',
          category: GROUP_LABELS[resolveGroupId(entry.code) || ''] || '',
          budgetCode: entry.code,
          subCode,
          calcDesc: '',
          initialBudget: initial,
          lastYearBudget: 0,
          comparison: '',
          revisedAug: revised,
          revisedOct: 0,
          planAmount: 0,
          composition: 0,
          spent,
          vatPurchase: 0,
          burnRate,
          balance,
          balanceOct: 0,
          note: '',
          rowType: 'ITEM',
          fixType: 'NONE',
          groupId: resolveGroupId(entry.code),
          order: 0,
        } as BudgetRow;
      })
    ));

    const totalEffective = items.reduce((sum, row) => {
      const effective = row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
      return sum + effective;
    }, 0);

    return items.map((row) => {
      const effective = row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
      return {
        ...row,
        composition: totalEffective > 0 ? effective / totalEffective : 0,
      };
    });
  }, [planMap, spentMap, myProject?.id]);

  const groups = useMemo(() => {
    const groupMap: Record<string, { subtotal: BudgetRow; items: BudgetRow[] }> = {};
    const ungrouped: BudgetRow[] = [];
    budgetItems.forEach((row) => {
      if (!row.groupId) { ungrouped.push(row); return; }
      if (!groupMap[row.groupId]) {
        groupMap[row.groupId] = {
          subtotal: {
            ...row,
            id: `${row.groupId}-subtotal`,
            budgetCode: '',
            subCode: '',
            rowType: 'SUBTOTAL',
            fixType: 'NONE',
            spent: 0,
            burnRate: 0,
            balance: 0,
            initialBudget: 0,
            revisedAug: 0,
          } as BudgetRow,
          items: [],
        };
      }
      groupMap[row.groupId].items.push(row);
    });

    Object.values(groupMap).forEach((group) => {
      const initialSum = group.items.reduce((s, r) => s + (r.initialBudget || 0), 0);
      const revisedSum = group.items.reduce((s, r) => s + (r.revisedAug || 0), 0);
      const effectiveSum = group.items.reduce((s, r) => s + ((r.revisedAug > 0 ? r.revisedAug : r.initialBudget) || 0), 0);
      const spentSum = group.items.reduce((s, r) => s + (r.spent || 0), 0);
      group.subtotal = {
        ...group.subtotal,
        initialBudget: initialSum,
        revisedAug: revisedSum,
        spent: spentSum,
        balance: effectiveSum - spentSum,
        burnRate: effectiveSum > 0 ? spentSum / effectiveSum : 0,
      };
    });

    return { groupMap, ungrouped };
  }, [budgetItems]);

  const total = useMemo(() => {
    const initialSum = budgetItems.reduce((s, r) => s + (r.initialBudget || 0), 0);
    const revisedSum = budgetItems.reduce((s, r) => s + (r.revisedAug || 0), 0);
    const effectiveSum = budgetItems.reduce((s, r) => s + ((r.revisedAug > 0 ? r.revisedAug : r.initialBudget) || 0), 0);
    const spentSum = budgetItems.reduce((s, r) => s + (r.spent || 0), 0);
    return {
      initialBudget: initialSum,
      revisedAug: revisedSum,
      spent: spentSum,
      balance: effectiveSum - spentSum,
      burnRate: effectiveSum > 0 ? spentSum / effectiveSum : 0,
      effectiveBudget: effectiveSum,
    };
  }, [budgetItems]);

  const auxRows = useMemo(() => {
    const effectiveTotal = total.effectiveBudget || 0;
    return Object.entries(groups.groupMap).map(([gid, group]) => {
      const effective = group.subtotal.revisedAug > 0 ? group.subtotal.revisedAug : group.subtotal.initialBudget;
      return {
        label: GROUP_LABELS[gid] || gid,
        amount: effective,
        ratio: effectiveTotal > 0 ? effective / effectiveTotal : 0,
      };
    });
  }, [groups.groupMap, total.effectiveBudget]);

  const getEffectiveBudget = useCallback((row: BudgetRow) => {
    return row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <PageHeader
          icon={Calculator}
          iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
          title="예산총괄"
          description={myProject ? myProject.name : '예산 현황'}
          badge={`${meta.year}년`}
          actions={(
            <div className="flex items-center gap-2">
              {editMode ? (
                <>
                  <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={cancelEdit}>
                    취소
                  </Button>
                  <Button size="sm" className="h-8 text-[12px]" onClick={saveSettings} disabled={settingsSaving}>
                    {settingsSaving ? '저장 중...' : '저장'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={startEdit}>
                  예산 편집
                </Button>
              )}
            </div>
          )}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: '총 예산', value: fmtShort(total.effectiveBudget || 0), sub: fmtKRW(total.effectiveBudget || 0) + '원', gradient: 'linear-gradient(135deg, #4f46e5, #7c3aed)', icon: Calculator },
            { label: '집행액', value: fmtShort(total.spent || 0), sub: fmtKRW(total.spent || 0) + '원', gradient: 'linear-gradient(135deg, #e11d48, #f43f5e)', icon: Wallet },
            { label: '잔액', value: fmtShort(total.balance || 0), sub: fmtKRW(total.balance || 0) + '원', gradient: 'linear-gradient(135deg, #0d9488, #059669)', icon: TrendingUp },
            { label: '소진율', value: fmtPercent(total.burnRate || 0), sub: `${fmtKRW(total.spent || 0)} / ${fmtKRW(total.effectiveBudget || 0)}`, gradient: `linear-gradient(135deg, ${burnColor(total.burnRate || 0)}, ${burnColor(total.burnRate || 0)}88)`, icon: TrendingUp },
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
              <span className="text-[13px]" style={{ fontWeight: 700, color: burnColor(total.burnRate || 0) }}>
                {fmtPercent(total.burnRate || 0)}
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${Math.min((total.burnRate || 0) * 100, 100)}%`,
                background: `linear-gradient(90deg, ${burnColor(total.burnRate || 0)}, ${burnColor(total.burnRate || 0)}cc)`,
              }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span>집행 {fmtKRW(total.spent || 0)}원</span>
              <span>잔액 {fmtKRW(total.balance || 0)}원</span>
            </div>
          </CardContent>
        </Card>

        {/* ── 그룹별 카드 뷰 (테이블 대체) ── */}
        <div className="space-y-3">
          {Object.entries(groups.groupMap).map(([gid, group]) => {
            const isCollapsed = collapsedGroups.has(gid);
            const sub = group.subtotal;
            const subEffective = getEffectiveBudget(sub);
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
                    <span className="text-muted-foreground">예산 <strong className="text-foreground">{fmtShort(subEffective)}</strong></span>
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
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>최초 예산</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>수정 예산</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>소진금액</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 50 }}>소진율</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>잔액</th>
                          <th className="px-4 py-2 text-left hidden lg:table-cell" style={{ fontWeight: 600, minWidth: 120 }}>특이사항</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(row => {
                          const effective = getEffectiveBudget(row);
                          const hasRevised = row.revisedAug > 0;
                          const delta = hasRevised ? row.revisedAug - row.initialBudget : 0;
                          const deltaUp = delta > 0;
                          const deltaDown = delta < 0;
                          const draft = editMode
                            ? draftRows.find((r) => r.budgetCode === row.budgetCode && r.subCode === row.subCode)
                            : null;
                          return (
                          <tr
                            key={row.id}
                            className={`border-t border-border/30 transition-colors ${editMode ? '' : 'hover:bg-muted/20 cursor-pointer'}`}
                            onClick={() => {
                              if (!editMode) setSelectedRow(row);
                            }}
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
                            <td className="px-3 py-2.5 text-right align-top" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {editMode ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={draft?.initialBudget || ''}
                                  className="w-full bg-transparent outline-none text-[11px] text-right px-1 py-0.5 border rounded"
                                  onChange={(e) => {
                                    const value = formatInputLive(e.target.value);
                                    setDraftRows((prev) => prev.map((r) => (
                                      r.budgetCode === row.budgetCode && r.subCode === row.subCode
                                        ? { ...r, initialBudget: value }
                                        : r
                                    )));
                                  }}
                                />
                              ) : (
                                <div>{fmtKRW(row.initialBudget)}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right align-top" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {editMode ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={draft?.revisedBudget || ''}
                                  className="w-full bg-transparent outline-none text-[11px] text-right px-1 py-0.5 border rounded"
                                  onChange={(e) => {
                                    const value = formatInputLive(e.target.value);
                                    setDraftRows((prev) => prev.map((r) => (
                                      r.budgetCode === row.budgetCode && r.subCode === row.subCode
                                        ? { ...r, revisedBudget: value }
                                        : r
                                    )));
                                  }}
                                />
                              ) : (
                                <div className="flex flex-col items-end leading-tight">
                                  <div>{fmtKRW(effective)}</div>
                                  {hasRevised && delta !== 0 && (
                                    <div className={`text-[9px] mt-0.5 inline-flex items-center gap-1 ${deltaUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {deltaUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                      {deltaUp ? '증액' : '감액'} {fmtKRW(Math.abs(delta))}
                                    </div>
                                  )}
                                  {hasRevised && delta === 0 && (
                                    <div className="text-[9px] mt-0.5 text-muted-foreground">유지 0</div>
                                  )}
                                </div>
                              )}
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
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 소계 풋터 */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span className="text-muted-foreground">소계</span>
                  <span>예산 <strong>{fmtKRW(subEffective)}</strong></span>
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
                      {fmtKRW(total.effectiveBudget)}원
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
              {auxRows.map((r, i) => (
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
                    ['최초 예산', fmtKRW(selectedRow.initialBudget) + '원'],
                    ['수정 예산', selectedRow.revisedAug > 0 ? fmtKRW(selectedRow.revisedAug) + '원' : '—'],
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
