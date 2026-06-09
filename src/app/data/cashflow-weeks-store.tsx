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
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { useAuth } from './auth-store';
import { useFirestoreAccessPolicy } from './firestore-realtime-mode';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId, type CashflowWeekSheet, type VarianceFlag, type VarianceFlagEvent } from './types';
import { filterCashflowWeeksThroughSelectedYear } from './cashflow-weeks.helpers';
import {
  resolveWeekDocId,
} from './cashflow-weeks.persistence';
import { applyWeekAmountsToLocalWeeks } from './cashflow-weeks.local-state';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath } from '../lib/firebase';
import {
  fetchWeeklyExpenseCashflowViaBff,
  fetchWeeklyExpenseStatusesViaBff,
  isPlatformApiEnabled,
  closeWeeklyExpenseWeekViaBff,
  submitWeeklyExpenseWeekViaBff,
  type WeeklyExpenseCashflowSnapshot,
  type WeeklyExpenseCashflowModeReadModel,
  type WeeklyExpenseStatusLine,
  upsertWeeklyExpenseProjectionViaBff,
} from '../lib/platform-bff-client';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../platform/business-days';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';
import { parseCashflowLineLabel } from '../platform/settlement-csv';

function createCashflowCommandIdempotencyKey(command: string, projectId: string, yearMonth: string, weekNo: number): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${command}:${projectId}:${yearMonth}:w${weekNo}:${random}`;
}

interface CashflowWeekState {
  yearMonth: string; // selected month ("YYYY-MM")
  weeks: CashflowWeekSheet[];
  isLoading: boolean;
  readModels: Record<string, CashflowMonthReadModel>;
}

interface CashflowWeekActions {
  setYearMonth: (yearMonth: string) => void;
  goPrevMonth: () => void;
  goNextMonth: () => void;
  upsertProjectionAmounts: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    amounts: Partial<Record<CashflowSheetLineId, number>>;
  }) => Promise<void>;
  submitWeekAsPm: (input: { projectId: string; yearMonth: string; weekNo: number }) => Promise<void>;
  closeWeekAsAdmin: (input: { projectId: string; yearMonth: string; weekNo: number }) => Promise<void>;
  updateVarianceFlag: (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }) => Promise<void>;
  ensureProjectCashflowSnapshot: (projectId: string) => Promise<void>;
  ensureProjectCashflowSnapshots: (projectIds: string[]) => Promise<void>;
  getWeeksForProject: (projectId: string) => CashflowWeekSheet[];
  getReadModelForProjectMonth: (projectId: string, yearMonth: string) => CashflowMonthReadModel | undefined;
}

export interface CashflowReadModelTotals {
  totalIn: number;
  totalOut: number;
  net: number;
}

export interface CashflowReadModelWeek extends CashflowReadModelTotals {
  weekNo: number;
  amounts: Partial<Record<CashflowSheetLineId, number>>;
  weekIn: number;
  weekOut: number;
}

export interface CashflowModeReadModel {
  rowTotals: Partial<Record<CashflowSheetLineId, number>>;
  weeks: CashflowReadModelWeek[];
  weekTotals: CashflowReadModelWeek[];
  monthTotals: CashflowReadModelTotals;
}

export interface CashflowMonthReadModel {
  projectId: string;
  yearMonth: string;
  projection: CashflowModeReadModel;
  actual: CashflowModeReadModel;
}

function normalizeSnapshotAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function normalizeReadModelTotals(value: { totalIn?: unknown; totalOut?: unknown; net?: unknown } | undefined): CashflowReadModelTotals {
  return {
    totalIn: normalizeSnapshotAmount(value?.totalIn),
    totalOut: normalizeSnapshotAmount(value?.totalOut),
    net: normalizeSnapshotAmount(value?.net),
  };
}

function resolveSnapshotLineId(cashflowLine: string): CashflowSheetLineId | null {
  const parsed = parseCashflowLineLabel(cashflowLine);
  if (parsed) return parsed;
  const entry = Object.entries(CASHFLOW_SHEET_LINE_LABELS)
    .find(([, label]) => String(label) === String(cashflowLine));
  return entry ? entry[0] as CashflowSheetLineId : null;
}

function normalizeModeReadModel(input: WeeklyExpenseCashflowModeReadModel | undefined): CashflowModeReadModel {
  const rowTotals: Partial<Record<CashflowSheetLineId, number>> = {};
  for (const [rawLineId, rawAmount] of Object.entries(input?.rowTotals || {})) {
    const lineId = resolveSnapshotLineId(rawLineId);
    if (!lineId) continue;
    rowTotals[lineId] = normalizeSnapshotAmount(rawAmount);
  }

  const weeks = (input?.weeks || []).map((week) => {
    const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
    for (const [rawLineId, rawAmount] of Object.entries(week.amounts || {})) {
      const lineId = resolveSnapshotLineId(rawLineId);
      if (!lineId) continue;
      amounts[lineId] = normalizeSnapshotAmount(rawAmount);
    }
    const totals = normalizeReadModelTotals(week);
    return {
      weekNo: Number(week.weekNo),
      amounts,
      ...totals,
      weekIn: normalizeSnapshotAmount(week.weekIn),
      weekOut: normalizeSnapshotAmount(week.weekOut),
    };
  });

  return {
    rowTotals,
    weeks,
    weekTotals: weeks,
    monthTotals: normalizeReadModelTotals(input?.monthTotals),
  };
}

function buildCashflowReadModelsFromSnapshot(snapshot: WeeklyExpenseCashflowSnapshot): Record<string, CashflowMonthReadModel> {
  const out: Record<string, CashflowMonthReadModel> = {};
  for (const month of snapshot.readModel?.months || []) {
    if (!/^\d{4}-\d{2}$/.test(month.yearMonth || '')) continue;
    out[`${snapshot.projectId}:${month.yearMonth}`] = {
      projectId: snapshot.projectId,
      yearMonth: month.yearMonth,
      projection: normalizeModeReadModel(month.projection),
      actual: normalizeModeReadModel(month.actual),
    };
  }
  return out;
}

function buildCashflowWeeksFromSnapshot(params: {
  orgId: string;
  snapshot: WeeklyExpenseCashflowSnapshot;
  now: string;
}): CashflowWeekSheet[] {
  const byKey = new Map<string, CashflowWeekSheet>();
  const ensureWeek = (yearMonth: string, weekNo: number): CashflowWeekSheet | null => {
    if (!/^\d{4}-\d{2}$/.test(yearMonth) || !Number.isFinite(weekNo)) return null;
    const def = getMonthMondayWeeks(yearMonth).find((week) => week.weekNo === weekNo);
    if (!def) return null;
    const id = resolveWeekDocId(params.snapshot.projectId, yearMonth, weekNo);
    const existing = byKey.get(id);
    if (existing) return existing;
    const next: CashflowWeekSheet = {
      id,
      tenantId: params.orgId,
      projectId: params.snapshot.projectId,
      yearMonth,
      weekNo,
      weekStart: def.weekStart,
      weekEnd: def.weekEnd,
      projection: {},
      actual: {},
      pmSubmitted: false,
      adminClosed: false,
      createdAt: params.now,
      updatedAt: params.now,
    };
    byKey.set(id, next);
    return next;
  };

  for (const month of Object.values(buildCashflowReadModelsFromSnapshot(params.snapshot))) {
    for (const mode of ['projection', 'actual'] as const) {
      for (const readWeek of month[mode].weeks) {
        const week = ensureWeek(month.yearMonth, Number(readWeek.weekNo));
        if (!week) continue;
        week[mode] = {
          ...week[mode],
          ...readWeek.amounts,
        };
        const totals = {
          totalIn: readWeek.totalIn,
          totalOut: readWeek.totalOut,
          net: readWeek.net,
        };
        if (mode === 'projection') {
          week.projectionTotals = totals;
        } else {
          week.actualTotals = totals;
        }
        if (mode === 'projection' && Object.keys(readWeek.amounts).length > 0) {
          week.projectionUpdated = true;
        }
      }
    }
  }

  for (const line of params.snapshot.projection || []) {
    const lineId = resolveSnapshotLineId(line.cashflowLine);
    const week = ensureWeek(line.yearMonth, Number(line.weekNo));
    if (!lineId || !week) continue;
    week.projection[lineId] = normalizeSnapshotAmount(line.amount);
    week.projectionUpdated = true;
  }

  for (const line of params.snapshot.actual || []) {
    const lineId = resolveSnapshotLineId(line.cashflowLine);
    const week = ensureWeek(line.yearMonth, Number(line.weekNo));
    if (!lineId || !week) continue;
    week.actual[lineId] = (week.actual[lineId] || 0) + normalizeSnapshotAmount(line.amount);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
    if (a.yearMonth !== b.yearMonth) return a.yearMonth.localeCompare(b.yearMonth);
    return a.weekNo - b.weekNo;
  });
}

function mergeWeeklyStatusesIntoCashflowWeeks(
  weeks: CashflowWeekSheet[],
  statuses: WeeklyExpenseStatusLine[] | undefined,
  params: { orgId: string; now: string },
): CashflowWeekSheet[] {
  if (!Array.isArray(statuses) || statuses.length === 0) return weeks;
  const byWeekId = new Map<string, CashflowWeekSheet>();
  for (const week of weeks) {
    byWeekId.set(resolveWeekDocId(week.projectId, week.yearMonth, Number(week.weekNo)), week);
  }
  const byKey = new Map<string, WeeklyExpenseStatusLine>();
  for (const status of statuses) {
    if (!status?.projectId || !/^\d{4}-\d{2}$/.test(status.yearMonth || '')) continue;
    const weekNo = Number(status.weekNo);
    const key = `${status.projectId}:${status.yearMonth}:${weekNo}`;
    byKey.set(key, status);
    const weekId = resolveWeekDocId(status.projectId, status.yearMonth, weekNo);
    if (byWeekId.has(weekId)) continue;
    const def = getMonthMondayWeeks(status.yearMonth).find((week) => week.weekNo === weekNo);
    if (!def) continue;
    byWeekId.set(weekId, {
      id: weekId,
      tenantId: params.orgId,
      projectId: status.projectId,
      yearMonth: status.yearMonth,
      weekNo,
      weekStart: def.weekStart,
      weekEnd: def.weekEnd,
      projection: {},
      actual: {},
      pmSubmitted: false,
      adminClosed: false,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }
  return Array.from(byWeekId.values()).map((week) => {
    const status = byKey.get(`${week.projectId}:${week.yearMonth}:${Number(week.weekNo)}`);
    if (!status) return week;
    return {
      ...week,
      pmSubmitted: Boolean(status.pmSubmitted),
      pmSubmittedAt: status.submittedAt || undefined,
      pmSubmittedByUid: status.submittedBy || undefined,
      adminClosed: Boolean(status.adminClosed),
      adminClosedAt: status.closedAt || undefined,
      adminClosedByUid: status.closedBy || undefined,
      updatedAt: status.updatedAt || week.updatedAt,
    };
  }).sort((a, b) => {
    if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
    if (a.yearMonth !== b.yearMonth) return a.yearMonth.localeCompare(b.yearMonth);
    return a.weekNo - b.weekNo;
  });
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
  const [readModels, setReadModels] = useState<Record<string, CashflowMonthReadModel>>({});
  const [isLoading, setIsLoading] = useState(false);
  const unsubsRef = useRef<Unsubscribe[]>([]);
  const loadedProjectSnapshotsRef = useRef<Set<string>>(new Set());

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
      setReadModels({});
      setIsLoading(false);
      return;
    }

    if (isPlatformApiEnabled() && user.source !== 'dev_harness') {
      setIsLoading(false);
      return;
    }

    if (!firestoreEnabled || !db) {
      setWeeks([]);
      setReadModels({});
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

  const ensureProjectCashflowSnapshot = useCallback(async (projectIdInput: string): Promise<void> => {
    const actor = user;
    const projectId = String(projectIdInput || '').trim();
    if (!actor || !projectId) return;
    if (!isPlatformApiEnabled() || actor.source === 'dev_harness') return;
    if (loadedProjectSnapshotsRef.current.has(projectId)) return;

    setIsLoading(true);
    try {
      const snapshot = await fetchWeeklyExpenseCashflowViaBff({
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
      const statuses = await fetchWeeklyExpenseStatusesViaBff({
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
      const snapshotWeeks = mergeWeeklyStatusesIntoCashflowWeeks(buildCashflowWeeksFromSnapshot({
        orgId,
        snapshot,
        now,
      }), statuses.statuses, { orgId, now });
      const snapshotReadModels = buildCashflowReadModelsFromSnapshot(snapshot);
      setWeeks((prev) => [
        ...prev.filter((week) => week.projectId !== projectId),
        ...snapshotWeeks,
      ].sort((a, b) => {
        if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
        if (a.yearMonth !== b.yearMonth) return a.yearMonth.localeCompare(b.yearMonth);
        return a.weekNo - b.weekNo;
      }));
      setReadModels((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${projectId}:`)) delete next[key];
        }
        return { ...next, ...snapshotReadModels };
      });
      loadedProjectSnapshotsRef.current.add(projectId);
    } catch (error) {
      console.error('[CashflowWeeks] snapshot load failed:', error);
      setWeeks((prev) => prev.filter((week) => week.projectId !== projectId));
      setReadModels((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${projectId}:`)) delete next[key];
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }, [orgId, user]);

  const ensureProjectCashflowSnapshots = useCallback(async (projectIds: string[]): Promise<void> => {
    const normalizedProjectIds = Array.from(new Set(
      (projectIds || []).map((projectId) => String(projectId || '').trim()).filter(Boolean),
    ));
    for (const projectId of normalizedProjectIds) {
      await ensureProjectCashflowSnapshot(projectId);
    }
  }, [ensureProjectCashflowSnapshot]);

  const upsertProjectionAmounts = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
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
      await upsertWeeklyExpenseProjectionViaBff({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        idempotencyKey: `projection-${projectId}-${ym}-w${weekNo}-${Date.now()}`,
        lines: Object.entries(normalizedAmounts).map(([lineId, amount]) => ({
          yearMonth: ym,
          weekNo,
          cashflowLine: CASHFLOW_SHEET_LINE_LABELS[lineId as CashflowSheetLineId] || lineId,
          amount: Number(amount) || 0,
        })),
      });
      loadedProjectSnapshotsRef.current.delete(projectId);
      const snapshot = await fetchWeeklyExpenseCashflowViaBff({
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
      const snapshotWeeks = buildCashflowWeeksFromSnapshot({
        orgId,
        snapshot,
        now: new Date().toISOString(),
      });
      const snapshotReadModels = buildCashflowReadModelsFromSnapshot(snapshot);
      setWeeks((prev) => [
        ...prev.filter((week) => week.projectId !== projectId),
        ...snapshotWeeks,
      ].sort((a, b) => {
        if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
        if (a.yearMonth !== b.yearMonth) return a.yearMonth.localeCompare(b.yearMonth);
        return a.weekNo - b.weekNo;
      }));
      setReadModels((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${projectId}:`)) delete next[key];
        }
        return { ...next, ...snapshotReadModels };
      });
      loadedProjectSnapshotsRef.current.add(projectId);
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
        mode: 'projection',
        amounts: input.amounts || {},
        now,
      }));
      return;
    }

    throw new Error('캐시플로 금액 저장 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
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

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const now = new Date().toISOString();
    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      await submitWeeklyExpenseWeekViaBff({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        yearMonth: ym,
        weekNo,
        idempotencyKey: createCashflowCommandIdempotencyKey('weekly-expense-submit-week', projectId, ym, weekNo),
      });
      loadedProjectSnapshotsRef.current.delete(projectId);
    }

    if (!isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      throw new Error('주간 제출 처리 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
    }

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
      mode: 'projection',
      amounts: {},
      now,
    }).map((week) => (
      week.projectId === projectId && week.yearMonth === ym && week.weekNo === weekNo
        ? {
          ...week,
          pmSubmitted: true,
          pmSubmittedAt: now,
          pmSubmittedByUid: actor.uid,
          pmSubmittedByName: actor.name,
          updatedAt: now,
          updatedByUid: actor.uid,
          updatedByName: actor.name,
        }
        : week
    )));
  }, [orgId, user]);

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

    const monthWeeks = getMonthMondayWeeks(ym);
    const def = monthWeeks.find((w) => w.weekNo === weekNo);
    if (!def) return;

    const now = new Date().toISOString();
    if (isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      await closeWeeklyExpenseWeekViaBff({
        tenantId: orgId,
        actor: {
          uid: actor.uid,
          email: actor.email,
          role: actor.role,
          idToken: (actor as any).idToken,
          googleAccessToken: (actor as any).googleAccessToken,
        },
        projectId,
        yearMonth: ym,
        weekNo,
        idempotencyKey: createCashflowCommandIdempotencyKey('weekly-expense-close-week', projectId, ym, weekNo),
      });
      loadedProjectSnapshotsRef.current.delete(projectId);
    }

    if (!isPlatformApiEnabled() && actor.source !== 'dev_harness') {
      throw new Error('주간 마감 처리 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
    }
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
      mode: 'projection',
      amounts: {},
      now,
    }).map((week) => (
      week.projectId === projectId && week.yearMonth === ym && week.weekNo === weekNo
        ? {
          ...week,
          adminClosed: true,
          adminClosedAt: now,
          adminClosedByUid: actor.uid,
          adminClosedByName: actor.name,
          updatedAt: now,
          updatedByUid: actor.uid,
          updatedByName: actor.name,
        }
        : week
    )));
  }, [orgId, user]);

  const updateVarianceFlag = useCallback(async (input: {
    sheetId: string;
    varianceFlag: VarianceFlag | undefined;
    varianceHistory: VarianceFlagEvent[];
  }): Promise<void> => {
    const actor = user;
    if (isPlatformApiEnabled() && actor?.source !== 'dev_harness') {
      throw new Error('차이 사유 저장 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
    }
    const now = new Date().toISOString();
    setWeeks((prev) => prev.map((week) => (
      week.id === input.sheetId
        ? {
          ...week,
          varianceFlag: input.varianceFlag,
          varianceHistory: input.varianceHistory,
          updatedAt: now,
        }
        : week
    )));
  }, [user]);

  const getWeeksForProject = useCallback((projectId: string): CashflowWeekSheet[] => {
    const pid = projectId.trim();
    if (!pid) return [];
    return weeks.filter((w) => w.projectId === pid);
  }, [weeks]);

  const getReadModelForProjectMonth = useCallback((projectId: string, yearMonthInput: string): CashflowMonthReadModel | undefined => {
    const pid = projectId.trim();
    const ym = yearMonthInput.trim();
    if (!pid || !/^\d{4}-\d{2}$/.test(ym)) return undefined;
    return readModels[`${pid}:${ym}`];
  }, [readModels]);

  const value = useMemo(() => ({
    yearMonth,
    weeks,
    isLoading,
    readModels,
    setYearMonth,
    goPrevMonth,
    goNextMonth,
    upsertProjectionAmounts,
    submitWeekAsPm,
    closeWeekAsAdmin,
    updateVarianceFlag,
    ensureProjectCashflowSnapshot,
    ensureProjectCashflowSnapshots,
    getWeeksForProject,
    getReadModelForProjectMonth,
  }), [
    yearMonth,
    weeks,
    isLoading,
    readModels,
    setYearMonth,
    goPrevMonth,
    goNextMonth,
    upsertProjectionAmounts,
    submitWeekAsPm,
    closeWeekAsAdmin,
    updateVarianceFlag,
    ensureProjectCashflowSnapshot,
    ensureProjectCashflowSnapshots,
    getWeeksForProject,
    getReadModelForProjectMonth,
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
