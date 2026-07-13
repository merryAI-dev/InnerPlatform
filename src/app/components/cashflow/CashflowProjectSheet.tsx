import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { ArrowDownToLine, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Columns2, FileSpreadsheet, Loader2, Pencil, RefreshCw, Save } from 'lucide-react';
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
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, computeCashflowDerivedTotals, computeOpeningCashflowTotals } from '../../platform/cashflow-sheet';
import { getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { resolveWeeklyAccountingState } from '../../platform/weekly-accounting-state';
import { useAuth } from '../../data/auth-store';
import { hasUnsavedChanges } from './cashflow-unsaved';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance, getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import {
  fetchCashflowSnapshotViaBff,
  fetchCashflowLaborRiskViaBff,
  saveCashflowProjectionBatchViaBff,
  type CashflowLaborRiskResult,
  type CashflowSnapshotResult,
} from '../../lib/platform-bff-client';
import { getCashflowModeLineLabel } from '../../platform/policies/cashflow-policy';
import { shouldHighlightProjectionAmountMismatch } from './cashflow-projection-cell-style';
import { getSnappedWeekScrollLeft } from './cashflow-board-scroll';
import { buildCashflowOpsSummary, type CashflowOpsTone } from './cashflow-ops-summary';
import {
  applyCashflowSheetLabViaBff,
  getCashflowSheetLabMirrorViaBff,
  refreshCashflowSheetLabMirrorViaBff,
  stageCashflowSheetLabViaBff,
  type CashflowSheetLabChangeCandidate,
  type CashflowSheetLabMirrorResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { recordDevtoolsLog } from '../../platform/devtools-transaction-log';
import { EditLeaseDialogs } from '../editing/EditLeaseDialogs';
import { useCashflowEditLease } from './useCashflowEditLease';
import { createCashflowPrivateDraftClient } from '../../lib/cashflow-private-draft-client';
import type { CashflowMutationLease } from '../../lib/cashflow-edit-lease';

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

function diffColorExplanation(section: '입금' | '출금', diff: number): string {
  if (diff === 0) return '차이가 없습니다.';
  const target = section === '입금' ? '입금' : '출금';
  return diff > 0
    ? `${target} Projection이 Actual보다 큽니다.`
    : `${target} Projection이 Actual보다 작습니다.`;
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
  const cashflowLease = useCashflowEditLease({ tenantId: orgId, projectId, actor: bffActor });
  const cashflowPrivateDraftClient = useMemo(() => (
    cashflowLease.sessionId
      ? createCashflowPrivateDraftClient({
          tenantId: orgId,
          projectId,
          actor: bffActor,
          sessionId: cashflowLease.sessionId,
        })
      : null
  ), [bffActor, cashflowLease.sessionId, orgId, projectId]);
  const canEdit = canUseCashflowActions && cashflowLease.canEdit;
  const canSubmitActual = canEdit;
  const canClose = canEdit;
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
  const [cashflowSnapshot, setCashflowSnapshot] = useState<CashflowSnapshotResult | null>(null);
  const [cashflowComparisonLoading, setCashflowComparisonLoading] = useState(false);
  const [cashflowComparisonError, setCashflowComparisonError] = useState<string | null>(null);
  const [cashflowSheetMirror, setCashflowSheetMirror] = useState<CashflowSheetLabMirrorResult | null>(null);
  const [sheetRefreshLoading, setSheetRefreshLoading] = useState(false);
  const [sheetRefreshResult, setSheetRefreshResult] = useState<{
    runId: string;
    stagedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    riskLineCount: number;
  } | null>(null);
  const [sheetReviewDialogOpen, setSheetReviewDialogOpen] = useState(false);
  const [sheetStageDialog, setSheetStageDialog] = useState<{
    runId: string;
    stagedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    riskLineCount: number;
    candidates: CashflowSheetLabChangeCandidate[];
    omittedCandidateCount: number;
  } | null>(null);
  const [sheetStageApplyLoading, setSheetStageApplyLoading] = useState(false);
  const [cashflowEvents, setCashflowEvents] = useState<CashflowEvent[]>([]);
  const [cashflowEventsError, setCashflowEventsError] = useState<string | null>(null);
  const [revertingRunId, setRevertingRunId] = useState<string | null>(null);

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
  const [privateDraftRevision, setPrivateDraftRevision] = useState<number | null>(null);
  const [privateDraftPayload, setPrivateDraftPayload] = useState<Record<string, unknown>>({});
  const loadedPrivateDraftKeyRef = useRef('');
  const privateDraftLoadRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const [auditDialog, setAuditDialog] = useState<{
    title: string;
    weekLabel: string;
    issues: CashflowAuditIssue[];
  } | null>(null);

  const [submitConfirm, setSubmitConfirm] = useState<{ weekNo: number; yearMonth: string } | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
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
    setPrivateDraftRevision(null);
    setPrivateDraftPayload({});
    loadedPrivateDraftKeyRef.current = '';
    privateDraftLoadRef.current = null;
  }, [projectId]);

  const hydrateCashflowPrivateDraft = useCallback(async (ownership: { leaseId: string; fence: number }): Promise<void> => {
    if (!cashflowPrivateDraftClient) throw new Error('임시저장 API가 준비되지 않았습니다.');
    const key = `${projectId}:${ownership.leaseId}:${ownership.fence}`;
    if (loadedPrivateDraftKeyRef.current === key) return;
    if (privateDraftLoadRef.current?.key === key) return privateDraftLoadRef.current.promise;
    const promise = (async () => {
      const { draft } = await cashflowPrivateDraftClient.open(ownership);
      setPrivateDraftRevision(draft.draftRevision);
      const payload = draft.payload || {};
      setPrivateDraftPayload(payload);
      const board = payload.board && typeof payload.board === 'object' && !Array.isArray(payload.board)
        ? payload.board as Record<string, unknown>
        : payload;
      if (draft.status === 'ACTIVE') {
        if (board.drafts && typeof board.drafts === 'object' && !Array.isArray(board.drafts)) {
          setDrafts(board.drafts as Record<string, string>);
        }
        if (board.weekSaveState && typeof board.weekSaveState === 'object' && !Array.isArray(board.weekSaveState)) {
          setWeekSaveState(board.weekSaveState as Record<string, WeekSaveState>);
        }
      }
      loadedPrivateDraftKeyRef.current = key;
    })();
    privateDraftLoadRef.current = { key, promise };
    try {
      await promise;
    } finally {
      if (privateDraftLoadRef.current?.key === key) privateDraftLoadRef.current = null;
    }
  }, [cashflowPrivateDraftClient, projectId]);

  useEffect(() => {
    if (!cashflowLease.canEdit || !cashflowLease.ownership) return;
    void hydrateCashflowPrivateDraft(cashflowLease.ownership).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '임시저장본을 복구하지 못했습니다.'));
    });
  }, [cashflowLease.canEdit, cashflowLease.ownership, hydrateCashflowPrivateDraft]);

  const beginCashflowEditing = useCallback(async (resumePrevious = false): Promise<boolean> => {
    if (!cashflowPrivateDraftClient) return false;
    const ownership = await (resumePrevious ? cashflowLease.takeover() : cashflowLease.acquire());
    if (!ownership) return false;
    try {
      await hydrateCashflowPrivateDraft(ownership);
      return true;
    } catch (error) {
      await cashflowLease.release();
      toast.error(resolveApiErrorMessage(error, '임시저장본을 열지 못했습니다.'));
      return false;
    }
  }, [cashflowLease.acquire, cashflowLease.release, cashflowLease.takeover, cashflowPrivateDraftClient, hydrateCashflowPrivateDraft]);

  const savePrivateCashflowDraft = useCallback(async (): Promise<void> => {
    if (!cashflowPrivateDraftClient) throw new Error('임시저장 API가 준비되지 않았습니다.');
    const mutationLease = await cashflowLease.checkBeforeMutation();
    let revision = privateDraftRevision;
    let payload = privateDraftPayload;
    if (revision === null) {
      const opened = await cashflowPrivateDraftClient.open(mutationLease);
      revision = opened.draft.draftRevision;
      payload = opened.draft.payload;
    }
    const nextPayload = { ...payload, board: { drafts, weekSaveState, yearMonth } };
    const { draft } = await cashflowPrivateDraftClient.save(mutationLease, {
      expectedDraftRevision: revision,
      payload: nextPayload,
    });
    setPrivateDraftRevision(draft.draftRevision);
    setPrivateDraftPayload(draft.payload);
  }, [
    cashflowLease.checkBeforeMutation,
    cashflowPrivateDraftClient,
    drafts,
    privateDraftRevision,
    privateDraftPayload,
    weekSaveState,
    yearMonth,
  ]);

  const savePrivateDraftAndLeave = useCallback(async (): Promise<void> => {
    if (blocker.state !== 'blocked') return;
    setExitBusy(true);
    try {
      await savePrivateCashflowDraft();
      await cashflowLease.release();
      blocker.proceed?.();
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '임시저장 후 이동하지 못했습니다. 현재 화면에서 다시 시도해 주세요.'));
    } finally {
      setExitBusy(false);
    }
  }, [blocker, cashflowLease.release, savePrivateCashflowDraft]);

  const completePrivateCashflowDraft = useCallback(async (mutationLease: CashflowMutationLease): Promise<void> => {
    if (!cashflowPrivateDraftClient || privateDraftRevision === null) return;
    await cashflowPrivateDraftClient.complete(mutationLease, {
      expectedDraftRevision: privateDraftRevision,
    });
    setPrivateDraftRevision(null);
  }, [cashflowPrivateDraftClient, privateDraftRevision]);

  useEffect(() => {
    if (!db || !projectId) {
      setCashflowSheetRange(null);
      setCashflowSheetConfig(null);
      return;
    }
    const documentPath = getOrgDocumentPath(orgId, 'projects', projectId);
    let cancelled = false;
    getDoc(doc(db, documentPath))
      .then((snap) => {
        if (cancelled) return;
        const config = snap.exists()
          ? (snap.data() as { cashflowSheetLab?: { value?: string; sheetName?: string; spreadsheetId?: string; spreadsheetTitle?: string; startWeek?: string; endWeek?: string; activeWeeks?: unknown; lastAppliedAt?: string; lastAppliedBy?: { uid?: string; email?: string; role?: string } | null; lastAppliedLineCount?: number; lastProjectionLineCount?: number; lastActualLineCount?: number } }).cashflowSheetLab
          : null;
        const activeWeeks = normalizeActiveSheetWeeks(config?.activeWeeks);
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'info',
          operation: 'cashflow.sheet_config.dashboard.read',
          transport: 'firestore',
          projectId,
          summary: {
            orgId,
            documentPath,
            projectExists: snap.exists(),
            hasCashflowSheetLab: Boolean(config),
            hasValue: Boolean(config?.value),
            spreadsheetId: config?.spreadsheetId || null,
            spreadsheetTitle: config?.spreadsheetTitle || null,
            sheetName: config?.sheetName || null,
            startWeek: config?.startWeek || null,
            endWeek: config?.endWeek || null,
            activeWeekCount: activeWeeks.length,
            updatedAt: (config as { updatedAt?: string } | null)?.updatedAt || null,
            lastAppliedAt: config?.lastAppliedAt || null,
          },
        });
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
        if (cancelled) return;
        recordDevtoolsLog({
          kind: 'cashflow_transaction',
          phase: 'error',
          operation: 'cashflow.sheet_config.dashboard.read.error',
          transport: 'firestore',
          projectId,
          summary: {
            orgId,
            documentPath,
          },
        });
        setCashflowSheetRange(null);
        setCashflowSheetConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, orgId, projectId]);

  useEffect(() => {
    let cancelled = false;
    setCashflowSheetMirror(null);
    if (!projectId || !orgId || !user?.uid) return () => { cancelled = true; };

    const readMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      getCashflowSheetLabMirrorViaBff({ tenantId: orgId, actor, projectId })
    );
    const loadPinnedMirror = async (): Promise<void> => {
      try {
        const actor = await resolveBffActor();
        if (!actor?.idToken) return;
        let mirror: CashflowSheetLabMirrorResult;
        try {
          mirror = await readMirror(actor);
        } catch (error) {
          if (!isBffAuthRejection(error)) throw error;
          const refreshedActor = await resolveBffActor({ forceRefresh: true });
          if (!refreshedActor?.idToken) throw error;
          mirror = await readMirror(refreshedActor);
        }
        if (!cancelled) setCashflowSheetMirror(mirror);
      } catch {
        if (!cancelled) setCashflowSheetMirror(null);
      }
    };
    void loadPinnedMirror();
    return () => { cancelled = true; };
  }, [orgId, projectId, resolveBffActor, user?.uid]);

  const loadCashflowComparison = useCallback(async (): Promise<void> => {
    if (!projectId || !orgId || !user?.uid) {
      setCashflowSnapshot(null);
      setCashflowComparisonError('로그인 세션이 만료되었습니다.');
      return;
    }
    const readSnapshot = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      fetchCashflowSnapshotViaBff({ tenantId: orgId, actor, projectId, asOf: todayIso })
    );
    setCashflowComparisonLoading(true);
    setCashflowComparisonError(null);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      try {
        setCashflowSnapshot(await readSnapshot(actor));
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        const refreshedActor = await resolveBffActor({ forceRefresh: true });
        if (!refreshedActor?.idToken) throw error;
        setCashflowSnapshot(await readSnapshot(refreshedActor));
      }
    } catch (error) {
      setCashflowSnapshot(null);
      setCashflowComparisonError(resolveApiErrorMessage(error, 'Projection - Actual 차이를 불러오지 못했습니다.'));
    } finally {
      setCashflowComparisonLoading(false);
    }
  }, [orgId, projectId, resolveBffActor, todayIso, user?.uid]);

  useEffect(() => {
    void loadCashflowComparison();
  }, [loadCashflowComparison]);

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

  const handleRefreshSheetMirror = useCallback(async (): Promise<void> => {
    if (!cashflowSheetConfig?.value) {
      toast.error('연결된 Google Sheet가 없습니다.');
      return;
    }
    const refreshIdempotencyKey = `cashflow-sheet-refresh:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const refreshMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      refreshCashflowSheetLabMirrorViaBff({
        tenantId: orgId,
        actor,
        projectId,
        value: cashflowSheetConfig.value,
        sheetName: cashflowSheetConfig.sheetName || undefined,
        startWeek: cashflowSheetConfig.startWeek || undefined,
        endWeek: cashflowSheetConfig.endWeek || undefined,
        idempotencyKey: refreshIdempotencyKey,
      })
    );
    const rememberMirror = (mirror: CashflowSheetLabMirrorResult) => {
      setCashflowSheetMirror((current) => mirror.status === 'STALE' && current?.sourceRevision
        ? {
            ...current,
            ...mirror,
            sourceRevision: mirror.sourceRevision || current.sourceRevision,
            capturedAt: mirror.capturedAt || current.capturedAt,
            summary: mirror.summary || current.summary,
            cells: mirror.cells || current.cells,
          }
        : mirror);
      setSheetRefreshResult(null);
      setSheetStageDialog(null);
      if (mirror.status === 'FRESH' && mirror.sourceRevision) {
        toast.success('시트 최신값을 고정했습니다. 변경 내용 검토를 눌러 비교해 주세요.');
      } else if (mirror.status === 'STALE') {
        toast.warning('최신 시트 조회에 실패해 마지막 정상 고정값을 유지했습니다.');
      } else {
        toast.error(mirror.lastRefreshError?.message || '시트 연동에 실패했습니다.');
      }
    };
    setSheetRefreshLoading(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      rememberMirror(await refreshMirror(actor));
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          rememberMirror(await refreshMirror(actor));
          return;
        } catch (retryError) {
          toast.error(resolveApiErrorMessage(retryError, '시트 최신값을 가져오지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '시트 최신값을 가져오지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetConfig, orgId, projectId, resolveBffActor]);

  const handleStagePinnedSheetValues = useCallback(async (): Promise<void> => {
    if (cashflowSheetMirror?.status !== 'FRESH' || !cashflowSheetMirror.sourceRevision) {
      toast.error('먼저 시트 최신값을 가져와 고정해 주세요.');
      return;
    }
    const stageIdempotencyKey = `cashflow-sheet-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const stageMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      stageCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        expectedMirrorRevision: cashflowSheetMirror.sourceRevision,
        idempotencyKey: stageIdempotencyKey,
      })
    );
    const rememberResult = (result: Awaited<ReturnType<typeof stageMirror>>) => {
      setSheetRefreshResult({
        runId: result.runId,
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
      });
      setSheetStageDialog({
        runId: result.runId,
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
        candidates: result.candidates || [],
        omittedCandidateCount: result.omittedCandidateCount || 0,
      });
      if (result.status === 'BLOCKED') toast.warning('검토가 필요한 월이 있어 바로 저장할 수 없습니다.');
      else toast.success('고정된 시트 값과 원장 값을 비교했습니다.');
    };
    setSheetRefreshLoading(true);
    setSheetRefreshResult(null);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      rememberResult(await stageMirror(actor));
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          rememberResult(await stageMirror(actor));
          return;
        } catch (retryError) {
          toast.error(resolveApiErrorMessage(retryError, '고정된 시트 값을 비교하지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '고정된 시트 값을 비교하지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetMirror, orgId, projectId, resolveBffActor]);

  const handleApplyStagedSheetValues = useCallback(async (): Promise<void> => {
    if (!sheetStageDialog?.runId) {
      toast.error('저장할 검토 값이 없습니다.');
      return;
    }
    const safeLineCount = Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount);
    if (safeLineCount <= 0) {
      toast.error('바로 저장할 수 있는 값이 없습니다. 확인 필요 항목을 먼저 검토해 주세요.');
      return;
    }
    const applyIdempotencyKey = `cashflow-sheet-apply-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    let finalMutationLease: Awaited<ReturnType<typeof cashflowLease.checkBeforeMutation>> | null = null;
    const apply = async (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => {
      const mutationLease = finalMutationLease || await cashflowLease.checkBeforeMutation();
      finalMutationLease = mutationLease;
      return applyCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        stageRunId: sheetStageDialog.runId,
        applyRiskCandidates: false,
        idempotencyKey: applyIdempotencyKey,
        lease: mutationLease,
        finalize: true,
      });
    };
    const rememberApplyResult = async (result: Awaited<ReturnType<typeof apply>>) => {
      await Promise.all([
        loadCashflowSheetRangeWeeks(),
        loadCashflowEvents(),
        loadCashflowComparison(),
      ]);
      setCashflowSheetConfig((current) => current ? {
        ...current,
        lastAppliedAt: result.lastAppliedAt,
        lastAppliedBy: result.lastAppliedBy,
        lastAppliedLineCount: result.appliedLineCount,
        lastProjectionLineCount: result.projectionLineCount,
        lastActualLineCount: result.actualLineCount,
      } : current);
      setSheetStageDialog(null);
      setSheetRefreshResult(null);
      if (cashflowPrivateDraftClient && privateDraftRevision !== null && finalMutationLease) {
        await cashflowPrivateDraftClient.complete(finalMutationLease, {
          expectedDraftRevision: privateDraftRevision,
        });
        setPrivateDraftRevision(null);
      }
      await cashflowLease.checkStatus();
      toast.success(`검토한 값 ${result.appliedLineCount.toLocaleString()}건을 캐시플로우 원장에 저장했습니다.`);
    };

    setSheetStageApplyLoading(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      const result = await apply(actor);
      await rememberApplyResult(result);
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          const result = await apply(actor);
          await rememberApplyResult(result);
          return;
        } catch (retryError) {
          toast.error(resolveApiErrorMessage(retryError, '변경 항목을 저장하지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '변경 항목을 저장하지 못했습니다.'));
    } finally {
      setSheetStageApplyLoading(false);
    }
  }, [cashflowLease.checkBeforeMutation, cashflowLease.checkStatus, cashflowPrivateDraftClient, loadCashflowComparison, loadCashflowEvents, loadCashflowSheetRangeWeeks, orgId, privateDraftRevision, projectId, resolveBffActor, sheetStageDialog]);

  const handleOpenSheetReviewDialog = useCallback(() => {
    if (cashflowSheetMirror?.status !== 'FRESH' || !cashflowSheetMirror.sourceRevision) {
      toast.info('먼저 시트 연동하기를 눌러 최신값을 고정해 주세요.');
      return;
    }
    setSheetReviewDialogOpen(true);
  }, [cashflowSheetMirror]);

  const handleStartSheetChangeReview = useCallback(async (): Promise<void> => {
    setSheetReviewDialogOpen(false);
    await handleStagePinnedSheetValues();
  }, [handleStagePinnedSheetValues]);

  const handleRevertCashflowRun = useCallback(async (_runId: string): Promise<void> => {
    toast.info('되돌리기는 서버 검증 경로가 준비될 때까지 읽기 전용입니다.');
  }, []);

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

  const projectionActualComparison = useMemo(() => {
    if (!cashflowSnapshot) return { rows: [], changedRows: [], changedCellCount: 0 };
    const comparisonMonths = cashflowSnapshot.readModel.months;
    const comparisonByMonth = new Map(comparisonMonths.map((month) => [month.yearMonth, month.comparison]));
    const lineDefs = [
      ...CASHFLOW_IN_LINES.map((lineId) => ({ section: '입금' as const, lineId })),
      ...CASHFLOW_OUT_LINES.map((lineId) => ({ section: '출금' as const, lineId })),
    ];
    const rows = lineDefs.map(({ section, lineId }) => {
      const cells = annualWeeks.map((week) => {
        const comparisonWeek = comparisonByMonth.get(week.yearMonth)?.weeks.find((candidate) => candidate.weekNo === week.weekNo);
        const comparisonLine = comparisonWeek?.lines.find((candidate) => candidate.lineId === lineId);
        return {
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
          weekLabel: week.label,
          weekRange: week.weekStart && week.weekEnd ? `${week.weekStart} ~ ${week.weekEnd}` : '',
          projection: comparisonLine?.projection ?? 0,
          actual: comparisonLine?.actual ?? 0,
          difference: comparisonWeek ? (comparisonWeek.amounts[lineId] ?? 0) : null,
        };
      });
      return {
        section,
        lineId,
        label: getCashflowModeLineLabel(lineId, 'projection'),
        cells,
        changed: cells.some((cell) => cell.difference !== null && cell.difference !== 0),
      };
    });
    return {
      rows,
      changedRows: rows.filter((row) => row.changed),
      changedCellCount: rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.difference !== null && cell.difference !== 0).length, 0),
    };
  }, [annualWeeks, cashflowSnapshot]);

  const cashflowTotalPeriodLabel = cashflowSheetRange?.label || `${selectedYear}년`;
  const sheetRangeLabel = cashflowSheetConfig
    ? `${cashflowSheetConfig.sheetName || '시트 탭'} · ${cashflowSheetConfig.startWeek || '전체'} ~ ${cashflowSheetConfig.endWeek || '전체'}`
    : '연결된 Google Sheet가 없습니다.';
  const sheetIdentityLabel = cashflowSheetConfig
    ? cashflowSheetConfig.spreadsheetTitle || cashflowSheetConfig.spreadsheetId || 'Google Sheet'
    : '시트 연결 필요';
  const sheetMirrorStatus = cashflowSheetMirror?.status || 'EMPTY';
  const sheetMirrorCapturedAt = formatSheetAppliedAt(cashflowSheetMirror?.capturedAt)
    || cashflowSheetMirror?.capturedAt
    || '';

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
      diffCellCount: projectionActualComparison.changedCellCount,
      labor: {
        nextMonthProjectionWritten: laborRisk ? laborRisk.labor.nextMonthProjection.isWritten : true,
        missingProjectionMonthCount: laborRisk ? laborRisk.labor.missingProjectionMonths.length : 0,
        shortageStatus: laborRisk ? laborRisk.shortage.status : 'ok',
        shortageWeekLabel: laborRisk?.shortage.week?.label || null,
        shortageAmount: laborRisk?.shortage.shortageAmount || 0,
      },
    });
  }, [annualWeeks, byYearMonthWeek, laborRisk, projectionActualComparison.changedCellCount, todayIso]);

  const markDirty = useCallback((input: { yearMonth?: string; weekNo: number; mode: 'projection' | 'actual' }) => {
    const wkKey = resolveWeekKey({ yearMonth: input.yearMonth || yearMonth, mode: input.mode, weekNo: input.weekNo });
    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'dirty' }));
  }, [resolveWeekKey, yearMonth]);

  const handleSaveWeekValues = useCallback((input: {
    yearMonth?: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }) => {
    if (input.mode === 'actual') {
      toast.info('Actual 금액은 사용내역 연동값이라 화면에서 수정하지 않습니다.');
      return;
    }
    void savePrivateCashflowDraft()
      .then(() => toast.success('작성자 전용 임시저장본을 저장했습니다.'))
      .catch((error) => {
        toast.error(resolveApiErrorMessage(error, '임시저장에 실패했습니다.'));
      });
  }, [savePrivateCashflowDraft]);

  const handleSaveBoardWeekValues = useCallback((input: {
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
  }) => {
    if (input.mode === 'actual') {
      toast.info('Actual 금액은 사용내역 연동값이라 화면에서 수정하지 않습니다.');
      return;
    }
    void savePrivateCashflowDraft()
      .then(() => toast.success('작성자 전용 임시저장본을 저장했습니다.'))
      .catch((error) => {
        toast.error(resolveApiErrorMessage(error, '임시저장에 실패했습니다.'));
      });
  }, [savePrivateCashflowDraft]);

  const handleSubmitWeek = useCallback(async (input: { weekNo: number; yearMonth: string }) => {
    setSubmitBusy(true);
    try {
      const mutationLease = await cashflowLease.checkBeforeMutation();
      await submitWeekAsPm({ projectId, yearMonth: input.yearMonth, weekNo: input.weekNo, cashflowLease: mutationLease, finalize: true });
      await completePrivateCashflowDraft(mutationLease);
      await cashflowLease.checkStatus();
      await loadCashflowEvents();
      toast.success('작성완료 처리했습니다.');
    } catch (e) {
      toast.error('작성완료 처리에 실패했습니다.');
    } finally {
      setSubmitBusy(false);
      setSubmitConfirm(null);
    }
  }, [cashflowLease.checkBeforeMutation, cashflowLease.checkStatus, completePrivateCashflowDraft, loadCashflowEvents, projectId, submitWeekAsPm]);

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

      const mutationLease = await cashflowLease.checkBeforeMutation();
      await upsertWeekAmounts({
        projectId,
        yearMonth: targetYearMonth,
        weekNo,
        mode: 'projection',
        amounts,
        markCompleted: true,
        cashflowLease: mutationLease,
        finalize: true,
      });
      await completePrivateCashflowDraft(mutationLease);
      await cashflowLease.checkStatus();

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
    cashflowLease.checkBeforeMutation,
    cashflowLease.checkStatus,
    completePrivateCashflowDraft,
    getEffectiveAmount,
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
      const { amounts, issues: preparedIssues } = prepareAuditedWeekAmounts({
        yearMonth: targetYearMonth,
        weekNo,
        mode: 'projection',
      });
      const auditIssues = [
        ...preparedIssues,
        ...collectAuditIssues({ yearMonth: targetYearMonth, weekNo, mode: 'projection', amounts })
          .filter((issue) => !preparedIssues.some((prepared) => prepared.key === issue.key)),
      ];
      if (auditIssues.length > 0) {
        showAuditBlock('결산 전에 확인이 필요합니다', weekNo, auditIssues, targetYearMonth);
        throw new Error('cashflow_audit_validation_failed');
      }
      const mutationLease = await cashflowLease.checkBeforeMutation();
      await closeWeekAsAdmin({
        projectId,
        yearMonth: targetYearMonth,
        weekNo,
        projectionLines: Object.entries(amounts).map(([cashflowLine, amount]) => ({
          yearMonth: targetYearMonth,
          weekNo,
          cashflowLine,
          amount: Number(amount) || 0,
        })),
        cashflowLease: mutationLease,
        finalize: true,
      });
      await completePrivateCashflowDraft(mutationLease);
      await cashflowLease.checkStatus();
      await loadCashflowEvents();
      toast.success('결산완료 처리했습니다.');
    } catch (e) {
      toast.error('결산완료 처리에 실패했습니다.');
    } finally {
      setCloseBusy(false);
      setCloseDialog(null);
    }
  }, [cashflowLease.checkBeforeMutation, cashflowLease.checkStatus, closeWeekAsAdmin, completePrivateCashflowDraft, loadCashflowEvents, projectId, yearMonth]);

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
    const shouldHighlightMismatch = shouldHighlightProjectionAmountMismatch({ projection, actual });
    const isEditing = isWeekModeEditing({ yearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo }) || raw !== undefined;
    const bgClass = input.isThisWeek ? 'bg-blue-50/70' : 'bg-white';
    const isCollapsedEmpty = !showEmptyCashflowRows && !isEditing && projection === 0 && actual === 0 && raw === undefined;

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
    const bgClass = input.isThisWeek ? 'bg-blue-50/80' : 'bg-slate-50/80';
    const isCollapsedEmpty = !showEmptyCashflowRows && projection === 0 && actual === 0 && !persisted.hasValue;

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
    const computeBoardDerived = (mode: 'projection' | 'actual') => computeCashflowDerivedTotals({
      openingIn: mode === 'projection' ? yearOpeningTotalsByMode.projectionIn : yearOpeningTotalsByMode.actualIn,
      openingOut: mode === 'projection' ? yearOpeningTotalsByMode.projectionOut : yearOpeningTotalsByMode.actualOut,
      weeks: visibleWeeks.map((week) => ({
        weekNo: week.weekNo,
        amounts: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
          lineId,
          getBoardEffectiveAmount({ targetYearMonth: week.yearMonth, mode, weekNo: week.weekNo, lineId }),
        ])) as Partial<Record<CashflowSheetLineId, number>>,
      })),
    });
    const derived = {
      projection: computeBoardDerived('projection'),
      actual: computeBoardDerived('actual'),
    };
    const dirtyBoardWeeks = visibleWeeks.filter((week) => (
      weekSaveState[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })] === 'dirty'
    ));
    const boardIsEditing = visibleWeeks.some((week) => (
      isWeekModeEditing({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })
    ));
    const setBoardEditing = (editing: boolean) => {
      setShowEmptyCashflowRows((current) => (editing ? true : current));
      setEditingWeekModes((current) => {
        const next = { ...current };
        for (const week of visibleWeeks) {
          next[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })] = editing;
          next[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo })] = false;
        }
        return next;
      });
    };
    const startBoardEditing = () => {
      void beginCashflowEditing().then((started) => {
        if (started) setBoardEditing(true);
      });
    };
    const saveBoardDrafts = async () => {
      const weeksToSave = visibleWeeks.filter((week) => (
        weekSaveState[resolveWeekKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo })] === 'dirty'
      ));
      const lines = weeksToSave.flatMap((week) => {
        const persisted = byYearMonthWeek.get(`${week.yearMonth}:${week.weekNo}`);
        return CASHFLOW_ALL_LINES.flatMap((lineId) => {
          const key = resolveCellKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo, lineId });
          if (!Object.prototype.hasOwnProperty.call(drafts, key)) return [];
          const amount = parseAmount(drafts[key]);
          const before = getPersistedCell({ doc: persisted, mode: 'projection', lineId });
          return amount === before.amount && before.hasValue
            ? []
            : [{ yearMonth: week.yearMonth, weekNo: week.weekNo, cashflowLine: lineId, amount }];
        });
      });
      const finalMutationLease = await cashflowLease.checkBeforeMutation();
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      await saveCashflowProjectionBatchViaBff({
        tenantId: orgId,
        actor,
        projectId,
        lines,
        idempotencyKey: `cashflow-projection-final:${projectId}:${Date.now()}`,
        lease: finalMutationLease,
        finalize: true,
      });
      await completePrivateCashflowDraft(finalMutationLease);
      await cashflowLease.checkStatus();
      setDrafts((current) => {
        const next = { ...current };
        for (const week of weeksToSave) {
          for (const lineId of CASHFLOW_ALL_LINES) {
            delete next[resolveCellKey({ yearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo, lineId })];
          }
        }
        return next;
      });
      await Promise.all([
        loadCashflowSheetRangeWeeks(),
        loadCashflowEvents(),
        loadCashflowComparison(),
      ]);
      setBoardEditing(false);
    };
    const settleWeek = (week: MonthMondayWeek) => {
      void (async () => {
        await savePrivateCashflowDraft();
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
      })().catch(() => toast.error('결산 확인에 실패했습니다.'));
    };
    const scrollBoard = (direction: -1 | 1) => {
      const container = cashflowBoardScrollRef.current;
      if (!container) return;
      const weekColumn = container.querySelector<HTMLElement>('[data-cashflow-week-column="true"]');
      const weekWidth = weekColumn?.getBoundingClientRect().width || 84;
      container.scrollTo({
        left: getSnappedWeekScrollLeft({
          currentLeft: container.scrollLeft,
          direction,
          viewportWidth: container.clientWidth,
          maxScrollLeft: container.scrollWidth - container.clientWidth,
          weekWidth,
        }),
        behavior: 'smooth',
      });
    };
    const renderModeLineRows = (
      mode: 'projection' | 'actual',
      lineIds: CashflowSheetLineId[],
      rowTone: 'income' | 'expense',
    ) => lineIds.map((lineId) => {
      const emphasized = lineId === 'MYSC_PREPAY_IN' || lineId.startsWith('MYSC_PREPAY_');
      return (
        <tr key={`${mode}-${lineId}`} data-cashflow-row="line" className="border-t border-white">
          <td className={`sticky left-0 z-20 w-[192px] min-w-[192px] border-r-[6px] border-r-white px-3 py-1.5 text-[9px] leading-4 text-slate-900 ${rowTone === 'income' ? 'border-l-[3px] border-l-emerald-400 bg-emerald-50/80' : 'border-l-[3px] border-l-rose-400 bg-rose-50/80'} ${emphasized ? 'font-bold' : 'font-medium'}`}>
            {renderCashflowLineLabel(getCashflowModeLineLabel(lineId, mode))}
          </td>
          {visibleWeeks.map((week) => {
            const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
            return mode === 'projection'
              ? renderProjectionCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek })
              : renderActualCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek });
          })}
          {renderSummaryCell({
            keyName: `${mode}-${lineId}-range`,
            value: derived[mode].rowTotals[lineId] || 0,
            mode,
            stickyRight: true,
          })}
        </tr>
      );
    });
    const renderSummaryRow = (
      mode: 'projection' | 'actual',
      kind: 'totalIn' | 'totalOut' | 'net',
    ) => {
      const isIncome = kind === 'totalIn';
      const isExpense = kind === 'totalOut';
      const label = isIncome ? '입금 합계' : isExpense ? '출금 합계' : mode === 'projection' ? '잔액 (※ 중요)' : '잔액';
      const rowTone = isIncome ? 'income' : isExpense ? 'expense' : undefined;
      const emphasis = isIncome ? 'income' : isExpense ? 'expense' : 'balance';
      return (
        <tr key={`${mode}-${kind}`} data-cashflow-row={kind} className={`border-t-[6px] border-white ${isIncome ? 'bg-emerald-50/80' : isExpense ? 'bg-rose-50/80' : 'bg-slate-100/90'}`}>
          <td className={`sticky left-0 z-20 w-[192px] min-w-[192px] border-r-[6px] border-r-white px-3 py-2 text-[9px] font-bold ${isIncome ? 'bg-emerald-50 text-emerald-950' : isExpense ? 'bg-rose-50 text-rose-950' : 'bg-slate-100 text-slate-950'}`}>
            {label}
          </td>
          {visibleWeeks.map((week, index) => renderSummaryCell({
            keyName: `${mode}-${kind}-${week.yearMonth}-${week.weekNo}`,
            value: derived[mode].weekTotals[index]?.[kind] || 0,
            mode,
            isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
            emphasis,
            rowTone,
          }))}
          {renderSummaryCell({
            keyName: `${mode}-${kind}-range`,
            value: derived[mode].monthTotals[kind],
            mode,
            emphasis,
            stickyRight: true,
            rowTone,
          })}
        </tr>
      );
    };
    const renderModeTable = (mode: 'projection' | 'actual') => (
      <table className="w-full border-separate border-spacing-0 text-[8px]" style={{ minWidth: `${192 + visibleWeeks.length * 84 + 84}px` }}>
        <thead className="sticky top-0 z-40 bg-white/95 text-slate-600 backdrop-blur shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <tr>
            <th className="sticky left-0 z-50 w-[192px] min-w-[192px] border-r-[6px] border-r-white bg-white px-3 py-2 text-left text-[11px] font-bold text-slate-800">
              항목
            </th>
            {visibleWeeks.map((week) => {
              const saveState = weekSaveState[resolveWeekKey({ yearMonth: week.yearMonth, mode, weekNo: week.weekNo })];
              const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
              const doc = byYearMonthWeek.get(`${week.yearMonth}:${week.weekNo}`);
              return (
                <th key={`${mode}-${week.yearMonth}-${week.weekNo}`} data-cashflow-week-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-2 text-center align-top font-semibold ${isThisWeek ? 'bg-blue-50/90' : 'bg-slate-50/80'}`}>
                  <div className="relative min-h-5">
                    <span className="block truncate text-[10px] font-bold leading-5 text-slate-800">{week.label}</span>
                    {mode === 'projection' && canEdit ? (
                      <Button size="sm" variant="outline" className="absolute right-0 top-0 h-5 w-5 rounded-full border-0 bg-white/95 p-0 shadow-sm" onClick={() => settleWeek(week)} disabled={closeBusy} aria-label={`${week.label} 결산`} title={`${week.label} 결산`}>
                        <CheckCircle2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="truncate text-[8px] font-normal text-slate-400">{week.weekStart && week.weekEnd ? `${week.weekStart.slice(5)}~${week.weekEnd.slice(5)}` : '-'}</div>
                  <Badge className={`mt-1 h-3.5 w-full justify-center rounded-full border-0 px-1 text-[7px] ${mode === 'projection' ? (doc?.projectionUpdated ? 'bg-white text-slate-700' : 'bg-rose-100 text-rose-700') : (doc?.pmSubmitted || hasWrittenSheetValues(doc?.actual) ? 'bg-white text-slate-700' : 'bg-rose-100 text-rose-700')}`}>
                    {mode === 'projection' ? (doc?.projectionUpdated ? 'Prj 작성' : 'Prj 미작성') : (doc?.pmSubmitted || hasWrittenSheetValues(doc?.actual) ? 'Act 작성' : 'Act 미작성')}
                  </Badge>
                  {saveState === 'dirty' ? <Badge className="mt-0.5 h-3.5 rounded-full border-0 bg-sky-100 px-1 text-[7px] text-sky-700">미저장</Badge> : null}
                </th>
              );
            })}
            <th className="sticky right-0 z-50 min-w-[84px] border-l-[6px] border-l-white bg-white px-1 py-2 text-left text-[11px] font-bold text-slate-800 shadow-[-12px_0_24px_rgba(15,23,42,0.08)]">
              범위 합계
            </th>
          </tr>
        </thead>
        <tbody>
          {renderModeLineRows(mode, CASHFLOW_IN_LINES, 'income')}
          {renderSummaryRow(mode, 'totalIn')}
          {renderModeLineRows(mode, CASHFLOW_OUT_LINES, 'expense')}
          {renderSummaryRow(mode, 'totalOut')}
          {renderSummaryRow(mode, 'net')}
        </tbody>
      </table>
    );

    return (
      <Card className="overflow-hidden rounded-[24px] border-0 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-b from-white to-slate-50/70 px-5 py-4">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">캐시플로 진단시트</div>
              <div className="mt-1 text-[10px] text-slate-500">기준 범위 {cashflowTotalPeriodLabel} · Projection 입력 / Actual 조회</div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant={boardIsEditing ? 'default' : 'outline'} className="h-8 rounded-full px-3 text-[11px] shadow-sm" onClick={startBoardEditing} disabled={!canUseCashflowActions || boardIsEditing || cashflowLease.busy || !cashflowLease.sessionId}>
                {cashflowLease.busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Pencil className="mr-1 h-3 w-3" />}
                수정 시작
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 rounded-full border-0 bg-white px-3 text-[11px] shadow-sm" onClick={() => void savePrivateCashflowDraft().then(() => toast.success('작성자 전용 임시저장본을 저장했습니다.')).catch((error) => toast.error(resolveApiErrorMessage(error, '임시저장에 실패했습니다.')))} disabled={!canEdit || cashflowLease.busy || (!boardIsEditing && dirtyBoardWeeks.length === 0)}>
                <Save className="mr-1 h-3 w-3" />
                임시저장
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 rounded-full border-0 bg-white px-3 text-[11px] shadow-sm" onClick={() => void saveBoardDrafts().then(() => toast.success('최종저장했습니다.')).catch(() => toast.error('최종저장에 실패했습니다. 입력값은 임시저장본에 유지됩니다.'))} disabled={!canEdit || cashflowLease.busy || (!boardIsEditing && dirtyBoardWeeks.length === 0)}>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                최종저장
              </Button>
              {cashflowLease.canEdit ? (
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[10px]" onClick={() => void cashflowLease.extend()} disabled={cashflowLease.busy}>
                  {cashflowLease.remainingLabel} · 30분 연장
                </Button>
              ) : null}
            </div>
          </div>
          <div className="relative bg-slate-50/80 px-4 pb-4">
            <Button type="button" variant="outline" size="sm" className="absolute left-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)]" onClick={() => scrollBoard(-1)} aria-label="왼쪽 주차로 이동">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="absolute right-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)]" onClick={() => scrollBoard(1)} aria-label="오른쪽 주차로 이동">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div ref={cashflowBoardScrollRef} className="space-y-4 overflow-x-auto scroll-smooth rounded-[20px] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.55)]">
              <section data-cashflow-block="projection" data-cashflow-row-count={CASHFLOW_ALL_LINES.length + 3}>
                <h3 className="sticky left-0 z-30 w-fit px-3 py-2 text-[14px] font-bold text-slate-950">Projection</h3>
                {renderModeTable('projection')}
              </section>
              <section data-cashflow-block="actual" data-cashflow-row-count={CASHFLOW_ALL_LINES.length + 3}>
                <h3 className="sticky left-0 z-30 w-fit px-3 py-2 text-[14px] font-bold text-slate-950">ACTUAL</h3>
                {renderModeTable('actual')}
              </section>
            </div>
          </div>
          {isLoading ? <div className="px-3 py-2 text-[11px] text-slate-500">불러오는 중...</div> : null}
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
                                aria-label="임시저장"
                                title="임시저장"
                              >
                                {saveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />}
                                {!compact && '임시저장'}
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
    const rows = differenceViewMode === 'diff'
      ? projectionActualComparison.changedRows
      : projectionActualComparison.rows;
    if (cashflowComparisonLoading) {
      return <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">BFF 차이값을 불러오는 중...</div>;
    }
    if (cashflowComparisonError || !cashflowSnapshot) {
      return (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-6 text-center text-[12px] text-rose-700">
          {cashflowComparisonError || 'Projection - Actual 차이를 불러오지 못했습니다.'}
        </div>
      );
    }
    return (
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-slate-950">
                <HoverExplain message="BFF가 확정 원장의 Projection에서 Actual을 뺀 값을 반환합니다. 프론트는 계산하지 않고 표시만 합니다.">
                  Projection - Actual 차이
                </HoverExplain>
              </div>
              <div className="text-[10px] text-slate-500">
                BFF 기준일 {cashflowSnapshot.comparison.asOfDate} · 차이 = Projection - Actual
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant={differenceViewMode === 'diff' ? 'default' : 'outline'} className="h-8 rounded-full px-3 text-[11px]" onClick={() => setDifferenceViewMode('diff')}>
                차이만
              </Button>
              <Button type="button" size="sm" variant={differenceViewMode === 'all' ? 'default' : 'outline'} className="h-8 rounded-full px-3 text-[11px]" onClick={() => setDifferenceViewMode('all')}>
                전체
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-[18px] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.55)]">
            <table className="border-separate border-spacing-0 text-[11px]" style={{ minWidth: `${220 + annualWeeks.length * 96}px` }}>
              <thead className="bg-white text-slate-500">
                <tr>
                  <th className="sticky left-0 z-20 w-[220px] min-w-[220px] border-r-[6px] border-r-white bg-white px-3 py-2 text-left font-medium">항목</th>
                  {annualWeeks.map((week) => (
                    <th key={`${week.yearMonth}-${week.weekNo}`} className="min-w-[96px] border-l-[6px] border-l-white bg-slate-50/80 px-2 py-2 text-right font-medium">
                      <div>{week.label}</div>
                      {formatShortWeekRange(week) ? <div className="text-[9px] font-normal text-slate-400">{formatShortWeekRange(week)}</div> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={annualWeeks.length + 1} className="px-3 py-8 text-center text-[12px] text-slate-500">
                      Projection과 Actual 차이가 없습니다.
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.lineId} className="border-t-[6px] border-white">
                    <td className={`sticky left-0 z-10 w-[220px] min-w-[220px] border-r-[6px] border-r-white px-3 py-2 ${row.section === '입금' ? 'border-l-[3px] border-l-emerald-400 bg-emerald-50/80' : 'border-l-[3px] border-l-rose-400 bg-rose-50/80'}`}>
                      <div className="truncate text-slate-900">{row.label}</div>
                    </td>
                    {row.cells.map((cell) => {
                      const differenceClass = cell.difference === null || cell.difference === 0
                        ? 'text-slate-300'
                        : cell.difference > 0
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-rose-50 text-rose-700';
                      return (
                        <td
                          key={`${row.lineId}-${cell.yearMonth}-${cell.weekNo}`}
                          className={`min-w-[96px] border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums ${differenceClass}`}
                          title={cell.difference === null ? `${cell.weekRange}\nBFF 비교 대상 기간 아님` : `${cell.weekRange}\nProjection ${fmt(cell.projection)} / Actual ${fmt(cell.actual)} / 차이 ${fmtSigned(cell.difference)}\n${diffColorExplanation(row.section, cell.difference)}`}
                        >
                          {cell.difference === null ? '-' : fmtSigned(cell.difference)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <FileSpreadsheet className={`mt-0.5 h-4 w-4 shrink-0 ${cashflowSheetConfig ? 'text-blue-600' : 'text-amber-700'}`} />
                <div className="min-w-0">
                  <div className="font-bold">시트 연동</div>
                  <div className={`mt-0.5 truncate ${cashflowSheetConfig ? 'text-blue-800' : 'text-amber-800'}`}>
                    {cashflowSheetConfig ? `${sheetIdentityLabel} · ${sheetRangeLabel}` : 'Google Sheet 연결 후 변경 후보를 검토할 수 있습니다.'}
                  </div>
                  <div className={`mt-1 text-[10px] leading-4 ${cashflowSheetConfig ? 'text-blue-800' : 'text-amber-800'}`}>
                    {cashflowSheetConfig
                      ? '버튼을 눌렀을 때만 시트 최신값을 가져와 고정하며, 검토와 원장 저장은 별도 단계입니다.'
                      : '처음 설정한 뒤 이 영역에서 시트 연동하기를 직접 실행합니다.'}
                  </div>
                  {cashflowSheetConfig ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <Badge className={`rounded-full border-0 px-2 py-0.5 text-[9px] ${
                        sheetMirrorStatus === 'FRESH'
                          ? 'bg-emerald-100 text-emerald-800'
                          : sheetMirrorStatus === 'STALE'
                            ? 'bg-amber-100 text-amber-800'
                            : sheetMirrorStatus === 'ERROR'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-slate-100 text-slate-600'
                      }`}>
                        {sheetMirrorStatus}
                      </Badge>
                      {sheetMirrorCapturedAt ? (
                        <span className={sheetMirrorStatus === 'STALE' ? 'text-amber-800' : 'text-blue-800'}>
                          {sheetMirrorStatus === 'STALE' ? '마지막 정상 고정' : '고정'} {sheetMirrorCapturedAt}
                        </span>
                      ) : null}
                      {cashflowSheetMirror?.summary ? (
                        <span className="text-blue-700">값 {cashflowSheetMirror.summary.valueCount.toLocaleString()}건</span>
                      ) : null}
                      {cashflowSheetMirror?.lastRefreshError?.message ? (
                        <span className={sheetMirrorStatus === 'ERROR' ? 'text-rose-700' : 'text-amber-800'}>
                          {cashflowSheetMirror.lastRefreshError.message}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {sheetRefreshResult ? (
                    <div className="mt-1 font-semibold text-emerald-800">
                      비교 결과 {sheetRefreshResult.stagedLineCount.toLocaleString()}건 · Projection {sheetRefreshResult.projectionLineCount.toLocaleString()}건 · Actual {sheetRefreshResult.actualLineCount.toLocaleString()}건
                      {sheetRefreshResult.riskLineCount > 0 ? ` · 확인 필요 ${sheetRefreshResult.riskLineCount.toLocaleString()}건` : ''}
                    </div>
                  ) : cashflowSheetConfig?.lastAppliedAt ? (
                    <div className="mt-1 text-blue-800">
                      마지막 반영 {formatSheetAppliedAt(cashflowSheetConfig.lastAppliedAt) || cashflowSheetConfig.lastAppliedAt}
                      {cashflowSheetConfig.lastAppliedBy?.email || cashflowSheetConfig.lastAppliedBy?.uid ? ` · 실행자 ${cashflowSheetConfig.lastAppliedBy.email || cashflowSheetConfig.lastAppliedBy.uid}` : ''}
                      {typeof cashflowSheetConfig.lastAppliedLineCount === 'number' ? ` · 반영 ${cashflowSheetConfig.lastAppliedLineCount.toLocaleString()}건` : ''}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-7 rounded-full px-2.5 text-[10px] font-semibold transition-transform hover:-translate-y-0.5 ${cashflowSheetConfig ? 'border-blue-200 bg-white text-blue-700' : 'border-amber-300 bg-white text-amber-800'}`}
                  onClick={() => void handleRefreshSheetMirror()}
                  disabled={!cashflowSheetConfig?.value || sheetRefreshLoading}
                >
                  {sheetRefreshLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  {cashflowSheetMirror?.sourceRevision ? '최신값 다시 가져오기' : '시트 연동하기'}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={`h-7 rounded-full px-2.5 text-[10px] font-semibold transition-transform hover:-translate-y-0.5 ${cashflowSheetConfig ? 'border-blue-200 bg-white text-blue-700' : 'border-amber-300 bg-white text-amber-800'}`}
                      onClick={handleOpenSheetReviewDialog}
                      disabled={sheetRefreshLoading || sheetMirrorStatus !== 'FRESH'}
                    >
                      <ClipboardCheck className="mr-1 h-3 w-3" />
                      변경 내용 검토
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] bg-slate-950 text-[11px] leading-relaxed text-white">
                    고정된 시트 값만 원장과 비교합니다. 저장 버튼을 누르기 전에는 원장이 바뀌지 않습니다.
                  </TooltipContent>
                </Tooltip>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-7 rounded-full px-2.5 text-[10px] transition-transform hover:-translate-y-0.5 ${cashflowSheetConfig ? 'border-blue-200 bg-white text-blue-700' : 'border-amber-300 bg-white text-amber-800'}`}
                  onClick={() => navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)}
                >
                  {cashflowSheetConfig ? '시트 설정' : '시트 연동 설정'}
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

  function cashflowCandidateRiskLabel(flag: string): string {
    if (flag === 'actual_overwrites_existing') return '기존 Actual 변경';
    if (flag === 'closed_week_change') return '결산 주차';
    return flag;
  }

  function cashflowCandidateBeforeLabel(candidate: CashflowSheetLabChangeCandidate): string {
    return candidate.beforeHadValue ? `${fmt(Number(candidate.beforeAmount || 0))}원` : '원장 미작성';
  }

  function cashflowCandidateProposedLabel(candidate: CashflowSheetLabChangeCandidate): string {
    return candidate.proposedHadValue ? `${fmt(Number(candidate.proposedAmount || 0))}원` : '미작성';
  }

  function renderSheetStageCandidateCell(key: string, candidate?: CashflowSheetLabChangeCandidate) {
    if (!candidate) {
      return (
        <td key={key} className="min-w-[108px] border-l-[6px] border-l-white bg-white px-1.5 py-1 text-right text-[9px] text-slate-300">
          -
        </td>
      );
    }
    const hasRisk = Boolean(candidate.riskFlags?.length);
    return (
      <td key={key} className={`min-w-[108px] border-l-[6px] border-l-white px-1.5 py-1 text-right align-top ${hasRisk ? 'bg-amber-50' : 'bg-emerald-50/70'}`}>
        <div className="text-[8px] leading-3 text-slate-400">{cashflowCandidateBeforeLabel(candidate)}</div>
        <div className={`text-[10px] font-bold leading-4 ${hasRisk ? 'text-amber-900' : 'text-slate-950'}`}>{cashflowCandidateProposedLabel(candidate)}</div>
        <div className="mt-0.5 flex justify-end">
          {hasRisk ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[7px] font-semibold text-amber-800">
              {candidate.riskFlags?.map(cashflowCandidateRiskLabel).join(', ')}
            </span>
          ) : (
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[7px] font-semibold text-emerald-700">저장 대상</span>
          )}
        </div>
      </td>
    );
  }

  function renderSheetStageReviewGrid(dialog: NonNullable<typeof sheetStageDialog>) {
    const weeks = Array.from(
      new Map(dialog.candidates.map((candidate) => [
        `${candidate.yearMonth}:${candidate.weekNo}`,
        { yearMonth: candidate.yearMonth, weekNo: candidate.weekNo },
      ])).values(),
    ).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo);
    const byCell = new Map(dialog.candidates.map((candidate) => [
      `${candidate.mode}:${candidate.yearMonth}:${candidate.weekNo}:${candidate.lineId}`,
      candidate,
    ]));
    const renderRows = (lineIds: CashflowSheetLineId[], tone: 'income' | 'expense') => lineIds.flatMap((lineId) => {
      const labelClass = tone === 'income'
        ? 'bg-emerald-50/80 border-l-[3px] border-l-emerald-400'
        : 'bg-rose-50/80 border-l-[3px] border-l-rose-400';
      const projectionRow = (
        <tr key={`${lineId}-projection`} className="border-t border-white">
          <td rowSpan={2} className={`sticky left-0 z-20 w-[132px] min-w-[132px] border-r-[6px] border-r-white px-2.5 py-1.5 text-[8px] font-semibold leading-4 text-slate-900 ${labelClass}`}>
            {renderCashflowLineLabel(CASHFLOW_SHEET_LINE_LABELS[lineId])}
          </td>
          <td className="sticky left-[132px] z-10 w-[70px] min-w-[70px] border-r-[6px] border-r-white bg-white px-1 py-1 text-[8px] font-semibold text-slate-700">Projection</td>
          {weeks.map((week) => renderSheetStageCandidateCell(
            `projection:${week.yearMonth}:${week.weekNo}:${lineId}`,
            byCell.get(`projection:${week.yearMonth}:${week.weekNo}:${lineId}`),
          ))}
        </tr>
      );
      const actualRow = (
        <tr key={`${lineId}-actual`} className="border-t border-white">
          <td className="sticky left-[132px] z-10 w-[70px] min-w-[70px] border-r-[6px] border-r-white bg-slate-100/80 px-1 py-1 text-[8px] font-semibold text-slate-500">Actual</td>
          {weeks.map((week) => renderSheetStageCandidateCell(
            `actual:${week.yearMonth}:${week.weekNo}:${lineId}`,
            byCell.get(`actual:${week.yearMonth}:${week.weekNo}:${lineId}`),
          ))}
        </tr>
      );
      return [projectionRow, actualRow];
    });

    if (weeks.length === 0) {
      return <div className="px-3 py-6 text-center text-[12px] text-slate-500">새로 표시할 변경 값이 없습니다.</div>;
    }

    return (
      <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-separate border-spacing-0 text-[8px]" style={{ minWidth: `${202 + weeks.length * 108}px` }}>
          <thead className="sticky top-0 z-40 bg-white/95 text-slate-600 backdrop-blur shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
            <tr>
              <th className="sticky left-0 z-50 w-[132px] min-w-[132px] border-r-[6px] border-r-white bg-white px-2 py-2 text-left text-[11px] font-bold text-slate-800">항목</th>
              <th className="sticky left-[132px] z-50 w-[70px] min-w-[70px] border-r-[6px] border-r-white bg-white px-1 py-2 text-left text-[11px] font-bold text-slate-800">구분</th>
              {weeks.map((week) => (
                <th key={`${week.yearMonth}:${week.weekNo}`} className="min-w-[108px] border-l-[6px] border-l-white bg-slate-50/80 px-1.5 py-2 text-center text-[10px] font-bold text-slate-800">
                  {formatSheetWeekLabel(week.yearMonth, week.weekNo)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderRows(CASHFLOW_IN_LINES, 'income')}
            {renderRows(CASHFLOW_OUT_LINES, 'expense')}
          </tbody>
        </table>
      </div>
    );
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
                시트 변경 가져오기, 저장, 작성완료, 결산을 실행하면 여기에 기록됩니다.
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
      <section data-cashflow-block="comparison" className="space-y-3 rounded-[24px] bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-100">
            <Columns2 className="h-4 w-4 text-slate-600" />
          </span>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">Projection - Actual 차이</div>
            <div className="text-[10px] text-slate-500">기준 범위 {cashflowTotalPeriodLabel}</div>
          </div>
        </div>
        {renderProjectionActualDiffTable()}
      </section>

      {renderUnifiedMonthlyBoard()}

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        {renderOperationsPanel()}
        {renderOpsTimeline()}
      </section>

      <AlertDialog
        open={sheetReviewDialogOpen}
        onOpenChange={(open) => setSheetReviewDialogOpen(open)}
      >
        <AlertDialogContent className="max-w-[760px]">
          <AlertDialogHeader>
            <AlertDialogTitle>시트 업데이트 반영</AlertDialogTitle>
            <AlertDialogDescription>
              고정해 둔 시트 값을 원장과 비교합니다. 저장 버튼을 누르기 전까지 원장은 바뀌지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-950">
                  <ArrowDownToLine className="h-4 w-4 text-blue-600" />
                  시트에서 가져오기
                </div>
                <div className="mt-1 text-[11px] leading-5 text-slate-600">
                  마지막으로 고정한 Projection/Actual 값을 원장과 비교합니다. 이 단계에서는 Google Sheet를 다시 읽지 않습니다.
                </div>
              </div>
              <Badge className={`w-fit rounded-full border-0 px-2.5 py-1 text-[10px] ${sheetMirrorStatus === 'FRESH' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {sheetMirrorStatus}
              </Badge>
            </div>
            <div className="flex items-start gap-2 rounded-[12px] border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-900">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>현재 선택: {sheetMirrorCapturedAt || '최근'} 고정본을 원장 값과 나란히 확인합니다.</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['1', '고정본 선택', '명시적으로 연동한 시트 고정본을 사용합니다.'],
                ['2', '값 비교', '원장과 다른 셀을 모두 보여줍니다.'],
                ['3', '검토 후 저장', '팝업에서 확정하면 원장에 저장합니다.'],
              ].map(([step, title, detail]) => (
                <div key={step} className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{step}</span>
                    <span className="text-[11px] font-bold text-slate-900">{title}</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</div>
                </div>
              ))}
            </div>
            <div className={`rounded-[12px] border px-3 py-2 text-[11px] leading-5 ${cashflowSheetConfig ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {cashflowSheetConfig
                ? `${sheetIdentityLabel} · ${sheetRangeLabel}`
                : '먼저 Google Sheet 공유 권한과 시트 범위를 설정해야 합니다.'}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            {!cashflowSheetConfig?.value ? (
              <AlertDialogAction onClick={() => navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)}>
                시트 연동 설정
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={() => void handleStartSheetChangeReview()} disabled={sheetRefreshLoading || sheetMirrorStatus !== 'FRESH'} className="transition-transform hover:-translate-y-0.5">
                {sheetRefreshLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                고정값 비교하기
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!sheetStageDialog}
        onOpenChange={(open) => {
          if (!open) setSheetStageDialog(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[1100px]">
          <AlertDialogHeader>
            <AlertDialogTitle>시트 값 비교 {sheetStageDialog?.stagedLineCount.toLocaleString() || 0}건</AlertDialogTitle>
            <AlertDialogDescription>
              원장은 아직 변경되지 않았습니다. 아래 변경 범위를 확인한 뒤 이 팝업에서 바로 저장합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {sheetStageDialog && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-emerald-50 px-3 py-2 transition-transform hover:-translate-y-0.5">
                  <div className="text-[10px] font-semibold text-emerald-700">
                    <HoverExplain message="확인 필요 표시가 없어 바로 저장 가능한 변경입니다. 저장 버튼은 이 항목만 반영합니다.">
                      바로 저장 가능
                    </HoverExplain>
                  </div>
                  <div className="mt-1 text-[16px] font-bold text-emerald-900">{Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount).toLocaleString()}건</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 transition-transform hover:-translate-y-0.5">
                  <div className="text-[10px] font-semibold text-slate-500">
                    <HoverExplain message="시트의 Projection 셀과 현재 캐시플로우 원장이 다른 항목입니다.">
                      Projection
                    </HoverExplain>
                  </div>
                  <div className="mt-1 text-[16px] font-bold text-slate-950">{sheetStageDialog.projectionLineCount.toLocaleString()}건</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 transition-transform hover:-translate-y-0.5">
                  <div className="text-[10px] font-semibold text-slate-500">
                    <HoverExplain message="시트의 Actual 셀과 현재 캐시플로우 원장이 다른 항목입니다. Actual은 시트에서만 입력한다고 보고 반영합니다.">
                      Actual
                    </HoverExplain>
                  </div>
                  <div className="mt-1 text-[16px] font-bold text-slate-950">{sheetStageDialog.actualLineCount.toLocaleString()}건</div>
                </div>
                <div className="rounded-lg bg-amber-50 px-3 py-2 transition-transform hover:-translate-y-0.5">
                  <div className="text-[10px] font-semibold text-amber-700">
                    <HoverExplain message="닫힌 주차처럼 바로 저장하지 않고 별도 검토가 필요한 항목입니다. 저장 버튼은 검토 완료 항목만 반영합니다.">
                      확인 필요
                    </HoverExplain>
                  </div>
                  <div className="mt-1 text-[16px] font-bold text-amber-900">{sheetStageDialog.riskLineCount.toLocaleString()}건</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
                Actual은 기존 값이 있어도 시트 값을 기준으로 덮어씁니다. 확인 필요 표시가 있는 행은 원장에 저장되지 않으니 별도로 확인해 주세요.
              </div>
              {renderSheetStageReviewGrid(sheetStageDialog)}
              {sheetStageDialog.omittedCandidateCount > 0 ? (
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  표시되지 않은 변경 값 {sheetStageDialog.omittedCandidateCount.toLocaleString()}건
                </div>
              ) : null}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sheetStageApplyLoading}>닫기</AlertDialogCancel>
            <Button
              type="button"
              className="transition-transform hover:-translate-y-0.5"
              disabled={sheetStageApplyLoading || !sheetStageDialog || Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount) <= 0}
              onClick={() => void handleApplyStagedSheetValues()}
            >
              {sheetStageApplyLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              {sheetStageDialog && Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount) > 0
                ? `검토한 값 ${Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount).toLocaleString()}건 원장에 저장`
                : '저장할 변경 없음'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          if (!open && !exitBusy && blocker.state === 'blocked') {
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
            <AlertDialogCancel disabled={exitBusy} onClick={() => blocker.reset?.()}>계속 편집</AlertDialogCancel>
            <AlertDialogAction
              disabled={exitBusy}
              onClick={(event) => {
                event.preventDefault();
                void savePrivateDraftAndLeave();
              }}
            >
              임시저장 후 나가기
            </AlertDialogAction>
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

      <EditLeaseDialogs
        warningOpen={cashflowLease.warningOpen}
        expiredOpen={cashflowLease.expiredOpen}
        conflictOpen={cashflowLease.conflictOpen}
        holder={cashflowLease.holder}
        busy={cashflowLease.busy}
        onDismissWarning={cashflowLease.dismissWarning}
        onExtend={() => { void cashflowLease.extend(); }}
        onContinueReadOnly={cashflowLease.continueReadOnly}
        onReacquire={() => { void beginCashflowEditing(); }}
        onTakeover={() => { void beginCashflowEditing(true); }}
      />
    </div>
  );
}
