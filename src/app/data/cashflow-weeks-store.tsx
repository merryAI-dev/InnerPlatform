import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from './auth-store';
import type { CashflowSheetLineId, CashflowWeekSheet, VarianceFlag, VarianceFlagEvent } from './types';
import { filterCashflowWeeksThroughSelectedYear, shouldCreateDocOnUpdateError } from './cashflow-weeks.helpers';
import {
  buildCashflowWeekUpdatePatch,
  buildInitialCashflowWeekDoc,
  resolveWeekDocId,
} from './cashflow-weeks.persistence';
import { applyWeekAmountsToLocalWeeks } from './cashflow-weeks.local-state';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import {
  isPlatformApiEnabled,
  syncProjectCashflowActualsViaBff,
  upsertCashflowWeekAmountsViaBff,
  type ProjectCashflowActualSyncResult,
} from '../lib/platform-bff-client';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../platform/business-days';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';
import { recordDevtoolsLog, summarizeAmountMap, toDevtoolsError } from '../platform/devtools-transaction-log';

interface CashflowWeekState {
  yearMonth: string; // selected month ("YYYY-MM")
  weeks: CashflowWeekSheet[];
  isLoading: boolean;
}

interface CashflowWeekActions {
  setYearMonth: (yearMonth: string) => void;
  goPrevMonth: () => void;
  goNextMonth: () => void;
  upsertWeekAmounts: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    amounts: Partial<Record<CashflowSheetLineId, number>>;
    markCompleted?: boolean;
  }) => Promise<void>;
  upsertLineAmount: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    lineId: CashflowSheetLineId;
    amount: number;
  }) => Promise<void>;
  submitWeekAsPm: (input: { projectId: string; yearMonth: string; weekNo: number }) => Promise<void>;
  closeWeekAsAdmin: (input: { projectId: string; yearMonth: string; weekNo: number }) => Promise<void>;
  syncProjectActualsFromExpenseSheets: (input: { projectId: string }) => Promise<ProjectCashflowActualSyncResult>;
  applyProjectActualSyncResultLocally: (input: {
    projectId: string;
    result: Pick<ProjectCashflowActualSyncResult, 'weeks' | 'cleared' | 'updatedAt' | 'skipped'>;
  }) => void;
  updateVarianceFlag: (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }) => Promise<void>;
  getWeeksForProject: (projectId: string) => CashflowWeekSheet[];
}

const _g = globalThis as any;
if (!_g.__MYSC_CASHFLOW_WEEKS_CTX__) {
  _g.__MYSC_CASHFLOW_WEEKS_CTX__ = createContext<(CashflowWeekState & CashflowWeekActions) | null>(null);
}
const CashflowWeekContext: React.Context<(CashflowWeekState & CashflowWeekActions) | null> = _g.__MYSC_CASHFLOW_WEEKS_CTX__;

type CashflowEventType =
  | 'projection_amount_change'
  | 'actual_amount_change'
  | 'projection_completed'
  | 'actual_completed'
  | 'admin_closed';

type CashflowEvent = {
  id?: string;
  tenantId: string;
  projectId: string;
  runId: string;
  type: CashflowEventType;
  source: 'manual';
  yearMonth: string;
  weekNo: number;
  mode?: 'projection' | 'actual';
  lineId?: CashflowSheetLineId;
  beforeAmount?: number;
  afterAmount?: number;
  beforeHadValue?: boolean;
  afterHadValue?: boolean;
  actorUid: string;
  actorName: string;
  actorEmail?: string;
  createdAt: string;
};

function safeCashflowEventDocId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 140);
}

async function writeCashflowEvents(db: NonNullable<ReturnType<typeof useFirebase>['db']>, orgId: string, events: CashflowEvent[]): Promise<void> {
  await Promise.all(events.map((event, index) => {
    const id = safeCashflowEventDocId(`${event.runId}:${event.type}:${event.mode || 'status'}:${event.yearMonth}:w${event.weekNo}:${event.lineId || index}`);
    return setDoc(doc(db, getOrgDocumentPath(orgId, 'cashflowEvents', id)), { ...event, id }, { merge: false });
  }));
}

function buildAmountChangeEvents(input: {
  tenantId: string;
  projectId: string;
  runId: string;
  mode: 'projection' | 'actual';
  yearMonth: string;
  weekNo: number;
  amounts: Partial<Record<CashflowSheetLineId, number>>;
  existing?: CashflowWeekSheet;
  actorUid: string;
  actorName: string;
  actorEmail?: string;
  now: string;
}): CashflowEvent[] {
  const src = input.mode === 'projection' ? input.existing?.projection : input.existing?.actual;
  return Object.entries(input.amounts || {}).flatMap(([lineId, rawAmount]) => {
    const typedLineId = lineId as CashflowSheetLineId;
    const beforeHadValue = !!src && Object.prototype.hasOwnProperty.call(src, typedLineId);
    const beforeAmount = Number(src?.[typedLineId] ?? 0);
    const afterAmount = Number(rawAmount) || 0;
    if (beforeHadValue && beforeAmount === afterAmount) return [];
    return [{
      tenantId: input.tenantId,
      projectId: input.projectId,
      runId: input.runId,
      type: input.mode === 'projection' ? 'projection_amount_change' : 'actual_amount_change',
      source: 'manual',
      yearMonth: input.yearMonth,
      weekNo: input.weekNo,
      mode: input.mode,
      lineId: typedLineId,
      beforeAmount,
      afterAmount,
      beforeHadValue,
      afterHadValue: true,
      actorUid: input.actorUid,
      actorName: input.actorName,
      actorEmail: input.actorEmail,
      createdAt: input.now,
    }];
  });
}

function patchCashflowWeekLocally(
  rows: CashflowWeekSheet[],
  id: string,
  patch: Partial<CashflowWeekSheet>,
  fallback?: CashflowWeekSheet,
): CashflowWeekSheet[] {
  let matched = false;
  const nextRows = rows.map((row) => {
    if (row.id !== id) return row;
    matched = true;
    return { ...row, ...patch };
  });
  if (!matched && fallback) {
    nextRows.push({ ...fallback, ...patch });
  }
  nextRows.sort((a, b) => {
    if (a.projectId !== b.projectId) return String(a.projectId).localeCompare(String(b.projectId));
    if (a.yearMonth !== b.yearMonth) return String(a.yearMonth).localeCompare(String(b.yearMonth));
    return (a.weekNo || 0) - (b.weekNo || 0);
  });
  return nextRows;
}

export function CashflowWeekProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = isOnline && !!db;

  const [yearMonth, setYearMonthState] = useState(() => getSeoulTodayIso().slice(0, 7));
  const [weeks, setWeeks] = useState<CashflowWeekSheet[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const setYearMonth = useCallback((value: string) => {
    const next = typeof value === 'string' ? value.trim() : '';
    if (!/^\d{4}-\d{2}$/.test(next)) return;
    setYearMonthState(next);
  }, []);

  const goPrevMonth = useCallback(() => {
    setYearMonthState((prev) => addMonthsToYearMonth(prev, -1));
  }, []);

  const goNextMonth = useCallback(() => {
    setYearMonthState((prev) => addMonthsToYearMonth(prev, 1));
  }, []);

  const applyProjectActualSyncResultLocally = useCallback((input: {
    projectId: string;
    result: Pick<ProjectCashflowActualSyncResult, 'weeks' | 'cleared' | 'updatedAt' | 'skipped'>;
  }) => {
    const actor = user;
    const projectId = input.projectId.trim();
    if (!actor || !projectId || input.result.skipped) return;

    const weeksToApply = [...input.result.weeks, ...input.result.cleared];
    if (weeksToApply.length === 0) return;

    setWeeks((prev) => weeksToApply.reduce((nextWeeks, week) => {
      const fallback = getMonthMondayWeeks(week.yearMonth).find((candidate) => candidate.weekNo === week.weekNo);
      return applyWeekAmountsToLocalWeeks({
        weeks: nextWeeks,
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        projectId,
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        weekStart: week.weekStart || fallback?.weekStart || '',
        weekEnd: week.weekEnd || fallback?.weekEnd || '',
        mode: 'actual',
        amounts: (week.amounts || {}) as Partial<Record<CashflowSheetLineId, number>>,
        now: input.result.updatedAt || new Date().toISOString(),
      });
    }, prev));
  }, [orgId, user]);

  useEffect(() => {
    let cancelled = false;

    if (authLoading || !isAuthenticated || !user) {
      setWeeks([]);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!firestoreEnabled || !db) {
      setWeeks([]);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    const base = collection(db, getOrgCollectionPath(orgId, 'cashflowWeeks'));
    const selectedYear = Number.parseInt(yearMonth.slice(0, 4), 10);
    const carryForwardYearStart = `${Number.isFinite(selectedYear) ? selectedYear - 1 : yearMonth.slice(0, 4)}-01`;
    const selectedYearEnd = `${yearMonth.slice(0, 4)}-12`;
    const q = query(
      base,
      where('yearMonth', '>=', carryForwardYearStart),
      where('yearMonth', '<=', selectedYearEnd),
      limit(5000),
    );

    void getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const docs = filterCashflowWeeksThroughSelectedYear(
          snap.docs.map((d) => d.data() as CashflowWeekSheet),
          yearMonth,
        );
        docs.sort((a, b) => {
          if (a.projectId !== b.projectId) return String(a.projectId).localeCompare(String(b.projectId));
          if (a.yearMonth !== b.yearMonth) return String(a.yearMonth).localeCompare(String(b.yearMonth));
          return (a.weekNo || 0) - (b.weekNo || 0);
        });
        setWeeks(docs);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[CashflowWeeks] fetch error:', err);
        setWeeks([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.uid, db, firestoreEnabled, orgId, yearMonth]);

  const upsertWeekAmounts = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    amounts: Partial<Record<CashflowSheetLineId, number>>;
    markCompleted?: boolean;
  }): Promise<void> => {
    const actor = user;
    if (!actor) return;

    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(5, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;
    const amountSummary = summarizeAmountMap(input.amounts || {});

    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      const normalizedAmounts = input.amounts || {};
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'start',
        operation: 'cashflow.week.upsert',
        transport: 'bff',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        mode: input.mode,
        summary: amountSummary,
      });
      try {
        await upsertCashflowWeekAmountsViaBff({
          tenantId: orgId,
          actor: {
            uid: actor.uid,
            email: actor.email,
            role: actor.role,
            idToken: (actor as any).idToken,
            googleAccessToken: (actor as any).googleAccessToken,
          },
          projectId,
          payload: {
            yearMonth: ym,
            weekNo,
            mode: input.mode,
            amounts: Object.fromEntries(
              Object.entries(normalizedAmounts).map(([lineId, amount]) => [lineId, Number(amount) || 0]),
            ),
          },
        });
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'success',
          operation: 'cashflow.week.upsert',
          transport: 'bff',
          tenantId: orgId,
          actorId: actor.uid,
          projectId,
          yearMonth: ym,
          weekNo,
          mode: input.mode,
          summary: amountSummary,
        });
      } catch (error) {
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'error',
          operation: 'cashflow.week.upsert',
          transport: 'bff',
          tenantId: orgId,
          actorId: actor.uid,
          projectId,
          yearMonth: ym,
          weekNo,
          mode: input.mode,
          summary: amountSummary,
          error: toDevtoolsError(error),
        });
        throw error;
      }
      const now = new Date().toISOString();
      setWeeks((prev) => applyWeekAmountsToLocalWeeks({
        weeks: prev,
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        projectId,
        yearMonth: ym,
        weekNo,
        weekStart: def.weekStart,
        weekEnd: def.weekEnd,
        mode: input.mode,
        amounts: normalizedAmounts,
        now,
      }));
      return;
    }

    if (!db && actor.source === 'dev_harness') {
      const now = new Date().toISOString();
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.week.upsert',
        transport: 'local',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        mode: input.mode,
        summary: amountSummary,
      });
      setWeeks((prev) => applyWeekAmountsToLocalWeeks({
        weeks: prev,
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        projectId,
        yearMonth: ym,
        weekNo,
        weekStart: def.weekStart,
        weekEnd: def.weekEnd,
        mode: input.mode,
        amounts: input.amounts || {},
        now,
      }));
      return;
    }

    if (!db) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));

    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.week.upsert',
      transport: 'firestore',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
      yearMonth: ym,
      weekNo,
      mode: input.mode,
      summary: { ...amountSummary, docId: id },
    });

    try {
      const existingSnap = await getDoc(ref).catch(() => null);
      const existingData = existingSnap?.exists() ? (existingSnap.data() as CashflowWeekSheet) : undefined;
      const runId = `cashflow-manual:${projectId}:${ym}:w${weekNo}:${input.mode}:${now}`;
      const events = [
        ...buildAmountChangeEvents({
          tenantId: orgId,
          projectId,
          runId,
          mode: input.mode,
          yearMonth: ym,
          weekNo,
          amounts: input.amounts || {},
          existing: existingData,
          actorUid: actor.uid,
          actorName: actor.name,
          actorEmail: actor.email,
          now,
        }),
        ...(input.markCompleted && input.mode === 'projection' ? [{
          tenantId: orgId,
          projectId,
          runId,
          type: 'projection_completed' as const,
          source: 'manual' as const,
          yearMonth: ym,
          weekNo,
          mode: 'projection' as const,
          actorUid: actor.uid,
          actorName: actor.name,
          actorEmail: actor.email,
          createdAt: now,
        }] : []),
      ];
      const patch = buildCashflowWeekUpdatePatch({
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        mode: input.mode,
        amounts: input.amounts || {},
        now,
        weekStart: def.weekStart,
        existingProjection: existingData?.projection,
        existingActual: existingData?.actual,
      });

      if (existingSnap?.exists()) {
        await updateDoc(ref, patch as any);
        await writeCashflowEvents(db, orgId, events);
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'success',
          operation: 'cashflow.week.upsert',
          transport: 'firestore',
          tenantId: orgId,
          actorId: actor.uid,
          projectId,
          yearMonth: ym,
          weekNo,
          mode: input.mode,
          summary: { ...amountSummary, docId: id, created: false },
        });
        setWeeks((prev) => applyWeekAmountsToLocalWeeks({
          weeks: prev,
          orgId,
          actorUid: actor.uid,
          actorName: actor.name,
          projectId,
          yearMonth: ym,
          weekNo,
          weekStart: def.weekStart,
          weekEnd: def.weekEnd,
          mode: input.mode,
          amounts: input.amounts || {},
          now,
        }));
        return;
      }

      const initial: CashflowWeekSheet = buildInitialCashflowWeekDoc({
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        projectId,
        yearMonth: ym,
        weekNo,
        weekStart: def.weekStart,
        weekEnd: def.weekEnd,
        mode: input.mode,
        amounts: input.amounts || {},
        now,
      });
      await setDoc(ref, initial, { merge: false });
      await writeCashflowEvents(db, orgId, events);
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.week.upsert',
        transport: 'firestore',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        mode: input.mode,
        summary: { ...amountSummary, docId: id, created: true },
      });
      setWeeks((prev) => applyWeekAmountsToLocalWeeks({
        weeks: prev,
        orgId,
        actorUid: actor.uid,
        actorName: actor.name,
        projectId,
        yearMonth: ym,
        weekNo,
        weekStart: def.weekStart,
        weekEnd: def.weekEnd,
        mode: input.mode,
        amounts: input.amounts || {},
        now,
      }));
      return;
    } catch (error) {
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'error',
        operation: 'cashflow.week.upsert',
        transport: 'firestore',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        mode: input.mode,
        summary: { ...amountSummary, docId: id },
        error: toDevtoolsError(error),
      });
      throw error;
    }
  }, [db, orgId, user]);

  const upsertLineAmount = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    lineId: CashflowSheetLineId;
    amount: number;
  }): Promise<void> => {
    return upsertWeekAmounts({
      projectId: input.projectId,
      yearMonth: input.yearMonth,
      weekNo: input.weekNo,
      mode: input.mode,
      amounts: { [input.lineId]: input.amount },
    });
  }, [upsertWeekAmounts]);

  const syncProjectActualsFromExpenseSheets = useCallback(async (input: {
    projectId: string;
  }): Promise<ProjectCashflowActualSyncResult> => {
    const actor = user;
    const projectId = input.projectId.trim();
    if (!actor || !projectId) throw new Error('Actual 동기화 권한 정보가 없습니다.');
    if (!isPlatformApiEnabled() || actor.source === 'dev_harness') {
      throw new Error('Actual 동기화 API가 연결되어 있지 않습니다.');
    }

    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.actual.sync',
      transport: 'bff',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
    });
    let result: ProjectCashflowActualSyncResult;
    try {
      result = await syncProjectCashflowActualsViaBff({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
      });
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.actual.sync',
        transport: 'bff',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        summary: {
          skipped: result.skipped,
          sourceRows: result.sourceRows,
          sheetCount: result.sheetCount,
          upsertedWeeks: result.upsertedWeeks,
          clearedWeeks: result.clearedWeeks,
        },
      });
    } catch (error) {
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'error',
        operation: 'cashflow.actual.sync',
        transport: 'bff',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        error: toDevtoolsError(error),
      });
      throw error;
    }

    applyProjectActualSyncResultLocally({ projectId, result });

    return result;
  }, [applyProjectActualSyncResultLocally, orgId, user]);

  const submitWeekAsPm = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
  }): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(5, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));
    const event: CashflowEvent = {
      tenantId: orgId,
      projectId,
      runId: `cashflow-status:${projectId}:${ym}:w${weekNo}:actual-completed:${now}`,
      type: 'actual_completed',
      source: 'manual',
      yearMonth: ym,
      weekNo,
      mode: 'actual',
      actorUid: actor.uid,
      actorName: actor.name,
      actorEmail: actor.email,
      createdAt: now,
    };

    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.week.submitActual',
      transport: 'firestore',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
      yearMonth: ym,
      weekNo,
      mode: 'actual',
      summary: { docId: id },
    });

    try {
      const patch: Partial<CashflowWeekSheet> = {
        pmSubmitted: true,
        pmSubmittedAt: now,
        pmSubmittedByUid: actor.uid,
        pmSubmittedByName: actor.name,
        updatedAt: now,
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        tenantId: orgId,
      };
      await updateDoc(ref, {
        ...patch,
      } as Partial<CashflowWeekSheet> as any);
      await writeCashflowEvents(db, orgId, [event]);
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.week.submitActual',
        transport: 'firestore',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        mode: 'actual',
        summary: { docId: id, created: false },
      });
      setWeeks((prev) => patchCashflowWeekLocally(prev, id, patch));
      return;
    } catch (error) {
      if (!shouldCreateDocOnUpdateError(error)) {
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'error',
          operation: 'cashflow.week.submitActual',
          transport: 'firestore',
          tenantId: orgId,
          actorId: actor.uid,
          projectId,
          yearMonth: ym,
          weekNo,
          mode: 'actual',
          summary: { docId: id },
          error: toDevtoolsError(error),
        });
        throw error;
      }
    }

    const initial: CashflowWeekSheet = {
      id,
      tenantId: orgId,
      projectId,
      yearMonth: ym,
      weekNo,
      weekStart: def.weekStart,
      weekEnd: def.weekEnd,
      projection: {},
      actual: {},
      pmSubmitted: true,
      pmSubmittedAt: now,
      pmSubmittedByUid: actor.uid,
      pmSubmittedByName: actor.name,
      adminClosed: false,
      createdAt: now,
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
    };
    await setDoc(ref, initial, { merge: false });
    await writeCashflowEvents(db, orgId, [event]);
    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'success',
      operation: 'cashflow.week.submitActual',
      transport: 'firestore',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
      yearMonth: ym,
      weekNo,
      mode: 'actual',
      summary: { docId: id, created: true },
    });
    setWeeks((prev) => patchCashflowWeekLocally(prev, id, initial, initial));
  }, [db, orgId, user]);

  const closeWeekAsAdmin = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
  }): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(5, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));
    const event: CashflowEvent = {
      tenantId: orgId,
      projectId,
      runId: `cashflow-status:${projectId}:${ym}:w${weekNo}:admin-closed:${now}`,
      type: 'admin_closed',
      source: 'manual',
      yearMonth: ym,
      weekNo,
      actorUid: actor.uid,
      actorName: actor.name,
      actorEmail: actor.email,
      createdAt: now,
    };

    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.week.close',
      transport: 'firestore',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
      yearMonth: ym,
      weekNo,
      summary: { docId: id },
    });

    try {
      const patch: Partial<CashflowWeekSheet> = {
        adminClosed: true,
        adminClosedAt: now,
        adminClosedByUid: actor.uid,
        adminClosedByName: actor.name,
        updatedAt: now,
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        tenantId: orgId,
      };
      await updateDoc(ref, {
        ...patch,
      } as Partial<CashflowWeekSheet> as any);
      await writeCashflowEvents(db, orgId, [event]);
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.week.close',
        transport: 'firestore',
        tenantId: orgId,
        actorId: actor.uid,
        projectId,
        yearMonth: ym,
        weekNo,
        summary: { docId: id, created: false },
      });
      setWeeks((prev) => patchCashflowWeekLocally(prev, id, patch));
      return;
    } catch (error) {
      if (!shouldCreateDocOnUpdateError(error)) {
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'error',
          operation: 'cashflow.week.close',
          transport: 'firestore',
          tenantId: orgId,
          actorId: actor.uid,
          projectId,
          yearMonth: ym,
          weekNo,
          summary: { docId: id },
          error: toDevtoolsError(error),
        });
        throw error;
      }
    }

    const initial: CashflowWeekSheet = {
      id,
      tenantId: orgId,
      projectId,
      yearMonth: ym,
      weekNo,
      weekStart: def.weekStart,
      weekEnd: def.weekEnd,
      projection: {},
      actual: {},
      pmSubmitted: false,
      adminClosed: true,
      adminClosedAt: now,
      adminClosedByUid: actor.uid,
      adminClosedByName: actor.name,
      createdAt: now,
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
    };
    await setDoc(ref, initial, { merge: false });
    await writeCashflowEvents(db, orgId, [event]);
    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'success',
      operation: 'cashflow.week.close',
      transport: 'firestore',
      tenantId: orgId,
      actorId: actor.uid,
      projectId,
      yearMonth: ym,
      weekNo,
      summary: { docId: id, created: true },
    });
    setWeeks((prev) => patchCashflowWeekLocally(prev, id, initial, initial));
  }, [db, orgId, user]);

  const updateVarianceFlag = useCallback(async (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }): Promise<void> => {
    if (!db) return;
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', input.sheetId));
    const now = new Date().toISOString();
    const firestorePatch = {
      varianceFlag: input.varianceFlag ?? null,
      varianceHistory: input.varianceHistory,
      updatedAt: now,
      tenantId: orgId,
    };
    await updateDoc(ref, firestorePatch as any);
    setWeeks((prev) => patchCashflowWeekLocally(prev, input.sheetId, {
      varianceFlag: input.varianceFlag,
      varianceHistory: input.varianceHistory,
      updatedAt: now,
      tenantId: orgId,
    }));
  }, [db, orgId]);

  const getWeeksForProject = useCallback((projectId: string): CashflowWeekSheet[] => {
    const pid = projectId.trim();
    if (!pid) return [];
    return weeks.filter((w) => w.projectId === pid);
  }, [weeks]);

  const value = useMemo(() => ({
    yearMonth,
    weeks,
    isLoading,
    setYearMonth,
    goPrevMonth,
    goNextMonth,
    upsertWeekAmounts,
    upsertLineAmount,
    submitWeekAsPm,
    closeWeekAsAdmin,
    syncProjectActualsFromExpenseSheets,
    applyProjectActualSyncResultLocally,
    updateVarianceFlag,
    getWeeksForProject,
  }), [
    yearMonth,
    weeks,
    isLoading,
    setYearMonth,
    goPrevMonth,
    goNextMonth,
    upsertWeekAmounts,
    upsertLineAmount,
    submitWeekAsPm,
    closeWeekAsAdmin,
    syncProjectActualsFromExpenseSheets,
    applyProjectActualSyncResultLocally,
    updateVarianceFlag,
    getWeeksForProject,
  ]);

  return (
    <CashflowWeekContext.Provider value={value}>
      {children}
    </CashflowWeekContext.Provider>
  );
}

export function useCashflowWeeks() {
  const ctx = useContext(CashflowWeekContext);
  if (!ctx) throw new Error('useCashflowWeeks must be used within CashflowWeekProvider');
  return ctx;
}
