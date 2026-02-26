import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ClipboardList, CircleDollarSign, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { PageHeader } from '../layout/PageHeader';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import {
  CASHFLOW_SHEET_LINE_LABELS,
  type CashflowSheetLineId,
  type CashflowWeekSheet,
  type Transaction,
  type UserRole,
} from '../../data/types';
import { getSeoulTodayIso } from '../../platform/business-days';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, computeCashflowTotals } from '../../platform/cashflow-sheet';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { useAuth } from '../../data/auth-store';
import { useBlocker } from 'react-router';
import { hasUnsavedChanges } from './cashflow-unsaved';

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

export function CashflowProjectSheet({
  projectId,
  projectName,
  transactions,
  roleOverride,
}: {
  projectId: string;
  projectName: string;
  transactions: Transaction[];
  roleOverride?: UserRole | string;
}) {
  const { user } = useAuth();
  const role = (roleOverride || user?.role || '').toString().toLowerCase() as UserRole | '';
  const isPm = role === 'pm';
  const canClose = role === 'admin' || role === 'finance' || role === 'tenant_admin';
  const canEdit = isPm || canClose;
  const todayIso = getSeoulTodayIso();
  const todayYearMonth = todayIso.slice(0, 7);

  const {
    yearMonth,
    weeks,
    isLoading,
    goPrevMonth,
    goNextMonth,
    upsertWeekAmounts,
    submitWeekAsPm,
    closeWeekAsAdmin,
  } = useCashflowWeeks();

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const normalizedYearMonth = useMemo(() => {
    const [y, m] = yearMonth.split('-');
    if (!y || !m) return yearMonth;
    return `${y}-${m.padStart(2, '0')}`;
  }, [yearMonth]);
  const projectWeeks = useMemo(
    () => weeks.filter((w) => {
      if (w.projectId !== projectId) return false;
      const ym = typeof w.yearMonth === 'string' ? w.yearMonth : '';
      const [yy, mm] = ym.split('-');
      const normalized = yy && mm ? `${yy}-${mm.padStart(2, '0')}` : ym;
      return normalized === normalizedYearMonth;
    }),
    [projectId, weeks, normalizedYearMonth],
  );
  const byWeekNo = useMemo(() => {
    const map = new Map<number, CashflowWeekSheet>();
    for (const w of projectWeeks) map.set(w.weekNo, w);
    return map;
  }, [projectWeeks]);

  const openingTotalsByMode = useMemo(() => {
    function ymToNumber(value: string): number | null {
      const [y, m] = value.split('-');
      const yy = Number.parseInt(y, 10);
      const mm = Number.parseInt(m, 10);
      if (!Number.isFinite(yy) || !Number.isFinite(mm)) return null;
      return yy * 100 + mm;
    }

    const currentYmNum = ymToNumber(normalizedYearMonth);
    const currentYear = currentYmNum ? Math.trunc(currentYmNum / 100) : null;
    let projectionIn = 0;
    let projectionOut = 0;
    let actualIn = 0;
    let actualOut = 0;

    for (const w of weeks) {
      if (w.projectId !== projectId) continue;
      const ymRaw = typeof w.yearMonth === 'string' ? w.yearMonth : '';
      const ymNum = ymToNumber(ymRaw);
      if (!ymNum || !currentYear || !currentYmNum) continue;
      if (Math.trunc(ymNum / 100) !== currentYear) continue;
      if (ymNum >= currentYmNum) continue;
      const p = computeCashflowTotals(w.projection);
      const a = computeCashflowTotals(w.actual);
      projectionIn += p.totalIn;
      projectionOut += p.totalOut;
      actualIn += a.totalIn;
      actualOut += a.totalOut;
    }

    return { projectionIn, projectionOut, actualIn, actualOut };
  }, [normalizedYearMonth, projectId, weeks]);


  // ── Actual: Firestore cashflow_weeks actual 값 사용 ──

  const [mode, setMode] = useState<'projection' | 'actual'>('projection');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  type WeekSaveState = 'dirty' | 'saving' | 'error' | 'saved';
  const [weekSaveState, setWeekSaveState] = useState<Record<string, WeekSaveState>>({});

  const [submitConfirm, setSubmitConfirm] = useState<{ weekNo: number; yearMonth: string } | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [monthSaving, setMonthSaving] = useState(false);

  const hasDirty = useMemo(
    () => hasUnsavedChanges(weekSaveState) || Object.keys(drafts).length > 0,
    [drafts, weekSaveState],
  );
  const blocker = useBlocker(hasDirty);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasDirty) return;
      // Modern browsers ignore custom messages. Setting returnValue triggers the confirmation dialog.
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDirty]);

  useEffect(() => {
    // If autosave clears the dirty state while we're blocked, let the navigation proceed.
    if (blocker.state === 'blocked' && !hasDirty) {
      blocker.proceed();
    }
  }, [blocker, hasDirty]);

  useEffect(() => {
    // Clear drafts when switching month to avoid writing into wrong docs.
    setDrafts({});
    setWeekSaveState({});
    setSubmitConfirm(null);
  }, [yearMonth, projectId]);

  const weekMeta = useMemo(() => {
    const map: Record<number, { pmSubmitted: boolean; adminClosed: boolean }> = {};
    for (const def of monthWeeks) {
      const doc = byWeekNo.get(def.weekNo);
      map[def.weekNo] = {
        pmSubmitted: Boolean(doc?.pmSubmitted),
        adminClosed: Boolean(doc?.adminClosed),
      };
    }
    return map;
  }, [byWeekNo, monthWeeks]);

  const weekHasActual = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const def of monthWeeks) {
      const doc = byWeekNo.get(def.weekNo);
      const actual = doc?.actual || {};
      map[def.weekNo] = Object.values(actual).some((v) => Number(v) !== 0);
    }
    return map;
  }, [byWeekNo, monthWeeks]);

  function resolveWeekKey(params: { yearMonth: string; mode: 'projection' | 'actual'; weekNo: number }): string {
    return `${params.yearMonth}:${params.mode}:${params.weekNo}`;
  }

  function resolveCellKey(params: {
    yearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): string {
    return `${resolveWeekKey(params)}:${params.lineId}`;
  }

  function getPersistedCell(params: {
    doc: CashflowWeekSheet | undefined;
    mode: 'projection' | 'actual';
    lineId: CashflowSheetLineId;
  }): { amount: number; hasValue: boolean } {
    const src = params.mode === 'projection' ? params.doc?.projection : params.doc?.actual;
    const hasValue = !!src && Object.prototype.hasOwnProperty.call(src, params.lineId);
    const amount = Number(src?.[params.lineId] ?? 0);
    return { amount, hasValue };
  }

  function getEffectiveAmount(params: {
    yearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    // Actual/Projection → Firestore 캐시플로 시트 값 사용
    const doc = byWeekNo.get(params.weekNo);
    const persisted = getPersistedCell({ doc, mode: params.mode, lineId: params.lineId });
    const key = resolveCellKey(params);
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    return raw !== undefined ? parseAmount(raw) : persisted.amount;
  }

  const derivedByMode = useMemo(() => {
    function compute(mode: 'projection' | 'actual') {
      const rowTotals: Record<CashflowSheetLineId, number> = Object.fromEntries(CASHFLOW_ALL_LINES.map((id) => [id, 0])) as any;
      const openingIn = mode === 'projection' ? openingTotalsByMode.projectionIn : openingTotalsByMode.actualIn;
      const openingOut = mode === 'projection' ? openingTotalsByMode.projectionOut : openingTotalsByMode.actualOut;
      let runningIn = openingIn;
      let runningOut = openingOut;
      const weekTotals = monthWeeks.map((def) => {
        const weekIn = CASHFLOW_IN_LINES.reduce((acc, id) => acc + getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId: id }), 0);
        const weekOut = CASHFLOW_OUT_LINES.reduce((acc, id) => acc + getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId: id }), 0);
        runningIn += weekIn;
        runningOut += weekOut;
        return { weekNo: def.weekNo, totalIn: runningIn, totalOut: runningOut, net: runningIn - runningOut, weekIn, weekOut };
      });

      for (const lineId of CASHFLOW_ALL_LINES) {
        for (const def of monthWeeks) {
          rowTotals[lineId] += getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId });
        }
      }

      const totalIn = weekTotals.length ? weekTotals[weekTotals.length - 1].totalIn : openingIn;
      const totalOut = weekTotals.length ? weekTotals[weekTotals.length - 1].totalOut : openingOut;
      return {
        rowTotals,
        weekTotals,
        monthTotals: { totalIn, totalOut, net: totalIn - totalOut },
      };
    }

    return {
      projection: compute('projection'),
      actual: compute('actual'),
    };
  }, [drafts, getEffectiveAmount, monthWeeks, openingTotalsByMode, yearMonth]);

  const flushWeek = useCallback(async (input: {
    weekNo: number;
    mode: 'projection' | 'actual';
    silent?: boolean;
  }): Promise<void> => {
    if (!canEdit && input.mode === 'actual') return;
    const wkKey = resolveWeekKey({ yearMonth, mode: input.mode, weekNo: input.weekNo });
    const doc = byWeekNo.get(input.weekNo);

    const rawByLine: Partial<Record<CashflowSheetLineId, string>> = {};
    const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
    for (const lineId of CASHFLOW_ALL_LINES) {
      const cellKey = resolveCellKey({ yearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
      const hasDraft = Object.prototype.hasOwnProperty.call(drafts, cellKey);
      if (!hasDraft) continue;

      const raw = drafts[cellKey];
      rawByLine[lineId] = raw;

      const nextAmount = parseAmount(raw);
      const persisted = getPersistedCell({ doc, mode: input.mode, lineId });
      if (nextAmount !== persisted.amount || !persisted.hasValue) {
        amounts[lineId] = nextAmount;
      }
    }

    // Even if nothing changed (user typed and reverted), clear redundant drafts.
    const hasAnyDrafts = Object.keys(rawByLine).length > 0;
    if (!hasAnyDrafts) return;

    if (Object.keys(amounts).length === 0) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of Object.keys(rawByLine) as CashflowSheetLineId[]) {
          const key = resolveCellKey({ yearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
          if (next[key] === rawByLine[lineId]) delete next[key];
        }
        return next;
      });
      return;
    }

    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saving' }));
    try {
      await upsertWeekAmounts({
        projectId,
        yearMonth,
        weekNo: input.weekNo,
        mode: input.mode,
        amounts,
      });

      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of Object.keys(rawByLine) as CashflowSheetLineId[]) {
          const key = resolveCellKey({ yearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
          if (next[key] === rawByLine[lineId]) delete next[key];
        }
        return next;
      });
    } catch (error) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'error' }));
      if (!input.silent) {
        toast.error('저장에 실패했습니다. 네트워크/권한을 확인하고 다시 시도해 주세요.');
      }
      throw error;
    }
  }, [byWeekNo, canEdit, drafts, projectId, resolveCellKey, resolveWeekKey, upsertWeekAmounts, yearMonth]);

  const markDirty = useCallback((input: { weekNo: number; mode: 'projection' | 'actual' }) => {
    const wkKey = resolveWeekKey({ yearMonth, mode: input.mode, weekNo: input.weekNo });
    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'dirty' }));
  }, [resolveWeekKey, yearMonth]);

  const flushAllDirtyBeforeMonthChange = useCallback(async () => {
    const entries = Object.entries(weekSaveState).filter(([, state]) => state === 'dirty' || state === 'error');
    for (const [key] of entries) {
      const parts = key.split(':');
      // `${yearMonth}:${mode}:${weekNo}`
      if (parts.length < 3) continue;
      const keyYearMonth = parts[0];
      const keyMode = parts[1] as 'projection' | 'actual';
      const keyWeekNo = Number(parts[2]);
      if (keyYearMonth !== yearMonth) continue;
      if (!Number.isFinite(keyWeekNo)) continue;
      await flushWeek({ weekNo: keyWeekNo, mode: keyMode, silent: false });
    }
  }, [flushWeek, weekSaveState, yearMonth]);

  const goPrevMonthSafe = useCallback(() => {
    void flushAllDirtyBeforeMonthChange()
      .then(() => goPrevMonth())
      .catch(() => {});
  }, [flushAllDirtyBeforeMonthChange, goPrevMonth]);

  const goNextMonthSafe = useCallback(() => {
    void flushAllDirtyBeforeMonthChange()
      .then(() => goNextMonth())
      .catch(() => {});
  }, [flushAllDirtyBeforeMonthChange, goNextMonth]);

  const saveMonthProjection = useCallback(() => {
    const targets = monthWeeks.map((w) => w.weekNo);
    void (async () => {
      setMonthSaving(true);
      for (const weekNo of targets) {
        await flushWeek({ weekNo, mode: 'projection', silent: false });
      }
      toast.success('이번 달 Projection을 저장했습니다.');
    })().catch((err) => {
      console.error('[Cashflow] month projection save failed:', err);
      toast.error('월 저장에 실패했습니다. 네트워크/권한을 확인해 주세요.');
    }).finally(() => {
      setMonthSaving(false);
    });
  }, [flushWeek, monthWeeks]);

  const handleSubmitWeek = useCallback(async (input: { weekNo: number; yearMonth: string }) => {
    setSubmitBusy(true);
    try {
      await flushWeek({ weekNo: input.weekNo, mode: 'actual', silent: false });
      await submitWeekAsPm({ projectId, yearMonth: input.yearMonth, weekNo: input.weekNo });
      toast.success('작성완료 처리했습니다.');
    } catch (e) {
      toast.error('작성완료 처리에 실패했습니다.');
    } finally {
      setSubmitBusy(false);
      setSubmitConfirm(null);
    }
  }, [flushWeek, projectId, submitWeekAsPm]);

  const handleCloseWeek = useCallback(async (weekNo: number) => {
    try {
      await flushWeek({ weekNo, mode: 'actual', silent: false });
      await closeWeekAsAdmin({ projectId, yearMonth, weekNo });
      toast.success('결산완료 처리했습니다.');
    } catch (e) {
      toast.error('결산완료 처리에 실패했습니다.');
    }
  }, [closeWeekAsAdmin, flushWeek, projectId, yearMonth]);

  function countEmptyCellsForWeek(input: { weekNo: number; mode: 'projection' | 'actual' }): number {
    const doc = byWeekNo.get(input.weekNo);
    let empty = 0;
    for (const lineId of CASHFLOW_ALL_LINES) {
      const persisted = getPersistedCell({ doc, mode: input.mode, lineId });
      const key = resolveCellKey({ yearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
      const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
      const filled = persisted.hasValue || (typeof raw === 'string' && raw.trim() !== '');
      if (!filled) empty += 1;
    }
    return empty;
  }

  function renderSheetTable(tableMode: 'projection' | 'actual') {
    const derived = tableMode === 'projection' ? derivedByMode.projection : derivedByMode.actual;
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-2 text-left" style={{ fontWeight: 700, minWidth: 180 }}>항목</th>
                  {monthWeeks.map((w) => {
                    const wkKey = resolveWeekKey({ yearMonth, mode: tableMode, weekNo: w.weekNo });
                    const saveState = weekSaveState[wkKey];
                    const doc = byWeekNo.get(w.weekNo);
                    const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                    const colClass = isThisWeek ? 'bg-teal-50/40 dark:bg-teal-950/10' : '';

                    return (
                      <th key={w.weekNo} className={`px-3 py-2 text-right ${colClass}`} style={{ fontWeight: 700, minWidth: 150 }}>
                        <div className="flex items-center justify-end gap-2">
                          <span>{w.label}</span>
                          {weekMeta[w.weekNo]?.adminClosed ? (
                            <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">결산</Badge>
                          ) : weekMeta[w.weekNo]?.pmSubmitted || weekHasActual[w.weekNo] ? (
                            <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0">작성</Badge>
                          ) : (
                            <Badge className="h-4 px-1 text-[9px] bg-slate-500/10 text-slate-600 dark:text-slate-300 border-0">미작성</Badge>
                          )}
                          {saveState === 'dirty' && (
                            <Badge className="h-4 px-1 text-[9px] bg-sky-500/15 text-sky-700 dark:text-sky-300 border-0">미저장</Badge>
                          )}
                          {saveState === 'saving' && (
                            <Badge className="h-4 px-1 text-[9px] bg-slate-500/10 text-slate-600 dark:text-slate-300 border-0">저장중</Badge>
                          )}
                          {saveState === 'error' && (
                            <Badge className="h-4 px-1 text-[9px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border-0">오류</Badge>
                          )}
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">{w.weekStart} ~ {w.weekEnd}</div>
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          {tableMode === 'actual' && !weekMeta[w.weekNo]?.pmSubmitted && isPm && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => setSubmitConfirm({ weekNo: w.weekNo, yearMonth })}
                            >
                              <CheckCircle2 className="w-3 h-3" /> 작성완료
                            </Button>
                          )}
                          {tableMode === 'actual' && !weekMeta[w.weekNo]?.adminClosed && canClose && (
                            <Button
                              size="sm"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => void handleCloseWeek(w.weekNo)}
                              style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
                            >
                              <CheckCircle2 className="w-3 h-3" /> 결산완료
                            </Button>
                          )}
                        </div>
                        {doc?.adminClosed && (
                          <div className="mt-1 text-[9px] text-muted-foreground">결산완료 이후 입력이 잠깁니다.</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: 120 }}>월 합계</th>
                </tr>
              </thead>
              <tbody>
                {tableMode === 'actual' && (
                  <tr className="bg-sky-50/50 dark:bg-sky-950/20">
                    <td className="px-4 py-2 text-[10px] text-sky-700 dark:text-sky-300" colSpan={monthWeeks.length + 2}>
                      Actual 값은 사업비 입력(주간)에서 저장된 값이 반영됩니다.
                    </td>
                  </tr>
                )}
                <tr className="bg-emerald-50/40 dark:bg-emerald-950/10">
                  <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>
                    입금 ({tableMode === 'projection' ? 'Projection' : 'Actual'})
                  </td>
                </tr>
                {CASHFLOW_IN_LINES.map((lineId) => (
                  <tr key={lineId} className="border-t border-border/30">
                    <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                    {monthWeeks.map((w) => {
                      const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                      const colClass = isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : '';

                      if (tableMode === 'actual') {
                        const amount = getEffectiveAmount({ yearMonth, mode: 'actual', weekNo: w.weekNo, lineId });
                        return (
                          <td key={w.weekNo} className={`px-3 py-2 text-right ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(amount)}
                          </td>
                        );
                      }

                      const doc = byWeekNo.get(w.weekNo);
                      const persisted = getPersistedCell({ doc, mode: tableMode, lineId });
                      const key = resolveCellKey({ yearMonth, mode: tableMode, weekNo: w.weekNo, lineId });
                      const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
                      const value = raw !== undefined ? raw : (persisted.hasValue ? String(persisted.amount) : '');

                      return (
                        <td key={w.weekNo} className={`px-3 py-1.5 text-right ${colClass}`}>
                          <Input
                            value={value}
                            inputMode="numeric"
                            className="h-8 text-[11px] text-right"
                            placeholder="0"
                            disabled={false}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                              markDirty({ weekNo: w.weekNo, mode: tableMode });
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border/50 bg-muted/40">
                  <td className="px-4 py-2" style={{ fontWeight: 800 }}>입금 합계</td>
                  {derived.weekTotals.map((w) => (
                    <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#059669' }}>
                      {fmt(w.totalIn)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#059669' }}>
                    {fmt(derived.monthTotals.totalIn)}
                  </td>
                </tr>

                <tr className="border-t border-border/50 bg-rose-50/30 dark:bg-rose-950/10">
                  <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>
                    출금 ({tableMode === 'projection' ? 'Projection' : 'Actual'})
                  </td>
                </tr>
                {CASHFLOW_OUT_LINES.map((lineId) => (
                  <tr key={lineId} className="border-t border-border/30">
                    <td className="px-4 py-2" style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                    {monthWeeks.map((w) => {
                      const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                      const colClass = isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : '';

                      if (tableMode === 'actual') {
                        const amount = getEffectiveAmount({ yearMonth, mode: 'actual', weekNo: w.weekNo, lineId });
                        return (
                          <td key={w.weekNo} className={`px-3 py-2 text-right ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(amount)}
                          </td>
                        );
                      }

                      const doc = byWeekNo.get(w.weekNo);
                      const persisted = getPersistedCell({ doc, mode: tableMode, lineId });
                      const key = resolveCellKey({ yearMonth, mode: tableMode, weekNo: w.weekNo, lineId });
                      const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
                      const value = raw !== undefined ? raw : (persisted.hasValue ? String(persisted.amount) : '');

                      return (
                        <td key={w.weekNo} className={`px-3 py-1.5 text-right ${colClass}`}>
                          <Input
                            value={value}
                            inputMode="numeric"
                            className="h-8 text-[11px] text-right"
                            placeholder="0"
                            disabled={false}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                              markDirty({ weekNo: w.weekNo, mode: tableMode });
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}

                <tr className="border-t border-border/30 bg-muted/40">
                  <td className="px-4 py-2" style={{ fontWeight: 800 }}>출금 합계</td>
                  {derived.weekTotals.map((w) => (
                    <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 800, color: '#e11d48' }}>
                      {fmt(w.totalOut)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: '#e11d48' }}>
                    {fmt(derived.monthTotals.totalOut)}
                  </td>
                </tr>
                <tr className="border-t border-border/30 bg-muted/50">
                  <td className="px-4 py-2" style={{ fontWeight: 900 }}>잔액</td>
                  {(() => {
                    let running = 0;
                    return derived.weekTotals.map((w) => {
                      running = w.net;
                      return (
                        <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 900, color: running >= 0 ? '#059669' : '#e11d48' }}>
                          {fmt(running)}
                        </td>
                      );
                    });
                  })()}
                  <td className="px-3 py-2 text-right" style={{ fontWeight: 900, color: derived.monthTotals.net >= 0 ? '#059669' : '#e11d48' }}>
                    {fmt(derived.monthTotals.net)}
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
    );
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
            {mode === 'projection' && (
              <Button
                variant="default"
                size="sm"
                className="h-8 text-[12px] gap-1.5"
                onClick={saveMonthProjection}
                disabled={monthSaving}
              >
                {monthSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                월 저장
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goPrevMonthSafe}>
              <ChevronLeft className="w-3.5 h-3.5" /> 이전 달
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goNextMonthSafe}>
              다음 달 <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      />

      <Tabs value={mode} onValueChange={(v) => (v === 'projection' || v === 'actual') && setMode(v)}>
        <TabsList className="w-full sm:w-fit bg-muted/40 p-1">
          <TabsTrigger
            value="projection"
            className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <ClipboardList className="w-4 h-4" />
            Projection
          </TabsTrigger>
          <TabsTrigger
            value="actual"
            className="gap-2 data-[state=active]:bg-sky-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <ClipboardCheck className="w-4 h-4" />
            Actual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projection">
          {renderSheetTable('projection')}
        </TabsContent>

        <TabsContent value="actual">
          {renderSheetTable('actual')}
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!submitConfirm}
        onOpenChange={(open) => {
          if (!open) setSubmitConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이번 주차를 작성완료 처리할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              작성완료 후에는 관리자 결산 전까지 수정은 가능하지만, 승인/결산 흐름이 시작됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {submitConfirm && (
            <div className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">주차</span>
                <span style={{ fontWeight: 700 }}>
                  {monthWeeks.find((x) => x.weekNo === submitConfirm.weekNo)?.label || `w${submitConfirm.weekNo}`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">기간</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {monthWeeks.find((x) => x.weekNo === submitConfirm.weekNo)?.weekStart} ~ {monthWeeks.find((x) => x.weekNo === submitConfirm.weekNo)?.weekEnd}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">비어있는 항목</span>
                <span style={{ fontWeight: 700 }}>
                  {countEmptyCellsForWeek({ weekNo: submitConfirm.weekNo, mode: 'actual' })} / {CASHFLOW_ALL_LINES.length}
                </span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitBusy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={!submitConfirm || submitBusy}
              onClick={(e) => {
                e.preventDefault();
                if (!submitConfirm) return;
                void handleSubmitWeek(submitConfirm);
              }}
            >
              {submitBusy ? '처리 중…' : '작성완료'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') {
            blocker.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장되지 않은 변경사항이 있습니다</AlertDialogTitle>
            <AlertDialogDescription>
              페이지를 이동하면 아직 저장되지 않은 캐시플로 입력값이 유실될 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset()}>계속 편집</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed()}>나가기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
