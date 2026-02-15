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
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { useAuth } from './auth-store';
import type { CashflowSheetLineId, CashflowWeekSheet } from './types';
import { featureFlags } from '../config/feature-flags';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../platform/business-days';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';

function normalizeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function canReadAll(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'tenant_admin' || normalized === 'finance' || normalized === 'auditor';
}

function resolveWeekDocId(projectId: string, yearMonth: string, weekNo: number): string {
  const safeProjectId = projectId.trim();
  const safeYm = yearMonth.trim();
  const safeNo = Math.max(1, Math.min(6, Math.trunc(weekNo)));
  return `${safeProjectId}-${safeYm}-w${safeNo}`;
}

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

interface CashflowWeekState {
  yearMonth: string; // selected month ("YYYY-MM")
  weeks: CashflowWeekSheet[];
  isLoading: boolean;
}

interface CashflowWeekActions {
  setYearMonth: (yearMonth: string) => void;
  goPrevMonth: () => void;
  goNextMonth: () => void;
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
  getWeeksForProject: (projectId: string) => CashflowWeekSheet[];
}

const _g = globalThis as any;
if (!_g.__MYSC_CASHFLOW_WEEKS_CTX__) {
  _g.__MYSC_CASHFLOW_WEEKS_CTX__ = createContext<(CashflowWeekState & CashflowWeekActions) | null>(null);
}
const CashflowWeekContext: React.Context<(CashflowWeekState & CashflowWeekActions) | null> = _g.__MYSC_CASHFLOW_WEEKS_CTX__;

export function CashflowWeekProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const role = user?.role;
  const myProjectId = user?.projectId || '';
  const readAll = canReadAll(role);

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

    if (!firestoreEnabled || !db) {
      setWeeks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const base = collection(db, getOrgCollectionPath(orgId, 'cashflowWeeks'));
    const q = readAll
      ? query(base, where('yearMonth', '==', yearMonth), limit(2500))
      : (myProjectId
        ? query(base, where('projectId', '==', myProjectId), where('yearMonth', '==', yearMonth), limit(80))
        : null);

    if (!q) {
      setWeeks([]);
      setIsLoading(false);
      return;
    }

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

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
    };
  }, [db, firestoreEnabled, myProjectId, orgId, readAll, yearMonth]);

  const upsertLineAmount = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    lineId: CashflowSheetLineId;
    amount: number;
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
    const patch: Record<string, unknown> = {
      tenantId: orgId,
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      [`${input.mode}.${input.lineId}`]: clampAmount(input.amount),
    };

    try {
      await updateDoc(ref, patch as any);
      return;
    } catch {
      // First write for this week doc.
    }

    const initial: CashflowWeekSheet = {
      id,
      tenantId: orgId,
      projectId,
      yearMonth: ym,
      weekNo,
      weekStart: def.weekStart,
      weekEnd: def.weekEnd,
      projection: input.mode === 'projection' ? { [input.lineId]: clampAmount(input.amount) } as any : {},
      actual: input.mode === 'actual' ? { [input.lineId]: clampAmount(input.amount) } as any : {},
      pmSubmitted: false,
      adminClosed: false,
      createdAt: now,
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
    };
    await setDoc(ref, initial, { merge: true });
  }, [db, orgId, user]);

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
    } catch {
      // Fallthrough to create.
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
    } as CashflowWeekSheet, { merge: true });
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
    } catch {
      // Fallthrough to create.
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
    } as CashflowWeekSheet, { merge: true });
  }, [db, orgId, user]);

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
    upsertLineAmount,
    submitWeekAsPm,
    closeWeekAsAdmin,
    getWeeksForProject,
  }), [
    yearMonth,
    weeks,
    isLoading,
    setYearMonth,
    goPrevMonth,
    goNextMonth,
    upsertLineAmount,
    submitWeekAsPm,
    closeWeekAsAdmin,
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
