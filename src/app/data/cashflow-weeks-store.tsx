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
  getDocs,
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
import { filterCashflowWeeksForYear, shouldCreateDocOnUpdateError } from './cashflow-weeks.helpers';
import {
  buildCashflowWeekUpdatePatch,
  buildInitialCashflowWeekDoc,
  normalizeWeekAmounts,
  resolveWeekDocId,
} from './cashflow-weeks.persistence';
import { isPlatformApiEnabled, upsertCashflowWeekViaBff } from '../lib/platform-bff-client';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../platform/business-days';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';
import { normalizeProjectIds } from './project-assignment';
import { useFirestoreAccessPolicy } from './firestore-realtime-mode';

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
  updateVarianceFlag: (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }) => Promise<void>;
  applyWeeklyExpenseCommandWeeks: (items: CashflowWeekSheet[]) => void;
  applyClosedCashflowWeek: (item: CashflowWeekSheet) => void;
  getWeeksForProject: (projectId: string) => CashflowWeekSheet[];
}

const _g = globalThis as any;
if (!_g.__MYSC_CASHFLOW_WEEKS_CTX__) {
  _g.__MYSC_CASHFLOW_WEEKS_CTX__ = createContext<(CashflowWeekState & CashflowWeekActions) | null>(null);
}
const CashflowWeekContext: React.Context<(CashflowWeekState & CashflowWeekActions) | null> = _g.__MYSC_CASHFLOW_WEEKS_CTX__;

function mergeCashflowWeekItem(prev: CashflowWeekSheet[], item: CashflowWeekSheet): CashflowWeekSheet[] {
  const byId = new Map(prev.map((existing) => [existing.id, existing]));
  byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
  return Array.from(byId.values()).sort((left, right) => {
    if (left.yearMonth !== right.yearMonth) return left.yearMonth.localeCompare(right.yearMonth);
    if (left.weekNo !== right.weekNo) return left.weekNo - right.weekNo;
    return left.id.localeCompare(right.id);
  });
}

export function CashflowWeekProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = isOnline && !!db;

  const role = user?.role;
  const myProjectId = user?.projectId || '';
  const projectIds = useMemo(
    () => normalizeProjectIds([...(Array.isArray(user?.projectIds) ? user?.projectIds : []), myProjectId]),
    [user?.projectIds, myProjectId],
  );
  const { allowPrivilegedReadAll: readAll } = useFirestoreAccessPolicy(role);

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

    if (!readAll && projectIds.length === 0) {
      setWeeks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const base = collection(db, getOrgCollectionPath(orgId, 'cashflowWeeks'));
    const q = readAll
      ? query(
        base,
        where('yearMonth', '>=', `${yearMonth.slice(0, 4)}-01`),
        where('yearMonth', '<=', `${yearMonth.slice(0, 4)}-12`),
        limit(2500),
      )
      : (projectIds.length > 0
        ? (projectIds.length === 1
          ? query(
            base,
            where('projectId', '==', projectIds[0]),
            limit(2500),
          )
          : query(
            base,
            where('projectId', 'in', projectIds.slice(0, 10)),
            limit(2500),
          ))
        : query(
          base,
          limit(2500),
        ));

    if (readAll) {
      unsubsRef.current.push(
        onSnapshot(q, (snap) => {
          const docs = snap.docs.map((d) => d.data() as CashflowWeekSheet);
          docs.sort((a, b) => {
            if (a.projectId !== b.projectId) return String(a.projectId).localeCompare(String(b.projectId));
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
    } else {
      void getDocs(q).then((snap) => {
        const docs = filterCashflowWeeksForYear(
          snap.docs.map((d) => d.data() as CashflowWeekSheet),
          yearMonth,
        );
        docs.sort((a, b) => {
          if (a.projectId !== b.projectId) return String(a.projectId).localeCompare(String(b.projectId));
          return (a.weekNo || 0) - (b.weekNo || 0);
        });
        setWeeks(docs);
        setIsLoading(false);
      }).catch((err) => {
        console.error('[CashflowWeeks] fetch error:', err);
        setWeeks([]);
        setIsLoading(false);
      });
    }

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
    };
  }, [authLoading, isAuthenticated, user, db, firestoreEnabled, orgId, projectIds, readAll, yearMonth]);

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

    if (isPlatformApiEnabled() && actor.uid && upsertCashflowWeekViaBff) {
      const result = await upsertCashflowWeekViaBff({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: actor.idToken,
          googleAccessToken: actor.googleAccessToken,
        },
        command: {
          projectId,
          yearMonth: ym,
          weekNo,
          mode: input.mode,
          amounts: input.amounts || {},
        },
      });
      setWeeks((prev) => mergeCashflowWeekItem(prev, result.cashflowWeek as CashflowWeekSheet));
      return;
    }

    if (!db && actor.source === 'dev_harness') {
      const id = resolveWeekDocId(projectId, ym, weekNo);
      const now = new Date().toISOString();
      const normalizedAmounts = normalizeWeekAmounts(input.amounts || {});
      setWeeks((prev) => {
        const existingIndex = prev.findIndex((sheet) => sheet.id === id);
        if (existingIndex >= 0) {
          const next = [...prev];
          const current = next[existingIndex];
          next[existingIndex] = {
            ...current,
            [input.mode]: {
              ...current[input.mode],
              ...normalizedAmounts,
            },
            updatedAt: now,
            updatedByUid: actor.uid,
            updatedByName: actor.name,
          };
          return next;
        }
        return [
          ...prev,
          {
            id,
            tenantId: orgId,
            projectId,
            yearMonth: ym,
            weekNo,
            weekStart: def.weekStart,
            weekEnd: def.weekEnd,
            projection: input.mode === 'projection' ? normalizedAmounts : {},
            actual: input.mode === 'actual' ? normalizedAmounts : {},
            pmSubmitted: false,
            adminClosed: false,
            createdAt: now,
            updatedAt: now,
            updatedByUid: actor.uid,
            updatedByName: actor.name,
          },
        ];
      });
      return;
    }

    if (!db) return;

    const id = resolveWeekDocId(projectId, ym, weekNo);
    const now = new Date().toISOString();
    const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', id));

    const patch = buildCashflowWeekUpdatePatch({
      orgId,
      actorUid: actor.uid,
      actorName: actor.name,
      mode: input.mode,
      amounts: input.amounts || {},
      now,
    });

    const existingSnap = await getDoc(ref).catch(() => null);
    if (existingSnap?.exists()) {
      await updateDoc(ref, patch as any);
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

  const applyWeeklyExpenseCommandWeeks = useCallback((items: CashflowWeekSheet[]) => {
    const nextItems = Array.isArray(items) ? items : [];
    if (nextItems.length === 0) return;
    setWeeks((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      nextItems.forEach((item) => {
        byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
      });
      return Array.from(byId.values()).sort((left, right) => {
        if (left.yearMonth !== right.yearMonth) return left.yearMonth.localeCompare(right.yearMonth);
        if (left.weekNo !== right.weekNo) return left.weekNo - right.weekNo;
        return left.id.localeCompare(right.id);
      });
    });
  }, []);

  const applyClosedCashflowWeek = useCallback((item: CashflowWeekSheet) => {
    if (!item?.id) return;
    setWeeks((prev) => mergeCashflowWeekItem(prev, item));
  }, []);

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
    updateVarianceFlag,
    applyWeeklyExpenseCommandWeeks,
    applyClosedCashflowWeek,
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
    updateVarianceFlag,
    applyWeeklyExpenseCommandWeeks,
    applyClosedCashflowWeek,
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
