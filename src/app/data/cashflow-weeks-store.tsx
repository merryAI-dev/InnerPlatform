import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
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
  closeWeeklyExpenseWeekViaPlatformApi,
  fetchCashflowSnapshotViaPlatformApi,
  isPlatformApiEnabled,
  submitWeeklyExpenseWeekViaPlatformApi,
  upsertCashflowProjectionViaPlatformApi,
} from '../lib/platform-bff-client';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../platform/business-days';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';

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
  hydrateProjectCashflowSnapshot: (input: { projectId: string }) => Promise<void>;
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

function idempotencyKey(prefix: string, parts: Array<string | number>): string {
  return `${prefix}-${parts.map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '_')).join('-')}-${Date.now()}`;
}

function numericAmounts(input: Record<string, unknown> | undefined): Partial<Record<CashflowSheetLineId, number>> {
  const output: Partial<Record<CashflowSheetLineId, number>> = {};
  for (const [lineId, amount] of Object.entries(input || {})) {
    output[lineId as CashflowSheetLineId] = Math.trunc(Number(amount) || 0);
  }
  return output;
}

export function CashflowWeekProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = isOnline && !!db;

  const [yearMonth, setYearMonthState] = useState(() => getSeoulTodayIso().slice(0, 7));
  const [weeks, setWeeks] = useState<CashflowWeekSheet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const unsubsRef = useRef<Unsubscribe[]>([]);

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

  useEffect(() => {
    unsubsRef.current.forEach((u) => u());
    unsubsRef.current = [];

    if (authLoading || !isAuthenticated || !user) {
      setWeeks([]);
      setIsLoading(false);
      return;
    }

    if (!firestoreEnabled || !db) {
      setWeeks([]);
      setIsLoading(false);
      return;
    }

    if (isPlatformApiEnabled() && user.source !== 'dev_harness') {
      setWeeks([]);
      setIsLoading(false);
      return;
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

    unsubsRef.current.push(
      onSnapshot(q, (snap) => {
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
      }, (err) => {
        console.error('[CashflowWeeks] listen error:', err);
        setWeeks([]);
        setIsLoading(false);
      }),
    );

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
    };
  }, [authLoading, isAuthenticated, user, db, firestoreEnabled, orgId, yearMonth]);

  const upsertWeekAmounts = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    amounts: Partial<Record<CashflowSheetLineId, number>>;
  }): Promise<void> => {
    const actor = user;
    if (!actor) return;

    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    if (input.mode === 'actual') {
      throw new Error('Cashflow actual은 프론트에서 저장할 수 없습니다. 사업비 원장 저장 후 Java read model을 조회해야 합니다.');
    }

    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      const normalizedAmounts = input.amounts || {};
      await upsertCashflowProjectionViaPlatformApi({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        idempotencyKey: idempotencyKey('cashflow-projection', [projectId, ym, weekNo]),
        lines: Object.entries(normalizedAmounts).map(([lineId, amount]) => ({
          yearMonth: ym,
          weekNo,
          cashflowLine: lineId,
          amount: Number(amount) || 0,
        })),
      });
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

    const existingSnap = await getDoc(ref).catch(() => null);
    const existingData = existingSnap?.exists() ? (existingSnap.data() as CashflowWeekSheet) : undefined;
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

  const hydrateProjectCashflowSnapshot = useCallback(async (input: {
    projectId: string;
  }): Promise<void> => {
    const actor = user;
    const projectId = input.projectId.trim();
    if (!actor || !projectId) return;
    if (!isPlatformApiEnabled() || actor.source === 'dev_harness') {
      return;
    }

    const snapshot = await fetchCashflowSnapshotViaPlatformApi({
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

    const now = new Date().toISOString();
    const nextDocs: CashflowWeekSheet[] = [];
    const monthModels = snapshot.readModel?.months || [];
    for (const month of monthModels) {
      const defs = getMonthMondayWeeks(month.yearMonth);
      const projectionWeeks = new Map((month.projection?.weeks || []).map((week) => [week.weekNo, week]));
      const actualWeeks = new Map((month.actual?.weeks || []).map((week) => [week.weekNo, week]));
      const weekNos = new Set<number>([
        ...projectionWeeks.keys(),
        ...actualWeeks.keys(),
      ]);
      for (const weekNo of weekNos) {
        const def = defs.find((week) => week.weekNo === weekNo);
        const projection = numericAmounts(projectionWeeks.get(weekNo)?.amounts);
        const actual = numericAmounts(actualWeeks.get(weekNo)?.amounts);
        nextDocs.push({
          id: resolveWeekDocId(projectId, month.yearMonth, weekNo),
          tenantId: orgId,
          projectId,
          yearMonth: month.yearMonth,
          weekNo,
          weekStart: def?.weekStart || '',
          weekEnd: def?.weekEnd || '',
          projection,
          actual,
          projectionTotals: {
            totalIn: Number(projectionWeeks.get(weekNo)?.totalIn || 0),
            totalOut: Number(projectionWeeks.get(weekNo)?.totalOut || 0),
            net: Number(projectionWeeks.get(weekNo)?.net || 0),
          },
          actualTotals: {
            totalIn: Number(actualWeeks.get(weekNo)?.totalIn || 0),
            totalOut: Number(actualWeeks.get(weekNo)?.totalOut || 0),
            net: Number(actualWeeks.get(weekNo)?.net || 0),
          },
          projectionUpdated: Object.values(projection).some((amount) => Number(amount) !== 0),
          pmSubmitted: Object.values(actual).some((amount) => Number(amount) !== 0),
          adminClosed: false,
          createdAt: now,
          updatedAt: now,
          updatedByUid: 'java-weekly-api',
          updatedByName: 'Java Weekly API',
        });
      }
    }

    setWeeks((prev) => [
      ...prev.filter((week) => week.projectId !== projectId),
      ...nextDocs,
    ]);
  }, [orgId, user]);

  const submitWeekAsPm = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
  }): Promise<void> => {
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      await submitWeeklyExpenseWeekViaPlatformApi({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        idempotencyKey: idempotencyKey('weekly-submit', [projectId, ym, weekNo]),
        yearMonth: ym,
        weekNo,
      });
      setWeeks((prev) => prev.map((week) => (
        week.projectId === projectId && week.yearMonth === ym && week.weekNo === weekNo
          ? {
            ...week,
            pmSubmitted: true,
            pmSubmittedAt: new Date().toISOString(),
            pmSubmittedByUid: actor.uid,
            pmSubmittedByName: actor.name,
          }
          : week
      )));
      return;
    }

    if (!db) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));

    try {
      await updateDoc(ref, {
        pmSubmitted: true,
        pmSubmittedAt: now,
        pmSubmittedByUid: actor.uid,
        pmSubmittedByName: actor.name,
        updatedAt: now,
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        tenantId: orgId,
      } as Partial<CashflowWeekSheet> as any);
      return;
    } catch (error) {
      if (!shouldCreateDocOnUpdateError(error)) {
        throw error;
      }
    }

    await setDoc(ref, {
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
    } as CashflowWeekSheet, { merge: false });
  }, [db, orgId, user]);

  const closeWeekAsAdmin = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
  }): Promise<void> => {
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      await closeWeeklyExpenseWeekViaPlatformApi({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        idempotencyKey: idempotencyKey('weekly-close', [projectId, ym, weekNo]),
        yearMonth: ym,
        weekNo,
      });
      setWeeks((prev) => prev.map((week) => (
        week.projectId === projectId && week.yearMonth === ym && week.weekNo === weekNo
          ? {
            ...week,
            adminClosed: true,
            adminClosedAt: new Date().toISOString(),
            adminClosedByUid: actor.uid,
            adminClosedByName: actor.name,
          }
          : week
      )));
      return;
    }

    if (!db) return;

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));

    try {
      await updateDoc(ref, {
        adminClosed: true,
        adminClosedAt: now,
        adminClosedByUid: actor.uid,
        adminClosedByName: actor.name,
        updatedAt: now,
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        tenantId: orgId,
      } as Partial<CashflowWeekSheet> as any);
      return;
    } catch (error) {
      if (!shouldCreateDocOnUpdateError(error)) {
        throw error;
      }
    }

    await setDoc(ref, {
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
    } as CashflowWeekSheet, { merge: false });
  }, [db, orgId, user]);

  const updateVarianceFlag = useCallback(async (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }): Promise<void> => {
    if (!db) return;
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', input.sheetId));
    const now = new Date().toISOString();
    await updateDoc(ref, {
      varianceFlag: input.varianceFlag ?? null,
      varianceHistory: input.varianceHistory,
      updatedAt: now,
      tenantId: orgId,
    } as any);
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
    hydrateProjectCashflowSnapshot,
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
    hydrateProjectCashflowSnapshot,
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

export function useHydrateCashflowSnapshots(projectIds: string[], options: { enabled?: boolean } = {}) {
  const { hydrateProjectCashflowSnapshot } = useCashflowWeeks();
  const enabled = options.enabled ?? true;
  const projectKey = useMemo(() => (
    Array.from(new Set(projectIds.map((id) => id.trim()).filter(Boolean))).sort().join('|')
  ), [projectIds]);

  useEffect(() => {
    if (!enabled || !projectKey) return;
    let cancelled = false;
    const ids = projectKey.split('|');

    void (async () => {
      for (const projectId of ids) {
        if (cancelled) return;
        try {
          await hydrateProjectCashflowSnapshot({ projectId });
        } catch (error) {
          console.error('[Cashflow] Java snapshot hydration failed:', { projectId, error });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, hydrateProjectCashflowSnapshot, projectKey]);
}
