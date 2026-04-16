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
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { useAuth } from './auth-store';
import type {
  MonthlyClose,
  PayrollPaidStatus,
  PayrollReviewCandidate,
  PayrollReviewStatus,
  PayrollRun,
  PayrollSchedule,
} from './types';
import { featureFlags } from '../config/feature-flags';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import {
  addMonthsToYearMonth,
  computePlannedPayDate,
  getSeoulTodayIso,
  subtractBusinessDays,
} from '../platform/business-days';
import {
  mergeMonthlyCloseState,
  mergePayrollRunState,
  mergePayrollScheduleState,
  sortMonthlyClosesByYearMonth,
  sortPayrollRunsByPlannedPayDate,
} from './payroll.helpers';
import { useFirestoreAccessPolicy } from './firestore-realtime-mode';

const DEFAULT_TIMEZONE = 'Asia/Seoul';
const DEFAULT_LEAD_DAYS = 3;

export function sanitizePayrollReviewCandidate(candidate: PayrollReviewCandidate): PayrollReviewCandidate {
  return {
    txId: candidate.txId,
    detectedFrom: candidate.detectedFrom,
    signals: candidate.signals,
    decision: candidate.decision,
    ...(candidate.decidedAt ? { decidedAt: candidate.decidedAt } : {}),
    ...(candidate.decidedByUid ? { decidedByUid: candidate.decidedByUid } : {}),
    ...(candidate.decidedByName ? { decidedByName: candidate.decidedByName } : {}),
    ...(candidate.note ? { note: candidate.note } : {}),
  };
}

export function sanitizePayrollReviewCandidates(candidates: PayrollReviewCandidate[]): PayrollReviewCandidate[] {
  return candidates.map((candidate) => sanitizePayrollReviewCandidate(candidate));
}

interface PayrollState {
  schedules: PayrollSchedule[];
  runs: PayrollRun[];
  monthlyCloses: MonthlyClose[];
}

interface PayrollActions {
  upsertSchedule: (input: { projectId: string; dayOfMonth: number; active?: boolean }) => Promise<void>;
  acknowledgePayrollRun: (runId: string) => Promise<void>;
  confirmPayrollPaid: (runId: string, matchedTxIds?: string[]) => Promise<void>;
  savePayrollReview: (input: {
    runId: string;
    reviewCandidates: PayrollReviewCandidate[];
    pmReviewStatus: PayrollReviewStatus;
    paidStatus: PayrollPaidStatus;
    missingCandidateAlertAt?: string;
  }) => Promise<void>;
  markMonthlyCloseDone: (input: { projectId: string; yearMonth: string }) => Promise<void>;
  acknowledgeMonthlyClose: (closeId: string) => Promise<void>;
  getProjectRun: (projectId: string, yearMonth: string) => PayrollRun | undefined;
  getProjectClose: (projectId: string, yearMonth: string) => MonthlyClose | undefined;
}

const _g = globalThis as any;
if (!_g.__MYSC_PAYROLL_CTX__) {
  _g.__MYSC_PAYROLL_CTX__ = createContext<(PayrollState & PayrollActions) | null>(null);
}
const PayrollContext: React.Context<(PayrollState & PayrollActions) | null> = _g.__MYSC_PAYROLL_CTX__;

export function PayrollProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [schedules, setSchedules] = useState<PayrollSchedule[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [monthlyCloses, setMonthlyCloses] = useState<MonthlyClose[]>([]);
  const unsubsRef = useRef<Unsubscribe[]>([]);

  const role = user?.role;
  const myProjectId = user?.projectId || '';
  const { allowPrivilegedReadAll: readAll } = useFirestoreAccessPolicy(role);

  useEffect(() => {
    unsubsRef.current.forEach((u) => u());
    unsubsRef.current = [];

    if (authLoading || !isAuthenticated || !user) {
      setSchedules([]);
      setRuns([]);
      setMonthlyCloses([]);
      return;
    }

    if (!firestoreEnabled || !db) {
      setSchedules([]);
      setRuns([]);
      setMonthlyCloses([]);
      return;
    }

    if (readAll) {
      const schedulesQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'payrollSchedules')),
        orderBy('updatedAt', 'desc'),
        limit(250),
      );
      const runsQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'payrollRuns')),
        orderBy('plannedPayDate', 'desc'),
        limit(800),
      );
      const closeQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'monthlyCloses')),
        orderBy('yearMonth', 'desc'),
        limit(800),
      );

      unsubsRef.current.push(
        onSnapshot(schedulesQuery, (snap) => {
          setSchedules(snap.docs.map((d) => d.data() as PayrollSchedule));
        }, (err) => console.error('[Payroll] schedules listen error:', err)),
      );
      unsubsRef.current.push(
        onSnapshot(runsQuery, (snap) => {
          setRuns(sortPayrollRunsByPlannedPayDate(snap.docs.map((d) => d.data() as PayrollRun)));
        }, (err) => console.error('[Payroll] runs listen error:', err)),
      );
      unsubsRef.current.push(
        onSnapshot(closeQuery, (snap) => {
          setMonthlyCloses(sortMonthlyClosesByYearMonth(snap.docs.map((d) => d.data() as MonthlyClose)));
        }, (err) => console.error('[Payroll] monthly closes listen error:', err)),
      );

      return () => {
        unsubsRef.current.forEach((u) => u());
        unsubsRef.current = [];
      };
    }

    if (myProjectId) {
      const scheduleRef = doc(db, getOrgDocumentPath(orgId, 'payrollSchedules', myProjectId));
      const runQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'payrollRuns')),
        where('projectId', '==', myProjectId),
        limit(36),
      );
      const closeQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'monthlyCloses')),
        where('projectId', '==', myProjectId),
        limit(18),
      );

      unsubsRef.current.push(
        onSnapshot(scheduleRef, (snap) => {
          if (!snap.exists()) {
            setSchedules([]);
            return;
          }
          setSchedules([snap.data() as PayrollSchedule]);
        }, (err) => console.error('[Payroll] scoped schedule listen error:', err)),
      );
      unsubsRef.current.push(
        onSnapshot(runQuery, (snap) => {
          setRuns(sortPayrollRunsByPlannedPayDate(snap.docs.map((d) => d.data() as PayrollRun)));
        }, (err) => console.error('[Payroll] scoped runs listen error:', err)),
      );
      unsubsRef.current.push(
        onSnapshot(closeQuery, (snap) => {
          setMonthlyCloses(sortMonthlyClosesByYearMonth(snap.docs.map((d) => d.data() as MonthlyClose)));
        }, (err) => console.error('[Payroll] scoped monthly closes listen error:', err)),
      );
    } else {
      setSchedules([]);
      setRuns([]);
      setMonthlyCloses([]);
    }

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
    };
  }, [authLoading, isAuthenticated, user, db, firestoreEnabled, myProjectId, orgId, readAll]);

  const upsertSchedule = useCallback(async (input: {
    projectId: string;
    dayOfMonth: number;
    active?: boolean;
  }): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const day = Math.max(1, Math.min(31, Math.trunc(input.dayOfMonth)));
    const now = new Date().toISOString();
    const projectId = input.projectId.trim();
    if (!projectId) return;

    const schedule: PayrollSchedule = {
      id: projectId,
      tenantId: orgId,
      projectId,
      dayOfMonth: day,
      timezone: DEFAULT_TIMEZONE,
      noticeLeadBusinessDays: DEFAULT_LEAD_DAYS,
      active: input.active ?? true,
      updatedAt: now,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      createdAt: now,
      createdBy: actor.uid,
    };

    await setDoc(doc(db, getOrgDocumentPath(orgId, 'payrollSchedules', projectId)), schedule, { merge: true });
    setSchedules((current) => mergePayrollScheduleState(current, schedule));

    // Ensure current + next month run docs exist so the UI is responsive even before the daily worker runs.
    const today = getSeoulTodayIso();
    const ym = today.slice(0, 7);
    const months = [ym, addMonthsToYearMonth(ym, 1)];

    for (const yearMonth of months) {
      const plannedPayDate = computePlannedPayDate(yearMonth, day);
      const noticeDate = subtractBusinessDays(plannedPayDate, DEFAULT_LEAD_DAYS);
      const runId = `${projectId}-${yearMonth}`;
      const runRef = doc(db, getOrgDocumentPath(orgId, 'payrollRuns', runId));

      try {
        await updateDoc(runRef, {
          tenantId: orgId,
          projectId,
          yearMonth,
          plannedPayDate,
          noticeDate,
          noticeLeadBusinessDays: DEFAULT_LEAD_DAYS,
          updatedAt: now,
        } as Partial<PayrollRun> as any);
        setRuns((current) => {
          const existing = current.find((entry) => entry.id === runId);
          if (!existing) return current;
          return mergePayrollRunState(current, {
            ...existing,
            tenantId: orgId,
            projectId,
            yearMonth,
            plannedPayDate,
            noticeDate,
            noticeLeadBusinessDays: DEFAULT_LEAD_DAYS,
            updatedAt: now,
          });
        });
      } catch {
        const run: PayrollRun = {
          id: runId,
          tenantId: orgId,
          projectId,
          yearMonth,
          plannedPayDate,
          noticeDate,
          noticeLeadBusinessDays: DEFAULT_LEAD_DAYS,
          acknowledged: false,
          paidStatus: 'UNKNOWN',
          matchedTxIds: [],
          reviewCandidates: [],
          pmReviewStatus: 'PENDING',
          createdAt: now,
          updatedAt: now,
        };
        await setDoc(runRef, run, { merge: true });
        setRuns((current) => mergePayrollRunState(current, run));
      }
    }
  }, [db, orgId, user]);

  const acknowledgePayrollRun = useCallback(async (runId: string): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const id = runId.trim();
    if (!id) return;
    const now = new Date().toISOString();
    await updateDoc(doc(db, getOrgDocumentPath(orgId, 'payrollRuns', id)), {
      tenantId: orgId,
      acknowledged: true,
      acknowledgedAt: now,
      acknowledgedByUid: actor.uid,
      acknowledgedByName: actor.name,
      updatedAt: now,
    } as Partial<PayrollRun> as any);
    setRuns((current) => {
      const existing = current.find((entry) => entry.id === id);
      if (!existing) return current;
      return mergePayrollRunState(current, {
        ...existing,
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedByUid: actor.uid,
        acknowledgedByName: actor.name,
        updatedAt: now,
      });
    });
  }, [db, orgId, user]);

  const confirmPayrollPaid = useCallback(async (runId: string, matchedTxIds?: string[]): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const id = runId.trim();
    if (!id) return;
    const now = new Date().toISOString();
    const run = runs.find((entry) => entry.id === id);
    const matchedFromReview = run?.reviewCandidates
      ?.filter((candidate) => candidate.decision === 'PAYROLL')
      .map((candidate) => candidate.txId);
    const safeMatchedTxIds = Array.isArray(matchedTxIds) && matchedTxIds.length > 0
      ? matchedTxIds
      : matchedFromReview;

    await updateDoc(doc(db, getOrgDocumentPath(orgId, 'payrollRuns', id)), {
      tenantId: orgId,
      paidStatus: 'CONFIRMED',
      ...(Array.isArray(safeMatchedTxIds) ? { matchedTxIds: safeMatchedTxIds.slice(0, 30) } : null),
      confirmedAt: now,
      confirmedByUid: actor.uid,
      confirmedByName: actor.name,
      updatedAt: now,
    } as Partial<PayrollRun> as any);
    setRuns((current) => {
      const existing = current.find((entry) => entry.id === id);
      if (!existing) return current;
      return mergePayrollRunState(current, {
        ...existing,
        paidStatus: 'CONFIRMED',
        matchedTxIds: Array.isArray(safeMatchedTxIds) ? safeMatchedTxIds.slice(0, 30) : existing.matchedTxIds,
        confirmedAt: now,
        confirmedByUid: actor.uid,
        confirmedByName: actor.name,
        updatedAt: now,
      });
    });
  }, [db, orgId, runs, user]);

  const savePayrollReview = useCallback(async (input: {
    runId: string;
    reviewCandidates: PayrollReviewCandidate[];
    pmReviewStatus: PayrollReviewStatus;
    paidStatus: PayrollPaidStatus;
    missingCandidateAlertAt?: string;
  }): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const runId = input.runId.trim();
    if (!runId) return;
    const now = new Date().toISOString();
    const completed = input.pmReviewStatus === 'COMPLETED';
    const reviewCandidates = sanitizePayrollReviewCandidates(input.reviewCandidates);

    await updateDoc(doc(db, getOrgDocumentPath(orgId, 'payrollRuns', runId)), {
      tenantId: orgId,
      reviewCandidates,
      pmReviewStatus: input.pmReviewStatus,
      paidStatus: input.paidStatus,
      missingCandidateAlertAt: input.missingCandidateAlertAt ?? deleteField(),
      pmReviewCompletedAt: completed ? now : deleteField(),
      pmReviewCompletedByUid: completed ? actor.uid : deleteField(),
      pmReviewCompletedByName: completed && actor.name ? actor.name : deleteField(),
      updatedAt: now,
    } as Partial<PayrollRun> as any);
    setRuns((current) => {
      const existing = current.find((entry) => entry.id === runId);
      if (!existing) return current;
      return mergePayrollRunState(current, {
        ...existing,
        reviewCandidates,
        pmReviewStatus: input.pmReviewStatus,
        paidStatus: input.paidStatus,
        ...(input.missingCandidateAlertAt ? { missingCandidateAlertAt: input.missingCandidateAlertAt } : {}),
        ...(!input.missingCandidateAlertAt ? { missingCandidateAlertAt: undefined } : {}),
        ...(completed
          ? {
              pmReviewCompletedAt: now,
              pmReviewCompletedByUid: actor.uid,
              pmReviewCompletedByName: actor.name,
            }
          : {
              pmReviewCompletedAt: undefined,
              pmReviewCompletedByUid: undefined,
              pmReviewCompletedByName: undefined,
            }),
        updatedAt: now,
      });
    });
  }, [db, orgId, user]);

  const markMonthlyCloseDone = useCallback(async (input: { projectId: string; yearMonth: string }): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const projectId = input.projectId.trim();
    const yearMonth = input.yearMonth.trim();
    if (!projectId || !/^\d{4}-\d{2}$/.test(yearMonth)) return;
    const now = new Date().toISOString();

    const closeId = `${projectId}-${yearMonth}`;
    const closeRef = doc(db, getOrgDocumentPath(orgId, 'monthlyCloses', closeId));

    try {
      await updateDoc(closeRef, {
        tenantId: orgId,
        projectId,
        yearMonth,
        status: 'DONE',
        doneAt: now,
        doneByUid: actor.uid,
        doneByName: actor.name,
        updatedAt: now,
      } as Partial<MonthlyClose> as any);
    } catch {
      const docData: MonthlyClose = {
        id: closeId,
        tenantId: orgId,
        projectId,
        yearMonth,
        status: 'DONE',
        doneAt: now,
        doneByUid: actor.uid,
        doneByName: actor.name,
        acknowledged: false,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(closeRef, docData, { merge: true });
      setMonthlyCloses((current) => mergeMonthlyCloseState(current, docData));
      return;
    }
    setMonthlyCloses((current) => {
      const existing = current.find((entry) => entry.id === closeId);
      if (!existing) return current;
      return mergeMonthlyCloseState(current, {
        ...existing,
        tenantId: orgId,
        projectId,
        yearMonth,
        status: 'DONE',
        doneAt: now,
        doneByUid: actor.uid,
        doneByName: actor.name,
        updatedAt: now,
      });
    });
  }, [db, orgId, user]);

  const acknowledgeMonthlyClose = useCallback(async (closeId: string): Promise<void> => {
    if (!db) return;
    const actor = user;
    if (!actor) return;
    const id = closeId.trim();
    if (!id) return;
    const now = new Date().toISOString();
    await updateDoc(doc(db, getOrgDocumentPath(orgId, 'monthlyCloses', id)), {
      tenantId: orgId,
      acknowledged: true,
      acknowledgedAt: now,
      acknowledgedByUid: actor.uid,
      acknowledgedByName: actor.name,
      updatedAt: now,
    } as Partial<MonthlyClose> as any);
    setMonthlyCloses((current) => {
      const existing = current.find((entry) => entry.id === id);
      if (!existing) return current;
      return mergeMonthlyCloseState(current, {
        ...existing,
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedByUid: actor.uid,
        acknowledgedByName: actor.name,
        updatedAt: now,
      });
    });
  }, [db, orgId, user]);

  const getProjectRun = useCallback((projectId: string, yearMonth: string) => {
    const id = `${projectId}-${yearMonth}`;
    return runs.find((r) => r.id === id);
  }, [runs]);

  const getProjectClose = useCallback((projectId: string, yearMonth: string) => {
    const id = `${projectId}-${yearMonth}`;
    return monthlyCloses.find((c) => c.id === id);
  }, [monthlyCloses]);

  const value: PayrollState & PayrollActions = useMemo(() => ({
    schedules,
    runs,
    monthlyCloses,
    upsertSchedule,
    acknowledgePayrollRun,
    confirmPayrollPaid,
    savePayrollReview,
    markMonthlyCloseDone,
    acknowledgeMonthlyClose,
    getProjectRun,
    getProjectClose,
  }), [
    schedules,
    runs,
    monthlyCloses,
    upsertSchedule,
    acknowledgePayrollRun,
    confirmPayrollPaid,
    savePayrollReview,
    markMonthlyCloseDone,
    acknowledgeMonthlyClose,
    getProjectRun,
    getProjectClose,
  ]);

  return <PayrollContext.Provider value={value}>{children}</PayrollContext.Provider>;
}

export function usePayroll() {
  const ctx = useContext(PayrollContext);
  if (!ctx) throw new Error('usePayroll must be used within PayrollProvider');
  return ctx;
}
