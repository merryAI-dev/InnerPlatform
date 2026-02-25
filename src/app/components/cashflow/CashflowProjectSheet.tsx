import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ClipboardList, CircleDollarSign, ChevronLeft, ChevronRight } from 'lucide-react';
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
} from '../../data/types';
import { getSeoulTodayIso } from '../../platform/business-days';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, aggregateTransactionsToActual } from '../../platform/cashflow-sheet';
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
}: {
  projectId: string;
  projectName: string;
  transactions: Transaction[];
}) {
  const { user } = useAuth();
  const role = user?.role;
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
  const projectWeeks = useMemo(() => weeks.filter((w) => w.projectId === projectId && w.yearMonth === yearMonth), [projectId, weeks, yearMonth]);
  const byWeekNo = useMemo(() => {
    const map = new Map<number, CashflowWeekSheet>();
    for (const w of projectWeeks) map.set(w.weekNo, w);
    return map;
  }, [projectWeeks]);

  // ── Actual 자동 집계: 트랜잭션에서 주차별 금액 계산 ──
  const projectTxForMonth = useMemo(
    () => transactions.filter((t) => t.projectId === projectId && t.dateTime.startsWith(yearMonth)),
    [transactions, projectId, yearMonth],
  );
  const actualFromTx = useMemo(
    () => aggregateTransactionsToActual(projectTxForMonth, monthWeeks),
    [projectTxForMonth, monthWeeks],
  );

  const [mode, setMode] = useState<'projection' | 'actual'>('projection');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  type WeekSaveState = 'dirty' | 'saving' | 'error' | 'saved';
  const [weekSaveState, setWeekSaveState] = useState<Record<string, WeekSaveState>>({});
  const autosaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  const [submitConfirm, setSubmitConfirm] = useState<{ weekNo: number; yearMonth: string } | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);

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
    for (const t of Object.values(autosaveTimersRef.current)) {
      if (t) clearTimeout(t);
    }
    autosaveTimersRef.current = {};
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
    // Actual → 트랜잭션 자동 집계값 사용 (수동 입력 X)
    if (params.mode === 'actual') {
      const weekBucket = actualFromTx.get(params.weekNo);
      return weekBucket?.[params.lineId] || 0;
    }
    // Projection → 기존 수동 입력 로직
    const doc = byWeekNo.get(params.weekNo);
    const persisted = getPersistedCell({ doc, mode: params.mode, lineId: params.lineId });
    const key = resolveCellKey(params);
    const raw = Object.prototype.hasOwnProperty.call(draftsRef.current, key) ? draftsRef.current[key] : undefined;
    return raw !== undefined ? parseAmount(raw) : persisted.amount;
  }

  const derivedByMode = useMemo(() => {
    function compute(mode: 'projection' | 'actual') {
      const rowTotals: Record<CashflowSheetLineId, number> = Object.fromEntries(CASHFLOW_ALL_LINES.map((id) => [id, 0])) as any;
      const weekTotals = monthWeeks.map((def) => {
        const totalIn = CASHFLOW_IN_LINES.reduce((acc, id) => acc + getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId: id }), 0);
        const totalOut = CASHFLOW_OUT_LINES.reduce((acc, id) => acc + getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId: id }), 0);
        return { weekNo: def.weekNo, totalIn, totalOut, net: totalIn - totalOut };
      });

      for (const lineId of CASHFLOW_ALL_LINES) {
        for (const def of monthWeeks) {
          rowTotals[lineId] += getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId });
        }
      }

      const totalIn = weekTotals.reduce((acc, w) => acc + w.totalIn, 0);
      const totalOut = weekTotals.reduce((acc, w) => acc + w.totalOut, 0);
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
  }, [getEffectiveAmount, monthWeeks, yearMonth]);

  const flushWeek = useCallback(async (input: {
    weekNo: number;
    mode: 'projection' | 'actual';
    silent?: boolean;
  }): Promise<void> => {
    if (!canEdit) return;
    const wkKey = resolveWeekKey({ yearMonth, mode: input.mode, weekNo: input.weekNo });
    const doc = byWeekNo.get(input.weekNo);

    const rawByLine: Partial<Record<CashflowSheetLineId, string>> = {};
    const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
    for (const lineId of CASHFLOW_ALL_LINES) {
      const cellKey = resolveCellKey({ yearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
      const hasDraft = Object.prototype.hasOwnProperty.call(draftsRef.current, cellKey);
      if (!hasDraft) continue;

      const raw = draftsRef.current[cellKey];
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
  }, [byWeekNo, canEdit, projectId, resolveCellKey, resolveWeekKey, upsertWeekAmounts, yearMonth]);

  const scheduleAutosave = useCallback((input: { weekNo: number; mode: 'projection' | 'actual' }) => {
    const wkKey = resolveWeekKey({ yearMonth, mode: input.mode, weekNo: input.weekNo });
    const existing = autosaveTimersRef.current[wkKey];
    if (existing) clearTimeout(existing);

    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'dirty' }));
    autosaveTimersRef.current[wkKey] = setTimeout(() => {
      void flushWeek({ weekNo: input.weekNo, mode: input.mode, silent: true }).catch(() => {});
    }, 1200);
  }, [flushWeek, resolveWeekKey, yearMonth]);

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
      const raw = Object.prototype.hasOwnProperty.call(draftsRef.current, key) ? draftsRef.current[key] : undefined;
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
                          ) : weekMeta[w.weekNo]?.pmSubmitted ? (
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
                          {canEdit && !weekMeta[w.weekNo]?.adminClosed && tableMode !== 'actual' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => void flushWeek({ weekNo: w.weekNo, mode: tableMode, silent: false }).catch(() => {})}
                            >
                              저장
                            </Button>
                          )}
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
                      Actual 값은 승인/제출된 사업비 사용내역(트랜잭션)에서 자동 집계됩니다. 사용내역 등록 시 자동 반영됩니다.
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
                            disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                              scheduleAutosave({ weekNo: w.weekNo, mode: tableMode });
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
                            disabled={!canEdit || weekMeta[w.weekNo]?.adminClosed}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                              scheduleAutosave({ weekNo: w.weekNo, mode: tableMode });
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
                <tr className="border-t border-border/30 bg-muted/40">
                  <td className="px-4 py-2" style={{ fontWeight: 900 }}>NET</td>
                  {derived.weekTotals.map((w) => (
                    <td key={w.weekNo} className="px-3 py-2 text-right" style={{ fontWeight: 900, color: w.net >= 0 ? '#059669' : '#e11d48' }}>
                      {fmt(w.net)}
                    </td>
                  ))}
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
