import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, runTransaction, where, writeBatch } from 'firebase/firestore';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Columns2, Loader2, Pencil, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useBlocker, useNavigate } from 'react-router';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
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
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import {
  CASHFLOW_SHEET_LINE_LABELS,
  type CashflowSheetLineId,
  type CashflowWeekSheet,
  type UserRole,
  type WeeklySubmissionStatus,
} from '../../data/types';
import { getSeoulTodayIso } from '../../platform/business-days';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, computeCashflowDerivedTotals, computeCashflowTotals, computeOpeningCashflowTotals } from '../../platform/cashflow-sheet';
import { getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { resolveWeeklyAccountingState } from '../../platform/weekly-accounting-state';
import { useAuth } from '../../data/auth-store';
import { hasUnsavedChanges } from './cashflow-unsaved';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance, getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import {
  fetchCashflowLaborRiskViaBff,
  type CashflowLaborRiskResult,
} from '../../lib/platform-bff-client';
import { shouldHighlightProjectionAmountMismatch } from './cashflow-projection-cell-style';
import { getSnappedWeekScrollLeft } from './cashflow-board-scroll';
import { buildCashflowOpsSummary, type CashflowOpsTone } from './cashflow-ops-summary';
import { stageCashflowSheetLabViaBff } from '../../lib/sheets-cashflow-readonly-client';

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toLocaleString('ko-KR')}`;
}

function formatSheetAppliedAt(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

const CASHFLOW_EDIT_LOCK_TTL_MS = 2 * 60 * 1000;

type CashflowEditLock = {
  projectId: string;
  editorUid?: string | null;
  editorName?: string | null;
  editorEmail?: string | null;
  status?: 'editing' | 'idle';
  startedAt?: number;
  updatedAt?: number;
  expiresAt?: number;
  releasedAt?: number;
  releasedByUid?: string | null;
  releaseReason?: string | null;
  lastEditedAt?: number;
  lastEditedByUid?: string | null;
  lastEditedByName?: string | null;
  lastEditedByEmail?: string | null;
};

type CashflowEventType =
  | 'sheet_apply'
  | 'projection_amount_change'
  | 'actual_amount_change'
  | 'projection_completed'
  | 'actual_completed'
  | 'admin_closed'
  | 'sheet_apply_reverted';

type CashflowEvent = {
  id?: string;
  tenantId?: string;
  projectId: string;
  runId: string;
  type: CashflowEventType;
  source?: 'manual' | 'google_sheet_apply' | 'revert';
  yearMonth?: string;
  weekNo?: number;
  mode?: 'projection' | 'actual';
  lineId?: CashflowSheetLineId;
  beforeAmount?: number;
  afterAmount?: number;
  beforeHadValue?: boolean;
  afterHadValue?: boolean;
  appliedLineCount?: number;
  projectionLineCount?: number;
  actualLineCount?: number;
  revertedRunId?: string;
  actorUid?: string;
  actorName?: string;
  actorEmail?: string;
  createdAt: string;
  revertedAt?: string;
};

function safeDocId(value: string): string {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');
}

function getUserDisplayName(user: unknown): string {
  const source = (user || {}) as { name?: unknown; displayName?: unknown; email?: unknown; uid?: unknown };
  const name = String(source.name || source.displayName || '').trim();
  if (name) return name;
  const email = String(source.email || '').trim();
  if (email) return email.split('@')[0] || email;
  return String(source.uid || '사용자');
}

function diffColorExplanation(section: '입금' | '출금', diff: number): string {
  if (diff === 0) return '차이가 없습니다.';
  if (section === '입금') {
    return diff > 0
      ? '초록색: 실제 입금이 계획보다 많습니다.'
      : '빨간색: 실제 입금이 계획보다 적습니다. 확인이 필요합니다.';
  }
  return diff > 0
    ? '빨간색: 실제 출금이 계획보다 많습니다. 확인이 필요합니다.'
    : '초록색: 실제 출금이 계획보다 적습니다.';
}

function HoverExplain({
  children,
  message,
}: {
  children: ReactNode;
  message: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-pointer underline decoration-dotted underline-offset-2">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-[11px] leading-relaxed">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

function DiffMetricCard({
  label,
  value,
  className,
  message,
}: {
  label: string;
  value: string;
  className: string;
  message: ReactNode;
}) {
  return (
    <div className="rounded-[16px] bg-white px-3 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
      <div className="text-[10px] text-slate-500">
        <HoverExplain message={message}>{label}</HoverExplain>
      </div>
      <div className={className}>{value}</div>
    </div>
  );
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '').trim().replaceAll(',', '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function formatAmountInput(raw: string): string {
  const cleaned = String(raw || '').replace(/[^\d-]/g, '');
  if (!cleaned) return '';
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return '';
  return Math.trunc(n).toLocaleString('ko-KR');
}

function hasWrittenSheetValues(values: Partial<Record<CashflowSheetLineId, unknown>> | undefined): boolean {
  if (!values) return false;
  return CASHFLOW_ALL_LINES.some((lineId) => Object.prototype.hasOwnProperty.call(values, lineId));
}

function formatSheetWeekLabel(yearMonth: string, weekNo: number): string {
  const year = Number.parseInt(yearMonth.slice(2, 4), 10);
  const month = Number.parseInt(yearMonth.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return `w${weekNo}`;
  return `${year}-${month}-${weekNo}`;
}

function formatShortWeekRange(week: Pick<MonthMondayWeek, 'weekStart' | 'weekEnd'>): string {
  if (!week.weekStart || !week.weekEnd) return '';
  return `${week.weekStart.slice(5)}~${week.weekEnd.slice(5)}`;
}

function hydrateWeekDates(week: MonthMondayWeek): MonthMondayWeek {
  if (week.weekStart && week.weekEnd) return week;
  const canonical = getMonthMondayWeeks(week.yearMonth).find((candidate) => candidate.weekNo === week.weekNo);
  return canonical ? { ...canonical, ...week, weekStart: canonical.weekStart, weekEnd: canonical.weekEnd } : week;
}

function renderCashflowLineLabel(label: string): ReactNode {
  const parenIndex = label.indexOf('(');
  if (parenIndex < 0) return label;
  const main = label.slice(0, parenIndex).trim();
  const detail = label.slice(parenIndex).trim();
  return (
    <>
      <span className="block">{main}</span>
      <span className="block text-[8px] font-normal leading-3 text-slate-500">{detail}</span>
    </>
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function parseCashflowSheetWeekLabel(value: unknown): { year: number; month: number; yearMonth: string; weekNo: number; sortKey: number } | null {
  const match = /^(\d{2})-(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = 2000 + Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return null;
  if (month < 1 || month > 12 || weekNo < 1 || weekNo > 5) return null;
  return {
    year,
    month,
    yearMonth: `${year}-${pad2(month)}`,
    weekNo,
    sortKey: year * 10000 + month * 100 + weekNo,
  };
}

function normalizeActiveSheetWeeks(raw: unknown): MonthMondayWeek[] {
  if (!Array.isArray(raw)) return [];
  const weeks: MonthMondayWeek[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as { label?: unknown; yearMonth?: unknown; weekNo?: unknown; weekStart?: unknown; weekEnd?: unknown };
    const label = String(source.label || '').trim();
    const parsedLabel = parseCashflowSheetWeekLabel(label);
    const yearMonth = String(source.yearMonth || parsedLabel?.yearMonth || '').trim();
    const weekNo = Number(source.weekNo ?? parsedLabel?.weekNo);
    if (!/^\d{4}-\d{2}$/.test(yearMonth) || !Number.isFinite(weekNo)) continue;
    const key = `${yearMonth}:${weekNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    weeks.push({
      yearMonth,
      weekNo,
      weekStart: String(source.weekStart || ''),
      weekEnd: String(source.weekEnd || ''),
      label: label || formatSheetWeekLabel(yearMonth, weekNo),
    });
  }
  return weeks.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo);
}

function isBffAuthRejection(error: unknown): boolean {
  const source = error as { status?: number; body?: { code?: string; error?: string } };
  const code = source.body?.code || source.body?.error || '';
  return source.status === 401
    || source.status === 403
    || code === 'missing_bearer_token'
    || code === 'invalid_token';
}

export function CashflowProjectSheet({
  projectId,
  roleOverride,
  onUpdateWeeklySubmissionStatus,
}: {
  projectId: string;
  roleOverride?: UserRole | string;
  initialViewMode?: 'projection' | 'actual' | 'compare';
  onUpdateWeeklySubmissionStatus?: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    projectionEdited?: boolean;
    projectionUpdated?: boolean;
    expenseEdited?: boolean;
    expenseUpdated?: boolean;
  }) => Promise<void>;
}) {
  const { user } = useAuth();
  const { db, orgId } = useFirebase();
  const navigate = useNavigate();
  const role = (roleOverride || user?.role || '').toString().toLowerCase() as UserRole | '';
  const canUseCashflowActions = Boolean(role || user);
  const canSubmitActual = canUseCashflowActions;
  const canClose = canUseCashflowActions;
  const canEdit = canUseCashflowActions;
  const todayIso = getSeoulTodayIso();
  const todayYearMonth = todayIso.slice(0, 7);
  const bffActor = useMemo(() => ({
    uid: user?.uid || 'cashflow-user',
    email: user?.email || '',
    role: user?.role || role || 'workspace_user',
    idToken: user?.idToken,
    googleAccessToken: user?.googleAccessToken,
  }), [
    role,
    user?.email,
    user?.googleAccessToken,
    user?.idToken,
    user?.role,
    user?.uid,
  ]);
  const latestBffActorRef = useRef(bffActor);
  useEffect(() => {
    latestBffActorRef.current = bffActor;
  }, [bffActor]);
  const resolveBffActor = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const currentActor = latestBffActorRef.current;
    const firebaseAuthUser = getAuthInstance()?.currentUser;
    const firebaseToken = await firebaseAuthUser?.getIdToken(Boolean(options.forceRefresh)).catch(() => undefined);
    const nextToken = firebaseToken || currentActor.idToken;
    if (!nextToken) return null;
    return {
      ...currentActor,
      idToken: nextToken,
    };
  }, []);

  const {
    yearMonth,
    weeks,
    isLoading,
    upsertWeekAmounts,
    submitWeekAsPm,
    closeWeekAsAdmin,
  } = useCashflowWeeks();

  const [cashflowSheetRange, setCashflowSheetRange] = useState<{
    startWeek: string;
    endWeek: string;
    startYearMonth: string;
    endYearMonth: string;
    label: string;
    activeWeeks: MonthMondayWeek[];
  } | null>(null);
  const [cashflowSheetConfig, setCashflowSheetConfig] = useState<{
    value?: string;
    sheetName?: string;
    spreadsheetId?: string;
    spreadsheetTitle?: string;
    startWeek?: string;
    endWeek?: string;
    lastAppliedAt?: string;
    lastAppliedBy?: { uid?: string; email?: string; role?: string } | null;
    lastAppliedLineCount?: number;
    lastProjectionLineCount?: number;
    lastActualLineCount?: number;
  } | null>(null);
  const [rangeLoadedWeeks, setRangeLoadedWeeks] = useState<CashflowWeekSheet[]>([]);
  const [laborRisk, setLaborRisk] = useState<CashflowLaborRiskResult | null>(null);
  const [laborRiskLoading, setLaborRiskLoading] = useState(false);
  const [laborRiskError, setLaborRiskError] = useState<string | null>(null);
  const [sheetRefreshLoading, setSheetRefreshLoading] = useState(false);
  const [sheetRefreshResult, setSheetRefreshResult] = useState<{
    stagedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    riskLineCount: number;
  } | null>(null);
  const [cashflowEvents, setCashflowEvents] = useState<CashflowEvent[]>([]);
  const [cashflowEventsError, setCashflowEventsError] = useState<string | null>(null);
  const [revertingRunId, setRevertingRunId] = useState<string | null>(null);
  const [editLockBusy, setEditLockBusy] = useState(false);
  const lockDocId = useMemo(() => safeDocId(projectId), [projectId]);
  const currentUserName = useMemo(() => getUserDisplayName(user), [user]);

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const selectedYear = useMemo(() => {
    const parsed = Number.parseInt(yearMonth.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  }, [yearMonth]);
  const yearWeeks = useMemo(() => getYearMondayWeeks(selectedYear), [selectedYear]);
  const sheetRangeWeeks = cashflowSheetRange?.activeWeeks || [];
  const allProjectCashflowWeeks = useMemo(() => {
    const byKey = new Map<string, CashflowWeekSheet>();
    for (const week of [...weeks, ...rangeLoadedWeeks]) {
      if (week.projectId !== projectId) continue;
      byKey.set(`${week.yearMonth}:${week.weekNo}`, week);
    }
    return Array.from(byKey.values());
  }, [projectId, rangeLoadedWeeks, weeks]);
  const annualWeeks = useMemo<MonthMondayWeek[]>(() => {
    const byKey = new Map<string, MonthMondayWeek>();
    const baseWeeks = sheetRangeWeeks.length > 0 ? sheetRangeWeeks : yearWeeks;
    const rangeStart = cashflowSheetRange ? parseCashflowSheetWeekLabel(cashflowSheetRange.startWeek) : null;
    const rangeEnd = cashflowSheetRange ? parseCashflowSheetWeekLabel(cashflowSheetRange.endWeek) : null;
    for (const week of baseWeeks) {
      byKey.set(`${week.yearMonth}:${week.weekNo}`, hydrateWeekDates(week));
    }
    for (const week of allProjectCashflowWeeks) {
      if (week.projectId !== projectId) continue;
      const weekNo = Number(week.weekNo);
      if (!Number.isFinite(weekNo)) continue;
      const parsedWeek = parseCashflowSheetWeekLabel(formatSheetWeekLabel(week.yearMonth, weekNo));
      if (rangeStart && rangeEnd) {
        if (!parsedWeek || parsedWeek.sortKey < rangeStart.sortKey || parsedWeek.sortKey > rangeEnd.sortKey) continue;
      } else if (!week.yearMonth?.startsWith(`${selectedYear}-`)) {
        continue;
      }
      const key = `${week.yearMonth}:${weekNo}`;
      if (byKey.has(key)) continue;
      byKey.set(key, hydrateWeekDates({
        yearMonth: week.yearMonth,
        weekNo,
        weekStart: week.weekStart || '',
        weekEnd: week.weekEnd || '',
        label: formatSheetWeekLabel(week.yearMonth, weekNo),
      }));
    }
    return Array.from(byKey.values())
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo);
  }, [allProjectCashflowWeeks, cashflowSheetRange, projectId, selectedYear, sheetRangeWeeks, yearWeeks]);
  const normalizedYearMonth = useMemo(() => {
    const [y, m] = yearMonth.split('-');
    if (!y || !m) return yearMonth;
    return `${y}-${m.padStart(2, '0')}`;
  }, [yearMonth]);
  const projectWeeks = useMemo(
    () => allProjectCashflowWeeks.filter((w) => {
      if (w.projectId !== projectId) return false;
      const ym = typeof w.yearMonth === 'string' ? w.yearMonth : '';
      const [yy, mm] = ym.split('-');
      const normalized = yy && mm ? `${yy}-${mm.padStart(2, '0')}` : ym;
      return normalized === normalizedYearMonth;
    }),
    [allProjectCashflowWeeks, projectId, normalizedYearMonth],
  );
  const byWeekNo = useMemo(() => {
    const map = new Map<number, CashflowWeekSheet>();
    for (const w of projectWeeks) map.set(w.weekNo, w);
    return map;
  }, [projectWeeks]);
  const byYearMonthWeek = useMemo(() => {
    const map = new Map<string, CashflowWeekSheet>();
    for (const week of allProjectCashflowWeeks) {
      if (week.projectId !== projectId) continue;
      map.set(`${week.yearMonth}:${week.weekNo}`, week);
    }
    return map;
  }, [allProjectCashflowWeeks, projectId]);
  const openingTotalsByMode = useMemo(() => {
    return computeOpeningCashflowTotals({
      weeks,
      projectId,
      yearMonth: normalizedYearMonth,
    });
  }, [normalizedYearMonth, projectId, weeks]);
  const yearOpeningTotalsByMode = useMemo(() => {
    return computeOpeningCashflowTotals({
      weeks: allProjectCashflowWeeks,
      projectId,
      yearMonth: cashflowSheetRange?.startYearMonth || `${selectedYear}-01`,
    });
  }, [allProjectCashflowWeeks, cashflowSheetRange?.startYearMonth, projectId, selectedYear]);

  const [differenceViewMode, setDifferenceViewMode] = useState<'diff' | 'all'>('diff');
  const [showEmptyCashflowRows, setShowEmptyCashflowRows] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingWeekModes, setEditingWeekModes] = useState<Record<string, boolean>>({});
  const cashflowBoardScrollRef = useRef<HTMLDivElement | null>(null);

  type WeekSaveState = 'dirty' | 'saving' | 'error' | 'saved';
  type CashflowAuditIssue = { key: string; label: string; detail: string };
  const [weekSaveState, setWeekSaveState] = useState<Record<string, WeekSaveState>>({});
  const [auditDialog, setAuditDialog] = useState<{
    title: string;
    weekLabel: string;
    issues: CashflowAuditIssue[];
  } | null>(null);

  const [submitConfirm, setSubmitConfirm] = useState<{ weekNo: number; yearMonth: string } | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [projectionCompleteWeek, setProjectionCompleteWeek] = useState<number | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeDialog, setCloseDialog] = useState<{
    kind: 'prerequisite' | 'warning' | 'confirm';
    yearMonth: string;
    weekNo: number;
    projectionDone: boolean;
    expenseDone: boolean;
    expenseStatusLabel?: string;
    expenseStatusDescription?: string;
  } | null>(null);

  const hasDirty = useMemo(
    () => hasUnsavedChanges(weekSaveState) || Object.keys(drafts).length > 0,
    [drafts, weekSaveState],
  );
  const blocker = useBlocker(hasDirty);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDirty]);

  useEffect(() => {
    if (blocker.state === 'blocked' && !hasDirty) {
      blocker.proceed();
    }
  }, [blocker, hasDirty]);

  useEffect(() => {
    setDrafts({});
    setEditingWeekModes({});
    setWeekSaveState({});
    setSubmitConfirm(null);
  }, [yearMonth, projectId]);

  const acquireCashflowEditLock = useCallback(async (): Promise<boolean> => {
    if (!db || !user?.uid || !projectId) return true;
    setEditLockBusy(true);
    const lockRef = doc(db, getOrgDocumentPath(orgId, 'cashflowEditLocks', lockDocId));
    const now = Date.now();
    let lockedBy = '다른 사용자';
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(lockRef);
        const existing = snap.exists() ? (snap.data() as CashflowEditLock) : null;
        const active = existing?.status === 'editing' && Number(existing.expiresAt || 0) > now;
        if (active && existing?.editorUid && existing.editorUid !== user.uid) {
          lockedBy = existing.editorName || existing.editorEmail || lockedBy;
          throw new Error('cashflow_edit_locked');
        }
        tx.set(lockRef, {
          projectId,
          editorUid: user.uid,
          editorName: currentUserName,
          editorEmail: user.email || '',
          status: 'editing',
          startedAt: active && existing?.editorUid === user.uid ? existing.startedAt || now : now,
          updatedAt: now,
          expiresAt: now + CASHFLOW_EDIT_LOCK_TTL_MS,
        } satisfies CashflowEditLock, { merge: true });
      });
      return true;
    } catch (error) {
      toast.error(`${lockedBy}이 수정 중입니다. 저장 후 다시 시도해 주세요.`);
      return false;
    } finally {
      setEditLockBusy(false);
    }
  }, [currentUserName, db, lockDocId, orgId, projectId, user]);

  const releaseCashflowEditLock = useCallback(async (reason: 'save' | 'leave' | 'cancel' = 'save'): Promise<void> => {
    if (!db || !user?.uid || !projectId) return;
    const lockRef = doc(db, getOrgDocumentPath(orgId, 'cashflowEditLocks', lockDocId));
    const now = Date.now();
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(lockRef);
      if (!snap.exists()) return;
      const existing = snap.data() as CashflowEditLock;
      if (existing.editorUid !== user.uid) return;
      tx.set(lockRef, {
        projectId,
        status: 'idle',
        editorUid: null,
        editorName: null,
        editorEmail: null,
        updatedAt: now,
        expiresAt: now,
        releasedAt: now,
        releasedByUid: user.uid,
        releaseReason: reason,
        lastEditedAt: reason === 'save' ? now : existing.lastEditedAt || null,
        lastEditedByUid: reason === 'save' ? user.uid : existing.lastEditedByUid || null,
        lastEditedByName: reason === 'save' ? currentUserName : existing.lastEditedByName || null,
        lastEditedByEmail: reason === 'save' ? user.email || '' : existing.lastEditedByEmail || null,
      } satisfies CashflowEditLock, { merge: true });
    });
  }, [currentUserName, db, lockDocId, orgId, projectId, user]);

  useEffect(() => {
    if (!db || !projectId) {
      setCashflowSheetRange(null);
      setCashflowSheetConfig(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, getOrgDocumentPath(orgId, 'projects', projectId)))
      .then((snap) => {
        if (cancelled) return;
        const config = snap.exists()
          ? (snap.data() as { cashflowSheetLab?: { value?: string; sheetName?: string; spreadsheetId?: string; spreadsheetTitle?: string; startWeek?: string; endWeek?: string; activeWeeks?: unknown; lastAppliedAt?: string; lastAppliedBy?: { uid?: string; email?: string; role?: string } | null; lastAppliedLineCount?: number; lastProjectionLineCount?: number; lastActualLineCount?: number } }).cashflowSheetLab
          : null;
        setCashflowSheetConfig(config?.value ? {
          value: config.value,
          sheetName: config.sheetName,
          spreadsheetId: config.spreadsheetId,
          spreadsheetTitle: config.spreadsheetTitle,
          startWeek: config.startWeek,
          endWeek: config.endWeek,
          lastAppliedAt: config.lastAppliedAt,
          lastAppliedBy: config.lastAppliedBy,
          lastAppliedLineCount: config.lastAppliedLineCount,
          lastProjectionLineCount: config.lastProjectionLineCount,
          lastActualLineCount: config.lastActualLineCount,
        } : null);
        const start = parseCashflowSheetWeekLabel(config?.startWeek);
        const end = parseCashflowSheetWeekLabel(config?.endWeek);
        const activeWeeks = normalizeActiveSheetWeeks(config?.activeWeeks);
        if (!start || !end || start.sortKey > end.sortKey || activeWeeks.length === 0) {
          setCashflowSheetRange(null);
          return;
        }
        setCashflowSheetRange({
          startWeek: config?.startWeek || '',
          endWeek: config?.endWeek || '',
          startYearMonth: start.yearMonth,
          endYearMonth: end.yearMonth,
          label: `${config?.startWeek} ~ ${config?.endWeek}`,
          activeWeeks,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCashflowSheetRange(null);
          setCashflowSheetConfig(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, orgId, projectId]);

  const loadCashflowSheetRangeWeeks = useCallback(async (): Promise<void> => {
    if (!db || !cashflowSheetRange) {
      setRangeLoadedWeeks([]);
      return;
    }
    const base = collection(db, getOrgCollectionPath(orgId, 'cashflowWeeks'));
    const q = query(
      base,
      where('yearMonth', '>=', cashflowSheetRange.startYearMonth),
      where('yearMonth', '<=', cashflowSheetRange.endYearMonth),
      limit(5000),
    );
    const snap = await getDocs(q);
    setRangeLoadedWeeks(
      snap.docs
        .map((d) => d.data() as CashflowWeekSheet)
        .filter((week) => week.projectId === projectId),
    );
  }, [cashflowSheetRange, db, orgId, projectId]);

  useEffect(() => {
    let cancelled = false;
    loadCashflowSheetRangeWeeks().catch(() => {
      if (!cancelled) setRangeLoadedWeeks([]);
    });
    return () => {
      cancelled = true;
    };
  }, [loadCashflowSheetRangeWeeks]);

  const loadCashflowEvents = useCallback(async (): Promise<void> => {
    if (!db || !projectId) {
      setCashflowEvents([]);
      setCashflowEventsError(null);
      return;
    }
    const base = collection(db, getOrgCollectionPath(orgId, 'cashflowEvents'));
    const targetProjectId = String(projectId || '').trim();
    const readCashflowEventsSnapshot = async (filterByProject: boolean): Promise<CashflowEvent[]> => {
      const snap = await getDocs(filterByProject
        ? query(base, where('projectId', '==', projectId), limit(200))
        : query(base, limit(500)));
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CashflowEvent, 'id'>) }))
        .filter((event) => String(event.projectId || '').trim() === targetProjectId)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 200);
    };

    try {
      let events = await readCashflowEventsSnapshot(true);
      if (events.length === 0) events = await readCashflowEventsSnapshot(false);
      setCashflowEvents(events);
      setCashflowEventsError(null);
    } catch (error) {
      try {
        const events = await readCashflowEventsSnapshot(false);
        setCashflowEvents(events);
        setCashflowEventsError(null);
      } catch {
        setCashflowEvents([]);
        setCashflowEventsError(resolveApiErrorMessage(error, '변경 이력을 불러오지 못했습니다.'));
      }
    }
  }, [db, orgId, projectId]);

  useEffect(() => {
    let cancelled = false;
    loadCashflowEvents().catch((error) => {
      if (!cancelled) {
        setCashflowEvents([]);
        setCashflowEventsError(resolveApiErrorMessage(error, '변경 이력을 불러오지 못했습니다.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadCashflowEvents]);

  const handleRefreshLaborRisk = useCallback(async (): Promise<void> => {
    if (!projectId || !orgId || !user?.uid) {
      setLaborRisk(null);
      setLaborRiskError('로그인 세션이 만료되었습니다. 저장/검토 동작에서 로그인을 먼저 진행해 주세요.');
      return;
    }
    setLaborRiskLoading(true);
    setLaborRiskError(null);
    try {
      const resolvedActor = await resolveBffActor();
      if (!resolvedActor?.idToken) {
        setLaborRisk(null);
        setLaborRiskError('로그인 세션이 만료되었습니다. 저장/검토 동작에서 로그인을 먼저 진행해 주세요.');
        return;
      }

      let result: CashflowLaborRiskResult;
      try {
        result = await fetchCashflowLaborRiskViaBff({
          tenantId: orgId,
          actor: resolvedActor,
          projectId,
        });
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        const refreshedActor = await resolveBffActor({ forceRefresh: true });
        if (!refreshedActor?.idToken) throw error;
        result = await fetchCashflowLaborRiskViaBff({
          tenantId: orgId,
          actor: refreshedActor,
          projectId,
        });
      }
      setLaborRisk(result);
    } catch (error) {
      setLaborRisk(null);
      setLaborRiskError(resolveApiErrorMessage(error, '인건비/잔액 체크를 불러오지 못했습니다.'));
    } finally {
      setLaborRiskLoading(false);
    }
  }, [orgId, projectId, resolveBffActor, user?.uid]);

  useEffect(() => {
    setLaborRisk(null);
    setLaborRiskError(null);
    if (!projectId || !orgId || !user?.uid) {
      setLaborRiskLoading(false);
      return;
    }
    void handleRefreshLaborRisk();
  }, [handleRefreshLaborRisk, orgId, projectId, user?.uid]);

  const handleRefreshSheetValues = useCallback(async (): Promise<void> => {
    if (!cashflowSheetConfig?.value) {
      toast.error('연결된 Google Sheet가 없습니다.');
      return;
    }
    const apply = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => {
      const idempotencyKey = `cashflow-sheet-refresh:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      return stageCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        value: cashflowSheetConfig.value,
        sheetName: cashflowSheetConfig.sheetName || undefined,
        startWeek: cashflowSheetConfig.startWeek || undefined,
        endWeek: cashflowSheetConfig.endWeek || undefined,
        idempotencyKey,
      });
    };
    const rememberResult = (result: Awaited<ReturnType<typeof apply>>) => {
      setSheetRefreshResult({
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
      });
    };
    setSheetRefreshLoading(true);
    setSheetRefreshResult(null);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      const result = await apply(actor);
      await loadCashflowSheetRangeWeeks();
      await loadCashflowEvents();
      rememberResult(result);
      toast.success('시트 변경 후보를 만들었습니다.');
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          const result = await apply(actor);
          await loadCashflowSheetRangeWeeks();
          await loadCashflowEvents();
          rememberResult(result);
          toast.success('시트 변경 후보를 만들었습니다.');
          return;
        } catch (retryError) {
          toast.error(resolveApiErrorMessage(retryError, '시트 변경 후보를 만들지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '시트 변경 후보를 만들지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetConfig, loadCashflowEvents, loadCashflowSheetRangeWeeks, orgId, projectId, resolveBffActor]);

  const handleRevertCashflowRun = useCallback(async (runId: string): Promise<void> => {
    if (!db || !user?.uid) {
      toast.error('로그인 세션이 만료되었습니다.');
      return;
    }
    const runEvents = cashflowEvents.filter((event) => event.runId === runId);
    const amountEvents = runEvents.filter((event) => (
      event.source === 'google_sheet_apply'
      && !event.revertedAt
      && (event.type === 'projection_amount_change' || event.type === 'actual_amount_change')
      && event.yearMonth
      && event.weekNo
      && event.mode
      && event.lineId
    ));
    if (amountEvents.length === 0) {
      toast.info('되돌릴 금액 변경이 없습니다.');
      return;
    }
    if (!window.confirm(`이 시트 반영의 금액 변경 ${amountEvents.length}건을 이전 값으로 되돌릴까요?`)) return;

    setRevertingRunId(runId);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const byWeek = new Map<string, CashflowEvent[]>();
      for (const event of amountEvents) {
        const key = `${event.yearMonth}:w${event.weekNo}`;
        byWeek.set(key, [...(byWeek.get(key) || []), event]);
      }

      for (const [key, events] of byWeek) {
        const [targetYearMonth, rawWeekNo] = key.split(':w');
        const weekNo = Number(rawWeekNo);
        const ref = doc(db, getOrgDocumentPath(orgId, 'cashflowWeeks', `${projectId}-${targetYearMonth}-w${weekNo}`));
        const snap = await getDoc(ref);
        const current = snap.exists() ? (snap.data() as CashflowWeekSheet) : undefined;
        const nextProjection = { ...(current?.projection || {}) };
        const nextActual = { ...(current?.actual || {}) };
        let touchedProjection = false;
        let touchedActual = false;

        for (const event of events) {
          const target = event.mode === 'projection' ? nextProjection : nextActual;
          if (!event.beforeHadValue) {
            delete target[event.lineId as CashflowSheetLineId];
          } else {
            target[event.lineId as CashflowSheetLineId] = Number(event.beforeAmount || 0);
          }
          touchedProjection = touchedProjection || event.mode === 'projection';
          touchedActual = touchedActual || event.mode === 'actual';
        }

        batch.set(ref, {
          ...(touchedProjection ? { projection: nextProjection, projectionTotals: computeCashflowTotals(nextProjection) } : {}),
          ...(touchedActual ? { actual: nextActual, actualTotals: computeCashflowTotals(nextActual) } : {}),
          updatedAt: now,
          updatedByUid: user.uid,
          updatedByName: getUserDisplayName(user),
          tenantId: orgId,
        } as Partial<CashflowWeekSheet> as any, { merge: true });
      }

      for (const event of runEvents) {
        if (!event.id) continue;
        batch.set(doc(db, getOrgDocumentPath(orgId, 'cashflowEvents', event.id)), {
          revertedAt: now,
          revertedByUid: user.uid,
          revertedByName: getUserDisplayName(user),
        }, { merge: true });
      }
      const revertId = safeDocId(`cashflow-revert:${runId}:${now}`);
      batch.set(doc(db, getOrgDocumentPath(orgId, 'cashflowEvents', revertId)), {
        id: revertId,
        tenantId: orgId,
        projectId,
        runId: `cashflow-revert:${runId}:${now}`,
        revertedRunId: runId,
        type: 'sheet_apply_reverted',
        source: 'revert',
        actorUid: user.uid,
        actorName: getUserDisplayName(user),
        actorEmail: user.email || '',
        createdAt: now,
      } as CashflowEvent);

      await batch.commit();
      await loadCashflowSheetRangeWeeks();
      await loadCashflowEvents();
      toast.success('시트 반영 이전 값으로 되돌렸습니다.');
    } catch (error) {
      toast.error('되돌리기에 실패했습니다. 네트워크/권한을 확인해 주세요.');
    } finally {
      setRevertingRunId(null);
    }
  }, [cashflowEvents, db, loadCashflowEvents, loadCashflowSheetRangeWeeks, orgId, projectId, user]);

  const weekMeta = useMemo(() => {
    const map: Record<number, { projectionUpdated: boolean; pmSubmitted: boolean; adminClosed: boolean }> = {};
    for (const def of monthWeeks) {
      const doc = byWeekNo.get(def.weekNo);
      map[def.weekNo] = {
        projectionUpdated: Boolean(doc?.projectionUpdated),
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
      map[def.weekNo] = hasWrittenSheetValues(doc?.actual);
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

  function isWeekModeEditing(params: { yearMonth: string; mode: 'projection' | 'actual'; weekNo: number }): boolean {
    return editingWeekModes[resolveWeekKey(params)] === true;
  }

  function setWeekModeEditing(params: { yearMonth: string; mode: 'projection' | 'actual'; weekNo: number; editing: boolean }) {
    const key = resolveWeekKey(params);
    setEditingWeekModes((prev) => ({ ...prev, [key]: params.editing }));
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

  function getWeekLabel(weekNo: number, targetYearMonth = yearMonth): string {
    return annualWeeks.find((week) => week.yearMonth === targetYearMonth && week.weekNo === weekNo)?.label
      || monthWeeks.find((week) => week.weekNo === weekNo)?.label
      || `w${weekNo}`;
  }

  function isAuditSettledWeek(weekNo: number, targetYearMonth = yearMonth): boolean {
    const week = annualWeeks.find((candidate) => candidate.yearMonth === targetYearMonth && candidate.weekNo === weekNo)
      || monthWeeks.find((candidate) => candidate.weekNo === weekNo);
    return Boolean(week && week.weekEnd <= todayIso);
  }

  function readAuditedCell(params: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    lineId: CashflowSheetLineId;
    overrideMode?: 'projection' | 'actual';
    overrideAmounts?: Partial<Record<CashflowSheetLineId, number>>;
  }): { amount: number; hasValue: boolean } {
    if (
      params.overrideMode === params.mode
      && params.overrideAmounts
      && Object.prototype.hasOwnProperty.call(params.overrideAmounts, params.lineId)
    ) {
      return { amount: Number(params.overrideAmounts[params.lineId] || 0), hasValue: true };
    }

    const targetYearMonth = params.yearMonth || yearMonth;
    const key = resolveCellKey({ yearMonth: targetYearMonth, mode: params.mode, weekNo: params.weekNo, lineId: params.lineId });
    if (Object.prototype.hasOwnProperty.call(drafts, key)) {
      const raw = drafts[key];
      if (raw.trim() === '') return { amount: 0, hasValue: false };
      return { amount: parseAmount(raw), hasValue: true };
    }

    return getPersistedCell({ doc: byYearMonthWeek.get(`${targetYearMonth}:${params.weekNo}`), mode: params.mode, lineId: params.lineId });
  }

  function addAuditIssue(
    issuesByKey: Map<string, CashflowAuditIssue>,
    issue: CashflowAuditIssue,
  ): void {
    if (!issuesByKey.has(issue.key)) issuesByKey.set(issue.key, issue);
  }

  function prepareAuditedWeekAmounts(input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }): {
    amounts: Partial<Record<CashflowSheetLineId, number>>;
    issues: CashflowAuditIssue[];
  } {
    const issuesByKey = new Map<string, CashflowAuditIssue>();
    const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
    const targetYearMonth = input.yearMonth || yearMonth;

    for (const lineId of CASHFLOW_ALL_LINES) {
      const key = resolveCellKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
      const hasDraft = Object.prototype.hasOwnProperty.call(drafts, key);
      const persisted = getPersistedCell({ doc: byYearMonthWeek.get(`${targetYearMonth}:${input.weekNo}`), mode: input.mode, lineId });

      if (hasDraft && drafts[key].trim() === '') {
        addAuditIssue(issuesByKey, {
          key: `${input.mode}:${lineId}:missing`,
          label: CASHFLOW_SHEET_LINE_LABELS[lineId],
          detail: `${input.mode === 'projection' ? 'Projection' : 'Actual'} 입력값이 비어 있습니다. 0원인 경우 0을 입력해 주세요.`,
        });
        continue;
      }

      if (hasDraft) {
        amounts[lineId] = parseAmount(drafts[key]);
      } else if (persisted.hasValue) {
        amounts[lineId] = persisted.amount;
      }
    }

    return { amounts, issues: Array.from(issuesByKey.values()) };
  }

  function collectAuditIssues(input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    amounts: Partial<Record<CashflowSheetLineId, number>>;
  }): CashflowAuditIssue[] {
    const issuesByKey = new Map<string, CashflowAuditIssue>();
    const targetYearMonth = input.yearMonth || yearMonth;

    for (const issue of prepareAuditedWeekAmounts({ yearMonth: targetYearMonth, weekNo: input.weekNo, mode: input.mode }).issues) {
      addAuditIssue(issuesByKey, issue);
    }

    if (!isAuditSettledWeek(input.weekNo, targetYearMonth)) return Array.from(issuesByKey.values());

    for (const lineId of CASHFLOW_ALL_LINES) {
      const projection = readAuditedCell({
        yearMonth: targetYearMonth,
        weekNo: input.weekNo,
        mode: 'projection',
        lineId,
        overrideMode: input.mode,
        overrideAmounts: input.amounts,
      });
      const actual = readAuditedCell({
        yearMonth: targetYearMonth,
        weekNo: input.weekNo,
        mode: 'actual',
        lineId,
        overrideMode: input.mode,
        overrideAmounts: input.amounts,
      });

      if (projection.hasValue && actual.hasValue && projection.amount !== actual.amount) {
        addAuditIssue(issuesByKey, {
          key: `settled:${lineId}:mismatch`,
          label: CASHFLOW_SHEET_LINE_LABELS[lineId],
          detail: `과거 주차는 Projection ${fmt(projection.amount)} / Actual ${fmt(actual.amount)}로 같아야 합니다.`,
        });
      }
    }

    return Array.from(issuesByKey.values());
  }

  function showAuditBlock(title: string, weekNo: number, issues: CashflowAuditIssue[], targetYearMonth = yearMonth): void {
    setAuditDialog({ title, weekLabel: getWeekLabel(weekNo, targetYearMonth), issues });
    toast.error('감사 필수값을 먼저 확인해 주세요.');
  }

  function getEffectiveAmount(params: {
    yearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    const doc = byWeekNo.get(params.weekNo);
    const persisted = getPersistedCell({ doc, mode: params.mode, lineId: params.lineId });
    const key = resolveCellKey(params);
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    return raw !== undefined ? parseAmount(raw) : persisted.amount;
  }

  function getPersistedYearAmount(params: {
    yearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    const doc = byYearMonthWeek.get(`${params.yearMonth}:${params.weekNo}`);
    return getPersistedCell({ doc, mode: params.mode, lineId: params.lineId }).amount;
  }

  const derivedByMode = useMemo(() => {
    function compute(mode: 'projection' | 'actual') {
      const openingIn = mode === 'projection' ? openingTotalsByMode.projectionIn : openingTotalsByMode.actualIn;
      const openingOut = mode === 'projection' ? openingTotalsByMode.projectionOut : openingTotalsByMode.actualOut;
      return computeCashflowDerivedTotals({
        openingIn,
        openingOut,
        weeks: monthWeeks.map((def) => ({
          weekNo: def.weekNo,
          amounts: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
            lineId,
            getEffectiveAmount({ yearMonth, mode, weekNo: def.weekNo, lineId }),
          ])) as Partial<Record<CashflowSheetLineId, number>>,
        })),
      });
    }

    return {
      projection: compute('projection'),
      actual: compute('actual'),
    };
  }, [drafts, getEffectiveAmount, monthWeeks, openingTotalsByMode, yearMonth]);

  const annualDerivedByMode = useMemo(() => {
    function compute(mode: 'projection' | 'actual') {
      const openingIn = mode === 'projection' ? yearOpeningTotalsByMode.projectionIn : yearOpeningTotalsByMode.actualIn;
      const openingOut = mode === 'projection' ? yearOpeningTotalsByMode.projectionOut : yearOpeningTotalsByMode.actualOut;
      return computeCashflowDerivedTotals({
        openingIn,
        openingOut,
        weeks: annualWeeks.map((def) => ({
          weekNo: def.weekNo,
          amounts: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
            lineId,
            getPersistedYearAmount({ yearMonth: def.yearMonth, mode, weekNo: def.weekNo, lineId }),
          ])) as Partial<Record<CashflowSheetLineId, number>>,
        })),
      });
    }

    return {
      projection: compute('projection'),
      actual: compute('actual'),
    };
  }, [annualWeeks, getPersistedYearAmount, yearOpeningTotalsByMode]);

  const projectionActualDiff = useMemo(() => {
    const rows = [
      ...CASHFLOW_IN_LINES.map((lineId) => ({ section: '입금' as const, lineId })),
      ...CASHFLOW_OUT_LINES.map((lineId) => ({ section: '출금' as const, lineId })),
    ].flatMap(({ section, lineId }) => monthWeeks.map((week) => {
      const projection = getEffectiveAmount({ yearMonth, mode: 'projection', weekNo: week.weekNo, lineId });
      const actual = getEffectiveAmount({ yearMonth, mode: 'actual', weekNo: week.weekNo, lineId });
      return {
        section,
        lineId,
        label: CASHFLOW_SHEET_LINE_LABELS[lineId],
        weekNo: week.weekNo,
        weekLabel: week.label,
        weekRange: `${week.weekStart} ~ ${week.weekEnd}`,
        projection,
        actual,
        diff: actual - projection,
      };
    }));
    const incomeDiff = rows
      .filter((row) => row.section === '입금')
      .reduce((sum, row) => sum + row.diff, 0);
    const expenseDiff = rows
      .filter((row) => row.section === '출금')
      .reduce((sum, row) => sum + row.diff, 0);
    const changedRows = rows.filter((row) => row.diff !== 0);
    return {
      rows,
      changedRows,
      incomeDiff,
      expenseDiff,
      netDiff: incomeDiff - expenseDiff,
    };
  }, [getEffectiveAmount, monthWeeks, yearMonth]);

  const projectionActualYearDiff = useMemo(() => {
    const lineDefs = [
      ...CASHFLOW_IN_LINES.map((lineId) => ({ section: '입금' as const, lineId })),
      ...CASHFLOW_OUT_LINES.map((lineId) => ({ section: '출금' as const, lineId })),
    ];
    const rows = lineDefs.map(({ section, lineId }) => {
      const cells = annualWeeks.map((week) => {
        const projection = getPersistedYearAmount({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo, lineId });
        const actual = getPersistedYearAmount({ yearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo, lineId });
        return {
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
          weekLabel: week.label,
          weekRange: week.weekStart && week.weekEnd ? `${week.weekStart} ~ ${week.weekEnd}` : '',
          projection,
          actual,
          diff: actual - projection,
        };
      });
      return {
        section,
        lineId,
        label: CASHFLOW_SHEET_LINE_LABELS[lineId],
        cells,
        changed: cells.some((cell) => cell.diff !== 0),
      };
    });
    const incomeDiff = rows
      .filter((row) => row.section === '입금')
      .flatMap((row) => row.cells)
      .reduce((sum, cell) => sum + cell.diff, 0);
    const expenseDiff = rows
      .filter((row) => row.section === '출금')
      .flatMap((row) => row.cells)
      .reduce((sum, cell) => sum + cell.diff, 0);
    const changedCellCount = rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.diff !== 0).length, 0);
    return {
      rows,
      changedRows: rows.filter((row) => row.changed),
      incomeDiff,
      expenseDiff,
      netDiff: incomeDiff - expenseDiff,
      changedCellCount,
    };
  }, [annualWeeks, getPersistedYearAmount]);

  const cashflowTotalPeriodLabel = cashflowSheetRange?.label || `${selectedYear}년`;

  const opsSummary = useMemo(() => {
    return buildCashflowOpsSummary({
      asOfDate: todayIso,
      weeks: annualWeeks.map((week) => {
        const doc = byYearMonthWeek.get(`${week.yearMonth}:${week.weekNo}`);
        const projectionHasValue = hasWrittenSheetValues(doc?.projection);
        const actualHasValue = hasWrittenSheetValues(doc?.actual);
        return {
          key: `${week.yearMonth}:${week.weekNo}`,
          label: week.label,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          projectionWritten: Boolean(doc?.projectionUpdated || projectionHasValue),
          actualWritten: Boolean(doc?.pmSubmitted || actualHasValue),
          adminClosed: Boolean(doc?.adminClosed),
          updatedAt: doc?.updatedAt,
          updatedByName: doc?.updatedByName,
          projectionUpdatedAt: doc?.projectionUpdatedAt,
          projectionUpdatedByName: doc?.projectionUpdatedByName,
          pmSubmittedAt: doc?.pmSubmittedAt,
          pmSubmittedByName: doc?.pmSubmittedByName,
          adminClosedAt: doc?.adminClosedAt,
          adminClosedByName: doc?.adminClosedByName,
        };
      }),
      diffCellCount: projectionActualYearDiff.changedCellCount,
      labor: {
        nextMonthProjectionWritten: laborRisk ? laborRisk.labor.nextMonthProjection.isWritten : true,
        missingProjectionMonthCount: laborRisk ? laborRisk.labor.missingProjectionMonths.length : 0,
        shortageStatus: laborRisk ? laborRisk.shortage.status : 'ok',
        shortageWeekLabel: laborRisk?.shortage.week?.label || null,
        shortageAmount: laborRisk?.shortage.shortageAmount || 0,
      },
    });
  }, [annualWeeks, byYearMonthWeek, laborRisk, projectionActualYearDiff.changedCellCount, todayIso]);

  const flushWeek = useCallback(async (input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    silent?: boolean;
  }): Promise<void> => {
    if (input.mode === 'actual') return;
    const targetYearMonth = input.yearMonth || yearMonth;
    const wkKey = resolveWeekKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo });
    const doc = byYearMonthWeek.get(`${targetYearMonth}:${input.weekNo}`);

    const rawByLine: Partial<Record<CashflowSheetLineId, string>> = {};
    const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
    for (const lineId of CASHFLOW_ALL_LINES) {
      const cellKey = resolveCellKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
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

    const hasAnyDrafts = Object.keys(rawByLine).length > 0;
    if (!hasAnyDrafts) return;

    if (Object.keys(amounts).length === 0) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of Object.keys(rawByLine) as CashflowSheetLineId[]) {
          const key = resolveCellKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
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
        yearMonth: targetYearMonth,
        weekNo: input.weekNo,
        mode: input.mode,
        amounts,
      });
      if (onUpdateWeeklySubmissionStatus) {
        await onUpdateWeeklySubmissionStatus({
          projectId,
          yearMonth: targetYearMonth,
          weekNo: input.weekNo,
          ...(input.mode === 'projection'
            ? { projectionEdited: true, projectionUpdated: true }
            : { expenseEdited: true, expenseUpdated: true }),
        });
      }
      await loadCashflowEvents();

      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of Object.keys(rawByLine) as CashflowSheetLineId[]) {
          const key = resolveCellKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo, lineId });
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
  }, [byYearMonthWeek, canEdit, drafts, loadCashflowEvents, onUpdateWeeklySubmissionStatus, projectId, resolveCellKey, resolveWeekKey, upsertWeekAmounts, yearMonth]);

  const markDirty = useCallback((input: { yearMonth?: string; weekNo: number; mode: 'projection' | 'actual' }) => {
    const wkKey = resolveWeekKey({ yearMonth: input.yearMonth || yearMonth, mode: input.mode, weekNo: input.weekNo });
    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'dirty' }));
  }, [resolveWeekKey, yearMonth]);

  const persistWeekValues = useCallback(async (input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }): Promise<void> => {
    if (input.mode === 'actual') return;

    const targetYearMonth = input.yearMonth || yearMonth;
    const wkKey = resolveWeekKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo });
    const { amounts, issues: preparedIssues } = prepareAuditedWeekAmounts({ ...input, yearMonth: targetYearMonth });
    const auditIssues = [
      ...preparedIssues,
      ...collectAuditIssues({ ...input, yearMonth: targetYearMonth, amounts })
        .filter((issue) => !preparedIssues.some((prepared) => prepared.key === issue.key)),
    ];

    if (auditIssues.length > 0) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'error' }));
      showAuditBlock('저장 전에 확인이 필요합니다', input.weekNo, auditIssues, targetYearMonth);
      throw new Error('cashflow_audit_validation_failed');
    }

    if (Object.keys(amounts).length === 0) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
      return;
    }

    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saving' }));
    try {
      await upsertWeekAmounts({
        projectId,
        yearMonth: targetYearMonth,
        weekNo: input.weekNo,
        mode: input.mode,
        amounts,
      });
      if (onUpdateWeeklySubmissionStatus) {
        await onUpdateWeeklySubmissionStatus({
          projectId,
          yearMonth: targetYearMonth,
          weekNo: input.weekNo,
          ...(input.mode === 'projection'
            ? { projectionEdited: true, projectionUpdated: true }
            : { expenseEdited: true, expenseUpdated: true }),
        });
      }
      await loadCashflowEvents();
      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of CASHFLOW_ALL_LINES) {
          delete next[resolveCellKey({ yearMonth: targetYearMonth, mode: input.mode, weekNo: input.weekNo, lineId })];
        }
        return next;
      });
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'saved' }));
    } catch (error) {
      setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'error' }));
      throw error;
    }
  }, [
    byYearMonthWeek,
    canEdit,
    drafts,
    loadCashflowEvents,
    onUpdateWeeklySubmissionStatus,
    projectId,
    resolveCellKey,
    resolveWeekKey,
    upsertWeekAmounts,
    yearMonth,
  ]);

  const handleSaveWeekValues = useCallback((input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }) => {
    if (input.mode === 'actual') {
      toast.info('Actual 금액은 사용내역 연동값이라 화면에서 수정하지 않습니다.');
      return;
    }
    void persistWeekValues(input)
      .then(() => toast.success('저장했습니다.'))
      .catch((error) => {
        if (error instanceof Error && error.message === 'cashflow_audit_validation_failed') return;
        toast.error('저장에 실패했습니다. 네트워크/권한을 확인해 주세요.');
      });
  }, [persistWeekValues]);

  const handleSaveBoardWeekValues = useCallback((input: {
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }) => {
    if (input.mode === 'actual') {
      toast.info('Actual 금액은 사용내역 연동값이라 화면에서 수정하지 않습니다.');
      return;
    }
    void persistWeekValues(input)
      .then(() => {
        setEditingWeekModes((prev) => ({
          ...prev,
          [resolveWeekKey(input)]: false,
        }));
        toast.success('저장했습니다.');
      })
      .catch((error) => {
        if (error instanceof Error && error.message === 'cashflow_audit_validation_failed') return;
        toast.error('저장에 실패했습니다. 네트워크/권한을 확인해 주세요.');
      });
  }, [persistWeekValues, resolveWeekKey]);

  const handleSubmitWeek = useCallback(async (input: { weekNo: number; yearMonth: string }) => {
    setSubmitBusy(true);
    try {
      await submitWeekAsPm({ projectId, yearMonth: input.yearMonth, weekNo: input.weekNo });
      await loadCashflowEvents();
      toast.success('작성완료 처리했습니다.');
    } catch (e) {
      toast.error('작성완료 처리에 실패했습니다.');
    } finally {
      setSubmitBusy(false);
      setSubmitConfirm(null);
    }
  }, [loadCashflowEvents, projectId, submitWeekAsPm]);

  const handleCompleteProjectionWeek = useCallback((weekNo: number, targetYearMonth = yearMonth) => {
    if (!canEdit) return;

    void (async () => {
      setProjectionCompleteWeek(weekNo);
      const { amounts, issues: preparedIssues } = prepareAuditedWeekAmounts({ yearMonth: targetYearMonth, weekNo, mode: 'projection' });
      const auditIssues = [
        ...preparedIssues,
        ...collectAuditIssues({ yearMonth: targetYearMonth, weekNo, mode: 'projection', amounts })
          .filter((issue) => !preparedIssues.some((prepared) => prepared.key === issue.key)),
      ];
      if (auditIssues.length > 0) {
        setWeekSaveState((prev) => ({ ...prev, [resolveWeekKey({ yearMonth: targetYearMonth, mode: 'projection', weekNo })]: 'error' }));
        showAuditBlock('작성완료 전에 확인이 필요합니다', weekNo, auditIssues, targetYearMonth);
        return;
      }

      await upsertWeekAmounts({
        projectId,
        yearMonth: targetYearMonth,
        weekNo,
        mode: 'projection',
        amounts,
        markCompleted: true,
      });

      if (onUpdateWeeklySubmissionStatus) {
        await onUpdateWeeklySubmissionStatus({
          projectId,
          yearMonth: targetYearMonth,
          weekNo,
          projectionEdited: true,
          projectionUpdated: true,
        });
      }
      await loadCashflowEvents();

      setDrafts((prev) => {
        const next = { ...prev };
        for (const lineId of CASHFLOW_ALL_LINES) {
          delete next[resolveCellKey({ yearMonth: targetYearMonth, mode: 'projection', weekNo, lineId })];
        }
        return next;
      });
      setWeekSaveState((prev) => {
        const next = { ...prev };
        delete next[resolveWeekKey({ yearMonth: targetYearMonth, mode: 'projection', weekNo })];
        return next;
      });
      toast.success('주차 Projection을 작성완료 처리했습니다.');
    })().catch(() => {
      toast.error('작성완료 처리에 실패했습니다. 네트워크/권한을 확인해 주세요.');
    }).finally(() => {
      setProjectionCompleteWeek((prev) => (prev === weekNo ? null : prev));
    });
  }, [
    canEdit,
    getEffectiveAmount,
    onUpdateWeeklySubmissionStatus,
    loadCashflowEvents,
    projectId,
    resolveCellKey,
    resolveWeekKey,
    upsertWeekAmounts,
    yearMonth,
  ]);

  const handleCloseWeek = useCallback(async (weekNo: number, targetYearMonth = yearMonth) => {
    setCloseBusy(true);
    try {
      await persistWeekValues({ yearMonth: targetYearMonth, weekNo, mode: 'projection' });
      await closeWeekAsAdmin({ projectId, yearMonth: targetYearMonth, weekNo });
      await loadCashflowEvents();
      toast.success('결산완료 처리했습니다.');
    } catch (e) {
      toast.error('결산완료 처리에 실패했습니다.');
    } finally {
      setCloseBusy(false);
      setCloseDialog(null);
    }
  }, [closeWeekAsAdmin, loadCashflowEvents, persistWeekValues, projectId, yearMonth]);

  const handleStartCloseWeek = useCallback(async (weekNo: number) => {
    if (!db) {
      setCloseDialog({
        kind: 'confirm',
        yearMonth,
        weekNo,
        projectionDone: true,
        expenseDone: true,
      });
      return;
    }

    try {
      const statusId = `${projectId}-${yearMonth}-w${weekNo}`;
      const statusRef = doc(db, getOrgDocumentPath(orgId, 'weeklySubmissionStatus', statusId));
      const snap = await getDoc(statusRef);
      const status = snap.exists() ? (snap.data() as WeeklySubmissionStatus) : undefined;
      const accountingState = resolveWeeklyAccountingState(status, byWeekNo.get(weekNo));

      setCloseDialog({
        kind: accountingState.closeDialogKind,
        yearMonth,
        weekNo,
        projectionDone: accountingState.projectionDone,
        expenseDone: accountingState.expenseDone,
        expenseStatusLabel: accountingState.expenseStatusLabel,
        expenseStatusDescription: accountingState.expenseStatusDescription,
      });
    } catch {
      toast.error('결산 전 제출현황을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [db, orgId, projectId, yearMonth]);

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

  function diffTextClass(diff: number): string {
    return diff === 0 ? 'text-slate-400' : 'text-slate-800';
  }

  function getBoardEffectiveAmount(params: {
    targetYearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    const doc = byYearMonthWeek.get(`${params.targetYearMonth}:${params.weekNo}`);
    const persisted = getPersistedCell({ doc, mode: params.mode, lineId: params.lineId });
    const key = resolveCellKey({
      yearMonth: params.targetYearMonth,
      mode: params.mode,
      weekNo: params.weekNo,
      lineId: params.lineId,
    });
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    return raw !== undefined ? parseAmount(raw) : persisted.amount;
  }

  function renderProjectionCell(input: {
    targetYearMonth: string;
    weekNo: number;
    lineId: CashflowSheetLineId;
    isThisWeek: boolean;
  }) {
    const projectionDoc = byYearMonthWeek.get(`${input.targetYearMonth}:${input.weekNo}`);
    const persisted = getPersistedCell({ doc: projectionDoc, mode: 'projection', lineId: input.lineId });
    const key = resolveCellKey({ yearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    const projectionValue = raw !== undefined ? raw : (persisted.hasValue ? formatAmountInput(String(persisted.amount)) : '');
    const projection = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const actual = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'actual', weekNo: input.weekNo, lineId: input.lineId });
    const diff = actual - projection;
    const shouldHighlightMismatch = shouldHighlightProjectionAmountMismatch({ projection, actual });
    const isEditing = isWeekModeEditing({ yearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo }) || raw !== undefined;
    const bgClass = input.isThisWeek ? 'bg-blue-50/70' : 'bg-white';
    const isCollapsedEmpty = !showEmptyCashflowRows && !isEditing && projection === 0 && actual === 0 && diff === 0 && raw === undefined;

    return (
      <td key={`${input.lineId}-${input.targetYearMonth}-${input.weekNo}-p`} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${bgClass}`}>
        {isCollapsedEmpty ? (
          <div className="py-0.5 text-center text-[9px] text-slate-300">-</div>
        ) : isEditing ? (
          <Input
            value={projectionValue}
            inputMode="numeric"
            className={`h-6 rounded-lg border-slate-200 bg-white px-1.5 py-0 text-right text-[8px] tabular-nums shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-visible:ring-1 focus-visible:ring-blue-400 ${shouldHighlightMismatch ? 'font-semibold text-rose-700' : 'text-slate-900'}`}
            placeholder="0"
            disabled={!canEdit}
            onChange={(e) => {
              const formatted = formatAmountInput(e.target.value);
              setDrafts((prev) => ({ ...prev, [key]: formatted }));
              markDirty({ yearMonth: input.targetYearMonth, weekNo: input.weekNo, mode: 'projection' });
            }}
          />
        ) : (
          <div className={`h-5 rounded-md px-1 text-right text-[8px] leading-5 tabular-nums ${shouldHighlightMismatch ? 'font-semibold text-rose-700' : 'text-slate-900'}`}>
            {fmt(projection)}
          </div>
        )}
      </td>
    );
  }

  function renderActualCell(input: {
    targetYearMonth: string;
    weekNo: number;
    lineId: CashflowSheetLineId;
    isThisWeek: boolean;
  }) {
    const actualDoc = byYearMonthWeek.get(`${input.targetYearMonth}:${input.weekNo}`);
    const persisted = getPersistedCell({ doc: actualDoc, mode: 'actual', lineId: input.lineId });
    const projection = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const actual = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'actual', weekNo: input.weekNo, lineId: input.lineId });
    const diff = actual - projection;
    const bgClass = input.isThisWeek ? 'bg-blue-50/80' : 'bg-slate-50/80';
    const isCollapsedEmpty = !showEmptyCashflowRows && projection === 0 && actual === 0 && diff === 0 && !persisted.hasValue;

    return (
      <td key={`${input.lineId}-${input.targetYearMonth}-${input.weekNo}-a`} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${bgClass}`}>
        {isCollapsedEmpty ? (
          <div className="py-0.5 text-center text-[9px] text-slate-300">-</div>
        ) : (
          <div className="h-5 px-1 text-right text-[8px] leading-5 tabular-nums text-slate-700">
            {fmt(actual)}
          </div>
        )}
      </td>
    );
  }

  function renderSummaryCell(input: {
    keyName: string;
    value: number;
    mode: 'projection' | 'actual';
    isThisWeek?: boolean;
    emphasis?: 'income' | 'expense' | 'balance';
    stickyRight?: boolean;
    rowTone?: 'income' | 'expense';
  }) {
    const bgClass = input.rowTone === 'income'
      ? (input.mode === 'actual' ? 'bg-emerald-50/70' : 'bg-emerald-50')
      : input.rowTone === 'expense'
        ? (input.mode === 'actual' ? 'bg-rose-50/70' : 'bg-rose-50')
        : input.mode === 'actual'
          ? (input.isThisWeek ? 'bg-blue-50/80' : 'bg-slate-50/80')
          : (input.isThisWeek ? 'bg-blue-50/70' : 'bg-white');
    const valueClass = input.emphasis === 'income'
      ? 'text-emerald-800'
      : input.emphasis === 'expense'
        ? 'text-rose-800'
        : 'text-slate-950';
    return (
      <td key={input.keyName} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${input.stickyRight ? 'sticky right-0 z-20 shadow-[-12px_0_24px_rgba(15,23,42,0.08)]' : ''} ${bgClass}`}>
        <div className="flex items-center justify-end gap-1 text-[8px] leading-4">
          <span className={`font-semibold tabular-nums ${input.mode === 'actual' ? 'text-slate-700' : valueClass}`}>
            {fmt(input.value)}
          </span>
        </div>
      </td>
    );
  }

  function renderUnifiedMonthlyBoard() {
    const visibleWeeks = annualWeeks;
    function computeBoardDerived(mode: 'projection' | 'actual') {
      const openingIn = mode === 'projection' ? yearOpeningTotalsByMode.projectionIn : yearOpeningTotalsByMode.actualIn;
      const openingOut = mode === 'projection' ? yearOpeningTotalsByMode.projectionOut : yearOpeningTotalsByMode.actualOut;
      return computeCashflowDerivedTotals({
        openingIn,
        openingOut,
        weeks: visibleWeeks.map((def) => ({
          weekNo: def.weekNo,
          amounts: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
            lineId,
            getBoardEffectiveAmount({ targetYearMonth: def.yearMonth, mode, weekNo: def.weekNo, lineId }),
          ])) as Partial<Record<CashflowSheetLineId, number>>,
        })),
      });
    }
    const projection = computeBoardDerived('projection');
    const actual = computeBoardDerived('actual');
    const projectionWeeksByKey = new Map(projection.weekTotals.map((week, index) => [`${annualWeeks[index]?.yearMonth}:${annualWeeks[index]?.weekNo}`, week]));
    const actualWeeksByKey = new Map(actual.weekTotals.map((week, index) => [`${annualWeeks[index]?.yearMonth}:${annualWeeks[index]?.weekNo}`, week]));
    const weekCount = visibleWeeks.length;
    const scrollBoard = (direction: -1 | 1) => {
      const container = cashflowBoardScrollRef.current;
      if (!container) return;
      const weekColumn = container.querySelector<HTMLElement>('[data-cashflow-week-column="true"]');
      const weekWidth = weekColumn?.getBoundingClientRect().width || 84;
      const targetLeft = getSnappedWeekScrollLeft({
        currentLeft: container.scrollLeft,
        direction,
        viewportWidth: container.clientWidth,
        maxScrollLeft: container.scrollWidth - container.clientWidth,
        weekWidth,
      });
      container.scrollTo({
        left: targetLeft,
        behavior: 'smooth',
      });
    };
    const dirtyBoardWeeks = visibleWeeks.filter((week) => (
      weekSaveState[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })] === 'dirty'
    ));
    const boardIsEditing = visibleWeeks.some((week) => (
      isWeekModeEditing({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })
    ));
    const setBoardEditing = (editing: boolean) => {
      setShowEmptyCashflowRows((prev) => (editing ? true : prev));
      setEditingWeekModes((prev) => {
        const next = { ...prev };
        for (const week of visibleWeeks) {
          next[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })] = editing;
          next[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo })] = false;
        }
        return next;
      });
    };
    const startBoardEditing = () => {
      void acquireCashflowEditLock().then((locked) => {
        if (!locked) return;
        setBoardEditing(true);
      });
    };
    const saveBoardDrafts = async () => {
      for (const week of visibleWeeks) {
        await flushWeek({ yearMonth: week.yearMonth, weekNo: week.weekNo, mode: 'projection', silent: true });
      }
      setBoardEditing(false);
      await releaseCashflowEditLock('save');
    };
    const saveBoard = () => {
      void saveBoardDrafts()
        .then(() => toast.success('저장했습니다.'))
        .catch(() => toast.error('저장에 실패했습니다. 네트워크/권한을 확인해 주세요.'));
    };
    const settleWeek = (week: MonthMondayWeek) => {
      void (async () => {
        await saveBoardDrafts();
        const issues: CashflowAuditIssue[] = [];
        for (const lineId of CASHFLOW_ALL_LINES) {
          const projectionAmount = getBoardEffectiveAmount({ targetYearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo, lineId });
          const actualAmount = getBoardEffectiveAmount({ targetYearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo, lineId });
          if (projectionAmount !== actualAmount) {
            issues.push({
              key: `${week.yearMonth}:${week.weekNo}:${lineId}:settle-mismatch`,
              label: CASHFLOW_SHEET_LINE_LABELS[lineId],
              detail: `결산 시 Projection ${fmt(projectionAmount)} / Actual ${fmt(actualAmount)}로 같아야 합니다.`,
            });
          }
        }
        if (issues.length > 0) {
          showAuditBlock('결산 전에 Projection/Actual 확인이 필요합니다', week.weekNo, issues, week.yearMonth);
          return;
        }
        setCloseDialog({
          kind: 'confirm',
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
          projectionDone: true,
          expenseDone: true,
        });
      })().catch((error) => {
        if (error instanceof Error && error.message === 'cashflow_audit_validation_failed') return;
        toast.error('결산 확인에 실패했습니다.');
      });
    };
    const renderLineRows = (
      lineIds: CashflowSheetLineId[],
      sectionTone: 'income' | 'expense',
    ) => lineIds.flatMap((lineId) => {
      const sectionLabelToneClass = sectionTone === 'income'
        ? 'bg-emerald-50/80 border-l-[3px] border-l-emerald-400'
        : 'bg-rose-50/80 border-l-[3px] border-l-rose-400';
      const projectionRow = (
        <tr key={`${lineId}-projection`} className="border-t border-white">
          <td rowSpan={2} className={`sticky left-0 z-20 w-[132px] min-w-[132px] border-r-[6px] border-r-white px-2.5 py-1.5 text-[8px] font-semibold leading-4 text-slate-900 ${sectionLabelToneClass}`}>
            <div className="flex items-start">
              <span>{renderCashflowLineLabel(CASHFLOW_SHEET_LINE_LABELS[lineId])}</span>
            </div>
          </td>
          <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-white px-1 py-1 text-[8px] font-semibold text-slate-700">
            Projection
          </td>
          {visibleWeeks.map((week) => {
            const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
            return renderProjectionCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek });
          })}
          {renderSummaryCell({
            keyName: `${lineId}-range-total-projection`,
            value: projection.rowTotals[lineId] || 0,
            mode: 'projection',
            stickyRight: true,
          })}
        </tr>
      );
      const actualRow = (
        <tr key={`${lineId}-actual`} className="border-t border-white">
          <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-slate-100/80 px-1 py-1 text-[8px] font-semibold text-slate-500">
            Actual
          </td>
          {visibleWeeks.map((week) => {
            const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
            return renderActualCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek });
          })}
          {renderSummaryCell({
            keyName: `${lineId}-range-total-actual`,
            value: actual.rowTotals[lineId] || 0,
            mode: 'actual',
            stickyRight: true,
          })}
        </tr>
      );
      return [projectionRow, actualRow];
    });

    return (
      <Card className="overflow-hidden rounded-[24px] border-0 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-b from-white to-slate-50/70 px-5 py-4">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">캐시플로 진단시트</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                <span>기준 범위 {cashflowTotalPeriodLabel} · 항목별 Projection 입력 / Actual 확인</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"><Pencil className="h-3 w-3" />전체 수정</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"><Save className="h-3 w-3" />전체 저장</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"><CheckCircle2 className="h-3 w-3" />주차별 결산</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"><ChevronLeft className="h-3 w-3" /><ChevronRight className="h-3 w-3" />주차 이동</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={boardIsEditing ? 'default' : 'outline'}
                className="h-8 rounded-full px-3 text-[11px] shadow-sm"
                onClick={startBoardEditing}
                disabled={!canEdit || boardIsEditing || editLockBusy}
                title="수정"
              >
                {editLockBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Pencil className="mr-1 h-3 w-3" />}
                수정
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-full border-0 bg-white px-3 text-[11px] shadow-sm"
                onClick={saveBoard}
                disabled={!canEdit || (!boardIsEditing && dirtyBoardWeeks.length === 0)}
              >
                <Save className="mr-1 h-3 w-3" />
                저장
              </Button>
              <Badge variant="outline" className="rounded-full border-0 bg-white px-2.5 py-1 text-[10px] text-slate-600 shadow-sm">
                {weekCount.toLocaleString()}주
              </Badge>
            </div>
          </div>

          <div className="relative bg-slate-50/80 px-4 pb-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute left-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)] backdrop-blur"
              onClick={() => scrollBoard(-1)}
              aria-label="왼쪽 주차로 이동"
              title="왼쪽 주차로 이동"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute right-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)] backdrop-blur"
              onClick={() => scrollBoard(1)}
              aria-label="오른쪽 주차로 이동"
              title="오른쪽 주차로 이동"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          <div ref={cashflowBoardScrollRef} className="overflow-x-auto scroll-smooth rounded-[20px] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.55)]">
            <table className="w-full border-separate border-spacing-0 text-[8px]" style={{ minWidth: `${192 + weekCount * 84 + 84}px` }}>
              <thead className="sticky top-0 z-40 bg-white/95 text-slate-600 backdrop-blur shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                <tr>
                  <th className="sticky left-0 z-50 w-[132px] min-w-[132px] border-r-[6px] border-r-white bg-white px-2 py-2 text-left text-[11px] font-bold text-slate-800">
                    항목
                  </th>
                  <th className="sticky left-[132px] z-50 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-white px-1 py-2 text-left text-[11px] font-bold text-slate-800">
                    구분
                  </th>
                  {visibleWeeks.map((week) => {
                    const projectionWeekKey = resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo });
                    const actualWeekKey = resolveWeekKey({ yearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo });
                    const projectionSaveState = weekSaveState[projectionWeekKey];
                    const actualSaveState = weekSaveState[actualWeekKey];
                    const isSavingWeek = projectionSaveState === 'saving' || actualSaveState === 'saving';
                    const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
                    const doc = byYearMonthWeek.get(`${week.yearMonth}:${week.weekNo}`);
                    return (
                      <th key={`${week.yearMonth}-${week.weekNo}`} data-cashflow-week-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-2 text-left align-top font-semibold ${isThisWeek ? 'bg-blue-50/90' : 'bg-slate-50/80'}`}>
                        <div className="flex min-h-[72px] flex-col gap-0.5">
                          <div className="relative min-h-5 leading-4">
                            <span className="block truncate text-center text-[10px] font-bold leading-5 text-slate-800">{week.label}</span>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="absolute right-0 top-0 h-5 w-5 shrink-0 rounded-full border-0 bg-white/95 p-0 shadow-sm"
                                onClick={() => settleWeek(week)}
                                disabled={closeBusy}
                                aria-label={`${week.label} 결산`}
                                title={`${week.label} 결산`}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          <div className="truncate text-center text-[8px] font-normal text-slate-400">{week.weekStart && week.weekEnd ? `${week.weekStart.slice(5)}~${week.weekEnd.slice(5)}` : '-'}</div>
                          <div className="grid gap-0.5">
                            {doc?.projectionUpdated ? (
                              <Badge className="h-3.5 w-full justify-center rounded-full border-0 bg-white px-1 text-[7px] text-slate-700 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">Prj 작성</Badge>
                            ) : (
                              <Badge className="h-3.5 w-full justify-center rounded-full border-0 bg-rose-100 px-1 text-[7px] text-rose-700">Prj 미작성</Badge>
                            )}
                            {doc?.pmSubmitted || hasWrittenSheetValues(doc?.actual) ? (
                              <Badge className="h-3.5 w-full justify-center rounded-full border-0 bg-white px-1 text-[7px] text-slate-700 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">Act 작성</Badge>
                            ) : (
                              <Badge className="h-3.5 w-full justify-center rounded-full border-0 bg-rose-100 px-1 text-[7px] text-rose-700">Act 미작성</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-0.5">
                          {projectionSaveState === 'dirty' && (
                            <Badge className="h-3.5 rounded-full border-0 bg-sky-100 px-1 text-[7px] text-sky-700">Prj 미저장</Badge>
                          )}
                          {actualSaveState === 'dirty' && (
                            <Badge className="h-3.5 rounded-full border-0 bg-sky-100 px-1 text-[7px] text-sky-700">Act 미저장</Badge>
                          )}
                          {isSavingWeek && (
                            <Badge className="h-3.5 rounded-full border-0 bg-slate-200 px-1 text-[7px] text-slate-600">저장중</Badge>
                          )}
                          {(projectionSaveState === 'error' || actualSaveState === 'error') && (
                            <Badge className="h-3.5 rounded-full border-0 bg-rose-100 px-1 text-[7px] text-rose-700">오류</Badge>
                          )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-50 min-w-[84px] border-l-[6px] border-l-white bg-white px-1 py-2 text-left align-top text-[11px] font-bold text-slate-800 shadow-[-12px_0_24px_rgba(15,23,42,0.08)]">
                    범위 합계
                  </th>
                </tr>
              </thead>
              <tbody>
                {renderLineRows(CASHFLOW_IN_LINES, 'income')}
                <tr className="border-t-[6px] border-white bg-emerald-50/80">
                  <td rowSpan={2} className="sticky left-0 z-20 w-[132px] min-w-[132px] border-r-[6px] border-r-white bg-emerald-50 px-2.5 py-1.5 text-[8px] font-bold text-emerald-950">입금 합계</td>
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-emerald-50 px-1 py-1 text-[8px] font-semibold text-emerald-900">Projection</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `total-in-${week.yearMonth}-${week.weekNo}-projection`,
                    value: projectionWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.totalIn || 0,
                    mode: 'projection',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'income',
                    rowTone: 'income',
                  }))}
                  {renderSummaryCell({
                    keyName: 'total-in-range-projection',
                    value: projection.monthTotals.totalIn,
                    mode: 'projection',
                    emphasis: 'income',
                    stickyRight: true,
                    rowTone: 'income',
                  })}
                </tr>
                <tr className="border-t border-white bg-emerald-50/50">
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-emerald-50/70 px-1 py-1 text-[8px] font-semibold text-emerald-900">Actual</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `total-in-${week.yearMonth}-${week.weekNo}-actual`,
                    value: actualWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.totalIn || 0,
                    mode: 'actual',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'income',
                    rowTone: 'income',
                  }))}
                  {renderSummaryCell({
                    keyName: 'total-in-range-actual',
                    value: actual.monthTotals.totalIn,
                    mode: 'actual',
                    emphasis: 'income',
                    stickyRight: true,
                    rowTone: 'income',
                  })}
                </tr>

                {renderLineRows(CASHFLOW_OUT_LINES, 'expense')}
                <tr className="border-t-[6px] border-white bg-rose-50/80">
                  <td rowSpan={2} className="sticky left-0 z-20 w-[132px] min-w-[132px] border-r-[6px] border-r-white bg-rose-50 px-2.5 py-1.5 text-[8px] font-bold text-rose-950">출금 합계</td>
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-rose-50 px-1 py-1 text-[8px] font-semibold text-rose-900">Projection</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `total-out-${week.yearMonth}-${week.weekNo}-projection`,
                    value: projectionWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.totalOut || 0,
                    mode: 'projection',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'expense',
                    rowTone: 'expense',
                  }))}
                  {renderSummaryCell({
                    keyName: 'total-out-range-projection',
                    value: projection.monthTotals.totalOut,
                    mode: 'projection',
                    emphasis: 'expense',
                    stickyRight: true,
                    rowTone: 'expense',
                  })}
                </tr>
                <tr className="border-t border-white bg-rose-50/50">
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-rose-50/70 px-1 py-1 text-[8px] font-semibold text-rose-900">Actual</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `total-out-${week.yearMonth}-${week.weekNo}-actual`,
                    value: actualWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.totalOut || 0,
                    mode: 'actual',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'expense',
                    rowTone: 'expense',
                  }))}
                  {renderSummaryCell({
                    keyName: 'total-out-range-actual',
                    value: actual.monthTotals.totalOut,
                    mode: 'actual',
                    emphasis: 'expense',
                    stickyRight: true,
                    rowTone: 'expense',
                  })}
                </tr>

                <tr className="border-t-[6px] border-white bg-slate-100/90">
                  <td rowSpan={2} className="sticky left-0 z-20 w-[132px] min-w-[132px] border-r-[6px] border-r-white bg-slate-100 px-2.5 py-1.5 text-[8px] font-bold text-slate-950">잔액</td>
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-white px-1 py-1 text-[8px] font-semibold text-slate-700">Projection</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `net-${week.yearMonth}-${week.weekNo}-projection`,
                    value: projectionWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.net || 0,
                    mode: 'projection',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'balance',
                  }))}
                  {renderSummaryCell({
                    keyName: 'net-range-projection',
                    value: projection.monthTotals.net,
                    mode: 'projection',
                    emphasis: 'balance',
                    stickyRight: true,
                  })}
                </tr>
                <tr className="border-t border-white bg-slate-100/90">
                  <td className="sticky left-[132px] z-10 w-[60px] min-w-[60px] border-r-[6px] border-r-white bg-slate-100 px-1 py-1 text-[8px] font-semibold text-slate-600">Actual</td>
                  {visibleWeeks.map((week) => renderSummaryCell({
                    keyName: `net-${week.yearMonth}-${week.weekNo}-actual`,
                    value: actualWeeksByKey.get(`${week.yearMonth}:${week.weekNo}`)?.net || 0,
                    mode: 'actual',
                    isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
                    emphasis: 'balance',
                  }))}
                  {renderSummaryCell({
                    keyName: 'net-range-actual',
                    value: actual.monthTotals.net,
                    mode: 'actual',
                    emphasis: 'balance',
                    stickyRight: true,
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          </div>
          {isLoading && (
            <div className="px-3 py-2 text-[11px] text-slate-500">불러오는 중...</div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderSheetTable(tableMode: 'projection' | 'actual', compact = false) {
    const derived = tableMode === 'projection' ? derivedByMode.projection : derivedByMode.actual;
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className={`${compact ? 'min-w-[760px]' : 'min-w-[860px]'} w-full text-[11px]`}>
              <thead>
                <tr className="bg-muted/30">
                  <th className={`${compact ? 'px-3' : 'px-4'} py-2 text-left`} style={{ fontWeight: 700, minWidth: compact ? 150 : 180 }}>항목</th>
                  {monthWeeks.map((w) => {
                    const wkKey = resolveWeekKey({ yearMonth, mode: tableMode, weekNo: w.weekNo });
                    const saveState = weekSaveState[wkKey];
                    const doc = byWeekNo.get(w.weekNo);
                    const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                    const colClass = isThisWeek ? 'bg-teal-50/40 dark:bg-teal-950/10' : '';

                    return (
                      <th key={w.weekNo} className={`px-3 py-2 text-right ${colClass}`} style={{ fontWeight: 700, minWidth: compact ? 112 : 150 }}>
                        <div className="flex items-center justify-end gap-2">
                          <span>{w.label}</span>
                          {weekMeta[w.weekNo]?.adminClosed ? (
                            <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">결산</Badge>
                          ) : tableMode === 'projection' ? (
                            weekMeta[w.weekNo]?.projectionUpdated ? (
                              <Badge className="h-4 px-1 text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0">작성</Badge>
                            ) : (
                              <Badge className="h-4 px-1 text-[9px] bg-slate-500/10 text-slate-600 dark:text-slate-300 border-0">미작성</Badge>
                            )
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
	                          {tableMode === 'projection' && canEdit && (
	                            <Button
	                              size="sm"
	                              variant="outline"
	                              className="h-7 text-[10px] gap-1"
	                              onClick={() => handleSaveWeekValues({ weekNo: w.weekNo, mode: tableMode })}
	                              disabled={saveState === 'saving'}
	                              aria-label="저장"
	                              title="저장"
	                            >
	                              {saveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />}
	                              {!compact && '저장'}
	                            </Button>
	                          )}
	                          {tableMode === 'projection' && canEdit && (
	                            <Button
	                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => handleCompleteProjectionWeek(w.weekNo)}
                              disabled={projectionCompleteWeek === w.weekNo}
                              aria-label="작성완료"
                              title="작성완료"
                            >
                              {projectionCompleteWeek === w.weekNo ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                              {!compact && '작성완료'}
                            </Button>
                          )}
                          {tableMode === 'actual' && !weekMeta[w.weekNo]?.pmSubmitted && canSubmitActual && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => setSubmitConfirm({ weekNo: w.weekNo, yearMonth })}
                              aria-label="작성완료"
                              title="작성완료"
                            >
                              <CheckCircle2 className="w-3 h-3" /> {!compact && '작성완료'}
                            </Button>
                          )}
                          {tableMode === 'projection' && !weekMeta[w.weekNo]?.adminClosed && canClose && (
                            <Button
                              size="sm"
                              className="h-7 text-[10px] gap-1"
                              onClick={() => void handleStartCloseWeek(w.weekNo)}
                              style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
                              aria-label="결산"
                              title="결산"
                            >
                              <CheckCircle2 className="w-3 h-3" /> {!compact && '결산'}
                            </Button>
                          )}
                        </div>
                        {doc?.adminClosed && (
                          <div className="mt-1 text-[9px] text-muted-foreground">결산완료 이후에도 Projection 수정은 가능합니다.</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right" style={{ fontWeight: 700, minWidth: compact ? 100 : 120 }}>월 합계</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-emerald-50/40 dark:bg-emerald-950/10">
                  <td className="px-4 py-2" colSpan={monthWeeks.length + 2} style={{ fontWeight: 700 }}>
                    입금 ({tableMode === 'projection' ? 'Projection' : 'Actual'})
                  </td>
                </tr>
                {CASHFLOW_IN_LINES.map((lineId) => (
                  <tr key={lineId} className="border-t border-border/30">
                    <td className={`${compact ? 'px-3' : 'px-4'} py-1.5 text-[10px] whitespace-nowrap`} style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                    {monthWeeks.map((w) => {
                      const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                      const colClass = isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : '';

                      if (tableMode === 'actual') {
                        const amount = getEffectiveAmount({ yearMonth, mode: 'actual', weekNo: w.weekNo, lineId });
                        return (
                          <td key={w.weekNo} className={`px-3 py-2 h-9 align-middle text-right text-slate-600 ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(amount)}
                          </td>
                        );
                      }

                      const doc = byWeekNo.get(w.weekNo);
                      const persisted = getPersistedCell({ doc, mode: tableMode, lineId });
                      const key = resolveCellKey({ yearMonth, mode: tableMode, weekNo: w.weekNo, lineId });
                      const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
                      const value = raw !== undefined ? raw : (persisted.hasValue ? formatAmountInput(String(persisted.amount)) : '');

                      return (
                        <td key={w.weekNo} className={`px-3 h-9 align-middle text-right ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <Input
                            value={value}
                            inputMode="numeric"
                            className="h-6 text-[10px] md:text-[10px] leading-[10px] font-normal text-right px-1 py-0 bg-transparent border-transparent focus-visible:ring-0 focus-visible:border-teal-500/60"
                            placeholder="0"
                            disabled={false}
                            onChange={(e) => {
                              const formatted = formatAmountInput(e.target.value);
                              setDrafts((prev) => ({ ...prev, [key]: formatted }));
                              markDirty({ weekNo: w.weekNo, mode: tableMode });
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border/50 bg-muted/40">
                  <td className="px-4 py-1.5 text-[10px]" style={{ fontWeight: 800 }}>입금 합계</td>
                  {derived.weekTotals.map((w) => (
                    <td key={w.weekNo} className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 800, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(w.totalIn)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 900, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>
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
                    <td className={`${compact ? 'px-3' : 'px-4'} py-1.5 text-[10px] whitespace-nowrap`} style={{ fontWeight: 500 }}>{CASHFLOW_SHEET_LINE_LABELS[lineId]}</td>
                    {monthWeeks.map((w) => {
                      const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                      const colClass = isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : '';

                      if (tableMode === 'actual') {
                        const amount = getEffectiveAmount({ yearMonth, mode: 'actual', weekNo: w.weekNo, lineId });
                        return (
                          <td key={w.weekNo} className={`px-3 py-2 h-9 align-middle text-right text-slate-600 ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(amount)}
                          </td>
                        );
                      }

                      const doc = byWeekNo.get(w.weekNo);
                      const persisted = getPersistedCell({ doc, mode: tableMode, lineId });
                      const key = resolveCellKey({ yearMonth, mode: tableMode, weekNo: w.weekNo, lineId });
                      const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
                      const value = raw !== undefined ? raw : (persisted.hasValue ? formatAmountInput(String(persisted.amount)) : '');

                      return (
                        <td key={w.weekNo} className={`px-3 h-9 align-middle text-right ${colClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <Input
                            value={value}
                            inputMode="numeric"
                            className="h-6 text-[10px] md:text-[10px] leading-[10px] font-normal text-right px-1 py-0 bg-transparent border-transparent focus-visible:ring-0 focus-visible:border-teal-500/60"
                            placeholder="0"
                            disabled={false}
                            onChange={(e) => {
                              const formatted = formatAmountInput(e.target.value);
                              setDrafts((prev) => ({ ...prev, [key]: formatted }));
                              markDirty({ weekNo: w.weekNo, mode: tableMode });
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}

                <tr className="border-t border-border/30 bg-muted/40">
                  <td className="px-4 py-1.5 text-[10px]" style={{ fontWeight: 800 }}>출금 합계</td>
                  {derived.weekTotals.map((w) => (
                    <td key={w.weekNo} className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 800, color: '#e11d48', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(w.totalOut)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 pr-2 h-9 align-middle text-right text-[10px]" style={{ fontWeight: 900, color: '#e11d48', fontVariantNumeric: 'tabular-nums' }}>
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

  function renderAnnualSheetMatrix(tableMode: 'projection' | 'actual') {
    const derived = tableMode === 'projection' ? annualDerivedByMode.projection : annualDerivedByMode.actual;
    const tone = tableMode === 'projection' ? 'text-slate-950' : 'text-slate-950';
    return (
      <Card className="overflow-hidden rounded-[20px] border-0 bg-slate-50/80 shadow-none">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <h3 className="text-[13px] font-semibold text-slate-950">
              저장된 {tableMode === 'projection' ? 'Projection' : 'Actual'}
            </h3>
            <span className="text-[11px] text-slate-500">기준 범위 {cashflowTotalPeriodLabel} · {annualWeeks.length.toLocaleString()}주</span>
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse text-[11px]" style={{ minWidth: `${220 + annualWeeks.length * 96}px` }}>
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="sticky left-0 z-20 w-[220px] min-w-[220px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium">
                    항목
                  </th>
                  {annualWeeks.map((week) => (
                    <th key={`${tableMode}-${week.yearMonth}-${week.weekNo}`} className="min-w-[96px] border-l border-slate-100 px-2 py-2 text-right font-medium">
                      <div>{week.label}</div>
                      {formatShortWeekRange(week) ? (
                        <div className="text-[9px] font-normal text-slate-400">{formatShortWeekRange(week)}</div>
                      ) : null}
                    </th>
                  ))}
                  <th className="min-w-[104px] border-l border-slate-200 px-2 py-2 text-right font-medium">범위 합계</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-emerald-50 text-emerald-900">
                  <td colSpan={annualWeeks.length + 2} className="px-3 py-2 font-semibold">입금</td>
                </tr>
                {CASHFLOW_IN_LINES.map((lineId) => (
                  <tr key={`${tableMode}-${lineId}`} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-white px-3 py-2 text-slate-900">
                      {CASHFLOW_SHEET_LINE_LABELS[lineId]}
                    </td>
                    {annualWeeks.map((week) => {
                      const amount = getPersistedYearAmount({ yearMonth: week.yearMonth, mode: tableMode, weekNo: week.weekNo, lineId });
                      return (
                        <td
                          key={`${tableMode}-${lineId}-${week.yearMonth}-${week.weekNo}`}
                          className={`min-w-[96px] border-l border-slate-100 px-2 py-2 text-right tabular-nums ${amount === 0 ? 'text-slate-300' : tone}`}
                        >
                          {fmt(amount)}
                        </td>
                      );
                    })}
                    <td className="min-w-[104px] border-l border-slate-200 px-2 py-2 text-right font-semibold tabular-nums">
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-emerald-50/70 font-semibold text-emerald-950">
                  <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-emerald-50 px-3 py-2">입금 합계</td>
                  {derived.weekTotals.map((week, index) => (
                    <td key={`${tableMode}-year-total-in-${index}`} className="min-w-[96px] border-l border-slate-100 px-2 py-2 text-right tabular-nums">
                      {fmt(week.totalIn)}
                    </td>
                  ))}
                  <td className="min-w-[104px] border-l border-slate-200 px-2 py-2 text-right tabular-nums">
                    {fmt(derived.monthTotals.totalIn)}
                  </td>
                </tr>
                <tr className="bg-rose-50 text-rose-900">
                  <td colSpan={annualWeeks.length + 2} className="px-3 py-2 font-semibold">출금</td>
                </tr>
                {CASHFLOW_OUT_LINES.map((lineId) => (
                  <tr key={`${tableMode}-${lineId}`} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-white px-3 py-2 text-slate-900">
                      {CASHFLOW_SHEET_LINE_LABELS[lineId]}
                    </td>
                    {annualWeeks.map((week) => {
                      const amount = getPersistedYearAmount({ yearMonth: week.yearMonth, mode: tableMode, weekNo: week.weekNo, lineId });
                      return (
                        <td
                          key={`${tableMode}-${lineId}-${week.yearMonth}-${week.weekNo}`}
                          className={`min-w-[96px] border-l border-slate-100 px-2 py-2 text-right tabular-nums ${amount === 0 ? 'text-slate-300' : tone}`}
                        >
                          {fmt(amount)}
                        </td>
                      );
                    })}
                    <td className="min-w-[104px] border-l border-slate-200 px-2 py-2 text-right font-semibold tabular-nums">
                      {fmt(derived.rowTotals[lineId] || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-rose-50/70 font-semibold text-rose-950">
                  <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-rose-50 px-3 py-2">출금 합계</td>
                  {derived.weekTotals.map((week, index) => (
                    <td key={`${tableMode}-year-total-out-${index}`} className="min-w-[96px] border-l border-slate-100 px-2 py-2 text-right tabular-nums">
                      {fmt(week.totalOut)}
                    </td>
                  ))}
                  <td className="min-w-[104px] border-l border-slate-200 px-2 py-2 text-right tabular-nums">
                    {fmt(derived.monthTotals.totalOut)}
                  </td>
                </tr>
                <tr className="border-t border-slate-300 bg-slate-100 font-semibold text-slate-950">
                  <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-slate-100 px-3 py-2">잔액</td>
                  {derived.weekTotals.map((week, index) => (
                    <td
                      key={`${tableMode}-year-balance-${index}`}
                      className={`min-w-[96px] border-l border-slate-200 px-2 py-2 text-right tabular-nums ${week.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {fmt(week.net)}
                    </td>
                  ))}
                  <td className={`min-w-[104px] border-l border-slate-200 px-2 py-2 text-right tabular-nums ${derived.monthTotals.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {fmt(derived.monthTotals.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderProjectionActualDiffTable() {
    const rows = differenceViewMode === 'diff' ? projectionActualDiff.changedRows : projectionActualDiff.rows;
    const yearRows = differenceViewMode === 'diff' ? projectionActualYearDiff.changedRows : projectionActualYearDiff.rows;
    return (
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-slate-950">
                <HoverExplain
                  message={
                    <span>
                      Projection은 계획값, Actual은 실적값입니다. 모든 차이는 Actual에서 Projection을 뺀 값으로 표시합니다.
                    </span>
                  }
                >
                  Projection / Actual 차이
                </HoverExplain>
              </div>
              <div className="text-[10px] text-slate-500">
                기준 범위 {cashflowTotalPeriodLabel} ·{' '}
                <HoverExplain
                  message={
                    <span>
                      차이 = Actual - Projection. 입금은 실제가 계획보다 많으면 초록색, 적으면 빨간색입니다. 출금은 실제가 계획보다 적으면 초록색, 많으면 빨간색입니다.
                    </span>
                  }
                >
                  차이 = Actual - Projection
                </HoverExplain>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={differenceViewMode === 'diff' ? 'default' : 'outline'}
                className="h-8 rounded-full px-3 text-[11px]"
                onClick={() => setDifferenceViewMode('diff')}
              >
                차이만
              </Button>
              <Button
                type="button"
                size="sm"
                variant={differenceViewMode === 'all' ? 'default' : 'outline'}
                className="h-8 rounded-full px-3 text-[11px]"
                onClick={() => setDifferenceViewMode('all')}
              >
                전체
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <DiffMetricCard
              label="입금 차이"
              value={fmtSigned(projectionActualYearDiff.incomeDiff)}
              className={projectionActualYearDiff.incomeDiff === 0 ? 'text-[13px] font-semibold text-slate-700' : 'text-[13px] font-semibold text-emerald-700'}
              message="기준 범위 전체의 입금 Actual - Projection 합계입니다. +는 Actual 입금이 Projection보다 큼, -는 Actual 입금이 Projection보다 작음을 의미합니다."
            />
            <DiffMetricCard
              label="출금 차이"
              value={fmtSigned(projectionActualYearDiff.expenseDiff)}
              className={projectionActualYearDiff.expenseDiff === 0 ? 'text-[13px] font-semibold text-slate-700' : 'text-[13px] font-semibold text-rose-700'}
              message="기준 범위 전체의 출금 Actual - Projection 합계입니다. +는 Actual 출금이 Projection보다 큼, -는 Actual 출금이 Projection보다 작음을 의미합니다."
            />
            <DiffMetricCard
              label="순차이"
              value={fmtSigned(projectionActualYearDiff.netDiff)}
              className={projectionActualYearDiff.netDiff === 0 ? 'text-[13px] font-semibold text-slate-700' : 'text-[13px] font-semibold text-slate-950'}
              message="입금 차이에서 출금 차이를 뺀 값입니다. +는 Actual 순잔액이 Projection보다 큼, -는 Actual 순잔액이 Projection보다 작음을 의미합니다."
            />
            <DiffMetricCard
              label="차이 셀"
              value={`${projectionActualYearDiff.changedCellCount.toLocaleString()}건`}
              className="text-[13px] font-semibold text-slate-950"
              message="Projection과 Actual이 서로 다른 주차별 항목 셀 개수입니다. 차이만 보기에서는 이 셀들이 있는 행만 남깁니다."
            />
          </div>

          <div className="overflow-x-auto rounded-[18px] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.55)]">
            <table className="border-separate border-spacing-0 text-[11px]" style={{ minWidth: `${220 + annualWeeks.length * 96}px` }}>
              <thead className="bg-white text-slate-500">
                <tr>
                  <th className="sticky left-0 z-20 w-[220px] min-w-[220px] border-r-[6px] border-r-white bg-white px-3 py-2 text-left font-medium">
                    항목
                  </th>
                  {annualWeeks.map((week) => (
                    <th key={`${week.yearMonth}-${week.weekNo}`} className="min-w-[96px] border-l-[6px] border-l-white bg-slate-50/80 px-2 py-2 text-right font-medium">
                      <div>{week.label}</div>
                      {formatShortWeekRange(week) ? (
                        <div className="text-[9px] font-normal text-slate-400">{formatShortWeekRange(week)}</div>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {yearRows.length === 0 ? (
                  <tr>
                    <td colSpan={annualWeeks.length + 1} className="px-3 py-8 text-center text-[12px] text-slate-500">
                      Projection과 Actual 차이가 없습니다.
                    </td>
                  </tr>
                ) : yearRows.map((row) => (
                  <tr key={row.lineId} className="border-t-[6px] border-white">
                    <td className={`sticky left-0 z-10 w-[220px] min-w-[220px] border-r-[6px] border-r-white px-3 py-2 ${row.section === '입금' ? 'border-l-[3px] border-l-emerald-400 bg-emerald-50/80' : 'border-l-[3px] border-l-rose-400 bg-rose-50/80'}`}>
                      <div className="truncate text-slate-900">
                        {row.label}
                      </div>
                    </td>
                    {row.cells.map((cell) => {
                      const diffClass = cell.diff === 0
                        ? 'text-slate-300'
                        : row.section === '입금'
                          ? cell.diff > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                          : cell.diff > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700';
                      return (
                        <td
                          key={`${row.lineId}-${cell.yearMonth}-${cell.weekNo}`}
                          className={`min-w-[96px] cursor-pointer border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums ${diffClass}`}
                          title={`${cell.weekRange}\nProjection ${fmt(cell.projection)} / Actual ${fmt(cell.actual)} / 차이 ${fmtSigned(cell.diff)}\n${diffColorExplanation(row.section, cell.diff)}`}
                        >
                          {fmtSigned(cell.diff)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 ? (
            <div className="border border-slate-200 bg-slate-50 px-3 py-8 text-center text-[12px] text-slate-500">
              Projection과 Actual 차이가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[11px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">항목</th>
                    <th className="px-3 py-2 text-left font-medium">주차</th>
                    <th className="px-3 py-2 text-right font-medium">Projection</th>
                    <th className="px-3 py-2 text-right font-medium">Actual</th>
                    <th className="px-3 py-2 text-right font-medium">차이</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const diffClass = row.diff === 0
                      ? 'text-slate-400'
                      : row.section === '입금'
                        ? row.diff > 0 ? 'text-emerald-700' : 'text-rose-700'
                        : row.diff > 0 ? 'text-rose-700' : 'text-emerald-700';
                    return (
                      <tr key={`${row.section}-${row.lineId}-${row.weekNo}`} className={row.diff === 0 ? 'border-t border-slate-100 text-slate-400' : 'border-t border-slate-100'}>
                        <td className={`px-3 py-2 text-slate-900 ${row.section === '입금' ? 'border-l-2 border-l-emerald-400 bg-emerald-50/70' : 'border-l-2 border-l-rose-400 bg-rose-50/70'}`}>{row.label}</td>
                        <td className="px-3 py-2 text-slate-600">
                          <div className="font-medium text-slate-800">{row.weekLabel}</div>
                          <div className="text-[10px] text-slate-500">{row.weekRange}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(row.projection)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(row.actual)}</td>
                        <td
                          className={`cursor-pointer px-3 py-2 text-right font-semibold tabular-nums ${diffClass}`}
                          title={`Projection ${fmt(row.projection)} / Actual ${fmt(row.actual)} / 차이 ${fmtSigned(row.diff)}\n${diffColorExplanation(row.section, row.diff)}`}
                        >
                          {fmtSigned(row.diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function opsToneClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-800';
    if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
    if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-800';
    return 'border-slate-200 bg-slate-50 text-slate-700';
  }

  function opsDotClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'bg-rose-500';
    if (tone === 'warning') return 'bg-amber-500';
    if (tone === 'success') return 'bg-emerald-500';
    if (tone === 'info') return 'bg-blue-500';
    return 'bg-slate-400';
  }

  function opsSubtleBgClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'bg-rose-50';
    if (tone === 'warning') return 'bg-amber-50';
    if (tone === 'success') return 'bg-emerald-50';
    if (tone === 'info') return 'bg-blue-50';
    return 'bg-slate-50';
  }

  function opsTextClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'text-rose-700';
    if (tone === 'warning') return 'text-amber-700';
    if (tone === 'success') return 'text-emerald-700';
    if (tone === 'info') return 'text-blue-700';
    return 'text-slate-700';
  }

  function renderOpsStatusDonut() {
    const blockedMatch = opsSummary.status.detail.match(/(\d+)/);
    const blockedCount = blockedMatch ? Number(blockedMatch[1]) : 0;
    const closedPercent = Math.min(100, Math.max(0, opsSummary.rates.closed.percent));
    const actualPercent = Math.min(100, Math.max(0, opsSummary.rates.actual.percent));
    const projectionPercent = Math.min(100, Math.max(0, opsSummary.rates.projection.percent));
    const totalPercent = Math.max(1, projectionPercent + actualPercent + closedPercent);
    const projectionEnd = (projectionPercent / totalPercent) * 360;
    const actualEnd = projectionEnd + (actualPercent / totalPercent) * 360;
    const closedEnd = actualEnd + (closedPercent / totalPercent) * 360;
    const gradient = `conic-gradient(#3b82f6 0deg ${projectionEnd}deg, #fb7185 ${projectionEnd}deg ${actualEnd}deg, #f59e0b ${actualEnd}deg ${closedEnd}deg, #e5e7eb ${closedEnd}deg 360deg)`;

    return (
      <div className="flex items-center justify-center">
        <div className="relative h-[78px] w-[78px] rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-[15px] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-sm">
            <div className={`text-[15px] font-bold leading-4 tabular-nums ${opsTextClass(opsSummary.status.tone)}`}>
              {blockedCount > 0 ? `${blockedCount}건` : opsSummary.status.label}
            </div>
            <div className="mt-0.5 text-[9px] leading-3 text-slate-500">
              {blockedCount > 0 ? '확인 필요' : '상태'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderRateTile(label: string, rate: { done: number; total: number; percent: number; missingLabels: string[] }) {
    const missingWord = label === '결산' ? '미결산' : '미작성';
    const visibleMissing = rate.missingLabels.slice(0, 2).join(', ');
    const hiddenMissingCount = Math.max(0, rate.missingLabels.length - 2);
    const missingText = rate.missingLabels.length > 0
      ? `${missingWord} ${visibleMissing}${hiddenMissingCount > 0 ? ` 외 ${hiddenMissingCount}건` : ''}`
      : '이번 주차까지 완료';

    return (
      <div className="min-w-[158px] rounded-[18px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]" title={rate.missingLabels.length > 0 ? `${missingWord}: ${rate.missingLabels.join(', ')}` : '이번 주차까지 완료'}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold leading-4 text-slate-600">{label}</div>
          <div className="text-[10px] tabular-nums text-slate-500">
            {rate.done}/{rate.total}
          </div>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className="text-[22px] font-bold leading-6 tabular-nums text-blue-700">
            {rate.percent}%
          </span>
          <span className={`truncate text-right text-[9px] font-semibold leading-3 ${rate.missingLabels.length > 0 ? 'text-rose-700' : 'text-blue-700'}`}>
            {rate.missingLabels.length > 0 ? `${rate.missingLabels.length}건` : 'OK'}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, Math.max(0, rate.percent))}%` }} />
        </div>
        <div className={`mt-1.5 truncate text-[9px] leading-3 ${rate.missingLabels.length > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
          {missingText}
        </div>
      </div>
    );
  }

  function renderLaborRiskCopy() {
    if (laborRiskLoading) {
      return (
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          인건비/잔액 체크를 불러오는 중입니다.
        </div>
      );
    }
    if (laborRiskError) {
      return <div className="text-[11px] font-semibold text-amber-700">인건비/잔액 체크 실패: {laborRiskError}</div>;
    }
    if (!laborRisk) return <div className="text-[11px] text-slate-500">페이지를 열면 인건비/잔액 체크 결과를 자동으로 계산합니다.</div>;

    const missingMonths = laborRisk.labor.missingProjectionMonths;
    const nextMonthProjectionMissing = !laborRisk.labor.nextMonthProjection.isWritten;
    const nextLaborAmount = laborRisk.labor.nextProjection?.amount
      ?? laborRisk.labor.nextMonthProjection.projectionAmount
      ?? laborRisk.labor.referenceActualAmount
      ?? 0;
    const laborChanged = laborRisk.labor.lastMonth.actualAmount !== nextLaborAmount;
    const minBalanceText = laborRisk.shortage.week
      ? `${laborRisk.shortage.week.label} 예상 잔액 ${fmt(laborRisk.shortage.projectedBalance || 0)}원`
      : '현재 Projection 기준 잔액 부족 예상 주차는 없습니다';

    return (
      <div className="space-y-1.5 text-[11px] leading-5 text-slate-700">
        {nextMonthProjectionMissing ? (
          <p>
            지난달 Actual 인건비는 <span className="font-semibold tabular-nums text-blue-700">{fmt(laborRisk.labor.lastMonth.actualAmount)}원</span>,
            오늘 기준 Actual 잔액은 <span className="font-semibold tabular-nums text-blue-700">{fmt(laborRisk.current.balance)}원</span>입니다.{' '}
            <span className="font-semibold text-rose-700">다음 달 Projection 인건비가 미작성이라 잔액 부족 여부를 확정할 수 없습니다.</span>
          </p>
        ) : (
          <div className="space-y-1">
            <p>
              오늘 기준 Actual 잔액은 <span className="font-semibold tabular-nums text-blue-700">{fmt(laborRisk.current.balance)}원</span>입니다.
              다음 인건비 <span className="font-semibold tabular-nums text-blue-700">{fmt(nextLaborAmount)}원</span> 반영 후 예상 잔액은{' '}
              <span className="font-semibold tabular-nums text-blue-700">{fmt(laborRisk.labor.balanceAfterNextLabor)}원</span>이며, {minBalanceText}.
            </p>
            {laborChanged && (
              <p className="font-semibold text-amber-700">
                지난달 인건비는 {fmt(laborRisk.labor.lastMonth.actualAmount)}원인데 이번달 인건비는 {fmt(nextLaborAmount)}원이라서 확인 필요합니다.
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-1.5 text-[10px] text-slate-500">
          <span>지난달: {laborRisk.labor.lastMonth.label}</span>
          <span>현재 주차: {laborRisk.current.week?.label || '없음'}</span>
          <span>다음 인건비 주차: {laborRisk.labor.nextProjection?.label || '없음'}</span>
          <span>
            다음 달 Projection: {laborRisk.labor.nextMonthProjection.label} ·{' '}
            <span className={laborRisk.labor.nextMonthProjection.isWritten ? 'text-slate-600' : 'font-semibold text-rose-700'}>
              {laborRisk.labor.nextMonthProjection.isWritten ? '작성됨' : '미작성'}
            </span>
          </span>
        </div>
        {missingMonths.length > 0 && (
          <div className="text-[11px] text-amber-700">
            MYSC 인건비 Projection 미산입 월: {missingMonths.slice(0, 6).map((month) => month.label).join(', ')}
            {missingMonths.length > 6 ? ` 외 ${missingMonths.length - 6}개월` : ''}
          </div>
        )}
      </div>
    );
  }

  function renderOperationsPanel() {
    const compactStatusDetail = opsSummary.status.detail
      .replace(' 항목이 있습니다.', ' 항목');
    const visibleInbox = opsSummary.inbox.slice(0, 4);
    const hiddenInboxCount = Math.max(0, opsSummary.inbox.length - visibleInbox.length);
    const primaryReason = visibleInbox.find((item) => item.id === 'projection-actual-diff') || visibleInbox[0];
    const remainingReasonCount = Math.max(0, opsSummary.inbox.length - 1);
    const statusBadgeLabel = opsSummary.status.kind === 'ready'
      ? opsSummary.status.label
      : `확인 항목 ${opsSummary.inbox.length}건`;
    const statusReason = opsSummary.status.kind === 'ready'
      ? '확인할 항목이 없습니다.'
      : `${primaryReason?.title || '확인 항목'}입니다. 확인해 주세요.${remainingReasonCount > 0 ? ` 외 ${remainingReasonCount}건` : ''}`;

    return (
      <Card className="overflow-hidden rounded-[24px] border-0 bg-slate-50/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ClipboardList className="h-4 w-4 shrink-0 text-blue-600" />
              <div className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950">운영 대시보드</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-[10px] text-slate-400 sm:inline">기준일 {todayIso}</span>
              <Badge className={`rounded-full border-0 px-2.5 py-1 text-[10px] shadow-sm ${opsToneClass(opsSummary.status.tone)}`}>
                {statusBadgeLabel}
              </Badge>
            </div>
          </div>

          <div className={`rounded-[18px] border px-3 py-2 text-[11px] ${cashflowSheetConfig ? 'border-blue-100 bg-blue-50 text-blue-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-bold">{cashflowSheetConfig ? '시트 값 가져오기 연결됨' : '시트 값 가져오기 미연결'}</div>
                {cashflowSheetConfig ? (
                  <div className="mt-0.5 truncate text-blue-800">
                    {cashflowSheetConfig.spreadsheetTitle || cashflowSheetConfig.spreadsheetId || 'Google Sheet'} · {cashflowSheetConfig.sheetName || '시트 탭'} · {cashflowSheetConfig.startWeek || '전체'} ~ {cashflowSheetConfig.endWeek || '전체'}
                  </div>
                ) : (
                  <div className="mt-0.5 text-amber-800">
                    Google Sheet를 연결하면 시트에서 수정한 Projection/Actual 값을 새로고침으로 가져올 수 있습니다.
                  </div>
                )}
                {sheetRefreshResult ? (
                  <div className="mt-1 font-semibold text-emerald-800">
                    검토 후보 생성 완료 · 후보 {sheetRefreshResult.stagedLineCount.toLocaleString()}건 · Projection {sheetRefreshResult.projectionLineCount.toLocaleString()}건 · Actual {sheetRefreshResult.actualLineCount.toLocaleString()}건
                    {sheetRefreshResult.riskLineCount > 0 ? ` · 확인 필요 ${sheetRefreshResult.riskLineCount.toLocaleString()}건` : ''}
                  </div>
                ) : null}
                {cashflowSheetConfig?.lastAppliedAt ? (
                  <div className="mt-1 text-blue-800">
                    마지막 반영 {formatSheetAppliedAt(cashflowSheetConfig.lastAppliedAt) || cashflowSheetConfig.lastAppliedAt}
                    {cashflowSheetConfig.lastAppliedBy?.email || cashflowSheetConfig.lastAppliedBy?.uid ? ` · 실행자 ${cashflowSheetConfig.lastAppliedBy.email || cashflowSheetConfig.lastAppliedBy.uid}` : ''}
                    {typeof cashflowSheetConfig.lastAppliedLineCount === 'number' ? ` · 반영 ${cashflowSheetConfig.lastAppliedLineCount.toLocaleString()}건` : ''}
                    {typeof cashflowSheetConfig.lastProjectionLineCount === 'number' ? ` · Projection ${cashflowSheetConfig.lastProjectionLineCount.toLocaleString()}건` : ''}
                    {typeof cashflowSheetConfig.lastActualLineCount === 'number' ? ` · Actual ${cashflowSheetConfig.lastActualLineCount.toLocaleString()}건` : ''}
                  </div>
                ) : cashflowSheetConfig ? (
                  <div className="mt-1 text-blue-800">시트에서 값을 수정한 뒤 시트 업데이트 검토를 누르면 변경 후보로 저장됩니다.</div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                {cashflowSheetConfig?.value ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full border-blue-200 bg-white px-2.5 text-[10px] font-semibold text-blue-700"
                    onClick={() => void handleRefreshSheetValues()}
                    disabled={sheetRefreshLoading}
                    title="Google Sheet에서 수정한 값을 검토 후보로 가져오기"
                  >
                    {sheetRefreshLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                    시트 업데이트 검토
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-7 rounded-full px-2.5 text-[10px] ${cashflowSheetConfig ? 'border-blue-200 bg-white text-blue-700' : 'border-amber-300 bg-white text-amber-800'}`}
                  onClick={() => navigate(`/portal/cashflow/sheets-lab?projectId=${encodeURIComponent(projectId)}`)}
                >
                  {cashflowSheetConfig ? '설정 변경' : '시트 연동 설정'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_240px]">
            <div className="grid gap-2 md:grid-cols-[210px_repeat(3,minmax(158px,1fr))]">
              <div className="flex min-w-[190px] items-center gap-3 rounded-[20px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]" title={opsSummary.status.detail}>
                {renderOpsStatusDonut()}
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold leading-3 text-slate-500">이번 주 기준</div>
                  <div className={`mt-1 truncate text-[13px] font-bold leading-4 ${opsTextClass(opsSummary.status.tone)}`}>
                    {statusBadgeLabel}
                  </div>
                  <div className="mt-1 max-h-8 overflow-hidden text-[10px] leading-4 text-slate-500">
                    {statusReason}
                  </div>
                  <div className="mt-1 text-[9px] leading-3 text-slate-400">{compactStatusDetail} · 결산 전 확인</div>
                </div>
              </div>
              {renderRateTile('Projection', opsSummary.rates.projection)}
              {renderRateTile('Actual', opsSummary.rates.actual)}
              {renderRateTile('결산', opsSummary.rates.closed)}
            </div>

            <div className="min-w-0 overflow-hidden rounded-[20px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] xl:max-h-[126px]">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-slate-500">확인할 항목</div>
                  <div className={`mt-0.5 text-[10px] font-bold tabular-nums ${opsTextClass(opsSummary.status.tone)}`}>
                    {opsSummary.inbox.length}건
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {visibleInbox.map((item) => (
                  <div key={item.id} className="grid grid-cols-[14px_minmax(0,1fr)] gap-1.5 px-3 py-1.5">
                    <div className="flex h-4 items-center justify-center">
                      <span className={`h-1.5 w-1.5 rounded-full ${opsDotClass(item.tone)}`} />
                    </div>
                    <div className="min-w-0">
                      <div className={`truncate text-[10px] font-bold leading-3 ${opsTextClass(item.tone)}`}>{item.title}</div>
                      <div className="mt-0.5 truncate text-[9px] leading-3 text-slate-500">{item.detail}</div>
                    </div>
                  </div>
                ))}
                {hiddenInboxCount > 0 && (
                  <div className="px-2 py-1 text-[9px] font-semibold text-slate-500">
                    외 {hiddenInboxCount}건
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[20px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="text-[11px] font-bold text-slate-900">
              <HoverExplain message="저장된 주차 값을 읽어 현재 잔액과 다음 인건비를 계산합니다.">
                인건비/잔액 체크
              </HoverExplain>
              </div>
              <div className="shrink-0 text-[10px] font-medium text-slate-400">페이지 새로고침 시 자동 계산</div>
            </div>
            {renderLaborRiskCopy()}
          </div>
        </CardContent>
      </Card>
    );
  }

  function cashflowEventLabel(event: CashflowEvent): string {
    if (event.type === 'sheet_apply') return '시트 값 반영';
    if (event.type === 'projection_amount_change') return 'Projection 값 변경';
    if (event.type === 'actual_amount_change') return 'Actual 값 변경';
    if (event.type === 'projection_completed') return 'Projection 작성완료';
    if (event.type === 'actual_completed') return 'Actual 작성완료';
    if (event.type === 'admin_closed') return '결산완료';
    if (event.type === 'sheet_apply_reverted') return '시트 반영 되돌림';
    return '변경';
  }

  function cashflowEventDetail(event: CashflowEvent): string {
    if (event.type === 'sheet_apply') {
      return `Google Sheet 반영 ${event.appliedLineCount || 0}건 · Projection ${event.projectionLineCount || 0}건 · Actual ${event.actualLineCount || 0}건`;
    }
    if (event.type === 'projection_amount_change' || event.type === 'actual_amount_change') {
      const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
      const lineLabel = event.lineId ? CASHFLOW_SHEET_LINE_LABELS[event.lineId] || event.lineId : '';
      const before = event.beforeHadValue ? `${fmt(Number(event.beforeAmount || 0))}원` : '미작성';
      const after = `${fmt(Number(event.afterAmount || 0))}원`;
      return `${weekLabel} ${lineLabel} ${before} → ${after}`;
    }
    if (event.type === 'sheet_apply_reverted') return '선택한 시트 반영 run의 금액 변경을 이전 값으로 되돌렸습니다.';
    const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
    return [weekLabel, event.actorName || event.actorEmail || '사용자'].filter(Boolean).join(' · ');
  }

  function cashflowEventSourceClass(source: CashflowEvent['source']): string {
    if (source === 'google_sheet_apply') return 'bg-blue-50 text-blue-700';
    if (source === 'revert') return 'bg-amber-50 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  }

  function renderOpsTimeline() {
    const countBadges = [
      { key: 'sheet', label: '시트 반영', value: cashflowEvents.filter((event) => event.type === 'sheet_apply').length },
      { key: 'amount', label: '금액 변경', value: cashflowEvents.filter((event) => event.type === 'projection_amount_change' || event.type === 'actual_amount_change').length },
      { key: 'status', label: '완료', value: cashflowEvents.filter((event) => ['projection_completed', 'actual_completed', 'admin_closed'].includes(event.type)).length },
    ].filter((item) => item.value > 0);

    return (
      <Card className="h-full overflow-hidden rounded-[24px] border-0 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 pb-3">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">변경 이력</div>
              <div className="text-[10px] text-slate-500">시트 반영, 저장, 작성완료, 결산 기록입니다.</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {countBadges.map((badge) => (
                <span
                  key={badge.key}
                  className="rounded-full border-0 bg-slate-100 px-2 py-1 text-[9px] font-semibold leading-3 text-slate-700"
                >
                  {badge.label} {badge.value}
                </span>
              ))}
            </div>
          </div>
          <div className="max-h-[230px] space-y-0 overflow-auto rounded-[18px] bg-slate-50/70 px-2 py-2 pr-1">
            {cashflowEventsError ? (
              <div className="px-2 py-8 text-center text-[10px] leading-4 text-rose-600">
                변경 이력을 불러오지 못했습니다.
                <br />
                {cashflowEventsError}
              </div>
            ) : cashflowEvents.length === 0 ? (
              <div className="px-2 py-8 text-center text-[10px] leading-4 text-slate-500">
                아직 표시할 변경 기록이 없습니다.
                <br />
                시트 업데이트 검토, 저장, 작성완료, 결산을 실행하면 여기에 기록됩니다.
              </div>
            ) : cashflowEvents.map((event, index) => {
              const canRevert = event.type === 'sheet_apply'
                && event.source === 'google_sheet_apply'
                && !event.revertedAt
                && cashflowEvents.some((candidate) => (
                  candidate.runId === event.runId
                  && !candidate.revertedAt
                  && (candidate.type === 'projection_amount_change' || candidate.type === 'actual_amount_change')
                ));
              return (
              <div key={event.id || `${event.runId}:${index}`} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-2 pb-3">
                {index < cashflowEvents.length - 1 && (
                  <div className="absolute left-[6px] top-3 h-full w-px bg-slate-200/80" />
                )}
                <div className={`relative z-10 mt-1 h-3 w-3 rounded-full border-2 border-white ${opsDotClass(event.type === 'sheet_apply_reverted' ? 'warning' : 'info')}`} />
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={`shrink-0 rounded-full border-0 px-1.5 py-0.5 text-[9px] font-semibold leading-3 ${cashflowEventSourceClass(event.source)}`}>
                          {event.source === 'google_sheet_apply' ? '시트' : event.source === 'revert' ? '되돌림' : '기록'}
                        </span>
                        <span className="truncate text-[11px] font-bold text-slate-900">{cashflowEventLabel(event)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-[9px] tabular-nums text-slate-400">{formatSheetAppliedAt(event.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500">{cashflowEventDetail(event)}</div>
                  {canRevert && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1 h-6 rounded-full px-2 text-[9px]"
                      onClick={() => void handleRevertCashflowRun(event.runId)}
                      disabled={revertingRunId === event.runId}
                    >
                      {revertingRunId === event.runId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                      이 반영 되돌리기
                    </Button>
                  )}
                  {event.revertedAt && <div className="mt-1 text-[9px] font-semibold text-amber-700">되돌림 완료</div>}
                </div>
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5 rounded-[28px] bg-slate-50/80 p-3">
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        {renderOperationsPanel()}
        {renderOpsTimeline()}
      </section>

      {renderUnifiedMonthlyBoard()}

      <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-100">
            <Columns2 className="h-4 w-4 text-slate-600" />
          </span>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">Projection / Actual 차이</div>
            <div className="text-[10px] text-slate-500">기준 범위 {cashflowTotalPeriodLabel}</div>
          </div>
        </div>
        {renderProjectionActualDiffTable()}
      </section>

      <AlertDialog
        open={!!auditDialog}
        onOpenChange={(open) => {
          if (!open) setAuditDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{auditDialog?.title || '확인이 필요합니다'}</AlertDialogTitle>
            <AlertDialogDescription>
              {auditDialog?.weekLabel} 주차는 아래 항목을 직접 확인한 뒤 다시 저장해 주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {auditDialog && (
            <div className="max-h-[320px] overflow-auto rounded-md border border-border/60">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">항목</th>
                    <th className="px-3 py-2 text-left font-medium">확인 내용</th>
                  </tr>
                </thead>
                <tbody>
                  {auditDialog.issues.slice(0, 20).map((issue) => (
                    <tr key={issue.key} className="border-t border-border/40">
                      <td className="px-3 py-2 font-medium">{issue.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{issue.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {auditDialog.issues.length > 20 && (
                <div className="border-t border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
                  외 {auditDialog.issues.length - 20}건
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setAuditDialog(null)}>확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <AlertDialogCancel onClick={() => blocker.reset?.()}>계속 편집</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>나가기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!closeDialog}
        onOpenChange={(open) => {
          if (!open && !closeBusy) setCloseDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {closeDialog?.kind === 'prerequisite'
                ? '결산 전에 제출현황을 확인해 주세요'
                : closeDialog?.kind === 'warning'
                  ? '검토/동기화 상태를 확인한 뒤 결산할까요?'
                : '이번 주차를 결산완료 처리할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {closeDialog?.kind === 'prerequisite'
                ? '내 제출현황에서 Projection 업데이트와 사업비 입력을 체크해주세요.'
                : closeDialog?.kind === 'warning'
                  ? '사업비 입력은 저장되었지만 일부 주차는 검토 루프 또는 동기화 확인이 더 필요합니다. 그래도 결산은 진행할 수 있습니다.'
                : 'Projection 업데이트와 사업비 입력 체크가 완료된 주차입니다. 결산완료 후에도 Projection은 계속 수정할 수 있습니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {closeDialog && (
            <div className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">주차</span>
                <span style={{ fontWeight: 700 }}>
                  {annualWeeks.find((x) => x.yearMonth === closeDialog.yearMonth && x.weekNo === closeDialog.weekNo)?.label || formatSheetWeekLabel(closeDialog.yearMonth, closeDialog.weekNo)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Projection 업데이트</span>
                <span style={{ fontWeight: 700 }}>
                  {closeDialog.projectionDone ? '완료' : '미완료'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">사업비 입력</span>
                <span style={{ fontWeight: 700 }}>
                  {closeDialog.expenseDone ? '완료' : '미완료'}
                </span>
              </div>
              {closeDialog.expenseStatusLabel && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">사업비 입력 상태</span>
                  <span style={{ fontWeight: 700 }}>
                    {closeDialog.expenseStatusLabel}
                  </span>
                </div>
              )}
              {closeDialog.expenseStatusDescription && (
                <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {closeDialog.expenseStatusDescription}
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeBusy}>취소</AlertDialogCancel>
            {closeDialog?.kind === 'prerequisite' ? (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setCloseDialog(null);
                  navigate('/portal/submissions');
                }}
              >
                내 제출현황으로 이동
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                disabled={!closeDialog || closeBusy}
                onClick={(e) => {
                  e.preventDefault();
                  if (!closeDialog) return;
                  void handleCloseWeek(closeDialog.weekNo, closeDialog.yearMonth);
                }}
              >
                {closeBusy ? '처리 중…' : '결산완료'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
