import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { ArrowDownToLine, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Columns2, FileSpreadsheet, Loader2, RefreshCw, Save } from 'lucide-react';
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
} from '../../data/types';
import { getSeoulTodayIso } from '../../platform/business-days';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../../platform/cashflow-sheet';
import { getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { useAuth } from '../../data/auth-store';
import { hasUnsavedChanges } from './cashflow-unsaved';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance, getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import {
  fetchCashflowSnapshotViaBff,
  fetchCashflowActivityViaBff,
  closeCashflowMonthViaBff,
  decideCashflowMonthReopenViaBff,
  fetchCashflowMonthCloseViaBff,
  requestCashflowMonthReopenViaBff,
  type CashflowMonthCloseCell,
  type CashflowMonthCloseDraftInput,
  type CashflowMonthCloseResult,
  type CashflowDeadlineSummary,
  type CashflowSnapshotResult,
  type CashflowActivityEvent,
} from '../../lib/platform-bff-client';
import { getCashflowModeLineLabel } from '../../platform/policies/cashflow-policy';
import { getSnappedWeekScrollLeft } from './cashflow-board-scroll';
import type { CashflowOpsTone } from './cashflow-ops-summary';
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
import {
  applyCashflowMonthCloseProjectionDrafts,
  buildCashflowMonthCloseDraftInput,
  cashflowMonthCloseConfirmationKey,
  cashflowMonthCloseReviewProgress,
  createEmptyCashflowMonthCloseDepositRows,
  normalizeCashflowMonthCloseCells,
  readCashflowMonthCloseReview,
  requiredCashflowMonthCloseDecision,
  type CashflowMonthCloseDecisionMap,
  type CashflowMonthCloseDepositReviewRow,
  type CashflowManagementDecisionMap,
} from './cashflow-month-close';

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toLocaleString('ko-KR')}`;
}

const FINANCIAL_YEAR_CHECK_FIELDS = [
  { key: 'contractAmount', label: '입금예정' },
  { key: 'salesVatAmount', label: '매출 부가세' },
  { key: 'totalRevenueAmount', label: 'MYSC 수익' },
  { key: 'supportAmount', label: '팀지원금' },
] as const;

function formatSheetAppliedAt(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

type CashflowEvent = CashflowActivityEvent & { revertedAt?: string };

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
  projectName,
  roleOverride,
}: {
  projectId: string;
  projectName?: string;
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
  const isPm = role === 'pm';
  const canReviewReopen = role === 'finance' || role === 'admin';
  const canUseCashflowActions = isPm;
  const todayIso = getSeoulTodayIso();
  const todayYearMonth = todayIso.slice(0, 7);
  const bffActor = useMemo(() => ({
    uid: user?.uid || 'cashflow-user',
    email: user?.email || '',
    role: role || user?.role || 'workspace_user',
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
    setYearMonth,
    weeks,
    isLoading,
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
  const [cashflowSheetConfigLoaded, setCashflowSheetConfigLoaded] = useState(false);
  const [rangeLoadedWeeks, setRangeLoadedWeeks] = useState<CashflowWeekSheet[]>([]);
  const [cashflowSnapshot, setCashflowSnapshot] = useState<CashflowSnapshotResult | null>(null);
  const [cashflowComparisonLoading, setCashflowComparisonLoading] = useState(false);
  const [cashflowComparisonError, setCashflowComparisonError] = useState<string | null>(null);
  const [cashflowSheetMirror, setCashflowSheetMirror] = useState<CashflowSheetLabMirrorResult | null>(null);
  const [monthCloseResult, setMonthCloseResult] = useState<CashflowMonthCloseResult | null>(null);
  const [monthCloseLoading, setMonthCloseLoading] = useState(false);
  const [monthCloseError, setMonthCloseError] = useState<string | null>(null);
  const [monthCloseBusy, setMonthCloseBusy] = useState(false);
  const [monthCloseReviewOpen, setMonthCloseReviewOpen] = useState(false);
  const [monthCloseDecisions, setMonthCloseDecisions] = useState<CashflowMonthCloseDecisionMap>({});
  const [managementDecisions, setManagementDecisions] = useState<CashflowManagementDecisionMap>({});
  const [monthCloseDepositRows, setMonthCloseDepositRows] = useState<CashflowMonthCloseDepositReviewRow[]>(
    () => createEmptyCashflowMonthCloseDepositRows(),
  );
  const [monthCloseReviewDirty, setMonthCloseReviewDirty] = useState(false);
  const [reopenAction, setReopenAction] = useState<'request' | 'approve' | 'reject' | null>(null);
  const [reopenReason, setReopenReason] = useState('');
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
    replaceAllActualSources: boolean;
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
  const cashflowSnapshotRange = useMemo(() => {
    const configuredStart = parseCashflowSheetWeekLabel(cashflowSheetRange?.startWeek);
    const configuredEnd = parseCashflowSheetWeekLabel(cashflowSheetRange?.endWeek);
    return {
      start: configuredStart
        ? { yearMonth: configuredStart.yearMonth, weekNo: configuredStart.weekNo }
        : { yearMonth: `${selectedYear}-01`, weekNo: 1 },
      end: configuredEnd
        ? { yearMonth: configuredEnd.yearMonth, weekNo: configuredEnd.weekNo }
        : { yearMonth: `${selectedYear}-12`, weekNo: 5 },
    };
  }, [cashflowSheetRange?.endWeek, cashflowSheetRange?.startWeek, selectedYear]);
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
  const [showEmptyCashflowRows, setShowEmptyCashflowRows] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingWeekModes, setEditingWeekModes] = useState<Record<string, boolean>>({});
  const cashflowBoardScrollRef = useRef<HTMLDivElement | null>(null);

  type WeekSaveState = 'dirty' | 'saving' | 'error' | 'saved';
  const [weekSaveState, setWeekSaveState] = useState<Record<string, WeekSaveState>>({});
  const [privateDraftRevision, setPrivateDraftRevision] = useState<number | null>(null);
  const [privateDraftPayload, setPrivateDraftPayload] = useState<Record<string, unknown>>({});
  const loadedPrivateDraftKeyRef = useRef('');
  const privateDraftLoadRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const [exitBusy, setExitBusy] = useState(false);
  const canEdit = canUseCashflowActions
    && cashflowLease.canEdit
    && monthCloseResult?.status === 'OPEN';

  const hasDirty = useMemo(
    () => hasUnsavedChanges(weekSaveState) || Object.keys(drafts).length > 0 || monthCloseReviewDirty,
    [drafts, monthCloseReviewDirty, weekSaveState],
  );
  const hasActiveEditSession = cashflowLease.canEdit && Boolean(cashflowLease.ownership);
  const blocker = useBlocker(hasDirty || hasActiveEditSession);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasDirty && !hasActiveEditSession) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasActiveEditSession, hasDirty]);

  useEffect(() => {
    setDrafts({});
    setEditingWeekModes({});
    setWeekSaveState({});
    setPrivateDraftRevision(null);
    setPrivateDraftPayload({});
    setMonthCloseResult(null);
    setMonthCloseDecisions({});
    setManagementDecisions({});
    setMonthCloseDepositRows(createEmptyCashflowMonthCloseDepositRows());
    setMonthCloseReviewDirty(false);
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

  useEffect(() => {
    const restored = readCashflowMonthCloseReview(
      privateDraftPayload.monthCloseReview || privateDraftPayload.monthClose,
      yearMonth,
    );
    if (restored) {
      setMonthCloseDecisions(restored.decisions);
      setMonthCloseDepositRows(restored.depositScheduleRows);
      setManagementDecisions(restored.managementDecisions);
    } else {
      setMonthCloseDecisions({});
      setManagementDecisions({});
      setMonthCloseDepositRows(createEmptyCashflowMonthCloseDepositRows());
    }
    setMonthCloseReviewDirty(false);
  }, [privateDraftPayload, yearMonth]);

  const beginCashflowEditing = useCallback(async (resumePrevious = false): Promise<boolean> => {
    if (!isPm || monthCloseResult?.status !== 'OPEN') {
      toast.info(monthCloseResult?.status === 'CLOSED'
        ? '월 결산 완료 후에는 수정할 수 없습니다. 재오픈을 요청해 주세요.'
        : 'PM만 결산 전 캐시플로를 수정할 수 있습니다.');
      return false;
    }
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
  }, [cashflowLease.acquire, cashflowLease.release, cashflowLease.takeover, cashflowPrivateDraftClient, hydrateCashflowPrivateDraft, isPm, monthCloseResult?.status]);

  const savePrivateCashflowDraft = useCallback(async (
    monthCloseInput?: CashflowMonthCloseDraftInput,
    providedLease?: CashflowMutationLease,
  ): Promise<number> => {
    if (!cashflowPrivateDraftClient) throw new Error('임시저장 API가 준비되지 않았습니다.');
    const mutationLease = providedLease || await cashflowLease.checkBeforeMutation();
    let revision = privateDraftRevision;
    let payload = privateDraftPayload;
    if (revision === null) {
      const opened = await cashflowPrivateDraftClient.open(mutationLease);
      revision = opened.draft.draftRevision;
      payload = opened.draft.payload;
    }
    const reviewConfirmations = Object.entries(monthCloseDecisions).flatMap(([key, decision]) => {
      if (!decision) return [];
      const [mode, weekNo, ...lineParts] = key.split(':');
      if ((mode !== 'projection' && mode !== 'actual') || !Number.isInteger(Number(weekNo)) || lineParts.length === 0) return [];
      return [{ mode, weekNo: Number(weekNo), cashflowLine: lineParts.join(':'), decision }];
    });
    const managementConfirmations = Object.entries(managementDecisions).flatMap(([checkId, decision]) => (
      decision ? [{ checkId, decision }] : []
    ));
    const nextPayload = {
      ...payload,
      board: { drafts, weekSaveState, yearMonth },
      monthCloseReview: {
        yearMonth,
        confirmations: reviewConfirmations,
        managementConfirmations,
        depositScheduleRows: monthCloseDepositRows,
      },
      ...(monthCloseInput ? { monthClose: monthCloseInput } : {}),
    };
    const { draft } = await cashflowPrivateDraftClient.save(mutationLease, {
      expectedDraftRevision: revision,
      payload: nextPayload,
    });
    setPrivateDraftRevision(draft.draftRevision);
    setPrivateDraftPayload(draft.payload);
    setMonthCloseReviewDirty(false);
    return draft.draftRevision;
  }, [
    cashflowLease.checkBeforeMutation,
    cashflowPrivateDraftClient,
    drafts,
    monthCloseDecisions,
    monthCloseDepositRows,
    managementDecisions,
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
      const released = await cashflowLease.release();
      if (!released) throw new Error('수정 세션을 종료하지 못했습니다. 임시저장본은 유지됩니다.');
      blocker.proceed?.();
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '임시저장 후 이동하지 못했습니다. 현재 화면에서 다시 시도해 주세요.'));
    } finally {
      setExitBusy(false);
    }
  }, [blocker, cashflowLease.release, savePrivateCashflowDraft]);

  const discardChangesAndLeave = useCallback(async (): Promise<void> => {
    if (blocker.state !== 'blocked') return;
    setExitBusy(true);
    try {
      const released = await cashflowLease.release();
      if (!released) throw new Error('수정 세션을 종료하지 못했습니다.');
      setDrafts({});
      setEditingWeekModes({});
      setWeekSaveState({});
      setMonthCloseReviewDirty(false);
      blocker.proceed?.();
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '저장하지 않고 종료하지 못했습니다. 다시 시도해 주세요.'));
    } finally {
      setExitBusy(false);
    }
  }, [blocker, cashflowLease.release]);

  useEffect(() => {
    setCashflowSheetConfigLoaded(false);
    setCashflowSheetRange(null);
    setCashflowSheetConfig(null);
    if (!db || !projectId) {
      setCashflowSheetConfigLoaded(true);
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
      })
      .finally(() => {
        if (!cancelled) setCashflowSheetConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, orgId, projectId]);

  useEffect(() => {
    if (!cashflowSheetConfigLoaded || cashflowSheetConfig || !projectId || typeof window === 'undefined') return;
    const storageKey = `myscube:cashflow-sheet-onboarding:${projectId}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, 'shown');
    } catch {
      // Storage가 차단된 브라우저에서도 온보딩은 정상 노출한다.
    }
    setSheetReviewDialogOpen(true);
  }, [cashflowSheetConfig, cashflowSheetConfigLoaded, projectId]);

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
      fetchCashflowSnapshotViaBff({
        tenantId: orgId,
        actor,
        projectId,
        asOf: todayIso,
        rangeStart: cashflowSnapshotRange.start,
        rangeEnd: cashflowSnapshotRange.end,
      })
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
  }, [cashflowSnapshotRange.end, cashflowSnapshotRange.start, orgId, projectId, resolveBffActor, todayIso, user?.uid]);

  useEffect(() => {
    void loadCashflowComparison();
  }, [loadCashflowComparison]);

  const loadCashflowMonthClose = useCallback(async (): Promise<void> => {
    if (!projectId || !orgId || !user?.uid) {
      setMonthCloseResult(null);
      setMonthCloseError('로그인 세션이 만료되었습니다.');
      return;
    }
    setMonthCloseLoading(true);
    setMonthCloseError(null);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      try {
        setMonthCloseResult(await fetchCashflowMonthCloseViaBff({
          tenantId: orgId,
          actor,
          projectId,
          yearMonth,
        }));
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        const refreshedActor = await resolveBffActor({ forceRefresh: true });
        if (!refreshedActor?.idToken) throw error;
        setMonthCloseResult(await fetchCashflowMonthCloseViaBff({
          tenantId: orgId,
          actor: refreshedActor,
          projectId,
          yearMonth,
        }));
      }
    } catch (error) {
      setMonthCloseResult(null);
      setMonthCloseError(resolveApiErrorMessage(error, '월 결산 상태를 불러오지 못했습니다.'));
    } finally {
      setMonthCloseLoading(false);
    }
  }, [orgId, projectId, resolveBffActor, user?.uid, yearMonth]);

  useEffect(() => {
    void loadCashflowMonthClose();
  }, [loadCashflowMonthClose]);

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
    if (!projectId || !orgId || !user?.uid) {
      setCashflowEvents([]);
      setCashflowEventsError(null);
      return;
    }
    try {
      let actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      try {
        const response = await fetchCashflowActivityViaBff({ tenantId: orgId, actor, projectId });
        setCashflowEvents(response.events);
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        actor = await resolveBffActor({ forceRefresh: true });
        if (!actor?.idToken) throw error;
        const response = await fetchCashflowActivityViaBff({ tenantId: orgId, actor, projectId });
        setCashflowEvents(response.events);
      }
      setCashflowEventsError(null);
    } catch (error) {
      setCashflowEvents([]);
      setCashflowEventsError(resolveApiErrorMessage(error, '변경 이력을 불러오지 못했습니다.'));
    }
  }, [orgId, projectId, resolveBffActor, user?.uid]);

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

  const monthClosePinnedSource = useMemo<CashflowSheetLabMirrorResult | null>(() => {
    const dashboard = monthCloseResult?.dashboard;
    if (!dashboard?.source || !Array.isArray(dashboard.cells)) return cashflowSheetMirror;
    return {
      projectId,
      status: dashboard.source.kind === 'PINNED_MIRROR' && dashboard.source.status === 'FRESH' ? 'FRESH' : 'STALE',
      sourceRevision: dashboard.source.sourceRevision,
      targetRevisionAtFetch: dashboard.source.targetRevision,
      capturedAt: dashboard.source.capturedAt,
      yearMonths: [yearMonth],
      cells: dashboard.cells.map((cell) => ({
        mode: cell.mode,
        yearMonth,
        weekNo: cell.weekNo,
        lineId: cell.cashflowLine,
        direction: CASHFLOW_IN_LINES.includes(cell.cashflowLine as CashflowSheetLineId) ? 'IN' : 'OUT',
        sourceCell: cell.sourceCell || '',
        sourceLabel: cell.sourceLabel || '',
        state: cell.cellState,
        ...(cell.cellState === 'VALUE' ? { amount: Number(cell.amount || 0) } : {}),
      })),
    };
  }, [cashflowSheetMirror, monthCloseResult?.dashboard, projectId, yearMonth]);

  useEffect(() => {
    const sourceRows = monthCloseResult?.dashboard?.sheetDepositScheduleRows || [];
    if (sourceRows.length !== 5 || monthCloseReviewDirty) return;
    if (readCashflowMonthCloseReview(privateDraftPayload.monthCloseReview || privateDraftPayload.monthClose, yearMonth)) return;
    setMonthCloseDepositRows(sourceRows
      .slice()
      .sort((left, right) => left.weekNo - right.weekNo)
      .map((row) => ({
        weekNo: row.weekNo,
        taxInvoiceIssuedDate: row.taxInvoiceIssuedDate || '',
        expectedDepositDate: row.expectedDepositDate || '',
        expectedDepositAmount: row.expectedDepositAmount ?? null,
        actualDepositDate: '',
        actualDepositAmount: null,
        actualSource: 'NOT_APPLICABLE',
        decision: null,
      })));
  }, [monthCloseResult?.dashboard?.sheetDepositScheduleRows, monthCloseReviewDirty, privateDraftPayload, yearMonth]);

  const monthCloseCellsState = useMemo(() => {
    try {
      return {
        cells: applyCashflowMonthCloseProjectionDrafts(
          normalizeCashflowMonthCloseCells(monthClosePinnedSource, yearMonth),
          drafts,
          yearMonth,
        ),
        error: null as string | null,
      };
    } catch (error) {
      return {
        cells: [] as CashflowMonthCloseCell[],
        error: error instanceof Error ? error.message : '결산 대상 시트 셀을 확인하지 못했습니다.',
      };
    }
  }, [drafts, monthClosePinnedSource, yearMonth]);

  const monthCloseProgress = useMemo(() => cashflowMonthCloseReviewProgress({
    cells: monthCloseCellsState.cells,
    decisions: monthCloseDecisions,
    depositScheduleRows: monthCloseDepositRows,
    managementChecks: monthCloseResult?.dashboard?.managementChecks,
    managementDecisions,
  }), [managementDecisions, monthCloseCellsState.cells, monthCloseDecisions, monthCloseDepositRows, monthCloseResult?.dashboard?.managementChecks]);

  const handleFinalizeMonthClose = useCallback(async (): Promise<void> => {
    if (!isPm || monthCloseResult?.status !== 'OPEN') {
      toast.error('결산 전 상태의 PM만 최종저장할 수 있습니다.');
      return;
    }
    let monthCloseInput: CashflowMonthCloseDraftInput;
    try {
      monthCloseInput = buildCashflowMonthCloseDraftInput({
        mirror: monthClosePinnedSource,
        yearMonth,
        decisions: monthCloseDecisions,
        depositScheduleRows: monthCloseDepositRows,
        projectionDrafts: drafts,
        managementChecks: monthCloseResult?.dashboard?.managementChecks || [],
        managementDecisions,
        deadlineSummary: monthCloseResult?.dashboard?.deadlineSummary || {
          trackingStartedAt: null,
          missedCount: 0,
          completedCount: 0,
          current: null,
        } satisfies CashflowDeadlineSummary,
      });
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '사람 확인이 필요한 항목을 모두 처리해 주세요.'));
      return;
    }

    setMonthCloseBusy(true);
    try {
      const mutationLease = await cashflowLease.checkBeforeMutation();
      await savePrivateCashflowDraft(monthCloseInput, mutationLease);
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const prepared = await fetchCashflowMonthCloseViaBff({
        tenantId: orgId,
        actor,
        projectId,
        yearMonth,
      });
      setMonthCloseResult(prepared);
      if (!prepared.dashboard?.validation?.canClose) {
        throw new Error(prepared.dashboard?.validation?.blockers?.[0]?.message || '서버 월 결산 검증을 통과하지 못했습니다.');
      }
      const result = await closeCashflowMonthViaBff({
        tenantId: orgId,
        actor,
        projectId,
        payload: {
          yearMonth,
          expectedRevision: prepared.revision,
        },
        idempotencyKey: `cashflow-month-close:${projectId}:${yearMonth}:${prepared.revision}`,
        lease: mutationLease,
      });
      setMonthCloseResult(result);
      setMonthCloseReviewOpen(false);
      setDrafts({});
      setEditingWeekModes({});
      setWeekSaveState({});
      setPrivateDraftRevision(null);
      setPrivateDraftPayload({});
      setManagementDecisions({});
      setMonthCloseReviewDirty(false);
      await cashflowLease.checkStatus();
      await Promise.all([
        loadCashflowComparison(),
        loadCashflowEvents(),
        loadCashflowSheetRangeWeeks(),
      ]);
      toast.success(`${yearMonth} 월 결산을 완료했습니다. 이제 수정할 수 없습니다.`);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '월 결산에 실패했습니다. 임시저장본은 유지됩니다.'));
      await loadCashflowMonthClose();
    } finally {
      setMonthCloseBusy(false);
    }
  }, [
    cashflowLease.checkBeforeMutation,
    cashflowLease.checkStatus,
    drafts,
    monthClosePinnedSource,
    isPm,
    loadCashflowComparison,
    loadCashflowEvents,
    loadCashflowMonthClose,
    loadCashflowSheetRangeWeeks,
    monthCloseDecisions,
    monthCloseDepositRows,
    managementDecisions,
    monthCloseResult,
    orgId,
    projectId,
    resolveBffActor,
    savePrivateCashflowDraft,
    yearMonth,
  ]);

  const handleMonthReopenAction = useCallback(async (): Promise<void> => {
    const reason = reopenReason.trim();
    if (!reopenAction || !monthCloseResult || !reason) {
      toast.error('사유를 입력해 주세요.');
      return;
    }
    if (reopenAction === 'request' && !isPm) {
      toast.error('PM만 재오픈을 요청할 수 있습니다.');
      return;
    }
    if (reopenAction !== 'request' && !canReviewReopen) {
      toast.error('Finance 또는 Admin만 재오픈 요청을 처리할 수 있습니다.');
      return;
    }

    setMonthCloseBusy(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const idempotencyKey = `cashflow-month-reopen:${reopenAction}:${projectId}:${yearMonth}:${monthCloseResult.revision}`;
      const result = reopenAction === 'request'
        ? await requestCashflowMonthReopenViaBff({
            tenantId: orgId,
            actor,
            projectId,
            payload: { yearMonth, expectedRevision: monthCloseResult.revision, reason },
            idempotencyKey,
          })
        : await decideCashflowMonthReopenViaBff({
            tenantId: orgId,
            actor,
            projectId,
            payload: {
              yearMonth,
              expectedRevision: monthCloseResult.revision,
              decision: reopenAction === 'approve' ? 'APPROVE' : 'REJECT',
              reason,
            },
            idempotencyKey,
          });
      setMonthCloseResult(result);
      setReopenAction(null);
      setReopenReason('');
      toast.success(reopenAction === 'request'
        ? '재오픈 요청을 보냈습니다.'
        : reopenAction === 'approve'
          ? '재오픈을 승인했습니다.'
          : '재오픈을 반려했습니다.');
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '재오픈 처리를 완료하지 못했습니다.'));
      await loadCashflowMonthClose();
    } finally {
      setMonthCloseBusy(false);
    }
  }, [canReviewReopen, isPm, loadCashflowMonthClose, monthCloseResult, orgId, projectId, reopenAction, reopenReason, resolveBffActor, yearMonth]);

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
        void loadCashflowEvents();
        toast.success('시트값을 고정했습니다. 저장할 값을 확인해 주세요.');
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
          toast.error(resolveApiErrorMessage(retryError, '시트값을 불러오지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '시트값을 불러오지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetConfig, loadCashflowEvents, orgId, projectId, resolveBffActor]);

  const handleStagePinnedSheetValues = useCallback(async (replaceAllActualSources = false): Promise<void> => {
    if (cashflowSheetMirror?.status !== 'FRESH' || !cashflowSheetMirror.sourceRevision) {
      toast.error('먼저 시트값 불러오기를 실행해 고정해 주세요.');
      return;
    }
    const expectedMirrorRevision = cashflowSheetMirror.sourceRevision;
    const stageIdempotencyKey = `cashflow-sheet-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const stageMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      stageCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        expectedMirrorRevision,
        ...(replaceAllActualSources ? { yearMonth, replaceAllActualSources: true } : {}),
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
        replaceAllActualSources: result.replaceAllActualSources === true,
      });
      if (result.status === 'BLOCKED') toast.warning('검토가 필요한 월이 있어 바로 저장할 수 없습니다.');
      else toast.success(result.replaceAllActualSources ? '선택한 월의 원장 덮어쓰기 값을 준비했습니다.' : '고정된 시트 값과 원장 값을 비교했습니다.');
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
  }, [cashflowSheetMirror, orgId, projectId, resolveBffActor, yearMonth]);

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
      toast.info('먼저 시트값 불러오기를 눌러 최신값을 고정해 주세요.');
      return;
    }
    setSheetReviewDialogOpen(true);
  }, [cashflowSheetMirror]);

  const handleOpenSheetOnboarding = useCallback(() => {
    setSheetReviewDialogOpen(true);
  }, []);

  const handleStartSheetChangeReview = useCallback(async (replaceAllActualSources = false): Promise<void> => {
    setSheetReviewDialogOpen(false);
    await handleStagePinnedSheetValues(replaceAllActualSources);
  }, [handleStagePinnedSheetValues]);

  const handleRevertCashflowRun = useCallback(async (_runId: string): Promise<void> => {
    toast.info('되돌리기는 서버 검증 경로가 준비될 때까지 읽기 전용입니다.');
  }, []);

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

  const openProjectionWeekEditing = useCallback(async (targetYearMonth: string, weekNo: number) => {
    if (!cashflowLease.canEdit) {
      const started = await beginCashflowEditing();
      if (!started) return;
    }
    setShowEmptyCashflowRows(true);
    setEditingWeekModes((current) => ({
      ...current,
      [resolveWeekKey({ yearMonth: targetYearMonth, mode: 'projection', weekNo })]: true,
    }));
  }, [beginCashflowEditing, cashflowLease.canEdit]);

  function getWeekLabel(weekNo: number, targetYearMonth = yearMonth): string {
    return annualWeeks.find((week) => week.yearMonth === targetYearMonth && week.weekNo === weekNo)?.label
      || monthWeeks.find((week) => week.weekNo === weekNo)?.label
      || `w${weekNo}`;
  }

  const projectionActualComparison = useMemo(() => {
    if (!cashflowSnapshot && !monthCloseResult?.dashboard?.comparison) return { rows: [], changedRows: [] };
    const comparisonMonths = cashflowSnapshot?.comparison?.months || [];
    const comparisonByMonth = new Map(comparisonMonths.map((month) => [month.yearMonth, month]));
    if (monthCloseResult?.dashboard?.comparison) {
      comparisonByMonth.set(yearMonth, monthCloseResult.dashboard.comparison);
    }
    const lineDefs = [
      ...CASHFLOW_IN_LINES.map((lineId) => ({ section: '입금' as const, lineId })),
      ...CASHFLOW_OUT_LINES.map((lineId) => ({ section: '출금' as const, lineId })),
    ];
    const rows = lineDefs.map(({ section, lineId }) => {
      const cells = annualWeeks.map((week) => {
        const comparisonWeek = comparisonByMonth.get(week.yearMonth)?.weeks?.find((candidate) => candidate.weekNo === week.weekNo);
        const comparisonLine = comparisonWeek?.lines?.find((candidate) => candidate.lineId === lineId);
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
    };
  }, [annualWeeks, cashflowSnapshot, monthCloseResult?.dashboard?.comparison, yearMonth]);

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
    const dashboard = monthCloseResult?.dashboard;
    const blockers = dashboard?.validation?.blockers || [];
    const warnings = dashboard?.validation?.warnings || [];
    const inbox = [
      ...blockers.map((item) => ({ id: `blocker-${item.code}`, tone: 'danger' as CashflowOpsTone, title: item.message, detail: item.code })),
      ...warnings.map((item) => ({ id: `warning-${item.code}`, tone: 'warning' as CashflowOpsTone, title: item.message, detail: item.code })),
      ...(dashboard && !dashboard.summary?.comparisonMatches
        ? [{ id: 'projection-actual-diff', tone: 'warning' as CashflowOpsTone, title: 'Projection/Actual 차이를 확인해 주세요.', detail: '서버 비교 결과에 차이가 있습니다.' }]
        : []),
    ];
    if (!dashboard && !monthCloseLoading) {
      inbox.push({ id: 'dashboard-unavailable', tone: 'danger', title: '월 결산 서버 상태를 불러오지 못했습니다.', detail: monthCloseError || '잠시 후 다시 시도해 주세요.' });
    }
    const issueCount = inbox.length;
    const kind = blockers.length > 0 || (!dashboard && !monthCloseLoading)
      ? 'blocked' as const
      : warnings.length > 0 || !dashboard?.summary?.comparisonMatches
        ? 'review' as const
        : 'ready' as const;
    const tone: CashflowOpsTone = kind === 'blocked' ? 'danger' : kind === 'review' ? 'warning' : 'success';
    const rate = (percent: number) => ({ percent: Math.min(100, Math.max(0, Number(percent) || 0)) });
    return {
      status: {
        kind,
        tone,
        count: issueCount,
        label: monthCloseLoading ? '서버 검증 중' : kind === 'ready' ? '서버 검증 완료' : '확인 필요',
        detail: monthCloseLoading
          ? '월 결산 상태와 합계를 불러오고 있습니다.'
          : kind === 'ready'
            ? '서버 검증 기준으로 확인할 항목이 없습니다.'
            : `서버 확인 항목 ${issueCount.toLocaleString()}건이 있습니다.`,
      },
      rates: {
        projection: rate(dashboard?.summary?.projectionProgressPercent || 0),
        actual: rate(dashboard?.summary?.actualProgressPercent || 0),
        confirmation: rate(dashboard?.summary?.confirmationProgressPercent || 0),
      },
      inbox,
    };
  }, [monthCloseError, monthCloseLoading, monthCloseResult?.dashboard]);

  const markDirty = useCallback((input: { yearMonth?: string; weekNo: number; mode: 'projection' | 'actual' }) => {
    const wkKey = resolveWeekKey({ yearMonth: input.yearMonth || yearMonth, mode: input.mode, weekNo: input.weekNo });
    setWeekSaveState((prev) => ({ ...prev, [wkKey]: 'dirty' }));
  }, [resolveWeekKey, yearMonth]);

  function diffTextClass(diff: number): string {
    return diff === 0 ? 'text-slate-400' : 'text-slate-800';
  }

  function getServerReadCell(params: {
    targetYearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): { amount: number; hasValue: boolean; mismatch: boolean } {
    if (params.targetYearMonth === yearMonth && monthCloseResult?.dashboard) {
      const cell = monthCloseResult.dashboard.cells?.find((candidate) => (
        candidate.mode === params.mode
        && candidate.weekNo === params.weekNo
        && candidate.cashflowLine === params.lineId
      ));
      const comparisonLine = monthCloseResult.dashboard.comparison?.weeks
        ?.find((candidate) => candidate.weekNo === params.weekNo)
        ?.lines?.find((candidate) => candidate.lineId === params.lineId);
      return {
        amount: cell?.cellState === 'VALUE' ? Number(cell.amount || 0) : 0,
        hasValue: cell?.cellState === 'VALUE',
        mismatch: comparisonLine?.mismatch === true,
      };
    }
    const month = cashflowSnapshot?.readModel?.months?.find((candidate) => candidate.yearMonth === params.targetYearMonth);
    const week = month?.[params.mode]?.weeks?.find((candidate) => candidate.weekNo === params.weekNo);
    const comparisonLine = month?.comparison?.weeks
      ?.find((candidate) => candidate.weekNo === params.weekNo)
      ?.lines?.find((candidate) => candidate.lineId === params.lineId);
    return {
      amount: Number(week?.amounts[params.lineId] || 0),
      hasValue: params.mode === 'projection'
        ? Boolean(comparisonLine?.projectionHadValue)
        : Boolean(comparisonLine?.actualHadValue),
      mismatch: comparisonLine?.mismatch === true,
    };
  }

  function getBoardEffectiveAmount(params: {
    targetYearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    const persisted = getServerReadCell(params);
    const key = resolveCellKey({
      yearMonth: params.targetYearMonth,
      mode: params.mode,
      weekNo: params.weekNo,
      lineId: params.lineId,
    });
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    return params.mode === 'projection' && raw !== undefined ? parseAmount(raw) : persisted.amount;
  }

  function renderProjectionCell(input: {
    targetYearMonth: string;
    weekNo: number;
    lineId: CashflowSheetLineId;
    isThisWeek: boolean;
  }) {
    const persisted = getServerReadCell({ ...input, mode: 'projection' });
    const key = resolveCellKey({ yearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const raw = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
    const projectionValue = raw !== undefined ? raw : (persisted.hasValue ? formatAmountInput(String(persisted.amount)) : '');
    const projection = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const actual = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'actual', weekNo: input.weekNo, lineId: input.lineId });
    const shouldHighlightMismatch = persisted.mismatch;
    const isEditing = isWeekModeEditing({ yearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo }) || raw !== undefined;
    const bgClass = input.isThisWeek ? 'bg-blue-50/70' : 'bg-white';
    const isCollapsedEmpty = !showEmptyCashflowRows && !isEditing && projection === 0 && actual === 0 && raw === undefined;

    return (
      <td key={`${input.lineId}-${input.targetYearMonth}-${input.weekNo}-p`} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${bgClass}`}>
        {isCollapsedEmpty ? (
          <button
            type="button"
            className="w-full py-0.5 text-center text-[9px] text-slate-300"
            onClick={() => void openProjectionWeekEditing(input.targetYearMonth, input.weekNo)}
            disabled={!canUseCashflowActions || cashflowLease.busy || monthCloseResult?.status !== 'OPEN'}
            aria-label={`${input.targetYearMonth} ${input.weekNo}주차 Projection 입력`}
          >
            -
          </button>
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
          <button
            type="button"
            className={`h-5 w-full rounded-md px-1 text-right text-[8px] leading-5 tabular-nums ${shouldHighlightMismatch ? 'font-semibold text-rose-700' : 'text-slate-900'}`}
            onClick={() => void openProjectionWeekEditing(input.targetYearMonth, input.weekNo)}
            disabled={!canUseCashflowActions || cashflowLease.busy || monthCloseResult?.status !== 'OPEN'}
            aria-label={`${input.targetYearMonth} ${input.weekNo}주차 Projection 입력`}
          >
            {fmt(projection)}
          </button>
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
    const persisted = getServerReadCell({ ...input, mode: 'actual' });
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
    if (cashflowComparisonLoading && !cashflowSnapshot) {
      return (
        <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">
          서버 확정 원장과 기간 합계를 불러오는 중입니다.
        </div>
      );
    }
    const visibleWeeks = annualWeeks;
    const readServerSummary = (mode: 'projection' | 'actual') => {
      const weekTotals = visibleWeeks.map((week) => {
        const dashboardWeek = week.yearMonth === yearMonth
          ? monthCloseResult?.dashboard?.totals?.[mode]?.weeks?.find((candidate) => candidate.weekNo === week.weekNo)
          : null;
        const serverWeek = dashboardWeek || cashflowSnapshot?.readModel?.months
          ?.find((month) => month.yearMonth === week.yearMonth)
          ?.[mode]?.weeks?.find((candidate) => candidate.weekNo === week.weekNo);
        return serverWeek || { weekNo: week.weekNo, amounts: {}, totalIn: 0, totalOut: 0, net: 0, weekIn: 0, weekOut: 0 };
      });
      const rangeTotals = cashflowSnapshot?.readModel?.range?.[mode];
      return {
        rowTotals: (rangeTotals?.rowTotals || {}) as Record<CashflowSheetLineId, number>,
        weekTotals,
        monthTotals: {
          totalIn: rangeTotals?.totalIn || 0,
          totalOut: rangeTotals?.totalOut || 0,
          net: rangeTotals?.net || 0,
        },
      };
    };
    const derived = {
      projection: readServerSummary('projection'),
      actual: readServerSummary('actual'),
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
              const hasServerValues = CASHFLOW_ALL_LINES.some((lineId) => getServerReadCell({
                targetYearMonth: week.yearMonth,
                mode,
                weekNo: week.weekNo,
                lineId,
              }).hasValue);
              return (
                <th key={`${mode}-${week.yearMonth}-${week.weekNo}`} data-cashflow-week-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-2 text-center align-top font-semibold ${isThisWeek ? 'bg-blue-50/90' : 'bg-slate-50/80'}`}>
                  <div className="min-h-5">
                    <span className="block truncate text-[10px] font-bold leading-5 text-slate-800">{week.label}</span>
                  </div>
                  <div className="truncate text-[8px] font-normal text-slate-400">{week.weekStart && week.weekEnd ? `${week.weekStart.slice(5)}~${week.weekEnd.slice(5)}` : '-'}</div>
                  <Badge className={`mt-1 h-3.5 w-full justify-center rounded-full border-0 px-1 text-[7px] ${hasServerValues ? 'bg-white text-slate-700' : 'bg-rose-100 text-rose-700'}`}>
                    {hasServerValues ? '서버 값' : '값 없음'}
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
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">현금흐름 관리시트</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                <span className="sr-only">결산 대상 월</span>
                <Input
                  type="month"
                  value={yearMonth}
                  className="h-8 w-[138px] rounded-full border-0 bg-white px-3 text-[11px] shadow-sm"
                  onChange={(event) => setYearMonth(event.target.value)}
                />
              </label>
              <Badge className={`h-8 rounded-full border-0 px-3 text-[10px] ${monthCloseStatusClass}`}>
                {monthCloseLoading ? '상태 확인 중' : monthCloseStatusLabel}
              </Badge>
              {isPm && monthCloseResult?.status === 'OPEN' ? (
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full border-0 bg-white px-3 text-[11px] shadow-sm" onClick={() => setMonthCloseReviewOpen(true)} disabled={!canEdit || cashflowLease.busy || monthCloseBusy}>
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  월 결산
                </Button>
              ) : null}
              {isPm && monthCloseResult?.status === 'CLOSED' ? (
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full border-0 bg-white px-3 text-[11px] shadow-sm" onClick={() => { setReopenReason(''); setReopenAction('request'); }}>
                  재오픈 요청
                </Button>
              ) : null}
              {canReviewReopen && monthCloseResult?.status === 'REOPEN_REQUESTED' ? (
                <>
                  <Button type="button" size="sm" className="h-8 rounded-full px-3 text-[11px]" onClick={() => { setReopenReason(''); setReopenAction('approve'); }}>재오픈 승인</Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 rounded-full px-3 text-[11px]" onClick={() => { setReopenReason(''); setReopenAction('reject'); }}>재오픈 반려</Button>
                </>
              ) : null}
              {cashflowLease.canEdit ? (
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[10px]" onClick={() => void cashflowLease.extend()} disabled={cashflowLease.busy}>
                  {cashflowLease.remainingLabel} · 30분 연장
                </Button>
              ) : null}
            </div>
          </div>
          {financialYearChecks?.years.length ? (
            <div className="grid gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 sm:grid-cols-2 xl:grid-cols-4">
              {[...financialYearChecks.years.map((check) => ({ ...check, label: `${check.year}년` })), { ...financialYearChecks.total, label: '전체' }].map((check) => (
                <div key={check.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-900">{check.label}</span>
                    <span className={`text-[9px] font-semibold ${check.status === 'MATCH' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {check.status === 'MATCH' ? '등록값과 일치' : check.status === 'SHEET_YEAR_MISSING' ? '시트 연도값 없음' : '확인 필요'}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {FINANCIAL_YEAR_CHECK_FIELDS.map((field) => {
                      const differs = check.mismatches.includes(field.key);
                      return (
                        <div key={field.key} className={`flex items-center justify-between gap-2 text-[9px] ${differs ? 'text-amber-700' : 'text-slate-500'}`}>
                          <span>{field.label}</span>
                          <span className="text-right tabular-nums">시트 {fmt(check.sheet[field.key])} · 등록 {fmt(check.registered[field.key])}</span>
                        </div>
                      );
                    })}
                  </div>
                  {check.status === 'MISMATCH' ? (
                    <p className="mt-2 text-[9px] leading-4 text-amber-700">
                      {FINANCIAL_YEAR_CHECK_FIELDS.filter((field) => check.mismatches.includes(field.key)).map((field) => field.label).join(', ')} 값이 시트와 다릅니다.
                    </p>
                  ) : check.status === 'SHEET_YEAR_MISSING' ? (
                    <p className="mt-2 text-[9px] leading-4 text-amber-700">이 연도의 시트 주차와 값을 확인해 주세요.</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
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


  function renderProjectionActualDiffTable() {
    const rows = projectionActualComparison.changedRows;
    if (cashflowComparisonLoading) {
      return <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">BFF 차이값을 불러오는 중...</div>;
    }
    if (cashflowComparisonError || !cashflowSnapshot?.readModel?.range) {
      return (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-6 text-center text-[12px] text-rose-700">
          {cashflowComparisonError || '서버 확정 원장과 기간 합계를 불러오지 못했습니다.'}
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
                BFF 기준일 {monthCloseResult?.dashboard?.summary?.comparisonAsOfDate || cashflowSnapshot?.comparison?.asOfDate || '-'} · 차이 = Projection - Actual
              </div>
            </div>
            <Badge className="rounded-full border-0 bg-blue-50 px-2.5 py-1 text-[10px] text-blue-700">차이 항목만</Badge>
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
                        : 'bg-blue-50 text-blue-700';
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

  function renderRateTile(label: string, rate: { percent: number }) {
    const summaryDescription = label === 'Projection'
      ? '총 계약금액 기준'
      : label === 'Actual'
        ? '이번 주차까지 입력 기준'
        : '사람 확인 완료 기준';
    return (
      <div className="min-w-[158px] rounded-[18px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]" title="BFF/JVM 서버 요약값">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold leading-4 text-slate-600">{label}</div>
          <div className="text-[10px] tabular-nums text-slate-500">서버 기준</div>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className="text-[22px] font-bold leading-6 tabular-nums text-blue-700">
            {rate.percent}%
          </span>
          <span className="truncate text-right text-[9px] font-semibold leading-3 text-blue-700">{rate.percent >= 100 ? 'OK' : '확인 중'}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, Math.max(0, rate.percent))}%` }} />
        </div>
        <div className="mt-1.5 truncate text-[9px] leading-3 text-slate-500">{summaryDescription}</div>
      </div>
    );
  }

  function renderOperationsSummary(input: {
    hiddenInboxCount: number;
    visibleInbox: typeof opsSummary.inbox;
  }) {
    return (
      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="grid gap-2 md:grid-cols-3">
          {renderRateTile('Projection', opsSummary.rates.projection)}
          {renderRateTile('Actual', opsSummary.rates.actual)}
          {renderRateTile('결산', opsSummary.rates.confirmation)}
        </div>

        <div className="min-w-0 overflow-hidden rounded-[20px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] xl:max-h-[126px]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">확인할 항목</div>
              <div className={`mt-0.5 text-[10px] font-bold tabular-nums ${opsTextClass(opsSummary.status.tone)}`}>
                {opsSummary.status.count}건
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {input.visibleInbox.length === 0 ? (
              <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-1.5 px-3 py-1.5">
                <div className="flex h-4 items-center justify-center">
                  <span className={`h-1.5 w-1.5 rounded-full ${opsDotClass('success')}`} />
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-[10px] font-bold leading-3 ${opsTextClass('success')}`}>확인할 항목이 없습니다.</div>
                  <div className="mt-0.5 truncate text-[9px] leading-3 text-slate-500">서버 검증 기준으로 준비되었습니다.</div>
                </div>
              </div>
            ) : input.visibleInbox.map((item) => (
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
            {input.hiddenInboxCount > 0 && (
              <div className="px-2 py-1 text-[9px] font-semibold text-slate-500">
                외 {input.hiddenInboxCount}건
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderOperationsPanel() {
    const visibleInbox = opsSummary.inbox.slice(0, 4);
    const hiddenInboxCount = Math.max(0, opsSummary.status.count - visibleInbox.length);
    const statusBadgeLabel = opsSummary.status.kind === 'ready'
      ? opsSummary.status.label
      : `확인 항목 ${opsSummary.status.count}건`;
    const dashboardSummary = renderOperationsSummary({
      hiddenInboxCount,
      visibleInbox,
    });
    return (
      <Card className="overflow-hidden rounded-[24px] border-0 bg-slate-50/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ClipboardList className="h-4 w-4 shrink-0 text-blue-600" />
              <div className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950">{dashboardTitle}</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-full border-blue-200 bg-white px-2.5 text-[10px] font-semibold text-blue-700"
                onClick={() => cashflowSheetConfig
                  ? navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)
                  : handleOpenSheetOnboarding()}
              >
                {cashflowSheetConfig ? '시트 설정' : '시트 연결'}
              </Button>
              {cashflowSheetConfig ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 rounded-full border-emerald-200 bg-white px-2.5 text-[10px] font-semibold text-emerald-700"
                  disabled={sheetRefreshLoading}
                  onClick={() => void handleRefreshSheetMirror()}
                >
                  {sheetRefreshLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  시트 값 불러오기
                </Button>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-[10px] text-slate-400 sm:inline">기준일 {todayIso}</span>
              <Badge className={`rounded-full border-0 px-2.5 py-1 text-[10px] shadow-sm ${opsToneClass(opsSummary.status.tone)}`}>
                {statusBadgeLabel}
              </Badge>
            </div>
          </div>

          {sheetDashboardMetadata ? (
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              {[
                ['사업 타입', sheetDashboardMetadata.businessType?.value],
                ['전용 계좌사업', sheetDashboardMetadata.accountType?.value],
                ['정산 여부', sheetDashboardMetadata.settlementStatus?.value],
              ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                <span key={label} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 font-semibold text-blue-950">
                  <span className="mr-1 text-blue-600">{label}</span>{value}
                </span>
              ))}
              <span className="ml-1 border-l border-slate-200 pl-3 text-slate-500">
                세금계산서 발행일 · 입금일 · 입금액 주별 확인됨
              </span>
            </div>
          ) : null}

          {cashflowSheetMirror?.lastRefreshError?.message ? (
            <div className="flex items-center justify-between gap-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
              <span className="min-w-0 truncate">시트 연동 오류: {cashflowSheetMirror.lastRefreshError.message}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-full border-rose-200 bg-white px-2.5 text-[10px] text-rose-700"
                onClick={() => navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)}
              >
                시트 설정
              </Button>
            </div>
          ) : null}

          {dashboardSummary}

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="rounded-[20px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-bold text-slate-900">주요 관리 항목</div>
                <span className="text-[9px] text-slate-400">프로젝트 전체 기간 · BFF/JVM 서버 판정</span>
              </div>
              <div className="space-y-2">
                {(monthCloseResult?.dashboard?.managementChecks || []).map((check) => {
                  const decision = managementDecisions[check.id];
                  const tone: CashflowOpsTone = check.status === 'OK' ? 'success' : check.status === 'WARNING' ? 'warning' : 'neutral';
                  return (
                    <div key={check.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${opsDotClass(tone)}`} />
                            <span className="text-[10px] font-bold text-slate-900">{check.title}</span>
                          </div>
                          <div className="mt-1 text-[9px] leading-4 text-slate-500">{check.detail}</div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={decision === 'CONFIRMED' ? 'default' : 'outline'}
                            className="h-6 rounded-full px-2 text-[9px]"
                            disabled={!canEdit}
                            onClick={() => {
                              setManagementDecisions((current) => ({ ...current, [check.id]: 'CONFIRMED' }));
                              setMonthCloseReviewDirty(true);
                            }}
                          >확인</Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={decision === 'NOT_APPLICABLE' ? 'default' : 'outline'}
                            className="h-6 rounded-full px-2 text-[9px]"
                            disabled={!canEdit}
                            onClick={() => {
                              setManagementDecisions((current) => ({ ...current, [check.id]: 'NOT_APPLICABLE' }));
                              setMonthCloseReviewDirty(true);
                            }}
                          >해당 없음</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[20px] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                <div className="text-[11px] font-bold text-slate-900">목요일 자정 업데이트</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-slate-400">누적 미준수</div><div className="mt-1 font-bold text-rose-700">{monthCloseResult?.dashboard?.deadlineSummary?.missedCount || 0}회</div></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-slate-400">기한 내 완료</div><div className="mt-1 font-bold text-emerald-700">{monthCloseResult?.dashboard?.deadlineSummary?.completedCount || 0}회</div></div>
                </div>
                <div className="mt-2 text-[9px] leading-4 text-slate-500">
                  {monthCloseResult?.dashboard?.deadlineSummary?.current
                    ? `${monthCloseResult.dashboard.deadlineSummary.current.yearMonth} ${monthCloseResult.dashboard.deadlineSummary.current.weekNo}주차 · ${monthCloseResult.dashboard.deadlineSummary.current.status}`
                    : '첫 시트 검토 완료 시점부터 집계합니다.'}
                </div>
              </div>
            </div>
          </div>

          {monthCloseResult?.dashboard?.postCloseAdjustment ? (
            <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-950">
              <div className="font-bold">결산 후 조정 특이사항</div>
              <div className="mt-1">{monthCloseResult.dashboard.postCloseAdjustment.reason} · 변경 {monthCloseResult.dashboard.postCloseAdjustment.changedCount}건</div>
              <div className="mt-1.5 space-y-1 text-[9px] leading-4 text-amber-900">
                {monthCloseResult.dashboard.postCloseAdjustment.changes.slice(0, 5).map((change) => (
                  <div key={`${change.mode}:${change.weekNo}:${change.cashflowLine}`}>
                    {change.mode === 'projection' ? 'Projection' : 'Actual'} {change.weekNo}주차 · {CASHFLOW_SHEET_LINE_LABELS[change.cashflowLine as CashflowSheetLineId] || change.cashflowLine}
                    {' '}{fmt(change.beforeAmount)}원 → {fmt(change.afterAmount)}원
                  </div>
                ))}
                {monthCloseResult.dashboard.postCloseAdjustment.changedCount > 5 ? (
                  <div>외 {monthCloseResult.dashboard.postCloseAdjustment.changedCount - 5}건</div>
                ) : null}
              </div>
            </div>
          ) : null}

        </CardContent>
      </Card>
    );
  }

  function cashflowEventLabel(event: CashflowEvent): string {
    if (event.type === 'sheet_refresh') return '시트 값 불러오기';
    if (event.type === 'sheet_apply') return '시트 값 반영';
    if (event.type === 'month_close') return '월 결산';
    if (event.type === 'projection_amount_change') return 'Projection 값 변경';
    if (event.type === 'actual_amount_change') return 'Actual 값 변경';
    if (event.type === 'projection_completed') return '과거 Projection 완료 기록';
    if (event.type === 'actual_completed') return '과거 Actual 완료 기록';
    if (event.type === 'admin_closed') return '과거 주차 결산 기록';
    if (event.type === 'sheet_apply_reverted') return '시트 반영 되돌림';
    return '변경';
  }

  function cashflowEventDetail(event: CashflowEvent): string {
    if (event.type === 'sheet_refresh') return [event.sheetName, '시트값을 고정했습니다.'].filter(Boolean).join(' · ');
    if (event.type === 'sheet_apply') {
      return `Google Sheet 반영 ${event.appliedLineCount || 0}건 · Projection ${event.projectionLineCount || 0}건 · Actual ${event.actualLineCount || 0}건`;
    }
    if (event.type === 'month_close') return [`${event.yearMonth || ''} 월`, event.status || '결산 완료', event.actorName || event.actorEmail || '사용자'].filter(Boolean).join(' · ');
    if (event.type === 'projection_amount_change' || event.type === 'actual_amount_change') {
      const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
      const lineLabel = event.lineId ? CASHFLOW_SHEET_LINE_LABELS[event.lineId as CashflowSheetLineId] || event.lineId : '';
      const before = event.beforeHadValue ? `${fmt(Number(event.beforeAmount || 0))}원` : '미작성';
      const after = `${fmt(Number(event.afterAmount || 0))}원`;
      return `${weekLabel} ${lineLabel} ${before} → ${after}`;
    }
    if (event.type === 'sheet_apply_reverted') return '선택한 시트 반영 run의 금액 변경을 이전 값으로 되돌렸습니다.';
    const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
    return [weekLabel, event.actorName || event.actorEmail || '사용자'].filter(Boolean).join(' · ');
  }

  function cashflowEventSourceClass(source: CashflowEvent['source']): string {
    if (source === 'google_sheet_refresh') return 'bg-emerald-50 text-emerald-700';
    if (source === 'google_sheet_apply') return 'bg-blue-50 text-blue-700';
    if (source === 'month_close') return 'bg-violet-50 text-violet-700';
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
      { key: 'sheet', label: '시트 불러오기', value: cashflowEvents.filter((event) => event.type === 'sheet_refresh').length },
      { key: 'amount', label: '금액 변경', value: cashflowEvents.filter((event) => event.type === 'projection_amount_change' || event.type === 'actual_amount_change').length },
      { key: 'status', label: '월 결산', value: cashflowEvents.filter((event) => event.type === 'month_close').length },
    ].filter((item) => item.value > 0);

    return (
      <Card className="h-full overflow-hidden rounded-[24px] border-0 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 pb-3">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">변경 이력</div>
              <div className="text-[10px] text-slate-500">명시적 시트 불러오기와 월 결산 이력입니다.</div>
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
                시트값 불러오기와 월 결산 이력이 여기에 기록됩니다.
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
                          {event.source === 'google_sheet_refresh' ? '불러오기' : event.source === 'google_sheet_apply' ? '시트' : event.source === 'month_close' ? '결산' : event.source === 'revert' ? '되돌림' : '기록'}
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

  const monthCloseStatusLabel = monthCloseResult?.status === 'CLOSED'
    ? '월 결산 완료'
    : monthCloseResult?.status === 'REOPEN_REQUESTED'
      ? '재오픈 승인 대기'
      : '결산 전';
  const monthCloseStatusClass = monthCloseResult?.status === 'CLOSED'
    ? 'bg-emerald-100 text-emerald-800'
    : monthCloseResult?.status === 'REOPEN_REQUESTED'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-amber-100 text-amber-800';
  const sheetDashboardMetadata = cashflowSheetMirror?.status === 'FRESH'
    ? cashflowSheetMirror.sheetFacts?.metadata
    : undefined;
  const financialYearChecks = cashflowSheetMirror?.status === 'FRESH'
    ? cashflowSheetMirror.financialYearChecks
    : undefined;
  const dashboardTitle = `${projectName?.trim() || '이 프로젝트'} 현금흐름 대시보드`;

  return (
    <div className="space-y-5 rounded-[28px] bg-slate-50/80 p-3">
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        {renderOperationsPanel()}
        {renderOpsTimeline()}
      </section>

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

      <AlertDialog
        open={monthCloseReviewOpen}
        onOpenChange={(open) => {
          if (!monthCloseBusy) setMonthCloseReviewOpen(open);
        }}
      >
        <AlertDialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1180px] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{yearMonth} 최종저장 · 월 결산</AlertDialogTitle>
            <AlertDialogDescription>
              시트값과 입금 일정을 사람이 모두 확인하면 서버가 스냅샷을 확정합니다. 확정 후에는 재오픈 승인 전까지 수정할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">시트 고정본</div>
              <div className="mt-1 truncate text-[11px] font-semibold text-slate-900">{monthCloseResult?.dashboard?.source?.sourceRevision || cashflowSheetMirror?.sourceRevision || '준비되지 않음'}</div>
            </div>
            <div className="rounded-xl bg-blue-50 px-3 py-2">
              <div className="text-[10px] text-blue-600">캐시플로 항목 확인</div>
              <div className="mt-1 text-[13px] font-bold text-blue-900">{monthCloseProgress.confirmedCells} / {monthCloseProgress.totalCells}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2">
              <div className="text-[10px] text-emerald-600">입금 일정 확인</div>
              <div className="mt-1 text-[13px] font-bold text-emerald-900">{monthCloseProgress.confirmedDepositRows} / 5</div>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2">
              <div className="text-[10px] text-amber-700">주요 관리 항목 확인</div>
              <div className="mt-1 text-[13px] font-bold text-amber-900">{monthCloseProgress.confirmedManagementChecks} / 4</div>
            </div>
          </div>

          {monthCloseCellsState.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{monthCloseCellsState.error}</div>
          ) : null}

          <section className="space-y-2 rounded-[18px] border border-slate-200 p-3">
            <div>
              <h3 className="text-[13px] font-bold text-slate-950">세금계산서·입금 일정</h3>
              <p className="mt-1 text-[10px] text-slate-500">시트에서 불러온 발행일·입금예정일·입금액을 확인하고, 실제 입금 정보가 있으면 출처까지 선택해 주세요.</p>
            </div>
            <div className="space-y-2">
              {monthCloseDepositRows.map((row) => {
                const hasSheetSource = Boolean(row.taxInvoiceIssuedDate || row.expectedDepositDate || row.expectedDepositAmount != null);
                return (
                <div key={row.weekNo} className="grid gap-2 rounded-xl bg-slate-50 p-3 xl:grid-cols-[52px_repeat(5,minmax(120px,1fr))_150px_auto] xl:items-end">
                  <div className="pb-2 text-[11px] font-bold text-slate-800">{row.weekNo}주차</div>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    세금계산서 발행일
                    <Input
                      type="date"
                      value={row.taxInvoiceIssuedDate}
                      className="h-8 bg-slate-100 text-[10px]"
                      readOnly
                      disabled={!canEdit}
                    />
                  </label>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    입금예정일
                    <Input
                      type="date"
                      value={row.expectedDepositDate}
                      className="h-8 bg-slate-100 text-[10px]"
                      readOnly
                      disabled={!canEdit}
                    />
                  </label>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    입금예정액
                    <Input
                      inputMode="numeric"
                      value={row.expectedDepositAmount == null ? '' : formatAmountInput(String(row.expectedDepositAmount))}
                      className="h-8 bg-slate-100 text-right text-[10px]"
                      readOnly
                      disabled={!canEdit}
                    />
                  </label>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    실제 입금일
                    <Input
                      type="date"
                      value={row.actualDepositDate}
                      className="h-8 bg-white text-[10px]"
                      disabled={!canEdit || row.decision === 'NOT_APPLICABLE'}
                      onChange={(event) => {
                        setMonthCloseDepositRows((current) => current.map((candidate) => candidate.weekNo === row.weekNo
                          ? { ...candidate, actualDepositDate: event.target.value, decision: null }
                          : candidate));
                        setMonthCloseReviewDirty(true);
                      }}
                    />
                  </label>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    실제 입금액
                    <Input
                      inputMode="numeric"
                      value={row.actualDepositAmount == null ? '' : formatAmountInput(String(row.actualDepositAmount))}
                      className="h-8 bg-white text-right text-[10px]"
                      disabled={!canEdit || row.decision === 'NOT_APPLICABLE'}
                      onChange={(event) => {
                        const value = event.target.value.trim() ? parseAmount(event.target.value) : null;
                        setMonthCloseDepositRows((current) => current.map((candidate) => candidate.weekNo === row.weekNo
                          ? { ...candidate, actualDepositAmount: value, decision: null }
                          : candidate));
                        setMonthCloseReviewDirty(true);
                      }}
                    />
                  </label>
                  <label className="grid gap-1 text-[9px] font-semibold text-slate-500">
                    실제 입금 출처
                    <select
                      value={row.actualSource}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[10px]"
                      disabled={!canEdit || row.decision === 'NOT_APPLICABLE'}
                      onChange={(event) => {
                        const actualSource = event.target.value as CashflowMonthCloseDepositReviewRow['actualSource'];
                        setMonthCloseDepositRows((current) => current.map((candidate) => candidate.weekNo === row.weekNo
                          ? { ...candidate, actualSource, decision: null }
                          : candidate));
                        setMonthCloseReviewDirty(true);
                      }}
                    >
                      <option value="NOT_APPLICABLE">입금 전/해당 없음</option>
                      <option value="SHEET">시트</option>
                      <option value="BANK_TRANSACTION">계좌 거래</option>
                      <option value="DIRECT_ENTRY">직접 입력</option>
                    </select>
                  </label>
                  <div className="flex gap-1 pb-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={row.decision === 'CONFIRMED' ? 'default' : 'outline'}
                      className="h-8 px-2 text-[10px]"
                      disabled={!canEdit}
                      onClick={() => {
                        setMonthCloseDepositRows((current) => current.map((candidate) => candidate.weekNo === row.weekNo
                          ? { ...candidate, decision: 'CONFIRMED' }
                          : candidate));
                        setMonthCloseReviewDirty(true);
                      }}
                    >확인</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={row.decision === 'NOT_APPLICABLE' ? 'default' : 'outline'}
                      className="h-8 px-2 text-[10px]"
                      disabled={!canEdit || hasSheetSource}
                      onClick={() => {
                        setMonthCloseDepositRows((current) => current.map((candidate) => candidate.weekNo === row.weekNo
                          ? {
                              ...candidate,
                              actualDepositDate: '',
                              actualDepositAmount: null,
                              actualSource: 'NOT_APPLICABLE',
                              decision: 'NOT_APPLICABLE',
                            }
                          : candidate));
                        setMonthCloseReviewDirty(true);
                      }}
                    >해당 없음</Button>
                  </div>
                </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-[18px] border border-slate-200 p-3">
            <div>
              <h3 className="text-[13px] font-bold text-slate-950">캐시플로 항목 사람 확인</h3>
              <p className="mt-1 text-[10px] text-slate-500">금액이 있는 셀은 확인, 빈 셀은 해당 없음을 직접 선택해 주세요.</p>
            </div>
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {(['projection', 'actual'] as const).map((mode) => (
                <div key={mode} className="space-y-2">
                  <h4 className="sticky top-0 z-10 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white">
                    {mode === 'projection' ? 'Projection' : 'ACTUAL'}
                  </h4>
                  {[1, 2, 3, 4, 5].map((weekNo) => (
                    <div key={`${mode}-${weekNo}`} className="rounded-xl bg-slate-50 p-2">
                      <div className="mb-1 text-[10px] font-bold text-slate-700">{weekNo}주차</div>
                      <div className="grid gap-1 md:grid-cols-2">
                        {monthCloseCellsState.cells.filter((cell) => cell.mode === mode && cell.weekNo === weekNo).map((cell) => {
                          const key = cashflowMonthCloseConfirmationKey(cell);
                          const requiredDecision = requiredCashflowMonthCloseDecision(cell);
                          const selected = monthCloseDecisions[key] === requiredDecision;
                          return (
                            <div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                              <div className="min-w-0">
                                <div className="truncate text-[9px] font-semibold text-slate-800">{getCashflowModeLineLabel(cell.cashflowLine as CashflowSheetLineId, mode)}</div>
                                <div className="text-[9px] tabular-nums text-slate-500">
                                  {cell.cellState === 'VALUE' ? `${fmt(Number(cell.amount || 0))}원` : '빈 셀'} · {cell.sourceLabel || cell.sourceCell || '-'}
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant={selected ? 'default' : 'outline'}
                                className="h-7 shrink-0 px-2 text-[9px]"
                                disabled={!canEdit}
                                onClick={() => {
                                  setMonthCloseDecisions((current) => ({ ...current, [key]: requiredDecision }));
                                  setMonthCloseReviewDirty(true);
                                }}
                              >
                                {requiredDecision === 'CONFIRMED' ? '확인' : '해당 없음'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={monthCloseBusy}>닫기</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={!canEdit || monthCloseBusy}
              onClick={() => void savePrivateCashflowDraft()
                .then(() => toast.success('월 결산 검토 내용을 임시저장했습니다.'))
                .catch((error) => toast.error(resolveApiErrorMessage(error, '임시저장에 실패했습니다.')))}
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              임시저장
            </Button>
            <AlertDialogAction
              disabled={!canEdit || monthCloseBusy || !monthCloseProgress.complete || Boolean(monthCloseCellsState.error)}
              onClick={(event) => {
                event.preventDefault();
                void handleFinalizeMonthClose();
              }}
            >
              {monthCloseBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              최종저장 · 월 결산
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reopenAction !== null}
        onOpenChange={(open) => {
          if (!open && !monthCloseBusy) {
            setReopenAction(null);
            setReopenReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reopenAction === 'request' ? '월 결산 재오픈 요청' : reopenAction === 'approve' ? '재오픈 승인' : '재오픈 반려'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              결산 이후 변경은 감사 이력과 경고 카운트에 남습니다. 처리 사유를 구체적으로 작성해 주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-2 text-[11px] font-semibold text-slate-700">
            사유
            <textarea
              value={reopenReason}
              className="min-h-[120px] rounded-xl border border-slate-200 p-3 text-[12px] font-normal outline-none focus:border-blue-400"
              placeholder="수정이 필요한 이유와 범위를 입력해 주세요."
              disabled={monthCloseBusy}
              onChange={(event) => setReopenReason(event.target.value)}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={monthCloseBusy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={monthCloseBusy || !reopenReason.trim()}
              onClick={(event) => {
                event.preventDefault();
                void handleMonthReopenAction();
              }}
            >
              {monthCloseBusy ? '처리 중…' : reopenAction === 'request' ? '요청 보내기' : reopenAction === 'approve' ? '승인' : '반려'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={sheetReviewDialogOpen}
        onOpenChange={(open) => setSheetReviewDialogOpen(open)}
      >
        <AlertDialogContent className="max-w-[760px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{cashflowSheetConfig ? '시트 업데이트 반영' : '캐시플로우 시트 연동 시작하기'}</AlertDialogTitle>
            <AlertDialogDescription>
              {cashflowSheetConfig
                ? '고정해 둔 시트 값을 원장과 비교합니다. 저장 버튼을 누르기 전까지 원장은 바뀌지 않습니다.'
                : '시트를 연결하지 않아도 캐시플로우는 조회할 수 있습니다. 기존 시트 값을 가져오려면 아래 순서로 연결해 주세요.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-950">
                  <ArrowDownToLine className="h-4 w-4 text-blue-600" />
                  {cashflowSheetConfig ? '시트에서 가져오기' : '연동 전 확인사항'}
                </div>
                <div className="mt-1 text-[11px] leading-5 text-slate-600">
                  {cashflowSheetConfig
                    ? '마지막으로 고정한 Projection/Actual 값을 원장과 비교합니다. 이 단계에서는 Google Sheet를 다시 읽지 않습니다.'
                  : '설정 후에도 자동으로 값을 가져오지 않습니다. 시트 설정에서 직접 시트값을 가져올 때만 고정합니다.'}
                </div>
              </div>
              <Badge className={`w-fit rounded-full border-0 px-2.5 py-1 text-[10px] ${sheetMirrorStatus === 'FRESH' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {cashflowSheetConfig ? sheetMirrorStatus : '선택 설정'}
              </Badge>
            </div>
            <div className="flex items-start gap-2 rounded-[12px] border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-900">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                {cashflowSheetConfig
                  ? `현재 선택: ${sheetMirrorCapturedAt || '최근'} 고정본을 원장 값과 나란히 확인합니다.`
                  : 'Google Sheet는 조회 전용으로 연결됩니다. 검토 후 저장하기 전까지 MYSCube 원장은 바뀌지 않습니다.'}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(cashflowSheetConfig ? [
                ['1', '고정본 선택', '명시적으로 연동한 시트 고정본을 사용합니다.'],
                ['2', '값 비교', '원장과 다른 셀을 모두 보여줍니다.'],
                ['3', '검토 후 저장', '팝업에서 확정하면 원장에 저장합니다.'],
              ] : [
                ['1', '공유 권한 확인', '연동할 Google Sheet에 조회 권한이 있는지 확인합니다.'],
                ['2', '시트·주차 선택', '사용할 시트 탭과 시작·종료 주차를 지정합니다.'],
                ['3', '명시적으로 불러오기', '설정 후 시트 설정에서 직접 값을 가져와 저장할 값을 확인합니다.'],
              ]).map(([step, title, detail]) => (
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
            <AlertDialogCancel>{cashflowSheetConfig ? '닫기' : '나중에 하기'}</AlertDialogCancel>
            {!cashflowSheetConfig?.value ? (
              <AlertDialogAction onClick={() => navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)}>
                시트 연동 설정
              </AlertDialogAction>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => void handleStartSheetChangeReview()} disabled={sheetRefreshLoading || sheetMirrorStatus !== 'FRESH'}>
                  {sheetRefreshLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  고정값 비교하기
                </Button>
                <AlertDialogAction onClick={() => void handleStartSheetChangeReview(true)} disabled={sheetRefreshLoading || sheetMirrorStatus !== 'FRESH'} className="bg-rose-700 hover:bg-rose-800">
                  {sheetRefreshLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  {yearMonth} 원장 덮어쓰기
                </AlertDialogAction>
              </>
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
            <AlertDialogTitle>{sheetStageDialog?.replaceAllActualSources ? `${yearMonth} 원장 덮어쓰기` : `시트 값 비교 ${sheetStageDialog?.stagedLineCount.toLocaleString() || 0}건`}</AlertDialogTitle>
            <AlertDialogDescription>
              {sheetStageDialog?.replaceAllActualSources
                ? '이 월의 Projection과 Actual 기존값을 모두 지우고, 고정한 시트 160개 셀로 교체합니다. 감사 이력은 유지됩니다.'
                : '원장은 아직 변경되지 않았습니다. 아래 변경 범위를 확인한 뒤 이 팝업에서 바로 저장합니다.'}
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
              <div className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${sheetStageDialog.replaceAllActualSources ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                {sheetStageDialog.replaceAllActualSources
                  ? '기존 은행·수기 등 Actual 출처도 이 월에서는 삭제됩니다. 시트값이 이 월의 단일 기준인지 확인한 뒤 저장하세요.'
                  : 'Actual은 시트 출처 값만 갱신하고 다른 출처 값은 유지합니다. 확인 필요 표시가 있는 행은 저장되지 않습니다.'}
              </div>
              {!sheetStageDialog.replaceAllActualSources ? renderSheetStageReviewGrid(sheetStageDialog) : null}
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
                ? sheetStageDialog.replaceAllActualSources
                  ? `${yearMonth} 원장 전체 덮어쓰기`
                  : `검토한 값 ${Math.max(0, sheetStageDialog.stagedLineCount - sheetStageDialog.riskLineCount).toLocaleString()}건 원장에 저장`
                : '저장할 변경 없음'}
            </Button>
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
             <AlertDialogTitle>{hasDirty ? '저장되지 않은 변경사항이 있습니다' : '수정 세션을 종료할까요?'}</AlertDialogTitle>
             <AlertDialogDescription>
               {hasDirty
                 ? '페이지를 이동하면 아직 저장되지 않은 캐시플로 입력값이 유실될 수 있습니다.'
                 : '페이지를 이동하면 현재 프로젝트의 수정 선점이 종료됩니다.'}
             </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={exitBusy} onClick={() => blocker.reset?.()}>계속 작성</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={exitBusy}
              onClick={() => void discardChangesAndLeave()}
            >
               {hasDirty ? '저장하지 않고 종료' : '수정 세션 종료'}
             </Button>
             {hasDirty ? (
               <AlertDialogAction
                 disabled={exitBusy}
                 onClick={(event) => {
                   event.preventDefault();
                   void savePrivateDraftAndLeave();
                 }}
               >
                 임시저장 후 종료
               </AlertDialogAction>
             ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <EditLeaseDialogs
        warningOpen={cashflowLease.warningOpen}
        expiredOpen={cashflowLease.expiredOpen}
        conflictOpen={cashflowLease.conflictOpen}
        holder={cashflowLease.holder}
        expiresAt={cashflowLease.expiresAt}
        remainingMs={cashflowLease.remainingMs}
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
