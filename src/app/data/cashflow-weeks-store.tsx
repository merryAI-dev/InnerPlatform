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
import { useFirestoreAccessPolicy } from './firestore-realtime-mode';
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
  syncProjectActualsFromExpenseSheets: (input: { projectId: string }) => Promise<ProjectCashflowActualSyncResult>;
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

export function CashflowWeekProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { routeMode } = useFirestoreAccessPolicy(user?.role);
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
  }, [authLoading, isAuthenticated, user, db, firestoreEnabled, orgId, routeMode, yearMonth]);

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

    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      const normalizedAmounts = input.amounts || {};
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

  const syncProjectActualsFromExpenseSheets = useCallback(async (input: {
    projectId: string;
  }): Promise<ProjectCashflowActualSyncResult> => {
    const actor = user;
    const projectId = input.projectId.trim();
    if (!actor || !projectId) throw new Error('Actual 동기화 권한 정보가 없습니다.');
    if (!isPlatformApiEnabled() || actor.source === 'dev_harness') {
      throw new Error('Actual 동기화 API가 연결되어 있지 않습니다.');
    }

    const result = await syncProjectCashflowActualsViaBff({
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

    if (!result.skipped) {
      setWeeks((prev) => [...result.weeks, ...result.cleared].reduce((nextWeeks, week) => {
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
          now: result.updatedAt,
        });
      }, prev));
    }

    console.groupCollapsed(`[CashflowActualSync] project=${projectId}`);
    console.log('response', result);
    console.table(result.weeks.map((week) => ({
      week: `${week.yearMonth}:w${week.weekNo}`,
      nonZero: Object.fromEntries(Object.entries(week.amounts || {}).filter(([, amount]) => Number(amount) !== 0)),
    })));
    console.groupEnd();

    return result;
  }, [orgId, user]);

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
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

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
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const ym = input.yearMonth.trim();
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return;

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
    syncProjectActualsFromExpenseSheets,
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
