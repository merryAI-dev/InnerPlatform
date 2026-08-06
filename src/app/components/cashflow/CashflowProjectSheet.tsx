import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Columns2, FileSpreadsheet, Loader2, LockKeyhole, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useBlocker, useNavigate } from 'react-router';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
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
  type OrgMember,
  type Project,
  type CashflowSheetLineId,
  type UserRole,
} from '../../data/types';
import { getSeoulTodayIso } from '../../platform/business-days';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../../platform/cashflow-sheet';
import { getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { recordDevtoolsLog, toDevtoolsError } from '../../platform/devtools-transaction-log';
import {
  fetchCashflowActivityViaBff,
  requestCashflowMonthCloseViaBff,
  saveCashflowMonthCloseApproverViaBff,
  completeCashflowWeeklyUpdateViaBff,
  decideCashflowMonthReopenViaBff,
  fetchCashflowMonthCloseViaBff,
  fetchCurrentCashflowMonthCloseRequestViaBff,
  fetchCashflowWeeklyComplianceViaBff,
  requestCashflowMonthReopenViaBff,
  type CashflowMonthCloseCell,
  type CashflowMonthCloseDraftInput,
  type CashflowMonthCloseResult,
  type CashflowMonthCloseRequest,
  type CashflowCumulativeCloseScope,
  type CashflowDeadlineSummary,
  type CashflowActivityEvent,
  type CashflowActivitySource,
  type CashflowWeeklyComplianceItem,
} from '../../lib/platform-bff-client';
import { getCashflowModeLineLabel } from '../../platform/policies/cashflow-policy';
import { getSnappedWeekScrollLeft } from './cashflow-board-scroll';
import type { CashflowOpsTone } from './cashflow-ops-summary';
import {
  applyCashflowSheetLabViaBff,
  cashflowFormulaMismatchesFromError,
  checkCashflowSheetChangesViaBff,
  getCashflowSheetLabApplyStatusViaBff,
  getCashflowSheetLabMirrorViaBff,
  getCashflowSheetLabShareAccountViaBff,
  isCashflowSheetApplyResultUncertain,
  refreshCashflowSheetLabMirrorViaBff,
  stageCashflowSheetLabViaBff,
  type CashflowSheetLabMirrorResult,
  type CashflowSheetChangeCheckResult,
  type CashflowSheetLabShareAccountResult,
  type CashflowSheetLabStageResult,
  type CashflowFormulaMismatch,
} from '../../lib/sheets-cashflow-readonly-client';
import {
  buildCashflowMonthCloseDraftInput,
  carryForwardCashflowRunningBalances,
  createEmptyCashflowMonthCloseDepositRows,
  isCashflowMonthCloseRequestLocked,
  isCashflowWeekLockedByRange,
  normalizeCashflowMonthCloseCells,
  resolveCashflowComparisonScope,
  resolveCashflowEvidenceScope,
  shouldApplyCashflowMonthCloseRequestResult,
  shouldHideCashflowValuesAfterLoadError,
  summarizeCanonicalCashflowYear,
  type CashflowMonthCloseDepositReviewRow,
} from './cashflow-month-close';
import { CashflowSheetSyncOverlay } from './CashflowSheetSyncOverlay';
import { CashflowFormulaMismatchDialog } from './CashflowFormulaMismatchDialog';
import { CashflowCanonicalSummary } from './CashflowCanonicalSummary';
import { AxrMonthCloseQaPanel } from './AxrMonthCloseQaPanel';
import { MemberPicker } from '../ui/member-picker';
import { buildOrgMemberPickerOptions } from '../../data/project-team-member-options';
import { loadCashflowActivitySourcesSequentially } from './cashflow-activity-loader';

const CASHFLOW_STANDARD_ANNUAL_YEARS = [2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032] as const;

function previousYearMonth(yearMonth: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return '';
  const month = new Date(`${yearMonth}-01T00:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  return month.toISOString().slice(0, 7);
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function isCumulativeCloseScopeReady(scope: CashflowCumulativeCloseScope | null | undefined, selectedMonth: string): scope is CashflowCumulativeCloseScope {
  const throughMonth = previousYearMonth(selectedMonth);
  return scope?.throughMonth === throughMonth
    && scope.lockRange.throughMonth === throughMonth
    && scope.lockRange.fromMonth === scope.fromMonth
    && scope.lockRange.fromWeekNo === 1
    && scope.lockRange.throughWeekNo === 5;
}

function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toLocaleString('ko-KR')}`;
}

function formatSheetAppliedAt(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

type WeeklyProjectionMissingCell = { yearMonth: string; weekNo: number; lineId: string };
type WeeklyProjectionValidation = { missingCells: WeeklyProjectionMissingCell[]; evidenceHash: string };

function weeklyProjectionValidation(error: unknown): WeeklyProjectionValidation | null {
  const details = (error as { body?: { details?: { missingCells?: unknown; evidenceHash?: unknown } } })?.body?.details;
  const missingCells = Array.isArray(details?.missingCells)
    ? details.missingCells.filter((cell): cell is WeeklyProjectionMissingCell => Boolean(
      cell && typeof cell === 'object'
      && /^20\d{2}-(0[1-9]|1[0-2])$/.test(String((cell as WeeklyProjectionMissingCell).yearMonth))
      && Number.isInteger(Number((cell as WeeklyProjectionMissingCell).weekNo))
      && typeof (cell as WeeklyProjectionMissingCell).lineId === 'string',
    ))
    : [];
  const evidenceHash = typeof details?.evidenceHash === 'string' ? details.evidenceHash : '';
  return missingCells.length > 0 && /^sha256:[a-f0-9]{64}$/.test(evidenceHash)
    ? { missingCells, evidenceHash }
    : null;
}

function decodeActivityActor(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function weeklyCompletionStatusLabel(status?: 'COMPLETED' | 'COMPLETED_LATE' | 'MISSED' | 'PENDING'): string {
  if (status === 'COMPLETED') return '기한 내 완료';
  if (status === 'COMPLETED_LATE') return '기한 후 완료';
  if (status === 'MISSED') return '기한 지남';
  return '완료 대기';
}

function weeklySettlementSurface(status?: string): string {
  if (status === 'COMPLETED' || status === 'COMPLETED_LATE') return 'bg-emerald-50';
  if (status === 'MISSED') return 'bg-red-50';
  if (status === 'PENDING') return 'bg-yellow-50';
  return '';
}

// 지난 달은 "닫혔나"가, 이번 달은 "이번 주 뭘 해야 하나"가 유일하게 중요한 질문이다.
// 현재 달은 아직 결산할 수 없으므로(대상월이 끝나야 결산 가능) 주간 정산 상태를 그대로 보여준다.
function cashflowWeekSurface(monthCloseStatus?: string, weeklyStatus?: string, closeOverdue?: boolean): string {
  if (monthCloseStatus === 'CLOSED' || monthCloseStatus === 'PENDING' || monthCloseStatus === 'APPROVING') return 'bg-slate-200';
  if (closeOverdue) return 'bg-red-100';
  return weeklySettlementSurface(weeklyStatus);
}

function logCashflowSettlement(input: {
  phase: 'start' | 'success' | 'error' | 'info';
  operation: string;
  projectId: string;
  yearMonth?: string;
  weekNo?: number;
  durationMs?: number;
  summary?: Record<string, unknown>;
  error?: unknown;
}): void {
  recordDevtoolsLog({
    kind: 'cashflow_transaction',
    phase: input.phase,
    operation: input.operation,
    transport: 'bff',
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    weekNo: input.weekNo,
    durationMs: input.durationMs,
    summary: input.summary,
    ...(input.error ? { error: toDevtoolsError(input.error) } : {}),
  });
}

type CashflowEvent = CashflowActivityEvent & { revertedAt?: string };
const CASHFLOW_ACTIVITY_SOURCE_LABELS: Record<CashflowActivitySource, string> = {
  legacy: '일반 변경',
  sheet_refresh: '시트 불러오기',
  audit: '시트 반영·월 결산',
};

function mergeCashflowEvents(current: CashflowEvent[], incoming: CashflowActivityEvent[]): CashflowEvent[] {
  const events = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => events.set(event.id, event));
  return [...events.values()]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

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
      <TooltipContent side="top" className="max-w-[280px] text-[12px] leading-relaxed">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

function formatSheetWeekLabel(yearMonth: string, weekNo: number): string {
  const year = Number.parseInt(yearMonth.slice(2, 4), 10);
  const month = Number.parseInt(yearMonth.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return `w${weekNo}`;
  return `${year}-${month}-${weekNo}`;
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
      <span className="block text-[12px] font-normal leading-4 text-slate-500">{detail}</span>
    </>
  );
}

function isBffAuthRejection(error: unknown): boolean {
  const source = error as { status?: number; body?: { code?: string; error?: string } };
  const code = bffErrorCode(error);
  return source.status === 401
    || source.status === 403
    || code === 'missing_bearer_token'
    || code === 'invalid_token';
}

function bffErrorCode(error: unknown): string {
  const source = error as { body?: { code?: string; error?: string } };
  return source.body?.code || source.body?.error || '';
}

export function CashflowProjectSheet({
  projectId,
  projectName,
  project,
  members,
  onExecutiveApproverSaved,
  roleOverride,
}: {
  projectId: string;
  projectName?: string;
  project?: Project | null;
  members?: OrgMember[];
  onExecutiveApproverSaved?: (result: {
    executiveApproverId: string;
    executiveApproverName: string;
    executiveApproverEmail: string;
    version: number;
    updatedAt: string;
  }) => void;
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
  const { orgId } = useFirebase();
  const navigate = useNavigate();
  const role = (roleOverride || user?.role || '').toString().toLowerCase() as UserRole | '';
  const canReviewReopen = role === 'finance' || role === 'admin';
  const canUseCashflowActions = role === 'pm' || role === 'finance' || role === 'admin';
  const canFinalizeMonth = role === 'viewer' || role === 'pm' || role === 'finance' || role === 'admin' || role === 'tenant_admin';
  const canCompleteWeekly = canFinalizeMonth || role === 'tenant_admin';
  const canRequestMonthReopen = canFinalizeMonth;
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
  } = useCashflowWeeks();

  const [cashflowSheetConfig, setCashflowSheetConfig] = useState<{
    sourceYear?: number;
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
  const [cashflowSheetChangeCheck, setCashflowSheetChangeCheck] = useState<CashflowSheetChangeCheckResult | null>(null);
  const [cashflowSystemAccountEmail, setCashflowSystemAccountEmail] = useState('');
  const [cashflowSystemAccountError, setCashflowSystemAccountError] = useState(false);
  const [cashflowSheetMirror, setCashflowSheetMirror] = useState<CashflowSheetLabMirrorResult | null>(null);
  const [monthCloseResult, setMonthCloseResult] = useState<CashflowMonthCloseResult | null>(null);
  const [monthCloseRequest, setMonthCloseRequest] = useState<CashflowMonthCloseRequest | null>(null);
  const [monthCloseLoading, setMonthCloseLoading] = useState(false);
  const [monthCloseError, setMonthCloseError] = useState<string | null>(null);
  const [monthCloseBusy, setMonthCloseBusy] = useState(false);
  const [selectedExecutiveApproverId, setSelectedExecutiveApproverId] = useState(project?.executiveApproverId || '');
  const [savedExecutiveApproverId, setSavedExecutiveApproverId] = useState(project?.executiveApproverId || '');
  const [executiveApproverBusy, setExecutiveApproverBusy] = useState(false);
  const [executiveApproverAttention, setExecutiveApproverAttention] = useState(false);
  const [weeklyCompletionBusy, setWeeklyCompletionBusy] = useState(false);
  const [weeklyCompletionOpen, setWeeklyCompletionOpen] = useState(false);
  const [weeklyUpdateResult, setWeeklyUpdateResult] = useState<'CHANGED' | 'NO_CHANGES' | ''>('');
  const [weeklyCompletionError, setWeeklyCompletionError] = useState('');
  const [weeklyProjectionWarning, setWeeklyProjectionWarning] = useState<WeeklyProjectionValidation | null>(null);
  const [weeklyHistoryOpen, setWeeklyHistoryOpen] = useState(false);
  const [weeklyComplianceHistory, setWeeklyComplianceHistory] = useState<CashflowWeeklyComplianceItem[]>([]);
  const [weeklyComplianceHistoryLoading, setWeeklyComplianceHistoryLoading] = useState(false);
  const [weeklyComplianceHistoryError, setWeeklyComplianceHistoryError] = useState('');
  const [weeklyComplianceNextCursor, setWeeklyComplianceNextCursor] = useState('');
  const [weeklyCompliancePageCount, setWeeklyCompliancePageCount] = useState(0);
  const [monthCloseReviewOpen, setMonthCloseReviewOpen] = useState(false);
  const [monthCloseHumanReviewed, setMonthCloseHumanReviewed] = useState(false);
  const [monthCloseDepositRows, setMonthCloseDepositRows] = useState<CashflowMonthCloseDepositReviewRow[]>(
    () => createEmptyCashflowMonthCloseDepositRows(),
  );
  const [monthCloseReviewDirty, setMonthCloseReviewDirty] = useState(false);
  const [reopenAction, setReopenAction] = useState<'request' | 'approve' | 'reject' | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [sheetRefreshLoading, setSheetRefreshLoading] = useState(false);
  const [sheetReviewDialogOpen, setSheetReviewDialogOpen] = useState(false);
  const [lateSheetApply, setLateSheetApply] = useState<CashflowSheetLabStageResult | null>(null);
  const [sheetApplyResumeRequired, setSheetApplyResumeRequired] = useState(false);
  const [lateSheetChangeReason, setLateSheetChangeReason] = useState('');
  const [lateSheetFormulaAccepted, setLateSheetFormulaAccepted] = useState(false);
  const [lateSheetDiffQuery, setLateSheetDiffQuery] = useState('');
  const [lateSheetDiffMode, setLateSheetDiffMode] = useState('ALL');
  const [lateSheetDiffMonth, setLateSheetDiffMonth] = useState('ALL');
  const [lateSheetDiffWeek, setLateSheetDiffWeek] = useState('ALL');
  const [formulaMismatchPrompt, setFormulaMismatchPrompt] = useState<{
    stage: CashflowSheetLabStageResult;
    issues: CashflowFormulaMismatch[];
    closedMonthChangeReason: string;
  } | null>(null);
  const [sheetStageApplyLoading, setSheetStageApplyLoading] = useState(false);
  const lateSheetDiffRows = useMemo(() => (lateSheetApply?.closedMonthDifferences || []).flatMap((month) =>
    (month.changes || []).map((change) => ({ ...change, yearMonth: month.yearMonth }))), [lateSheetApply]);
  const lateSheetDiffComplete = Boolean(lateSheetApply?.closedMonthDifferenceManifestHash)
    && Number.isSafeInteger(lateSheetApply?.closedMonthDifferenceCount)
    && lateSheetApply?.closedMonthDifferenceCount === lateSheetDiffRows.length
    && (lateSheetApply?.closedMonthDifferences || []).every((month) => !month.truncatedChangeCount);
  const filteredLateSheetDiffRows = lateSheetDiffRows.filter((change) => {
    const label = CASHFLOW_SHEET_LINE_LABELS[change.lineId as CashflowSheetLineId] || change.lineId;
    const query = lateSheetDiffQuery.trim().toLocaleLowerCase('ko-KR');
    return (lateSheetDiffMode === 'ALL' || change.mode === lateSheetDiffMode)
      && (lateSheetDiffMonth === 'ALL' || change.yearMonth === lateSheetDiffMonth)
      && (lateSheetDiffWeek === 'ALL' || String(change.weekNo) === lateSheetDiffWeek)
      && (!query || `${change.yearMonth} ${change.weekNo} ${change.mode} ${label} ${change.lineId}`.toLocaleLowerCase('ko-KR').includes(query));
  });
  const executiveApproverOptions = useMemo(() => buildOrgMemberPickerOptions(members || [])
    .filter((member) => (
      member.uid !== user?.uid
      && member.uid !== project?.registeredById
      && member.uid !== project?.managerId
    )),
  [members, project?.managerId, project?.registeredById, user?.uid]);

  useEffect(() => {
    const approverId = project?.executiveApproverId || '';
    setSelectedExecutiveApproverId(approverId);
    setSavedExecutiveApproverId(approverId);
  }, [project?.executiveApproverId, projectId]);
  const [cashflowEvents, setCashflowEvents] = useState<CashflowEvent[]>([]);
  const [cashflowEventErrors, setCashflowEventErrors] = useState<Array<{ source: CashflowActivitySource; message: string }>>([]);
  const [cashflowEventLoadingSources, setCashflowEventLoadingSources] = useState<CashflowActivitySource[]>([]);
  const cashflowActivityGenerationRef = useRef(0);
  const [cashflowEventQuery, setCashflowEventQuery] = useState('');
  const [cashflowEventMode, setCashflowEventMode] = useState('ALL');
  const [cashflowEventMonth, setCashflowEventMonth] = useState('ALL');
  const [revertingRunId, setRevertingRunId] = useState<string | null>(null);
  const monthCloseRequestGenerationRef = useRef(0);
  const monthCloseCurrentRequestGenerationRef = useRef(0);
  const selectedYearMonthRef = useRef(yearMonth);
  selectedYearMonthRef.current = yearMonth;
  const monthCloseRequestLocked = isCashflowMonthCloseRequestLocked(monthCloseRequest?.status);

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const selectedYear = useMemo(() => {
    const parsed = Number.parseInt(yearMonth.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  }, [yearMonth]);
  const cashflowEvidenceScope = resolveCashflowEvidenceScope({
    projectId,
    yearMonth,
    monthClose: monthCloseResult,
    liveYearView: null,
    liveSheetMetadata: cashflowSheetMirror?.status === 'FRESH'
      ? cashflowSheetMirror.sheetFacts?.metadata
      : undefined,
  });
  const yearWeeks = useMemo(() => getYearMondayWeeks(selectedYear), [selectedYear]);
  const annualWeeks = useMemo<MonthMondayWeek[]>(
    () => yearWeeks.map(hydrateWeekDates),
    [yearWeeks],
  );
  const cashflowBoardScrollRef = useRef<HTMLElement | null>(null);
  const [exitBusy, setExitBusy] = useState(false);

  const hasDirty = monthCloseReviewDirty;
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
    setMonthCloseResult(null);
    setMonthCloseDepositRows(createEmptyCashflowMonthCloseDepositRows());
    setMonthCloseHumanReviewed(false);
    setMonthCloseReviewDirty(false);
  }, [projectId]);

  const discardChangesAndLeave = useCallback(async (): Promise<void> => {
    if (blocker.state !== 'blocked') return;
    setExitBusy(true);
    try {
      setMonthCloseReviewDirty(false);
      blocker.proceed?.();
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '저장하지 않고 종료하지 못했습니다. 다시 시도해 주세요.'));
    } finally {
      setExitBusy(false);
    }
  }, [blocker]);

  useEffect(() => {
    let cancelled = false;
    setCashflowSheetConfigLoaded(false);
    setCashflowSheetConfig(null);
    setCashflowSystemAccountEmail('');
    setCashflowSystemAccountError(false);
    if (!projectId || !orgId || !user?.uid) {
      setCashflowSheetConfigLoaded(true);
      return () => { cancelled = true; };
    }
    const loadConfig = async (): Promise<void> => {
      try {
        let actor = await resolveBffActor();
        if (!actor?.idToken) return;
        let response: CashflowSheetLabShareAccountResult;
        try {
          response = await getCashflowSheetLabShareAccountViaBff({ tenantId: orgId, actor, projectId, sourceYear: selectedYear });
        } catch (error) {
          if (!isBffAuthRejection(error)) throw error;
          actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          response = await getCashflowSheetLabShareAccountViaBff({ tenantId: orgId, actor, projectId, sourceYear: selectedYear });
        }
        if (!cancelled) {
          setCashflowSheetConfig(response.config?.value ? response.config : null);
          setCashflowSystemAccountEmail(response.systemAccountEmail || response.accessPolicy?.serviceAccountEmail || '');
          setCashflowSystemAccountError(!(response.systemAccountEmail || response.accessPolicy?.serviceAccountEmail));
        }
      } catch {
        if (!cancelled) {
          setCashflowSheetConfig(null);
          setCashflowSystemAccountError(true);
        }
      } finally {
        if (!cancelled) setCashflowSheetConfigLoaded(true);
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, resolveBffActor, selectedYear, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    setCashflowSheetChangeCheck(null);
    if (!cashflowSheetConfigLoaded || !cashflowSheetConfig?.value || !projectId || !orgId || !user?.uid) {
      return () => { cancelled = true; };
    }

    setCashflowSheetChangeCheck({
      status: 'CHECKING',
      classification: 'PARTIAL',
      checkedAt: '',
      sheet: { status: 'AVAILABLE' },
      comparisons: {
        sheetToJvm: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
        sheetToFirestore: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
        jvmToFirestore: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
      },
    });
    const checkSheetChanges = async (): Promise<void> => {
      try {
        let actor = await resolveBffActor();
        if (!actor?.idToken) throw new Error('Cashflow sheet change check requires authentication.');
        let result: CashflowSheetChangeCheckResult;
        try {
          result = await checkCashflowSheetChangesViaBff({
            tenantId: orgId,
            actor,
            projectId,
            sourceYear: cashflowSheetConfig.sourceYear || selectedYear,
          });
        } catch (error) {
          if (!isBffAuthRejection(error)) throw error;
          actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          result = await checkCashflowSheetChangesViaBff({
            tenantId: orgId,
            actor,
            projectId,
            sourceYear: cashflowSheetConfig.sourceYear || selectedYear,
          });
        }
        if (!cancelled) {
          setCashflowSheetChangeCheck(result);
        }
      } catch {
        if (!cancelled) setCashflowSheetChangeCheck({
          status: 'UNAVAILABLE',
          classification: 'PARTIAL',
          checkedAt: '',
          sheet: { status: 'UNAVAILABLE' },
          comparisons: {
            sheetToJvm: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
            sheetToFirestore: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
            jvmToFirestore: { status: 'UNAVAILABLE', changeCount: null, projectionChangeCount: null, actualChangeCount: null },
          },
        });
      }
    };
    void checkSheetChanges();
    return () => { cancelled = true; };
  }, [
    cashflowSheetConfig?.sourceYear,
    cashflowSheetConfig?.value,
    cashflowSheetConfigLoaded,
    orgId,
    projectId,
    resolveBffActor,
    selectedYear,
    user?.uid,
  ]);

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

  const loadCashflowMonthClose = useCallback(async (): Promise<void> => {
    const requestGeneration = ++monthCloseRequestGenerationRef.current;
    const isCurrentRequest = () => requestGeneration === monthCloseRequestGenerationRef.current;
    if (!projectId || !orgId || !user?.uid) {
      setMonthCloseResult(null);
      setMonthCloseError('로그인 세션이 만료되었습니다.');
      return;
    }
    setMonthCloseResult((current) => current?.yearMonth === yearMonth ? current : null);
    setMonthCloseLoading(true);
    setMonthCloseError(null);
    const startedAt = Date.now();
    logCashflowSettlement({
      phase: 'start',
      operation: 'cashflow.month_close.status.load',
      projectId,
      yearMonth,
      summary: { selectedYear },
    });
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      try {
      const result = await fetchCashflowMonthCloseViaBff({
        tenantId: orgId,
        actor,
        projectId,
        yearMonth,
      });
      if (!isCurrentRequest()) return;
      setMonthCloseResult(result);
      logCashflowSettlement({
        phase: 'success',
        operation: 'cashflow.month_close.status.load',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        summary: { status: result.status, closeEligible: result.closeEligible },
      });
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        const refreshedActor = await resolveBffActor({ forceRefresh: true });
        if (!refreshedActor?.idToken) throw error;
        const result = await fetchCashflowMonthCloseViaBff({
          tenantId: orgId,
          actor: refreshedActor,
          projectId,
          yearMonth,
        });
        if (!isCurrentRequest()) return;
        setMonthCloseResult(result);
        logCashflowSettlement({
          phase: 'success',
          operation: 'cashflow.month_close.status.load',
          projectId,
          yearMonth,
          durationMs: Date.now() - startedAt,
          summary: { status: result.status, closeEligible: result.closeEligible, retriedAuth: true },
        });
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      setMonthCloseError(resolveApiErrorMessage(error, '월 결산 상태를 불러오지 못했습니다.'));
      logCashflowSettlement({
        phase: 'error',
        operation: 'cashflow.month_close.status.load',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        error,
      });
    } finally {
      if (isCurrentRequest()) setMonthCloseLoading(false);
    }
  }, [orgId, projectId, resolveBffActor, selectedYear, user?.uid, yearMonth]);

  useEffect(() => {
    void loadCashflowMonthClose();
  }, [loadCashflowMonthClose]);

  const loadMonthCloseRequest = useCallback(async (): Promise<void> => {
    const requestGeneration = ++monthCloseCurrentRequestGenerationRef.current;
    const requestedYearMonth = yearMonth;
    const isCurrentRequest = () => shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration,
      currentGeneration: monthCloseCurrentRequestGenerationRef.current,
      requestedYearMonth,
      selectedYearMonth: selectedYearMonthRef.current,
    });
    if (!projectId || !orgId || !user?.uid) {
      if (isCurrentRequest()) setMonthCloseRequest(null);
      return;
    }
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) return;
      const request = await fetchCurrentCashflowMonthCloseRequestViaBff({
        tenantId: orgId,
        actor,
        projectId,
        yearMonth,
      });
      if (isCurrentRequest()) setMonthCloseRequest(request);
    } catch (error) {
      if (!isCurrentRequest()) return;
      logCashflowSettlement({
        phase: 'error',
        operation: 'cashflow.month_close.request.load',
        projectId,
        yearMonth,
        error,
      });
    }
  }, [orgId, projectId, resolveBffActor, user?.uid, yearMonth]);

  useEffect(() => {
    void loadMonthCloseRequest();
  }, [loadMonthCloseRequest]);

  const handleCompleteWeeklyUpdate = useCallback(async (): Promise<void> => {
    if (!canCompleteWeekly || !weeklyUpdateResult) return;
    if (!savedExecutiveApproverId) {
      setExecutiveApproverAttention(true);
      toast.error('먼저 프로젝트 조직장을 선택해 주세요.');
      return;
    }
    setWeeklyCompletionBusy(true);
    const startedAt = Date.now();
    const currentDeadline = monthCloseResult?.dashboard?.deadlineSummary?.current;
    logCashflowSettlement({
      phase: 'start',
      operation: 'cashflow.weekly_settlement.complete',
      projectId,
      yearMonth: currentDeadline?.yearMonth || yearMonth,
      weekNo: currentDeadline?.weekNo,
      summary: { alreadyCompleted: Boolean(currentDeadline?.completedAt) },
    });
    try {
      let actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const complete = (targetActor: typeof actor) => completeCashflowWeeklyUpdateViaBff({
        tenantId: orgId,
        actor: targetActor,
        projectId,
        yearMonth: currentDeadline?.yearMonth,
        weekNo: currentDeadline?.weekNo,
        updateResult: weeklyUpdateResult,
        ignoreProjectionValidation: Boolean(weeklyProjectionWarning),
        projectionValidationEvidenceHash: weeklyProjectionWarning?.evidenceHash,
        projectionValidationIssueCount: weeklyProjectionWarning?.missingCells.length,
      });
      let result;
      try {
        result = await complete(actor);
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        actor = await resolveBffActor({ forceRefresh: true });
        if (!actor?.idToken) throw error;
        result = await complete(actor);
      }
      await loadCashflowMonthClose();
      setWeeklyCompletionOpen(false);
      setWeeklyCompletionError('');
      setWeeklyProjectionWarning(null);
      setWeeklyUpdateResult('');
      logCashflowSettlement({
        phase: 'success',
        operation: 'cashflow.weekly_settlement.complete',
        projectId,
        yearMonth: result.yearMonth,
        weekNo: result.weekNo,
        durationMs: Date.now() - startedAt,
        summary: { alreadyCompleted: result.alreadyCompleted },
      });
      toast.success(result.alreadyCompleted
        ? `${result.yearMonth} ${result.weekNo}주차는 이미 정산 완료되었습니다.`
        : `${result.yearMonth} ${result.weekNo}주차 정산을 완료했습니다.`);
    } catch (error) {
      logCashflowSettlement({
        phase: 'error',
        operation: 'cashflow.weekly_settlement.complete',
        projectId,
        yearMonth: currentDeadline?.yearMonth || yearMonth,
        weekNo: currentDeadline?.weekNo,
        durationMs: Date.now() - startedAt,
        error,
      });
      const message = resolveApiErrorMessage(error, '주간 정산 완료 상태를 저장하지 못했습니다.');
      setWeeklyCompletionError(message);
      setWeeklyProjectionWarning(weeklyProjectionValidation(error));
      toast.error(message);
    } finally {
      setWeeklyCompletionBusy(false);
    }
  }, [canCompleteWeekly, loadCashflowMonthClose, monthCloseResult?.dashboard?.deadlineSummary?.current, orgId, projectId, resolveBffActor, savedExecutiveApproverId, weeklyProjectionWarning, weeklyUpdateResult, yearMonth]);

  const loadWeeklyComplianceHistory = useCallback(async (): Promise<void> => {
    setWeeklyComplianceHistoryLoading(true);
    setWeeklyComplianceHistoryError('');
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const page = await fetchCashflowWeeklyComplianceViaBff({ tenantId: orgId, actor, projectId, limit: 50 });
      setWeeklyComplianceHistory(page.items);
      setWeeklyComplianceNextCursor(page.nextCursor);
      setWeeklyCompliancePageCount(1);
    } catch (error) {
      setWeeklyComplianceHistoryError(resolveApiErrorMessage(error, '주간 정산 이력을 불러오지 못했습니다.'));
    } finally {
      setWeeklyComplianceHistoryLoading(false);
    }
  }, [orgId, projectId, resolveBffActor]);

  const loadMoreWeeklyComplianceHistory = useCallback(async (): Promise<void> => {
    if (!weeklyComplianceNextCursor || weeklyComplianceHistoryLoading) return;
    if (weeklyCompliancePageCount >= 100) {
      setWeeklyComplianceHistoryError('안전을 위해 100페이지에서 추가 조회를 중단했습니다. 검색 범위를 조정해 주세요.');
      return;
    }
    setWeeklyComplianceHistoryLoading(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const page = await fetchCashflowWeeklyComplianceViaBff({ tenantId: orgId, actor, projectId, limit: 50, cursor: weeklyComplianceNextCursor });
      if (page.nextCursor && page.nextCursor === weeklyComplianceNextCursor) throw new Error('이력 페이지가 반복되어 추가 조회를 중단했습니다.');
      setWeeklyComplianceHistory((items) => [...items, ...page.items]);
      setWeeklyComplianceNextCursor(page.nextCursor);
      setWeeklyCompliancePageCount((count) => count + 1);
    } catch (error) {
      setWeeklyComplianceHistoryError(resolveApiErrorMessage(error, '추가 주간 정산 이력을 불러오지 못했습니다.'));
    } finally {
      setWeeklyComplianceHistoryLoading(false);
    }
  }, [orgId, projectId, resolveBffActor, weeklyComplianceHistoryLoading, weeklyComplianceNextCursor, weeklyCompliancePageCount]);

  useEffect(() => {
    if (weeklyHistoryOpen) void loadWeeklyComplianceHistory();
  }, [loadWeeklyComplianceHistory, weeklyHistoryOpen]);

  const loadCashflowEventSource = useCallback(async (source: CashflowActivitySource, generation = cashflowActivityGenerationRef.current): Promise<void> => {
    if (!projectId || !orgId || !user?.uid) {
      return;
    }
    setCashflowEventLoadingSources((current) => current.includes(source) ? current : [...current, source]);
    try {
      let actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      try {
        const response = await fetchCashflowActivityViaBff({ tenantId: orgId, actor, projectId, source });
        if (cashflowActivityGenerationRef.current !== generation) return;
        setCashflowEvents((current) => mergeCashflowEvents(current, response.events));
      } catch (error) {
        if (!isBffAuthRejection(error)) throw error;
        actor = await resolveBffActor({ forceRefresh: true });
        if (!actor?.idToken) throw error;
        const response = await fetchCashflowActivityViaBff({ tenantId: orgId, actor, projectId, source });
        if (cashflowActivityGenerationRef.current !== generation) return;
        setCashflowEvents((current) => mergeCashflowEvents(current, response.events));
      }
      setCashflowEventErrors((current) => current.filter((failure) => failure.source !== source));
    } catch (error) {
      if (cashflowActivityGenerationRef.current !== generation) return;
      const message = resolveApiErrorMessage(error, `${CASHFLOW_ACTIVITY_SOURCE_LABELS[source]} 기록을 불러오지 못했습니다.`);
      setCashflowEventErrors((current) => [...current.filter((failure) => failure.source !== source), { source, message }]);
    } finally {
      if (cashflowActivityGenerationRef.current === generation) {
        setCashflowEventLoadingSources((current) => current.filter((candidate) => candidate !== source));
      }
    }
  }, [orgId, projectId, resolveBffActor, user?.uid]);

  const loadCashflowEvents = useCallback(async (): Promise<void> => {
    const generation = cashflowActivityGenerationRef.current + 1;
    cashflowActivityGenerationRef.current = generation;
    setCashflowEventErrors([]);
    setCashflowEventLoadingSources([]);
    await loadCashflowActivitySourcesSequentially(async (source) => {
      await loadCashflowEventSource(source, generation);
    });
  }, [loadCashflowEventSource]);

  useEffect(() => {
    setCashflowEvents([]);
    void loadCashflowEvents();
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
        ...(['VALUE', 'ZERO'].includes(cell.cellState) ? { amount: Number(cell.amount || 0) } : {}),
      })),
    };
  }, [cashflowSheetMirror, monthCloseResult?.dashboard, projectId, yearMonth]);

  useEffect(() => {
    setMonthCloseHumanReviewed(false);
  }, [yearMonth, monthClosePinnedSource?.sourceRevision, monthClosePinnedSource?.targetRevisionAtFetch]);

  useEffect(() => {
    const sourceRows = monthCloseResult?.dashboard?.sheetDepositScheduleRows || [];
    if (sourceRows.length !== 5 || monthCloseReviewDirty) return;
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
  }, [monthCloseResult?.dashboard?.sheetDepositScheduleRows, monthCloseReviewDirty]);

  const monthCloseCellsState = useMemo(() => {
    try {
      return {
        cells: normalizeCashflowMonthCloseCells(monthClosePinnedSource, yearMonth),
        error: null as string | null,
      };
    } catch (error) {
      return {
        cells: [] as CashflowMonthCloseCell[],
        error: error instanceof Error ? error.message : '결산 대상 시트 셀을 확인하지 못했습니다.',
      };
    }
  }, [monthClosePinnedSource, yearMonth]);

  const monthClosePreparation = useMemo(() => {
    const mirrorIsFresh = monthClosePinnedSource?.status === 'FRESH';
    const hasSelectedMonth = Boolean(monthClosePinnedSource?.yearMonths?.includes(yearMonth));
    const hasSnapshotRevision = Boolean(monthClosePinnedSource?.sourceRevision && monthClosePinnedSource?.targetRevisionAtFetch);
    if (monthCloseCellsState.error) {
      if (!cashflowSheetConfig?.value) {
        return {
          status: 'SHEET_SETUP_REQUIRED' as const,
          title: '결산 기준 시트를 연결해 주세요.',
          detail: '시트를 연결한 뒤 필요한 시점에만 시트 값을 불러오면, 그 고정본을 기준으로 월 결산합니다.',
          actionLabel: '시트 설정으로 이동',
        };
      }
      return {
        status: 'PINNED_SHEET_REQUIRED' as const,
        title: `${yearMonth} 결산 기준 시트값을 준비해 주세요.`,
        detail: monthCloseCellsState.error,
        actionLabel: '시트 값 불러오기',
      };
    }
    if (monthCloseError) {
      return {
        status: 'STATUS_RETRY_REQUIRED' as const,
        title: '월 결산 상태를 다시 확인해 주세요.',
        detail: `${monthCloseError} 다시 확인해도 계속되면 개발자도구의 cashflow.month_close.status.load 로그를 확인해 주세요.`,
        actionLabel: '결산 상태 다시 확인',
      };
    }
    if (monthCloseLoading) {
      return {
        status: 'STATUS_LOADING' as const,
        title: '결산 상태를 확인하고 있습니다.',
        detail: '서버의 결산 가능일과 고정본 상태를 확인한 뒤 확정할 수 있습니다.',
        actionLabel: null,
      };
    }
    if (!monthCloseResult) {
      return {
        status: 'STATUS_RETRY_REQUIRED' as const,
        title: '월 결산 상태를 다시 확인해 주세요.',
        detail: '서버 상태를 확인하지 못했습니다. 다시 확인해도 계속되면 개발자도구의 cashflow.month_close.status.load 로그를 확인해 주세요.',
        actionLabel: '결산 상태 다시 확인',
      };
    }
    if (!monthCloseResult.closeEligible) {
      return {
        status: 'CLOSE_DATE_PENDING' as const,
        title: '아직 월 결산 가능일이 아닙니다.',
        detail: monthCloseResult.dashboard?.summary?.closeDeadline && monthCloseResult.dashboard.summary.targetYearMonth
          ? `${monthCloseResult.dashboard.summary.closeDeadline}까지 ${monthCloseResult.dashboard.summary.targetYearMonth}월의 시트값과 현금흐름을 확인한 뒤 결산할 수 있습니다.`
          : '월 결산 가능일을 서버에서 확인한 뒤 결산할 수 있습니다.',
        actionLabel: null,
      };
    }
    return {
      status: 'READY' as const,
      title: '월 결산을 진행할 수 있습니다.',
      detail: `고정된 시트값 ${hasSelectedMonth && hasSnapshotRevision && mirrorIsFresh ? '및 서버 검증 결과' : '을'} 기준으로 ${yearMonth}을 확정합니다.`,
      actionLabel: null,
    };
  }, [cashflowSheetConfig?.value, monthCloseCellsState.error, monthCloseError, monthCloseLoading, monthClosePinnedSource?.sourceRevision, monthClosePinnedSource?.status, monthClosePinnedSource?.targetRevisionAtFetch, monthClosePinnedSource?.yearMonths, monthCloseResult, yearMonth]);

  const handleSaveExecutiveApprover = useCallback(async (): Promise<void> => {
    const approver = executiveApproverOptions.find((member) => member.uid === selectedExecutiveApproverId);
    if (!project || !approver) {
      toast.error('조직장을 선택해 주세요.');
      return;
    }
    setExecutiveApproverBusy(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const result = await saveCashflowMonthCloseApproverViaBff({
        tenantId: orgId,
        actor,
        projectId,
        payload: {
          approverUid: approver.uid,
          yearMonth,
          expectedVersion: project.version,
        },
        idempotencyKey: `cashflow-month-close-approver:${projectId}:${yearMonth}:${approver.uid}:${project.version ?? 0}`,
      });
      setSavedExecutiveApproverId(result.executiveApproverId);
      setExecutiveApproverAttention(false);
      onExecutiveApproverSaved?.(result);
      toast.success(`${result.executiveApproverName || approver.name}님을 프로젝트 조직장으로 지정했습니다.`);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '조직장을 저장하지 못했습니다.'));
    } finally {
      setExecutiveApproverBusy(false);
    }
  }, [executiveApproverOptions, onExecutiveApproverSaved, orgId, project, projectId, resolveBffActor, selectedExecutiveApproverId, yearMonth]);

  const handleOpenMonthCloseReview = useCallback((): void => {
    const summary = {
      status: monthClosePreparation.status,
      hasSheetConfig: Boolean(cashflowSheetConfig?.value),
      mirrorStatus: cashflowSheetMirror?.status || 'EMPTY',
      hasSourceRevision: Boolean(monthClosePinnedSource?.sourceRevision),
      hasSelectedMonth: Boolean(monthClosePinnedSource?.yearMonths?.includes(yearMonth)),
      monthCloseStatus: monthCloseResult?.status || 'UNAVAILABLE',
      closeEligible: Boolean(monthCloseResult?.closeEligible),
    };
    logCashflowSettlement({
      phase: 'info',
      operation: 'cashflow.month_close.review.open',
      projectId,
      yearMonth,
      summary,
    });
    if (!canFinalizeMonth) {
      toast.error('프로젝트 접근 권한이 있는 활성 사용자만 월 결산할 수 있습니다.');
      return;
    }
    if (project && !savedExecutiveApproverId) {
      setExecutiveApproverAttention(true);
      toast.error('먼저 프로젝트 조직장을 선택해 주세요.');
      return;
    }
    setMonthCloseReviewOpen(true);
    if (monthClosePreparation.status !== 'READY' && monthClosePreparation.status !== 'STATUS_LOADING') {
      logCashflowSettlement({
        phase: 'info',
        operation: 'cashflow.month_close.preflight.blocked',
        projectId,
        yearMonth,
        summary,
      });
    }
  }, [canFinalizeMonth, cashflowSheetConfig?.value, cashflowSheetMirror?.status, monthClosePinnedSource?.sourceRevision, monthClosePinnedSource?.yearMonths, monthClosePreparation.status, monthCloseResult?.closeEligible, monthCloseResult?.status, project, projectId, savedExecutiveApproverId, yearMonth]);

  const handleFinalizeMonthClose = useCallback(async (): Promise<void> => {
    if (!canFinalizeMonth) {
      toast.error('프로젝트 접근 권한이 있는 활성 사용자만 월 결산할 수 있습니다.');
      return;
    }
    if (!yearMonth || !savedExecutiveApproverId || !monthCloseHumanReviewed) {
      if (!savedExecutiveApproverId) setExecutiveApproverAttention(true);
      toast.error('결산 대상 월과 조직장을 선택하고 시트값 확인에 동의해 주세요.');
      return;
    }
    if (!isCumulativeCloseScopeReady(monthCloseResult?.dashboard?.cumulativeCloseScope, yearMonth)) {
      toast.error('서버의 누적 결산 고정 범위가 선택한 월과 일치하지 않습니다. 다시 불러와 주세요.');
      return;
    }
    let monthCloseInput: CashflowMonthCloseDraftInput;
    try {
      if (monthCloseCellsState.error) throw new Error(monthCloseCellsState.error);
      const managementChecks = monthCloseResult?.dashboard?.managementChecks || [];
      monthCloseInput = buildCashflowMonthCloseDraftInput({
        mirror: monthClosePinnedSource,
        yearMonth,
        humanReviewed: monthCloseHumanReviewed,
        depositScheduleRows: monthCloseDepositRows,
        managementChecks,
        deadlineSummary: monthCloseResult?.dashboard?.deadlineSummary || {
          trackingStartedAt: null,
          missedCount: 0,
          completedCount: 0,
          current: null,
        } satisfies CashflowDeadlineSummary,
      });
    } catch (error) {
      logCashflowSettlement({
        phase: 'info',
        operation: 'cashflow.month_close.preflight.blocked',
        projectId,
        yearMonth,
        summary: { reason: 'draft_input_invalid', hasSheetConfig: Boolean(cashflowSheetConfig?.value) },
        error,
      });
      toast.error(resolveApiErrorMessage(error, '월 결산할 데이터를 준비하지 못했습니다. 시트 값을 다시 확인해 주세요.'));
      return;
    }
    const reviewedOpeningBalances = monthCloseResult?.dashboard?.openingBalances;
    if (!reviewedOpeningBalances) {
      toast.error('전년도 이월 항목을 불러오지 못했습니다. 월 결산 화면을 다시 열어 주세요.');
      return;
    }

    setMonthCloseBusy(true);
    const startedAt = Date.now();
    logCashflowSettlement({
      phase: 'start',
      operation: 'cashflow.month_close.request',
      projectId,
      yearMonth,
      summary: { sourceRevision: monthCloseInput.sourceRevision, targetRevision: monthCloseInput.targetRevision },
    });
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const prepared = await fetchCashflowMonthCloseViaBff({
        tenantId: orgId,
        actor,
        projectId,
        yearMonth,
      });
      setMonthCloseResult(prepared);
      if (!isCumulativeCloseScopeReady(prepared.dashboard?.cumulativeCloseScope, yearMonth)) {
        throw new Error('서버의 누적 결산 고정 범위가 선택한 월과 일치하지 않습니다.');
      }
      const request = await requestCashflowMonthCloseViaBff({
        tenantId: orgId,
        actor,
        projectId,
        payload: {
          contractVersion: 'cashflow-cumulative-close-v2',
          yearMonth,
          expectedRevision: prepared.revision,
          expectedApproverUid: savedExecutiveApproverId,
          expectedProjectVersion: project?.version ?? 0,
          expectedOpeningBalances: reviewedOpeningBalances,
          closeInput: monthCloseInput,
        },
        idempotencyKey: `cashflow-month-close-request:${projectId}:${yearMonth}:${prepared.revision}:r${monthCloseRequest?.revision ?? -1}`,
      });
      if (request.status !== 'PENDING') throw new Error('월결산 결재 요청 상태를 확인하지 못했습니다.');
      monthCloseCurrentRequestGenerationRef.current += 1;
      setMonthCloseRequest(request);
      setMonthCloseReviewOpen(false);
      setMonthCloseReviewDirty(false);
      toast.success('월결산 결재 요청을 제출했습니다.');
      await Promise.all([
        loadCashflowMonthClose(),
        loadMonthCloseRequest(),
        loadCashflowEvents(),
      ]);
      logCashflowSettlement({
        phase: 'success',
        operation: 'cashflow.month_close.request',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        summary: { status: request.status, revision: request.revision },
      });
    } catch (error) {
      logCashflowSettlement({
        phase: 'error',
        operation: 'cashflow.month_close.request',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        error,
      });
      toast.error(resolveApiErrorMessage(error, '월 결산 요청에 실패했습니다. 입력 내용을 확인하고 다시 시도해 주세요.'));
      await Promise.all([loadCashflowMonthClose(), loadMonthCloseRequest()]);
    } finally {
      setMonthCloseBusy(false);
    }
  }, [
    canFinalizeMonth,
    cashflowSheetConfig?.value,
    monthClosePinnedSource,
    loadCashflowEvents,
    loadCashflowMonthClose,
    loadMonthCloseRequest,
    monthCloseCellsState,
    monthCloseDepositRows,
    monthCloseHumanReviewed,
    monthCloseResult,
    monthCloseRequest?.revision,
    orgId,
    projectId,
    project?.version,
    savedExecutiveApproverId,
    resolveBffActor,
    yearMonth,
  ]);

  const handleMonthReopenAction = useCallback(async (): Promise<void> => {
    const reason = reopenReason.trim();
    if (!reopenAction || !monthCloseResult || !reason) {
      toast.error('사유를 입력해 주세요.');
      return;
    }
    if (reopenAction === 'request' && !canRequestMonthReopen) {
      toast.error('프로젝트 접근 권한이 있는 활성 사용자만 재오픈을 요청할 수 있습니다.');
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
  }, [canRequestMonthReopen, canReviewReopen, loadCashflowMonthClose, monthCloseResult, orgId, projectId, reopenAction, reopenReason, resolveBffActor, yearMonth]);

  const handleRefreshSheetMirror = useCallback(async (): Promise<void> => {
    if (!cashflowSheetConfig?.value) {
      logCashflowSettlement({
        phase: 'info',
        operation: 'cashflow.month_close.preflight.sheet_refresh.blocked',
        projectId,
        yearMonth,
        summary: { reason: 'sheet_config_missing' },
      });
      toast.error('연결된 Google Sheet가 없습니다.');
      return;
    }
    const startedAt = Date.now();
    const refreshIdempotencyKey = `cashflow-sheet-refresh:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const refreshMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => (
      refreshCashflowSheetLabMirrorViaBff({
        tenantId: orgId,
        actor,
        projectId,
        sourceYear: selectedYear,
        value: cashflowSheetConfig.value,
        sheetName: cashflowSheetConfig.sheetName || undefined,
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
      if (mirror.status === 'FRESH' && mirror.sourceRevision) {
        void loadCashflowEvents();
        toast.success('시트값을 불러왔습니다. MYSCube 시트 반영 전 금액을 확인합니다.');
      } else if (mirror.status === 'STALE') {
        toast.warning('최신 시트 조회에 실패해 마지막 정상 고정값을 유지했습니다.');
      } else {
        toast.error(mirror.lastRefreshError?.message || '시트 연동에 실패했습니다.');
      }
    };
    setSheetRefreshLoading(true);
    logCashflowSettlement({
      phase: 'start',
      operation: 'cashflow.sheet_refresh',
      projectId,
      yearMonth,
      summary: { sourceYear: selectedYear, hasSheetConfig: true },
    });
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      const mirror = await refreshMirror(actor);
      rememberMirror(mirror);
      logCashflowSettlement({
        phase: 'success',
        operation: 'cashflow.sheet_refresh',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        summary: { mirrorStatus: mirror.status, hasSourceRevision: Boolean(mirror.sourceRevision) },
      });
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          const mirror = await refreshMirror(actor);
          rememberMirror(mirror);
          logCashflowSettlement({
            phase: 'success',
            operation: 'cashflow.sheet_refresh',
            projectId,
            yearMonth,
            durationMs: Date.now() - startedAt,
            summary: { mirrorStatus: mirror.status, hasSourceRevision: Boolean(mirror.sourceRevision), retriedAuth: true },
          });
          return;
        } catch (retryError) {
          logCashflowSettlement({
            phase: 'error',
            operation: 'cashflow.sheet_refresh',
            projectId,
            yearMonth,
            durationMs: Date.now() - startedAt,
            error: retryError,
          });
          toast.error(resolveApiErrorMessage(retryError, '시트값을 불러오지 못했습니다.'));
          return;
        }
      }
      logCashflowSettlement({
        phase: 'error',
        operation: 'cashflow.sheet_refresh',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
        error,
      });
      toast.error(resolveApiErrorMessage(error, '시트값을 불러오지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetConfig, loadCashflowEvents, orgId, projectId, resolveBffActor, selectedYear, yearMonth]);

  const handleMonthClosePreparationAction = useCallback(async (): Promise<void> => {
    if (monthClosePreparation.status === 'SHEET_SETUP_REQUIRED') {
      logCashflowSettlement({
        phase: 'info',
        operation: 'cashflow.month_close.preflight.sheet_settings.open',
        projectId,
        yearMonth,
      });
      setMonthCloseReviewOpen(false);
      navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`);
      return;
    }
    if (monthClosePreparation.status === 'PINNED_SHEET_REQUIRED') {
      const startedAt = Date.now();
      logCashflowSettlement({
        phase: 'start',
        operation: 'cashflow.month_close.preflight.sheet_refresh',
        projectId,
        yearMonth,
        summary: { mirrorStatus: cashflowSheetMirror?.status || 'EMPTY' },
      });
      await handleRefreshSheetMirror();
      await loadCashflowMonthClose();
      logCashflowSettlement({
        phase: 'info',
        operation: 'cashflow.month_close.preflight.sheet_refresh.complete',
        projectId,
        yearMonth,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    if (monthClosePreparation.status === 'STATUS_RETRY_REQUIRED') {
      logCashflowSettlement({
        phase: 'start',
        operation: 'cashflow.month_close.preflight.status_retry',
        projectId,
        yearMonth,
      });
      await loadCashflowMonthClose();
    }
  }, [cashflowSheetMirror?.status, handleRefreshSheetMirror, loadCashflowMonthClose, monthClosePreparation.status, navigate, projectId, yearMonth]);

  const handleApplyStagedSheetValues = useCallback(async (
    stage: CashflowSheetLabStageResult,
    closedMonthChangeReason = '',
    acceptFormulaMismatches = false,
  ): Promise<void> => {
    if (!stage.runId || stage.stagedLineCount <= 0) return;
    const applyIdempotencyKey = `cashflow-sheet-apply-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const apply = async (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => {
      return applyCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        stageRunId: stage.runId,
        applyRiskCandidates: true,
        closedMonthChangeReason,
        closedMonthDifferenceCount: stage.closedMonthDifferenceCount,
        closedMonthDifferenceManifestHash: stage.closedMonthDifferenceManifestHash,
        acceptFormulaMismatches,
        idempotencyKey: applyIdempotencyKey,
      });
    };
    const rememberApplyResult = async (result: Awaited<ReturnType<typeof apply>>) => {
      await Promise.all([
        loadCashflowEvents(),
        loadCashflowMonthClose(),
      ]);
      setCashflowSheetConfig((current) => current ? {
        ...current,
        lastAppliedAt: result.lastAppliedAt,
        lastAppliedBy: result.lastAppliedBy,
        lastAppliedLineCount: result.appliedLineCount,
        lastProjectionLineCount: result.projectionLineCount,
        lastActualLineCount: result.actualLineCount,
      } : current);
      setLateSheetApply(null);
      setSheetApplyResumeRequired(false);
      setLateSheetChangeReason('');
      setLateSheetFormulaAccepted(false);
      setFormulaMismatchPrompt(null);
      toast.success(`시트 최신값 ${result.appliedLineCount.toLocaleString()}건을 MYSCube 시트에 반영했습니다.`);
    };

    setSheetStageApplyLoading(true);
    logCashflowSettlement({
      phase: 'start',
      operation: 'cashflow.sheet_apply',
      projectId,
      summary: { stagedRunId: stage.runId, stagedLineCount: stage.stagedLineCount, reasonProvided: Boolean(closedMonthChangeReason.trim()) },
    });
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      const result = await apply(actor);
      await rememberApplyResult(result);
      logCashflowSettlement({ phase: 'success', operation: 'cashflow.sheet_apply', projectId, summary: { appliedLineCount: result.appliedLineCount } });
    } catch (error) {
      let finalError = error;
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          const result = await apply(actor);
          await rememberApplyResult(result);
          logCashflowSettlement({ phase: 'success', operation: 'cashflow.sheet_apply', projectId, summary: { appliedLineCount: result.appliedLineCount, authRetried: true } });
          return;
        } catch (retryError) {
          finalError = retryError;
        }
      }
      logCashflowSettlement({ phase: 'error', operation: 'cashflow.sheet_apply', projectId, error: finalError });
      if (bffErrorCode(finalError) === 'cashflow_formula_mismatch_confirmation_required') {
        const issues = cashflowFormulaMismatchesFromError(finalError);
        if (issues.length > 0) {
          setFormulaMismatchPrompt({ stage, issues, closedMonthChangeReason });
          return;
        }
      }
      if (bffErrorCode(finalError) === 'cashflow_closed_month_reason_required') {
        const details = (finalError as {
          body?: { details?: { closedMonthDifferences?: CashflowSheetLabStageResult['closedMonthDifferences'] } };
        }).body?.details;
        setLateSheetApply({
          ...stage,
          closedMonthDifferences: details?.closedMonthDifferences?.length
            ? details.closedMonthDifferences
            : stage.closedMonthDifferences,
        });
        setLateSheetChangeReason('');
        setLateSheetFormulaAccepted(acceptFormulaMismatches);
        setSheetApplyResumeRequired(false);
        return;
      }
      if (isCashflowSheetApplyResultUncertain(finalError)) {
        setLateSheetApply(stage);
        setLateSheetFormulaAccepted(acceptFormulaMismatches);
        setSheetApplyResumeRequired(true);
      } else {
        setLateSheetApply(null);
        setSheetApplyResumeRequired(false);
      }
      toast.error(resolveApiErrorMessage(finalError, '시트 값을 MYSCube 시트에 반영하지 못했습니다.'));
    } finally {
      setSheetStageApplyLoading(false);
    }
  }, [loadCashflowEvents, loadCashflowMonthClose, orgId, projectId, resolveBffActor]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !orgId || !user?.uid) return () => { cancelled = true; };
    const loadApplyStatus = async (): Promise<void> => {
      try {
        const actor = await resolveBffActor();
        if (!actor?.idToken) return;
        const status = await getCashflowSheetLabApplyStatusViaBff({ tenantId: orgId, actor, projectId });
        if (cancelled || status.status !== 'APPLYING' || !status.stagedRun) return;
        setLateSheetApply(status.stagedRun);
        setLateSheetChangeReason(status.applyInput?.closedMonthChangeReason || '');
        setLateSheetFormulaAccepted(status.applyInput?.acceptFormulaMismatches === true);
        setSheetApplyResumeRequired(true);
      } catch {
        // 복구 상태 조회 실패는 일반 조회를 막지 않는다. 실제 반영 시 서버가 다시 차단한다.
      }
    };
    void loadApplyStatus();
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, resolveBffActor, user?.uid]);

  const handleStagePinnedSheetValues = useCallback(async (
    replaceAllActualSources = false,
    mirrorOverride?: CashflowSheetLabMirrorResult,
  ): Promise<void> => {
    const sourceMirror = mirrorOverride || cashflowSheetMirror;
    if (sourceMirror?.status !== 'FRESH' || !sourceMirror.sourceRevision) {
      toast.error('먼저 시트값 불러오기를 실행해 고정해 주세요.');
      return;
    }
    const stageIdempotencyKey = `cashflow-sheet-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const stageMirror = (actor: NonNullable<Awaited<ReturnType<typeof resolveBffActor>>>) => stageCashflowSheetLabViaBff({
      tenantId: orgId,
      actor,
      projectId,
      expectedMirrorRevision: sourceMirror.sourceRevision,
      yearMonth,
      ...(replaceAllActualSources ? { replaceAllActualSources: true } : {}),
      idempotencyKey: stageIdempotencyKey,
    });
    const applyStageResult = async (result: CashflowSheetLabStageResult) => {
      if (result.status === 'BLOCKED') {
        toast.warning('시트 범위가 월 전체 구조와 맞지 않아 반영하지 않았습니다.');
        return;
      }
      if (result.stagedLineCount <= 0) {
        toast.info('MYSCube 시트와 다른 값이 없습니다.');
        return;
      }
      if (result.closedMonthDifferences?.length) {
        setLateSheetApply(result);
        setLateSheetChangeReason('');
        setLateSheetFormulaAccepted(false);
        setSheetApplyResumeRequired(false);
        return;
      }
      await handleApplyStagedSheetValues(result);
    };
    setSheetRefreshLoading(true);
    try {
      const actor = await resolveBffActor();
      if (!actor?.idToken) {
        toast.error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      await applyStageResult(await stageMirror(actor));
    } catch (error) {
      if (isBffAuthRejection(error)) {
        try {
          const actor = await resolveBffActor({ forceRefresh: true });
          if (!actor?.idToken) throw error;
          await applyStageResult(await stageMirror(actor));
          return;
        } catch (retryError) {
          toast.error(resolveApiErrorMessage(retryError, '고정된 시트 값을 준비하지 못했습니다.'));
          return;
        }
      }
      toast.error(resolveApiErrorMessage(error, '고정된 시트 값을 준비하지 못했습니다.'));
    } finally {
      setSheetRefreshLoading(false);
    }
  }, [cashflowSheetMirror, handleApplyStagedSheetValues, orgId, projectId, resolveBffActor, yearMonth]);

  const handleOpenSheetReviewDialog = useCallback(() => {
    setSheetReviewDialogOpen(true);
  }, []);

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

  function getWeekLabel(weekNo: number, targetYearMonth = yearMonth): string {
    return annualWeeks.find((week) => week.yearMonth === targetYearMonth && week.weekNo === weekNo)?.label
      || monthWeeks.find((week) => week.weekNo === weekNo)?.label
      || `w${weekNo}`;
  }

  const annualYears = useMemo(() => {
    return CASHFLOW_STANDARD_ANNUAL_YEARS.filter((year) => year !== selectedYear);
  }, [selectedYear]);
  const previousAnnualYears = annualYears.filter((year) => year < selectedYear);
  const followingAnnualYears = annualYears.filter((year) => year > selectedYear);
  const comparisonAsOfWeek = monthCloseResult?.dashboard?.summary?.comparisonAsOfWeek;
  const comparisonScope = useMemo(() => resolveCashflowComparisonScope({
    selectedYear,
    annualYears,
    weeks: annualWeeks,
    comparisonAsOfWeek,
  }), [annualWeeks, annualYears, comparisonAsOfWeek, selectedYear]);
  const visibleComparisonWeeks = comparisonScope.weeks;
  const visibleComparisonAnnualYears = comparisonScope.annualYears;
  const previousComparisonAnnualYears = visibleComparisonAnnualYears.filter((year) => year < selectedYear);
  const followingComparisonAnnualYears = visibleComparisonAnnualYears.filter((year) => year > selectedYear);
  const canonicalAnnualTotalFor = (year: number, mode: 'projection' | 'actual') => summarizeCanonicalCashflowYear(
    monthCloseResult?.dashboard?.canonical?.months || [],
    year,
    mode,
  );
  const annualTotalFor = (year: number, mode: 'projection' | 'actual') => {
    const canonical = canonicalAnnualTotalFor(year, mode);
    if (canonical) return canonical;
    const jvmSource = monthCloseResult?.dashboard?.openingBalances?.selectedYear === selectedYear
      ? monthCloseResult.dashboard.openingBalances[mode]?.sources?.find((source) => source.year === year)
      : null;
    if (jvmSource) {
      const totalIn = CASHFLOW_IN_LINES.reduce((sum, lineId) => sum + Number(jvmSource.lineAmounts?.[lineId] || 0), 0);
      const totalOut = CASHFLOW_OUT_LINES.reduce((sum, lineId) => sum + Number(jvmSource.lineAmounts?.[lineId] || 0), 0);
      return {
        lineAmounts: jvmSource.lineAmounts,
        lineStates: jvmSource.lineStates,
        totalIn,
        totalOut,
        net: totalIn - totalOut,
      };
    }
    return null;
  };
  const projectLineTotalFor = (mode: 'projection' | 'actual', lineId: CashflowSheetLineId) => {
    const rangeTotals = monthCloseResult?.dashboard?.canonical?.range?.[mode] as {
      rowTotals?: Record<CashflowSheetLineId, number>;
      lineAmounts?: Record<CashflowSheetLineId, number>;
    } | null | undefined;
    const selectedYearTotal = rangeTotals?.rowTotals?.[lineId] ?? rangeTotals?.lineAmounts?.[lineId] ?? 0;
    if (annualYears.some((year) => !annualTotalFor(year, mode))) return null;
    return annualYears.reduce(
      (sum, year) => sum + Number(annualTotalFor(year, mode)?.lineAmounts?.[lineId] || 0),
      Number(selectedYearTotal),
    );
  };

  const projectionActualComparison = useMemo(() => {
    const lineDefs = [
      ...CASHFLOW_IN_LINES.map((lineId) => ({ section: '입금' as const, lineId })),
      ...CASHFLOW_OUT_LINES.map((lineId) => ({ section: '출금' as const, lineId })),
    ];
    const rows = lineDefs.map(({ section, lineId }) => {
      const comparisonWeeks = visibleComparisonWeeks.map((week) => {
        const projectionCell = getServerReadCell({ targetYearMonth: week.yearMonth, mode: 'projection', weekNo: week.weekNo, lineId });
        const actualCell = getServerReadCell({ targetYearMonth: week.yearMonth, mode: 'actual', weekNo: week.weekNo, lineId });
        const hasValue = projectionCell.hasValue || actualCell.hasValue;
        return {
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
          weekLabel: week.label,
          weekRange: week.weekStart && week.weekEnd ? `${week.weekStart} ~ ${week.weekEnd}` : '',
          projection: projectionCell.amount,
          actual: actualCell.amount,
          difference: hasValue ? projectionCell.amount - actualCell.amount : null,
        };
      });
      const comparisonAnnualYears = visibleComparisonAnnualYears.map((year) => {
        const projectionTotal = annualTotalFor(year, 'projection');
        const actualTotal = annualTotalFor(year, 'actual');
        const projectionState = projectionTotal?.lineStates?.[lineId]
          || (Object.prototype.hasOwnProperty.call(projectionTotal?.lineAmounts || {}, lineId) ? 'VALUE' : 'EMPTY');
        const actualState = actualTotal?.lineStates?.[lineId]
          || (Object.prototype.hasOwnProperty.call(actualTotal?.lineAmounts || {}, lineId) ? 'VALUE' : 'EMPTY');
        const hasValue = ['VALUE', 'ZERO'].includes(projectionState) || ['VALUE', 'ZERO'].includes(actualState);
        const projection = Number(projectionTotal?.lineAmounts?.[lineId] || 0);
        const actual = Number(actualTotal?.lineAmounts?.[lineId] || 0);
        return { year, projection, actual, difference: hasValue ? projection - actual : null };
      });
      const totalProjection = comparisonWeeks.reduce((sum, cell) => sum + cell.projection, 0)
        + comparisonAnnualYears.reduce((sum, cell) => sum + cell.projection, 0);
      const totalActual = comparisonWeeks.reduce((sum, cell) => sum + cell.actual, 0)
        + comparisonAnnualYears.reduce((sum, cell) => sum + cell.actual, 0);
      const totalHasValue = [...comparisonAnnualYears, ...comparisonWeeks].some((cell) => cell.difference !== null);
      return {
        section,
        lineId,
        label: getCashflowModeLineLabel(lineId, 'projection'),
        cells: comparisonWeeks,
        annualCells: comparisonAnnualYears,
        totalCell: {
          projection: totalProjection,
          actual: totalActual,
          difference: totalHasValue ? totalProjection - totalActual : null,
        },
        changed: [...comparisonWeeks, ...comparisonAnnualYears, { difference: totalHasValue ? totalProjection - totalActual : null }]
          .some((cell) => cell.difference !== null && cell.difference !== 0),
      };
    });
    return {
      rows,
      changedRows: rows.filter((row) => row.changed),
    };
  }, [monthCloseResult, selectedYear, visibleComparisonAnnualYears, visibleComparisonWeeks, yearMonth]);

  const cashflowTotalPeriodLabel = comparisonScope.periodLabel;
  const sheetRangeLabel = cashflowSheetConfig
    ? `${cashflowSheetConfig.sheetName || '시트 탭'} · 탭 전체`
    : '연결된 Google Sheet가 없습니다.';
  const sheetIdentityLabel = cashflowSheetConfig
    ? cashflowSheetConfig.spreadsheetTitle || cashflowSheetConfig.spreadsheetId || 'Google Sheet'
    : '시트 연결 필요';
  const sheetChangeCount = [
    cashflowSheetChangeCheck?.comparisons.jvmToFirestore,
    cashflowSheetChangeCheck?.comparisons.sheetToFirestore,
    cashflowSheetChangeCheck?.comparisons.sheetToJvm,
  ].find((comparison) => comparison?.status === 'AVAILABLE' && Number(comparison.changeCount) > 0)?.changeCount || 0;
  const sheetMirrorStatus = cashflowSheetMirror?.status || 'EMPTY';
  const configuredSheetUrl = (() => {
    try {
      const url = new URL(cashflowSheetConfig?.value || '');
      return url.protocol === 'https:' && url.hostname === 'docs.google.com' && url.pathname.startsWith('/spreadsheets/')
        ? url.toString()
        : '';
    } catch {
      return '';
    }
  })();
  const sheetMirrorCapturedAt = formatSheetAppliedAt(cashflowSheetMirror?.capturedAt)
    || cashflowSheetMirror?.capturedAt
    || '';

  const opsSummary = useMemo(() => {
    const dashboard = monthCloseResult?.dashboard;
    const blockers = dashboard?.validation?.blockers || [];
    const warnings = dashboard?.validation?.warnings || [];
    const settlementIncompleteCount = dashboard?.summary?.settlementIncompleteWeeks?.length || 0;
    const dashboardUnavailable = !dashboard && !monthCloseLoading;
    const issueCount = blockers.length
      + warnings.length
      + (settlementIncompleteCount > 0 ? 1 : 0)
      + (dashboardUnavailable ? 1 : 0);
    const kind = blockers.length > 0 || dashboardUnavailable
      ? 'blocked' as const
      : warnings.length > 0 || settlementIncompleteCount > 0
        ? 'review' as const
        : 'ready' as const;
    const tone: CashflowOpsTone = kind === 'blocked' ? 'danger' : kind === 'review' ? 'warning' : 'success';
    const rate = (percent: number) => ({ percent: Math.max(0, Number(percent) || 0) });
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
        projection: rate(dashboard?.summary?.contractCoveragePercent || 0),
        actual: rate(dashboard?.summary?.actualProgressPercent || 0),
        confirmation: rate(dashboard?.projectionActualSummary?.settlementMatches ? 100 : 0),
      },
    };
  }, [monthCloseLoading, monthCloseResult?.dashboard]);

  function diffTextClass(diff: number): string {
    return diff === 0 ? 'text-slate-400' : 'text-slate-800';
  }

  function getServerReadCell(params: {
    targetYearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): { amount: number; hasValue: boolean; mismatch: boolean } {
    const month = monthCloseResult?.dashboard?.canonical?.months?.find((candidate) => candidate.yearMonth === params.targetYearMonth);
    const week = month?.[params.mode]?.weeks?.find((candidate) => candidate.weekNo === params.weekNo);
    const comparisonLine = month?.comparison?.weeks
      ?.find((candidate) => candidate.weekNo === params.weekNo)
      ?.lines?.find((candidate) => candidate.lineId === params.lineId);
    const amounts = week?.amounts || {};
    return {
      amount: Number(amounts[params.lineId] || 0),
      hasValue: Object.prototype.hasOwnProperty.call(amounts, params.lineId),
      mismatch: comparisonLine?.mismatch === true,
    };
  }

  function getBoardEffectiveAmount(params: {
    targetYearMonth: string;
    mode: 'projection' | 'actual';
    weekNo: number;
    lineId: CashflowSheetLineId;
  }): number {
    return getServerReadCell(params).amount;
  }

  function getCanonicalDerivedAmount(
    mode: 'projection' | 'actual',
    targetYearMonth: string,
    weekNo: number,
    kind: 'totalIn' | 'totalOut' | 'net',
  ): number | null {
    const check = monthCloseResult?.dashboard?.canonical?.months
      ?.find((month) => month.yearMonth === targetYearMonth)?.[mode]?.weeks
      ?.find((week) => week.weekNo === weekNo);
    const value = kind === 'totalIn'
      ? check?.totalIn
      : kind === 'totalOut'
        ? check?.totalOut
        : check?.net;
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }

  function renderProjectionCell(input: {
    targetYearMonth: string;
    weekNo: number;
    lineId: CashflowSheetLineId;
    isThisWeek: boolean;
    isAltRow: boolean;
    monthCloseStatus?: string;
    weeklyStatus?: string;
    closeOverdue?: boolean;
  }) {
    const persisted = getServerReadCell({ ...input, mode: 'projection' });
    const projection = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const actual = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'actual', weekNo: input.weekNo, lineId: input.lineId });
    const shouldHighlightMismatch = persisted.mismatch;
    const bgClass = cashflowWeekSurface(input.monthCloseStatus, input.weeklyStatus, input.closeOverdue) || (input.isThisWeek ? 'bg-[#EAF0F5]' : input.isAltRow ? 'bg-slate-50' : 'bg-white');
    const isCollapsedEmpty = projection === 0 && actual === 0 && !persisted.hasValue;

    return (
      <td key={`${input.lineId}-${input.targetYearMonth}-${input.weekNo}-p`} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${bgClass}`}>
        {isCollapsedEmpty ? (
          <div className="py-0.5 text-center text-[12px] text-slate-400">미입력</div>
        ) : (
          <div className={`h-5 px-1 text-right text-[12px] leading-5 tabular-nums ${shouldHighlightMismatch ? 'font-semibold text-red-700' : 'text-slate-900'}`}>
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
    isAltRow: boolean;
    monthCloseStatus?: string;
    weeklyStatus?: string;
    closeOverdue?: boolean;
  }) {
    const persisted = getServerReadCell({ ...input, mode: 'actual' });
    const projection = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'projection', weekNo: input.weekNo, lineId: input.lineId });
    const actual = getBoardEffectiveAmount({ targetYearMonth: input.targetYearMonth, mode: 'actual', weekNo: input.weekNo, lineId: input.lineId });
    const bgClass = cashflowWeekSurface(input.monthCloseStatus, input.weeklyStatus, input.closeOverdue) || (input.isThisWeek ? 'bg-[#EAF0F5]' : input.isAltRow ? 'bg-slate-50' : 'bg-white');
    const isCollapsedEmpty = projection === 0 && actual === 0 && !persisted.hasValue;

    return (
      <td key={`${input.lineId}-${input.targetYearMonth}-${input.weekNo}-a`} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${bgClass}`}>
        {isCollapsedEmpty ? (
          <div className="py-0.5 text-center text-[12px] text-slate-400">미입력</div>
        ) : (
          <div className="h-5 px-1 text-right text-[12px] leading-5 tabular-nums text-slate-700">
            {fmt(actual)}
          </div>
        )}
      </td>
    );
  }

  function renderSummaryCell(input: {
    keyName: string;
    value: number | null;
    mode: 'projection' | 'actual';
    isThisWeek?: boolean;
    isAltRow?: boolean;
    monthCloseStatus?: string;
    weeklyStatus?: string;
    closeOverdue?: boolean;
    emphasis?: 'income' | 'expense' | 'balance';
    stickyRight?: boolean;
    rowTone?: 'income' | 'expense';
  }) {
    const bgClass = cashflowWeekSurface(input.monthCloseStatus, input.weeklyStatus, input.closeOverdue) || (input.emphasis
      ? 'bg-[#EAF0F5]'
      : input.isThisWeek
        ? 'bg-[#EAF0F5]'
        : input.isAltRow
          ? 'bg-slate-50'
          : 'bg-white');
    const valueClass = input.emphasis ? 'text-slate-950' : 'text-slate-800';
    return (
      <td key={input.keyName} className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 align-middle ${input.stickyRight ? 'sticky right-0 z-20 shadow-[-12px_0_24px_rgba(15,23,42,0.08)]' : ''} ${bgClass}`}>
        <div className="flex items-center justify-end gap-1 text-[12px] leading-4">
          <span className={`font-semibold tabular-nums ${input.mode === 'actual' ? 'text-slate-700' : valueClass}`}>
            {input.value === null ? <span className="text-slate-400">미입력</span> : fmt(input.value)}
          </span>
        </div>
      </td>
    );
  }

  function renderUnifiedMonthlyBoard() {
    if (monthCloseLoading && !monthCloseResult?.dashboard?.canonical) {
      return (
        <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">
          서버 확정 시트와 기간 합계를 불러오는 중입니다.
        </div>
      );
    }
    if (shouldHideCashflowValuesAfterLoadError(monthCloseError, Boolean(monthCloseResult?.dashboard?.canonical))) {
      return (
        <div className="rounded-[18px] border border-red-200 bg-red-50 px-3 py-8 text-center text-[12px] text-red-700">
          <p>현금흐름 데이터를 불러오지 못했습니다.</p>
          <button type="button" className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold" onClick={() => void loadCashflowMonthClose()}>
            다시 확인
          </button>
        </div>
      );
    }
    const visibleWeeks = annualWeeks;
    const monthCloseStatusByMonth = new Map(
      (monthCloseResult?.dashboard?.monthCloseStatuses || []).map((month) => [month.yearMonth, month.status]),
    );
    if (!monthCloseStatusByMonth.has(yearMonth) && monthCloseResult?.status) {
      monthCloseStatusByMonth.set(yearMonth, monthCloseResult.status);
    }
    if (monthCloseRequest?.lockRange && ['PENDING', 'APPROVING', 'UNCERTAIN', 'APPROVED'].includes(monthCloseRequest.status)) {
      visibleWeeks.forEach((week) => {
        if (isCashflowWeekLockedByRange(monthCloseRequest.lockRange, week.yearMonth, week.weekNo)) {
          monthCloseStatusByMonth.set(week.yearMonth, monthCloseRequest.status === 'APPROVED' ? 'CLOSED' : monthCloseRequest.status);
        }
      });
    }
    const monthCloseOverdueByMonth = new Map(
      (monthCloseResult?.dashboard?.monthCloseStatuses || []).map((month) => [month.yearMonth, Boolean(month.closeOverdue)]),
    );
    const weeklyStatusByWeek = new Map(
      (monthCloseResult?.dashboard?.deadlineSummary?.weeklyStatuses || [])
        .map((week) => [`${week.yearMonth}:${week.weekNo}`, week.status]),
    );
    const monthGroups = visibleWeeks.reduce<Array<{ yearMonth: string; weeks: typeof visibleWeeks }>>((groups, week) => {
      const group = groups.at(-1);
      if (!group || group.yearMonth !== week.yearMonth) groups.push({ yearMonth: week.yearMonth, weeks: [week] });
      else group.weeks.push(week);
      return groups;
    }, []);
    const boardColumnCount = previousAnnualYears.length + visibleWeeks.length + followingAnnualYears.length + 2;
    const canonicalReadModel = monthCloseResult?.dashboard?.canonical;
    const readServerSummary = (mode: 'projection' | 'actual') => {
      const openingBalance = monthCloseResult?.dashboard?.openingBalances?.selectedYear === selectedYear
        ? Number(monthCloseResult.dashboard.openingBalances[mode]?.amount || 0)
        : 0;
      const priorServerWeek = (canonicalReadModel?.months || [])
        .filter((month) => month.yearMonth < `${selectedYear}-01`)
        .flatMap((month) => (month[mode]?.weeks || []).map((week) => ({ ...week, yearMonth: month.yearMonth })))
        .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth) || left.weekNo - right.weekNo)
        .at(-1);
      const serverWeeks = visibleWeeks.map((week) => {
        const dashboardWeek = week.yearMonth === yearMonth
          ? monthCloseResult?.dashboard?.totals?.[mode]?.weeks?.find((candidate) => candidate.weekNo === week.weekNo)
          : null;
        const canonicalWeek = canonicalReadModel?.months
          ?.find((month) => month.yearMonth === week.yearMonth)
          ?.[mode]?.weeks?.find((candidate) => candidate.weekNo === week.weekNo);
        return canonicalWeek || dashboardWeek || null;
      });
      const displayedRunningBalances = carryForwardCashflowRunningBalances({
        priorWeeklyNet: Number(priorServerWeek?.net || 0),
        annualOpeningBalance: openingBalance,
        serverRunningNets: serverWeeks.map((week) => week == null ? null : Number(week.net || 0)),
      });
      const weekTotals = serverWeeks.map((serverWeek, index) => {
        const visibleWeek = visibleWeeks[index];
        return {
          ...(serverWeek || { weekNo: visibleWeek.weekNo, amounts: {}, totalIn: 0, totalOut: 0, weekIn: 0, weekOut: 0 }),
          net: displayedRunningBalances[index],
        };
      });
      const rangeTotals = canonicalReadModel?.range?.[mode];
      const endingBalance = Number(weekTotals.at(-1)?.net ?? openingBalance);
      return {
        rowTotals: ((rangeTotals as { rowTotals?: Record<CashflowSheetLineId, number>; lineAmounts?: Record<CashflowSheetLineId, number> } | null)?.rowTotals
          || (rangeTotals as { lineAmounts?: Record<CashflowSheetLineId, number> } | null)?.lineAmounts
          || {}) as Record<CashflowSheetLineId, number>,
        weekTotals,
        monthTotals: {
          totalIn: rangeTotals?.totalIn || 0,
          totalOut: rangeTotals?.totalOut || 0,
          net: endingBalance,
        },
      };
    };
    const derived = {
      projection: readServerSummary('projection'),
      actual: readServerSummary('actual'),
    };
    const projectTotalsFor = (mode: 'projection' | 'actual') => {
      if (annualYears.some((year) => !annualTotalFor(year, mode))) {
        return { totalIn: null, totalOut: null, net: null };
      }
      const totalIn = annualYears.reduce((sum, year) => sum + Number(annualTotalFor(year, mode)?.totalIn || 0), Number(derived[mode].monthTotals.totalIn || 0));
      const totalOut = annualYears.reduce((sum, year) => sum + Number(annualTotalFor(year, mode)?.totalOut || 0), Number(derived[mode].monthTotals.totalOut || 0));
      return { totalIn, totalOut, net: totalIn - totalOut };
    };
    const scrollBoard = (direction: -1 | 1) => {
      const container = cashflowBoardScrollRef.current;
      if (!container) return;
      const weekColumn = container.querySelector<HTMLElement>('[data-cashflow-board-column="true"]');
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
    const renderAnnualLineCell = (mode: 'projection' | 'actual', lineId: CashflowSheetLineId, year: number, isAltRow: boolean) => {
      const total = annualTotalFor(year, mode);
      const state = total?.lineStates?.[lineId]
        || (Object.prototype.hasOwnProperty.call(total?.lineAmounts || {}, lineId) ? 'VALUE' : 'EMPTY');
      const value = Number(total?.lineAmounts?.[lineId] || 0);
      return (
        <td key={`${mode}-${lineId}-${year}-annual`} data-cashflow-board-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 text-right align-middle text-[12px] tabular-nums text-slate-700 ${isAltRow ? 'bg-slate-50' : 'bg-white'}`}>
          {state === 'VALUE' || state === 'ZERO' ? fmt(value) : <span className="text-slate-400">미입력</span>}
        </td>
      );
    };
    const renderAnnualSummaryCell = (
      mode: 'projection' | 'actual',
      kind: 'totalIn' | 'totalOut' | 'net',
      year: number,
      emphasis: 'income' | 'expense' | 'balance',
      rowTone?: 'income' | 'expense',
    ) => renderSummaryCell({
      keyName: `${mode}-${kind}-${year}-annual`,
      value: annualTotalFor(year, mode)?.[kind] ?? null,
      mode,
      emphasis,
      rowTone,
    });
    const renderModeLineRows = (
      mode: 'projection' | 'actual',
      lineIds: CashflowSheetLineId[],
      tone: 'income' | 'expense',
    ) => lineIds.map((lineId, rowIndex) => {
      const emphasized = lineId === 'MYSC_PREPAY_IN' || lineId.startsWith('MYSC_PREPAY_');
      return (
        <tr key={`${mode}-${lineId}`} data-cashflow-row="line" className="border-t border-white transition-colors hover:brightness-[0.98]">
          <td className={`sticky left-0 z-20 w-[192px] min-w-[192px] border-r-[6px] border-r-white px-3 py-2 text-[12px] leading-4 ${tone === 'income' ? 'text-emerald-700' : 'text-red-700'} ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'} ${emphasized ? 'font-bold' : 'font-medium'}`}>
            {renderCashflowLineLabel(getCashflowModeLineLabel(lineId, mode))}
          </td>
          {previousAnnualYears.map((year) => renderAnnualLineCell(mode, lineId, year, rowIndex % 2 === 1))}
          {visibleWeeks.map((week) => {
            const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
            const monthCloseStatus = monthCloseStatusByMonth.get(week.yearMonth);
            const closeOverdue = monthCloseOverdueByMonth.get(week.yearMonth);
            const weeklyStatus = weeklyStatusByWeek.get(`${week.yearMonth}:${week.weekNo}`);
            return mode === 'projection'
              ? renderProjectionCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek, isAltRow: rowIndex % 2 === 1, monthCloseStatus, weeklyStatus, closeOverdue })
              : renderActualCell({ targetYearMonth: week.yearMonth, weekNo: week.weekNo, lineId, isThisWeek, isAltRow: rowIndex % 2 === 1, monthCloseStatus, weeklyStatus, closeOverdue });
          })}
          {followingAnnualYears.map((year) => renderAnnualLineCell(mode, lineId, year, rowIndex % 2 === 1))}
          {renderSummaryCell({
            keyName: `${mode}-${lineId}-range`,
            value: projectLineTotalFor(mode, lineId),
            mode,
            isAltRow: rowIndex % 2 === 1,
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
        <tr key={`${mode}-${kind}`} data-cashflow-row={kind} className="border-t-[6px] border-white bg-[#EAF0F5]">
          <td className="sticky left-0 z-20 w-[192px] min-w-[192px] border-r-[6px] border-r-white bg-[#EAF0F5] px-3 py-2 text-[12px] font-bold text-[#17324D]">
            {label}
          </td>
          {previousAnnualYears.map((year) => renderAnnualSummaryCell(mode, kind, year, emphasis, rowTone))}
          {visibleWeeks.map((week, index) => renderSummaryCell({
            keyName: `${mode}-${kind}-${week.yearMonth}-${week.weekNo}`,
            value: getCanonicalDerivedAmount(mode, week.yearMonth, week.weekNo, kind) ?? (derived[mode].weekTotals[index]?.[kind] || 0),
            mode,
            isThisWeek: todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd,
            monthCloseStatus: monthCloseStatusByMonth.get(week.yearMonth),
            weeklyStatus: weeklyStatusByWeek.get(`${week.yearMonth}:${week.weekNo}`),
            closeOverdue: monthCloseOverdueByMonth.get(week.yearMonth),
            emphasis,
            rowTone,
          }))}
          {followingAnnualYears.map((year) => renderAnnualSummaryCell(mode, kind, year, emphasis, rowTone))}
          {renderSummaryCell({
            keyName: `${mode}-${kind}-range`,
            value: projectTotalsFor(mode)[kind],
            mode,
            emphasis,
            stickyRight: true,
            rowTone,
          })}
        </tr>
      );
    };
    const renderModeTable = (mode: 'projection' | 'actual') => (
      <table className="w-full border-separate border-spacing-0 text-[12px]" style={{ minWidth: `${192 + (boardColumnCount - 1) * 84}px` }}>
        <thead className="sticky top-0 z-40 bg-white/95 text-slate-600 backdrop-blur shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <tr>
            <th rowSpan={3} className="sticky left-0 z-50 w-[192px] min-w-[192px] border-r-[6px] border-r-white bg-white px-3 py-2 text-left text-[12px] font-bold text-slate-800">
              항목
            </th>
            {previousAnnualYears.map((year) => (
              <th rowSpan={3} key={`${mode}-${year}-before`} data-cashflow-board-column="true" className="min-w-[84px] border-l-[6px] border-l-white bg-slate-100 px-1 py-2 text-center align-middle font-semibold">
                <div className="text-[12px] font-bold text-slate-800">{year}년</div>
                <div className="text-[12px] font-normal text-slate-400">누적</div>
              </th>
            ))}
            {monthGroups.map((month) => {
              const monthStatus = monthCloseStatusByMonth.get(month.yearMonth);
              const rangeLocked = month.weeks.some((week) => isCashflowWeekLockedByRange(monthCloseRequest?.lockRange, week.yearMonth, week.weekNo));
              const locked = rangeLocked || monthStatus === 'CLOSED' || isCashflowMonthCloseRequestLocked(monthStatus);
              const overdue = !locked && Boolean(monthCloseOverdueByMonth.get(month.yearMonth));
              const monthHeadClass = locked
                ? 'border-b-slate-500 bg-slate-300 text-slate-800'
                : overdue
                  ? 'border-b-red-400 bg-red-200 text-red-900'
                  : 'border-b-slate-200 bg-slate-100 text-slate-600';
              return (
                <th colSpan={month.weeks.length} key={`${mode}-${month.yearMonth}-month`} className={`border-b-2 border-l-[6px] border-l-white px-2 py-1.5 text-left align-middle ${monthHeadClass}`}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-bold">
                    {month.yearMonth.replace('-', '년 ')}월
                    {locked ? <LockKeyhole className="h-3.5 w-3.5" aria-label={rangeLocked ? `누적 월결산 ${monthCloseRequest?.requestId || ''} 승인 범위 수정 잠김` : '월 결산 수정 잠김'} /> : null}
                    {overdue ? (
                      <span className="rounded bg-red-700 px-1.5 py-0.5 text-[12px] font-bold text-white">월 결산 기한 초과</span>
                    ) : null}
                  </span>
                </th>
              );
            })}
            {followingAnnualYears.map((year) => (
              <th rowSpan={3} key={`${mode}-${year}-after`} data-cashflow-board-column="true" className="min-w-[84px] border-l-[6px] border-l-white bg-slate-100 px-1 py-2 text-center align-middle font-semibold">
                <div className="text-[12px] font-bold text-slate-800">{year}년</div>
                <div className="text-[12px] font-normal text-slate-400">합계</div>
              </th>
            ))}
            <th rowSpan={3} className="sticky right-0 z-50 min-w-[84px] border-l-[6px] border-l-white bg-white px-1 py-2 text-left text-[12px] font-bold text-slate-800 shadow-[-12px_0_24px_rgba(15,23,42,0.08)]">
              Total
            </th>
          </tr>
          <tr>
            {visibleWeeks.map((week) => {
              const monthlyStatus = monthCloseStatusByMonth.get(week.yearMonth);
              const status = weeklyStatusByWeek.get(`${week.yearMonth}:${week.weekNo}`);
              const rangeLocked = isCashflowWeekLockedByRange(monthCloseRequest?.lockRange, week.yearMonth, week.weekNo);
              const label = status === 'COMPLETED' || status === 'COMPLETED_LATE'
                ? '주간 정산 완료'
                : status === 'MISSED' ? '미정산' : status === 'PENDING' ? '정산 대기' : '';
              return (
                <th key={`${mode}-${week.yearMonth}-${week.weekNo}-weekly-close`} data-cashflow-board-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1 text-center align-middle ${cashflowWeekSurface(monthlyStatus, status) || 'bg-white'}`}>
                  <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold ${monthlyStatus === 'CLOSED' ? 'text-slate-600' : status === 'MISSED' ? 'text-red-700' : status ? 'text-slate-700' : 'text-slate-300'}`}>
                    {rangeLocked || monthlyStatus === 'CLOSED' ? <LockKeyhole className="h-3 w-3" aria-hidden="true" /> : <CheckCircle2 className={`h-3 w-3 ${status === 'MISSED' ? 'text-red-600' : status ? 'text-[#17324D]' : 'text-slate-300'}`} />}
                    {rangeLocked ? '누적 결산 잠김' : monthlyStatus === 'CLOSED' ? '월 결산 완료' : label}
                  </span>
                </th>
              );
            })}
          </tr>
          <tr>
            {visibleWeeks.map((week) => {
              const isThisWeek = todayYearMonth === week.yearMonth && todayIso >= week.weekStart && todayIso <= week.weekEnd;
              const monthlyStatus = monthCloseStatusByMonth.get(week.yearMonth);
              const status = weeklyStatusByWeek.get(`${week.yearMonth}:${week.weekNo}`);
              return (
                <th key={`${mode}-${week.yearMonth}-${week.weekNo}`} data-cashflow-board-column="true" className={`min-w-[84px] border-l-[6px] border-l-white px-1 py-1.5 text-center align-top font-semibold ${cashflowWeekSurface(monthlyStatus, status) || (isThisWeek ? 'bg-[#EAF0F5]' : 'bg-slate-50')}`}>
                  <span className="block truncate text-[12px] font-bold leading-5 text-slate-800">{week.label}</span>
                </th>
              );
            })}
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
      <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">현금흐름 관리시트</div>
              <div className="mt-1 text-[12px] text-slate-500">조회 전용 · 값은 시트 값 불러오기로만 반영됩니다.</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-1 text-[12px] font-semibold text-slate-600">
                <span className="sr-only">결산 대상 월</span>
                <Input
                  type="month"
                  value={yearMonth}
                  disabled={monthCloseRequestLocked}
                  className="h-8 w-[138px] rounded-full border-0 bg-white px-3 text-[12px] shadow-sm disabled:bg-slate-200 disabled:text-slate-500"
                  onChange={(event) => setYearMonth(event.target.value)}
                />
              </label>
              <Badge className={`h-8 rounded-full border-0 px-3 text-[12px] ${monthCloseStatusClass}`}>
                {monthCloseLoading ? '상태 확인 중' : monthCloseStatusLabel}
              </Badge>
              {monthCloseResult?.dashboard?.summary?.closeDeadline && monthCloseResult.dashboard.summary.targetYearMonth ? (
                <span className="text-[12px] text-slate-500">
                  {monthCloseResult.dashboard.summary.closeDeadline}까지 {monthCloseResult.dashboard.summary.targetYearMonth}월 결산
                </span>
              ) : null}
            </div>
          </div>
          <div className="relative bg-slate-100 px-4 pb-4">
            <Button type="button" variant="outline" size="sm" className="absolute left-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)]" onClick={() => scrollBoard(-1)} aria-label="왼쪽 주차로 이동">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="absolute right-2 top-1/2 z-50 h-11 w-9 -translate-y-1/2 rounded-full border-0 bg-white/95 p-0 shadow-[0_10px_28px_rgba(15,23,42,0.16)]" onClick={() => scrollBoard(1)} aria-label="오른쪽 주차로 이동">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="space-y-5 rounded-md border border-slate-200 bg-white p-3">
              <section ref={cashflowBoardScrollRef} className="overflow-x-auto scroll-smooth" data-cashflow-block="projection" data-cashflow-row-count={CASHFLOW_ALL_LINES.length + 3} tabIndex={0} aria-label="Projection 현금흐름 가로 스크롤 표">
                <h3 className="sticky left-0 z-30 w-fit border-l-4 border-[#17324D] bg-[#17324D] px-3 py-2 text-[14px] font-bold text-white">Projection</h3>
                {renderModeTable('projection')}
              </section>
              <section className="overflow-x-auto" data-cashflow-block="actual" data-cashflow-row-count={CASHFLOW_ALL_LINES.length + 3} tabIndex={0} aria-label="Actual 현금흐름 가로 스크롤 표">
                <h3 className="sticky left-0 z-30 w-fit border-l-4 border-[#17324D] bg-[#17324D] px-3 py-2 text-[14px] font-bold text-white">ACTUAL</h3>
                {renderModeTable('actual')}
              </section>
            </div>
          </div>
          {monthCloseLoading ? <div className="px-3 py-2 text-[12px] text-slate-500">불러오는 중...</div> : null}
        </CardContent>
      </Card>
    );
  }


  function renderProjectionActualDiffTable() {
    const rows = projectionActualComparison.changedRows;
    const columnCount = visibleComparisonAnnualYears.length + visibleComparisonWeeks.length + 1;
    if (monthCloseResult?.dashboard?.snapshotCompatibility?.status === 'LEGACY_EVIDENCE_ONLY') {
      return (
        <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-5 text-[12px] leading-5 text-[#17324D]">
          이전 형식으로 결산된 월이라 전체 기간의 항목별 차이 근거는 표시하지 않습니다. 결산 당시 보관된 월 값만 읽을 수 있습니다.
        </div>
      );
    }
    if (monthCloseLoading) {
      return <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">BFF 차이값을 불러오는 중...</div>;
    }
    if (monthCloseError || !monthCloseResult?.dashboard?.canonical?.range) {
      return (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-6 text-center text-[12px] text-red-700">
          {monthCloseError || '서버 확정 시트와 기간 합계를 불러오지 못했습니다.'}
        </div>
      );
    }
    return (
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-slate-950">
                <HoverExplain message="아래 현금흐름 관리시트와 동일한 반영값으로 Projection에서 Actual을 뺍니다.">
                  Projection - Actual 차이
                </HoverExplain>
              </div>
              <div className="text-[12px] text-slate-500">
                현금흐름 관리시트 기준 · 차이 = Projection - Actual
              </div>
            </div>
            <Badge className="rounded-md border border-[#C7D3DF] bg-[#EAF0F5] px-2.5 py-1 text-[12px] text-[#17324D]">차이 항목만</Badge>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-2">
            <table className="border-separate border-spacing-0 text-[12px]" style={{ minWidth: `${220 + columnCount * 96}px` }}>
              <thead className="bg-white text-slate-500">
                <tr>
                  <th className="sticky left-0 z-20 w-[220px] min-w-[220px] border-r-[6px] border-r-white bg-white px-3 py-2 text-left font-medium">항목</th>
                  {previousComparisonAnnualYears.map((year) => (
                    <th key={`comparison-${year}-before`} className="min-w-[96px] border-l-[6px] border-l-white bg-slate-100 px-2 py-2 text-right font-medium">{year}년</th>
                  ))}
                  {visibleComparisonWeeks.map((week) => (
                    <th key={`${week.yearMonth}-${week.weekNo}`} className="min-w-[96px] border-l-[6px] border-l-white bg-slate-50/80 px-2 py-2 text-right font-medium">
                      <div>{week.label}</div>
                    </th>
                  ))}
                  {followingComparisonAnnualYears.map((year) => (
                    <th key={`comparison-${year}-after`} className="min-w-[96px] border-l-[6px] border-l-white bg-slate-100 px-2 py-2 text-right font-medium">{year}년</th>
                  ))}
                  <th className="sticky right-0 z-20 min-w-[96px] border-l-[6px] border-l-white bg-white px-2 py-2 text-right font-medium shadow-[-12px_0_24px_rgba(15,23,42,0.08)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount + 1} className="px-3 py-8 text-center text-[12px] text-slate-500">
                      Projection과 Actual 차이가 없습니다.
                    </td>
                  </tr>
                ) : rows.map((row, rowIndex) => (
                  <tr key={row.lineId} className="border-t-[6px] border-white">
                    <td className={`sticky left-0 z-10 w-[220px] min-w-[220px] border-r-[6px] border-r-white px-3 py-2 ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                      <div className={`truncate ${row.section === '입금' ? 'text-emerald-700' : 'text-red-700'}`}>{row.label}</div>
                    </td>
                    {row.annualCells.filter((cell) => previousComparisonAnnualYears.includes(cell.year)).map((cell) => {
                      const rowSurface = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                      const differenceClass = cell.difference === null || cell.difference === 0
                        ? `${rowSurface} text-slate-300`
                        : 'bg-[#EAF0F5] text-sky-700';
                      return (
                        <td key={`${row.lineId}-${cell.year}`} className={`min-w-[96px] border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums ${differenceClass}`} title={cell.difference === null ? `${cell.year}년\n미입력` : `${cell.year}년\nProjection ${fmt(cell.projection)} / Actual ${fmt(cell.actual)} / 차이 ${fmtSigned(cell.difference)}`}>
                          {cell.difference === null ? '미입력' : fmtSigned(cell.difference)}
                        </td>
                      );
                    })}
                    {row.cells.map((cell) => {
                      const rowSurface = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                      const differenceClass = cell.difference === null || cell.difference === 0
                        ? `${rowSurface} text-slate-300`
                        : 'bg-[#EAF0F5] text-sky-700';
                      return (
                        <td
                          key={`${row.lineId}-${cell.yearMonth}-${cell.weekNo}`}
                          className={`min-w-[96px] border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums ${differenceClass}`}
                          title={cell.difference === null ? `${cell.weekRange}\nBFF 비교 대상 기간 아님` : `${cell.weekRange}\nProjection ${fmt(cell.projection)} / Actual ${fmt(cell.actual)} / 차이 ${fmtSigned(cell.difference)}\n${diffColorExplanation(row.section, cell.difference)}`}
                        >
                          {cell.difference === null ? '미입력' : fmtSigned(cell.difference)}
                        </td>
                      );
                    })}
                    {row.annualCells.filter((cell) => followingComparisonAnnualYears.includes(cell.year)).map((cell) => {
                      const rowSurface = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                      const differenceClass = cell.difference === null || cell.difference === 0
                        ? `${rowSurface} text-slate-300`
                        : 'bg-[#EAF0F5] text-sky-700';
                      return (
                        <td key={`${row.lineId}-${cell.year}`} className={`min-w-[96px] border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums ${differenceClass}`} title={cell.difference === null ? `${cell.year}년\n미입력` : `${cell.year}년\nProjection ${fmt(cell.projection)} / Actual ${fmt(cell.actual)} / 차이 ${fmtSigned(cell.difference)}`}>
                          {cell.difference === null ? '미입력' : fmtSigned(cell.difference)}
                        </td>
                      );
                    })}
                    <td className={`sticky right-0 z-10 min-w-[96px] border-l-[6px] border-l-white px-2 py-2 text-right font-semibold tabular-nums shadow-[-12px_0_24px_rgba(15,23,42,0.08)] ${row.totalCell.difference === null || row.totalCell.difference === 0 ? (rowIndex % 2 === 0 ? 'bg-white text-slate-300' : 'bg-slate-50 text-slate-300') : 'bg-[#EAF0F5] text-sky-700'}`} title={row.totalCell.difference === null ? 'Total\n미입력' : `Total\nProjection ${fmt(row.totalCell.projection)} / Actual ${fmt(row.totalCell.actual)} / 차이 ${fmtSigned(row.totalCell.difference)}`}>
                      {row.totalCell.difference === null ? '미입력' : fmtSigned(row.totalCell.difference)}
                    </td>
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
    if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800';
    if (tone === 'warning') return 'border-border bg-accent text-accent-foreground';
    if (tone === 'success') return 'border-border bg-secondary text-secondary-foreground';
    if (tone === 'info') return 'border-border bg-accent text-accent-foreground';
    return 'border-border bg-secondary text-secondary-foreground';
  }

  function opsDotClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'bg-red-500';
    if (tone === 'warning') return 'bg-sky-600';
    if (tone === 'success') return 'bg-slate-500';
    if (tone === 'info') return 'bg-[#17324D]';
    return 'bg-slate-400';
  }

  function opsSubtleBgClass(tone: CashflowOpsTone): string {
    if (tone === 'danger') return 'bg-red-50';
    if (tone === 'warning') return 'bg-accent';
    if (tone === 'success') return 'bg-secondary';
    if (tone === 'info') return 'bg-accent';
    return 'bg-secondary';
  }

  function rateStatusLabel(percent: number): string {
    if (monthCloseLoading || !monthCloseResult?.dashboard) return '확인 중';
    if (percent === 100) return 'OK';
    return percent > 100 ? '초과' : '미달';
  }

  function renderRateTile(label: string, rate: { percent: number }) {
    const tone = label === 'Projection'
      ? { surface: 'border-border bg-accent', value: 'text-primary', bar: 'bg-primary' }
      : label === 'Actual'
        ? { surface: 'border-border bg-card', value: 'text-foreground', bar: 'bg-sky-600' }
        : { surface: 'border-border bg-accent', value: 'text-primary', bar: 'bg-sky-600' };
    const dashboard = monthCloseResult?.dashboard;
    if (label === '결산') {
      return (
        <div className={`min-w-[158px] rounded-md border px-3.5 py-3 shadow-none ${tone.surface}`} title="JVM 누적 Projection-Actual 요약값">
          <div className="mb-1 text-[12px] font-semibold leading-4 text-muted-foreground">결산</div>
          <CashflowCanonicalSummary
            summary={dashboard?.projectionActualSummary}
            loading={monthCloseLoading}
            error={Boolean(monthCloseError)}
            onRetry={() => void loadCashflowMonthClose()}
          />
        </div>
      );
    }
    const projectionSummary = dashboard?.summary;
    const projectionMetricsReady = projectionSummary?.projectionContractAmount !== undefined
      && projectionSummary.projectionSalesAndVatTotal !== undefined
      && projectionSummary.contractDifference !== undefined
      && projectionSummary.contractCoveragePercent !== undefined;
    const zeroContract = projectionMetricsReady && projectionSummary.projectionContractAmount === 0;
    const summaryDescription = label === 'Projection'
      ? projectionMetricsReady
        ? `프로젝트 등록 계약금액 ${fmt(Number(projectionSummary?.projectionContractAmount || 0))}원 · 전체 사업기간 Projection 매출액+매출부가세 ${fmt(Number(projectionSummary?.projectionSalesAndVatTotal || 0))}원 · 차이 ${fmt(Number(projectionSummary?.contractDifference || 0))}원`
        : '계약금액과 매출액+매출부가세 합계를 불러오는 중입니다.'
      : '이번 주차까지 입력 기준';
    const primaryValue = label === 'Projection' && !projectionMetricsReady
        ? '확인 중'
        : label === 'Projection' && zeroContract
          ? '계약금액 0원'
        : `${rate.percent}%`;
    const statusLabel = label === 'Projection' && !projectionMetricsReady ? '로딩' : label === 'Projection' && zeroContract ? '계약금액 확인' : rateStatusLabel(rate.percent);
    return (
      <div className={`min-w-[158px] rounded-md border px-3.5 py-3 shadow-none ${tone.surface}`} title="BFF/JVM 서버 요약값">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold leading-4 text-muted-foreground">{label}</div>
          <div className="text-[12px] tabular-nums text-muted-foreground">서버 기준</div>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className={`text-[22px] font-bold leading-6 tabular-nums ${tone.value}`}>
            {primaryValue}
          </span>
          <span className={`truncate text-right text-[12px] font-semibold leading-4 ${tone.value}`}>{statusLabel}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, rate.percent))}%` }} />
        </div>
        <div className="mt-1.5 text-[12px] leading-4 text-muted-foreground">{summaryDescription}</div>
      </div>
    );
  }

  function renderOperationsSummary() {
    return (
      <div className="grid gap-2 md:grid-cols-3">
        {renderRateTile('Projection', opsSummary.rates.projection)}
        {renderRateTile('Actual', opsSummary.rates.actual)}
        {renderRateTile('결산', opsSummary.rates.confirmation)}
      </div>
    );
  }

  function renderOperationsPanel() {
    const statusBadgeLabel = opsSummary.status.kind === 'ready'
      ? opsSummary.status.label
      : `확인 항목 ${opsSummary.status.count}건`;
    const dashboardSummary = renderOperationsSummary();
    return (
      <Card className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
              <div className="truncate text-[16px] font-bold tracking-[-0.01em] text-card-foreground">{dashboardTitle}</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-md border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-[#17324D]"
                onClick={() => cashflowSheetConfig
                  ? navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)
                  : handleOpenSheetOnboarding()}
              >
                {cashflowSheetConfig ? '시트 설정' : '시트 연결'}
              </Button>
              {cashflowSheetConfig && sheetChangeCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 rounded-md border-yellow-300 bg-yellow-50 px-2.5 text-[12px] font-semibold text-yellow-900 hover:bg-yellow-100"
                  onClick={handleOpenSheetReviewDialog}
                >
                  {`변경 ${sheetChangeCount.toLocaleString()}건`}
                </Button>
              ) : null}
              {configuredSheetUrl ? (
                <a
                  className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px] font-semibold text-[#17324D] hover:bg-accent"
                  href={configuredSheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileSpreadsheet className="mr-1 h-3 w-3" />
                  시트 이동
                </a>
              ) : null}
              {cashflowSheetConfig ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 rounded-md border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-[#17324D]"
                  disabled={sheetRefreshLoading}
                  onClick={() => void handleRefreshSheetMirror()}
                >
                  {sheetRefreshLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  시트 값 불러오기
                </Button>
              ) : null}
              {project && members ? (
                <div
                  id="project-executive-approver"
                  className={`flex min-w-[250px] items-end gap-2 border-l pl-2 ${executiveApproverAttention ? 'border-yellow-400 bg-yellow-50 ring-2 ring-yellow-300' : 'border-slate-200'}`}
                >
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-[12px] font-semibold text-slate-800">프로젝트 조직장</label>
                    <MemberPicker
                      className="h-7 border-slate-300 bg-white text-[12px]"
                      options={executiveApproverOptions}
                      value={selectedExecutiveApproverId}
                      onChange={setSelectedExecutiveApproverId}
                      placeholder="조직장 선택"
                      disabled={executiveApproverBusy || ['PENDING', 'APPROVING'].includes(monthCloseRequest?.status || '')}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-[#17324D]"
                    disabled={executiveApproverBusy || !selectedExecutiveApproverId || selectedExecutiveApproverId === savedExecutiveApproverId || ['PENDING', 'APPROVING'].includes(monthCloseRequest?.status || '')}
                    onClick={() => void handleSaveExecutiveApprover()}
                  >
                    {executiveApproverBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    저장
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-[12px] text-muted-foreground sm:inline">기준일 {todayIso}</span>
              <Badge className={`rounded-md px-2.5 py-1 text-[12px] shadow-none ${opsToneClass(opsSummary.status.tone)}`}>
                {statusBadgeLabel}
              </Badge>
            </div>
          </div>

          {sheetDashboardMetadata ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {[
                ['사업 타입', sheetDashboardMetadata.businessType?.value],
                ['전용 계좌사업', sheetDashboardMetadata.accountType?.value],
                ['정산 여부', sheetDashboardMetadata.settlementStatus?.value],
              ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                <span key={label} className="rounded-md border border-border bg-accent px-2.5 py-1 font-semibold text-accent-foreground">
                  <span className="mr-1 text-primary">{label}</span>{value}
                </span>
              ))}
              <span className="ml-1 border-l border-border pl-3 text-muted-foreground">
                세금계산서 발행일 · 입금일 · 입금액 주별 확인됨
              </span>
            </div>
          ) : null}

          <section data-cashflow-settlement-actions className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-bold text-card-foreground">주간 정산</div>
                    <div className="mt-1 text-[12px] leading-4 text-muted-foreground">
                      {monthCloseResult?.dashboard?.deadlineSummary?.current
                        ? `${monthCloseResult.dashboard.deadlineSummary.current.yearMonth} ${monthCloseResult.dashboard.deadlineSummary.current.weekNo}주차 · ${weeklyCompletionStatusLabel(monthCloseResult.dashboard.deadlineSummary.current.status)}`
                        : '서버에서 주간 마감 상태를 확인하고 있습니다.'}
                    </div>
                  </div>
                  {canCompleteWeekly ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 rounded-md border-slate-300 bg-white px-3 text-[12px] font-semibold text-[#17324D]"
                      disabled={weeklyCompletionBusy || monthCloseLoading || Boolean(monthCloseResult?.dashboard?.deadlineSummary?.current?.completedAt)}
                      onClick={() => {
                        if (!savedExecutiveApproverId) {
                          setExecutiveApproverAttention(true);
                          toast.error('먼저 프로젝트 조직장을 선택해 주세요.');
                          return;
                        }
                        setWeeklyCompletionError('');
                        setWeeklyProjectionWarning(null);
                        setWeeklyUpdateResult('');
                        setWeeklyCompletionOpen(true);
                      }}
                    >
                      {weeklyCompletionBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ClipboardCheck className="mr-1 h-3 w-3" />}
                      {monthCloseResult?.dashboard?.deadlineSummary?.current?.completedAt ? '주간 정산 완료됨' : '주간 정산 완료'}
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-4 text-[12px] text-muted-foreground">
                  <span>누적 미준수 <strong className="ml-1 text-red-700">{monthCloseResult?.dashboard?.deadlineSummary?.missedCount || 0}회</strong></span>
                  <span>기한 내 완료 <strong className="ml-1 text-primary">{monthCloseResult?.dashboard?.deadlineSummary?.completedCount || 0}회</strong></span>
                  <button type="button" className="font-semibold text-[#17324D] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17324D]" onClick={() => setWeeklyHistoryOpen(true)}>자세히</button>
                </div>
              </div>
              <div className="bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-bold text-card-foreground">월 결산</div>
                      <Badge className={`h-6 rounded-md px-2 text-[12px] shadow-none ${monthCloseStatusClass}`}>{monthCloseLoading ? '상태 확인 중' : monthCloseStatusLabel}</Badge>
                    </div>
                    <div className="mt-1 text-[12px] leading-4 text-muted-foreground">
                      {monthCloseRequest?.status === 'PENDING' || monthCloseRequest?.status === 'APPROVING' || monthCloseRequest?.status === 'UNCERTAIN'
                        ? monthCloseRequest.status === 'UNCERTAIN' ? '서버 처리 결과를 다시 확인하고 있습니다.' : '지정 조직장의 검토를 기다리고 있습니다.'
                        : monthCloseRequest?.status === 'REJECTED'
                          ? `반려됨${monthCloseRequest.decisionReason ? ` · ${monthCloseRequest.decisionReason}` : ''}`
                        : monthCloseRequest?.status === 'REOPENED'
                          ? '재오픈됨 · 수정 후 월 결산을 다시 요청해 주세요.'
                      : monthClosePreparation.status === 'READY'
                        ? `${yearMonth} 결산 승인을 요청하면 조직장 승인 전까지 확정되지 않습니다.`
                        : monthClosePreparation.title}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canFinalizeMonth && !['PENDING', 'APPROVING', 'UNCERTAIN', 'APPROVED'].includes(monthCloseRequest?.status || '') && (monthCloseError || (monthCloseResult?.status !== 'CLOSED' && monthCloseResult?.status !== 'REOPEN_REQUESTED')) ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-md bg-[#17324D] px-3 text-[12px] font-semibold text-white shadow-none hover:bg-slate-800"
                        disabled={monthCloseBusy || monthCloseLoading}
                        onClick={handleOpenMonthCloseReview}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {monthCloseError || !monthCloseResult ? '월 결산 점검' : ['REJECTED', 'REOPENED'].includes(monthCloseRequest?.status || '') ? '월 결산 재요청' : '월 결산 요청'}
                      </Button>
                    ) : null}
                    {!monthCloseError && canRequestMonthReopen && monthCloseResult?.status === 'CLOSED' ? (
                      <Button type="button" size="sm" variant="outline" className="h-8 rounded-md border-slate-300 bg-white px-3 text-[12px] text-[#17324D]" onClick={() => { setReopenReason(''); setReopenAction('request'); }}>
                        재오픈 요청
                      </Button>
                    ) : null}
                    {!monthCloseError && canReviewReopen && monthCloseResult?.status === 'REOPEN_REQUESTED' ? (
                      <>
                        <Button type="button" size="sm" className="h-8 rounded-md bg-[#17324D] px-3 text-[12px] text-white shadow-none hover:bg-slate-800" onClick={() => { setReopenReason(''); setReopenAction('approve'); }}>재오픈 승인</Button>
                        <Button type="button" size="sm" variant="outline" className="h-8 rounded-md border-slate-300 bg-white px-3 text-[12px] text-slate-700" onClick={() => { setReopenReason(''); setReopenAction('reject'); }}>재오픈 반려</Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <span>{monthCloseResult?.dashboard?.summary?.closeDeadline && monthCloseResult.dashboard.summary.targetYearMonth ? `${monthCloseResult.dashboard.summary.closeDeadline}까지 ${monthCloseResult.dashboard.summary.targetYearMonth}월 결산` : '결산 가능일을 서버에서 확인합니다.'}</span>
                </div>
              </div>
          </section>

          {cashflowSheetMirror?.lastRefreshError?.message ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
              <div className="min-w-0">
                <span className="font-semibold">시트 연동 오류: </span>{cashflowSheetMirror.lastRefreshError.message}
                {cashflowSheetMirror.lastRefreshError.diagnostics?.length ? (
                  <ul className="mt-2 space-y-1 border-t border-red-200 pt-2">
                    {cashflowSheetMirror.lastRefreshError.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${diagnostic.sourceCell || index}`}>
                        {diagnostic.sourceCell ? `${diagnostic.sourceCell} · ` : ''}{diagnostic.message}
                      </li>
                    ))}
                    {(cashflowSheetMirror.lastRefreshError.diagnosticCount || 0) > cashflowSheetMirror.lastRefreshError.diagnostics.length ? (
                      <li>외 {(cashflowSheetMirror.lastRefreshError.diagnosticCount || 0) - cashflowSheetMirror.lastRefreshError.diagnostics.length}건</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 rounded-md border-red-200 bg-white px-2.5 text-[12px] text-red-700"
                onClick={() => navigate(`/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab`)}
              >
                시트 설정
              </Button>
            </div>
          ) : null}
          {dashboardSummary}

          <div className="grid gap-3">
            <div className="rounded-md border border-border bg-card px-3.5 py-3 shadow-none">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-card-foreground">주요 관리 항목</div>
                <span className="text-[12px] text-muted-foreground">프로젝트 전체 기간 · BFF/JVM 서버 판정</span>
              </div>
              <div className="space-y-2">
                {(monthCloseResult?.dashboard?.managementChecks || []).map((check) => {
                  const tone: CashflowOpsTone = check.status === 'OK' ? 'success' : check.status === 'WARNING' ? 'warning' : 'neutral';
                  return (
                    <div key={check.id} className="rounded-md border border-border bg-secondary px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${opsDotClass(tone)}`} />
                        <span className="text-[12px] font-bold text-secondary-foreground">{check.title}</span>
                      </div>
                      {check.findings?.length ? (
                        <ul className="mt-1 space-y-0.5 text-[12px] leading-4 text-muted-foreground">
                          {check.findings.map((finding) => <li key={finding}>· {finding}</li>)}
                        </ul>
                      ) : (
                        <div className="mt-1 text-[12px] leading-4 text-muted-foreground">{check.detail}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {monthCloseResult?.dashboard?.postCloseAdjustment ? (
            <div className="rounded-md border border-border bg-accent px-3 py-2 text-[12px] text-accent-foreground">
              <div className="font-bold">결산 후 조정 특이사항</div>
              <div className="mt-1">{monthCloseResult.dashboard.postCloseAdjustment.reason} · 변경 {monthCloseResult.dashboard.postCloseAdjustment.changedCount}건</div>
              <div className="mt-1.5 space-y-1 text-[12px] leading-4 text-secondary-foreground">
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
    const actorName = decodeActivityActor(event.actorName);
    const actorEmail = decodeActivityActor(event.actorEmail);
    if (event.type === 'sheet_refresh') {
      const actor = actorName
        ? `${actorName}님이`
        : actorEmail ? `${actorEmail} 계정으로` : '담당자가';
      const action = `${actor} 시트의 최신 값을 불러와 MYSCube 시트 반영 전 검증본으로 보관했습니다.`;
      return [event.sheetName, action].filter(Boolean).join(' · ');
    }
    if (event.type === 'sheet_apply') {
      const actor = actorName || actorEmail || '담당자';
      const period = event.scope === 'annual' && event.year ? `${event.year}년 합계` : event.yearMonth || '';
      return `${actor} · ${period} 시트 반영 ${event.appliedLineCount || 0}건 · Projection ${event.projectionLineCount || 0}건 · Actual ${event.actualLineCount || 0}건`;
    }
    if (event.type === 'month_close') return [`${event.yearMonth || ''} 월`, event.status || '결산 완료', actorName || actorEmail || '사용자'].filter(Boolean).join(' · ');
    if (event.type === 'projection_amount_change' || event.type === 'actual_amount_change') {
      const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
      const lineLabel = event.lineId ? CASHFLOW_SHEET_LINE_LABELS[event.lineId as CashflowSheetLineId] || event.lineId : '';
      const before = event.beforeState === 'EMPTY' ? '미작성 (EMPTY)' : event.beforeState === 'ZERO' ? '0원 (ZERO)' : `${fmt(Number(event.beforeAmount || 0))}원 (VALUE)`;
      const after = event.afterState === 'EMPTY' ? '미작성 (EMPTY)' : event.afterState === 'ZERO' ? '0원 (ZERO)' : `${fmt(Number(event.afterAmount || 0))}원 (VALUE)`;
      return `${weekLabel} ${lineLabel} ${before} → ${after} · ${actorName || actorEmail || '사용자'}`;
    }
    if (event.type === 'sheet_apply_reverted') return '선택한 시트 반영 run의 금액 변경을 이전 값으로 되돌렸습니다.';
    const weekLabel = event.weekNo ? getWeekLabel(event.weekNo, event.yearMonth) : '';
    return [weekLabel, actorName || actorEmail || '사용자'].filter(Boolean).join(' · ');
  }

  function latestCashflowEventSummary(event?: CashflowEvent): string {
    if (!event) return '시트 반영과 월 결산 기록이 여기에 남습니다.';
    const actor = decodeActivityActor(event.actorName) || decodeActivityActor(event.actorEmail) || '최근 사용자';
    if (event.type === 'sheet_refresh') return `${actor}님이 시트의 최신 값을 불러왔습니다.`;
    if (event.type === 'sheet_apply') return `${actor}님이 시트 값을 MYSCube 시트에 반영했습니다.`;
    if (event.type === 'month_close') return `${actor}님이 ${event.yearMonth || ''} 월 결산을 확정했습니다.`;
    return `${actor}님의 최근 변경 기록입니다.`;
  }

  function cashflowEventSourceClass(source: CashflowEvent['source']): string {
    if (source === 'google_sheet_refresh') return 'bg-slate-100 text-slate-700';
    if (source === 'google_sheet_apply') return 'bg-[#EAF0F5] text-[#17324D]';
    if (source === 'month_close') return 'bg-[#EAF0F5] text-[#17324D]';
    if (source === 'revert') return 'bg-[#EAF0F5] text-[#17324D]';
    return 'bg-slate-100 text-slate-700';
  }

  function renderOpsTimeline() {
    const countBadges = [
      { key: 'sheet', label: '시트 불러오기', value: cashflowEvents.filter((event) => event.type === 'sheet_refresh').length },
      { key: 'amount', label: '금액 변경', value: cashflowEvents.filter((event) => event.type === 'projection_amount_change' || event.type === 'actual_amount_change').length },
      { key: 'status', label: '월 결산', value: cashflowEvents.filter((event) => event.type === 'month_close').length },
    ].filter((item) => item.value > 0);
    const latestEvent = cashflowEvents[0];
    const filteredEvents = cashflowEvents.filter((event) => {
      const query = cashflowEventQuery.trim().toLocaleLowerCase('ko-KR');
      const mode = event.mode || (event.type.startsWith('projection') ? 'projection' : event.type.startsWith('actual') ? 'actual' : '');
      return (cashflowEventMode === 'ALL' || mode === cashflowEventMode)
        && (cashflowEventMonth === 'ALL' || event.yearMonth === cashflowEventMonth)
        && (!query || `${cashflowEventLabel(event)} ${cashflowEventDetail(event)} ${event.sourceDetail || event.source || ''} ${event.operation || ''} ${event.operationId || ''} ${event.auditId || ''} ${event.runId} ${event.reason || ''} ${event.sourceRevision || ''} ${event.targetRevision || ''}`.toLocaleLowerCase('ko-KR').includes(query));
    });

    return (
      <Card className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 pb-3">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">실제 반영 기록</div>
              <div className="mt-0.5 text-[12px] leading-4 text-slate-600">{latestCashflowEventSummary(latestEvent)}</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {countBadges.map((badge) => (
                <span
                  key={badge.key}
                  className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[12px] font-semibold leading-4 text-slate-700"
                >
                  {badge.label} {badge.value}
                </span>
              ))}
            </div>
          </div>
          <div className="mb-2 grid gap-2 sm:grid-cols-3">
            <Input aria-label="실제 반영 기록 검색" value={cashflowEventQuery} onChange={(event) => setCashflowEventQuery(event.target.value)} placeholder="항목·담당자 검색" />
            <select aria-label="실제 반영 mode 필터" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[12px]" value={cashflowEventMode} onChange={(event) => setCashflowEventMode(event.target.value)}><option value="ALL">전체 mode</option><option value="projection">Projection</option><option value="actual">Actual</option></select>
            <select aria-label="실제 반영 월 필터" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[12px]" value={cashflowEventMonth} onChange={(event) => setCashflowEventMonth(event.target.value)}><option value="ALL">전체 월</option>{[...new Set(cashflowEvents.map((event) => event.yearMonth).filter(Boolean))].sort((left, right) => left.localeCompare(right)).map((month) => <option key={month} value={month}>{month}</option>)}</select>
          </div>
          {cashflowEventErrors.map((failure) => (
            <div key={failure.source} role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              <span>{CASHFLOW_ACTIVITY_SOURCE_LABELS[failure.source]}: {failure.message}</span>
              <Button type="button" size="sm" variant="outline" disabled={cashflowEventLoadingSources.includes(failure.source)} onClick={() => void loadCashflowEventSource(failure.source)}>다시 시도</Button>
            </div>
          ))}
          <div className="max-h-[230px] space-y-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-2 pr-1">
            {cashflowEventLoadingSources.length > 0 && filteredEvents.length === 0 ? (
              <div role="status" className="px-2 py-8 text-center text-[12px] leading-4 text-slate-500">실제 반영 기록을 불러오는 중입니다.</div>
            ) : filteredEvents.length === 0 ? (
              <div className="px-2 py-8 text-center text-[12px] leading-4 text-slate-500">
                아직 표시할 변경 기록이 없습니다.
                <br />
                시트 값을 불러오거나 월 결산하면 담당자와 시간이 여기에 남습니다.
              </div>
            ) : filteredEvents.map((event, index) => {
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
                {index < filteredEvents.length - 1 && (
                  <div className="absolute left-[6px] top-3 h-full w-px bg-slate-200/80" />
                )}
                <div className={`relative z-10 mt-1 h-3 w-3 rounded-full border-2 border-white ${opsDotClass(event.type === 'sheet_apply_reverted' ? 'warning' : 'info')}`} />
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[12px] font-semibold leading-4 ${cashflowEventSourceClass(event.source)}`}>
                          {event.source === 'google_sheet_refresh' ? '불러오기' : event.source === 'google_sheet_apply' ? '시트' : event.source === 'month_close' ? '결산' : event.source === 'revert' ? '되돌림' : '기록'}
                        </span>
                        <span className="truncate text-[12px] font-bold text-slate-900">{cashflowEventLabel(event)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-[12px] tabular-nums text-slate-400">{formatSheetAppliedAt(event.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[12px] leading-4 text-slate-500">{cashflowEventDetail(event)}</div>
                  {canRevert && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1 h-6 rounded-md px-2 text-[12px]"
                      onClick={() => void handleRevertCashflowRun(event.runId)}
                      disabled={revertingRunId === event.runId}
                    >
                      {revertingRunId === event.runId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                      이 반영 되돌리기
                    </Button>
                  )}
                  {event.revertedAt && <div className="mt-1 text-[12px] font-semibold text-slate-700">되돌림 완료</div>}
                </div>
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  const monthCloseStatusLabel = monthCloseError
    ? '상태 재확인 필요'
    : monthCloseResult?.status === 'CLOSED'
    ? '월 결산 완료'
    : monthCloseResult?.status === 'REOPEN_REQUESTED'
      ? '재오픈 승인 대기'
      : monthCloseRequest?.status === 'APPROVING'
        ? '승인 처리 중'
        : monthCloseRequest?.status === 'UNCERTAIN'
          ? '서버 결과 확인 필요'
        : monthCloseRequest?.status === 'PENDING'
          ? '조직장 승인 대기'
          : monthCloseRequest?.status === 'REJECTED'
            ? '월 결산 반려'
            : monthCloseRequest?.status === 'REOPENED'
              ? '재결산 필요'
      : '결산 전';
  const monthCloseStatusClass = monthCloseError
    ? 'border border-red-200 bg-red-50 text-red-700'
    : monthCloseResult?.status === 'CLOSED'
    ? 'border border-border bg-secondary text-secondary-foreground'
    : monthCloseResult?.status === 'REOPEN_REQUESTED'
      ? 'border border-border bg-accent text-accent-foreground'
      : monthCloseRequest?.status === 'REJECTED'
        ? 'border border-red-200 bg-red-50 text-red-700'
      : 'border border-border bg-accent text-accent-foreground';
  const sheetDashboardMetadata = cashflowEvidenceScope.sheetMetadata;
  const dashboardTitle = `${projectName?.trim() || '이 프로젝트'} 현금흐름 대시보드`;
  const legacyCloseEvidence = monthCloseResult?.dashboard?.snapshotCompatibility?.status === 'LEGACY_EVIDENCE_ONLY';
  const cumulativeRequestScope = monthCloseResult?.dashboard?.cumulativeCloseScope;
  const cumulativeRequestScopeReady = isCumulativeCloseScopeReady(cumulativeRequestScope, yearMonth);

  return (
    <>
    <div className="space-y-5 bg-background p-4" inert={sheetRefreshLoading || undefined} aria-busy={sheetRefreshLoading}>
      {legacyCloseEvidence ? (
        <div role="status" className="rounded-md border border-slate-300 bg-slate-50 px-4 py-3 text-[12px] leading-5 text-[#17324D]">
          <strong>이전 형식의 월 결산입니다.</strong> 결산 당시 저장된 값은 읽을 수 있지만, 항목별 전년도 이월 근거와 전체 동결 시트는 보관되지 않았습니다. 수정이 필요하면 재오픈 승인 후 시트값을 다시 반영하고 재결산해 주세요.
        </div>
      ) : null}
      <AxrMonthCloseQaPanel
        projectId={projectId}
        projectName={projectName}
        yearMonth={yearMonth}
        tenantId={orgId}
        role={role}
        resolveActor={resolveBffActor}
        onOpenMonthCloseRequest={() => setMonthCloseReviewOpen(true)}
        onRefresh={async () => { await Promise.all([loadCashflowMonthClose(), loadMonthCloseRequest(), loadCashflowEvents()]); }}
      />
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        {renderOperationsPanel()}
        {renderOpsTimeline()}
      </section>

      <section id="projection-actual-comparison" data-cashflow-block="comparison" className="scroll-mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#EAF0F5]">
            <Columns2 className="h-4 w-4 text-[#17324D]" />
          </span>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.01em] text-slate-950">Projection - Actual 차이</div>
            <div className="text-[12px] text-slate-500">기준 범위 {cashflowTotalPeriodLabel}</div>
          </div>
        </div>
        {renderProjectionActualDiffTable()}
      </section>

      {renderUnifiedMonthlyBoard()}

      <AlertDialog open={weeklyCompletionOpen} onOpenChange={(open) => {
        if (!weeklyCompletionBusy) {
          setWeeklyCompletionOpen(open);
          if (!open) setWeeklyProjectionWarning(null);
        }
      }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[620px]">
          <AlertDialogHeader>
            <AlertDialogTitle>주간 정산 완료</AlertDialogTitle>
            <AlertDialogDescription>대상 주차와 그 이후 15개 재무주차(총 16주·256칸)의 JVM 저장 Projection 값을 확인합니다.</AlertDialogDescription>
          </AlertDialogHeader>
          {weeklyCompletionError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] leading-5 text-red-800">{weeklyCompletionError}</div> : null}
          {weeklyProjectionWarning ? (
            <details open className="max-h-[260px] overflow-auto rounded-md border border-red-300 bg-red-50 p-3 text-[12px]">
              <summary className="cursor-pointer font-bold text-red-950">서버가 확인한 미입력 항목 {weeklyProjectionWarning.missingCells.length.toLocaleString()}건</summary>
              <ul className="mt-2 space-y-1" aria-label="Projection 미입력 주차와 항목">
                {weeklyProjectionWarning.missingCells.map((cell) => <li key={`${cell.yearMonth}:${cell.weekNo}:${cell.lineId}`}>{cell.yearMonth} {cell.weekNo}주차 · {CASHFLOW_SHEET_LINE_LABELS[cell.lineId as CashflowSheetLineId] || cell.lineId}이 미작성입니다.</li>)}
              </ul>
            </details>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-bold text-slate-900">이번 주차 처리 결과를 하나 선택해 주세요.</legend>
            {([
              ['CHANGED', '변경사항 반영 완료', '시트 변경사항을 MYSCube에 반영하고 확인했습니다.'],
              ['NO_CHANGES', '변경사항 없음', '확인 결과 이번 주차에 반영할 변경사항이 없습니다.'],
            ] as const).map(([value, label, description]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-300 p-3 text-[12px] focus-within:ring-2 focus-within:ring-[#17324D]">
                <input type="radio" name="weekly-update-result" value={value} checked={weeklyUpdateResult === value} disabled={weeklyCompletionBusy} onChange={() => { setWeeklyUpdateResult(value); setWeeklyCompletionError(''); }} className="mt-0.5 h-4 w-4" />
                <span><strong className="block text-slate-900">{label}</strong><span className="mt-1 block text-slate-600">{description}</span></span>
              </label>
            ))}
          </fieldset>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={weeklyCompletionBusy}>취소</AlertDialogCancel>
            <Button type="button" disabled={weeklyCompletionBusy || !weeklyUpdateResult} onClick={() => void handleCompleteWeeklyUpdate()}>
              {weeklyCompletionBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />}{weeklyProjectionWarning ? '무시하고 반영' : '반영'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={weeklyHistoryOpen} onOpenChange={setWeeklyHistoryOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[860px]">
          <AlertDialogHeader>
            <AlertDialogTitle>주간 정산 준수 이력</AlertDialogTitle>
            <AlertDialogDescription>JVM 프로젝트 원장의 연월·주차별 전체 준수 이력입니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[60dvh] overflow-auto rounded-md border border-slate-300" role="region" aria-label="주간 정산 준수 전체 이력" tabIndex={0}>
            {weeklyComplianceHistory.length > 0 ? (
              <table className="w-full min-w-[780px] border-collapse text-[12px]">
                <caption className="sr-only">주간 정산 대상, 마감기한, 준수 상태, 완료시각과 완료자</caption>
                <thead className="sticky top-0 bg-slate-100"><tr><th className="px-3 py-2 text-left">대상 주차</th><th className="px-3 py-2 text-left">마감기한</th><th className="px-3 py-2 text-left">준수 상태</th><th className="px-3 py-2 text-left">처리 결과</th><th className="px-3 py-2 text-left">완료시각</th><th className="px-3 py-2 text-left">완료자</th></tr></thead>
                <tbody>{weeklyComplianceHistory.map((week) => <tr key={`${week.yearMonth}:${week.weekNo}:${week.operationId || week.status}`} className="border-t border-slate-200"><th className="px-3 py-2 text-left">{week.yearMonth} {week.weekNo}주차</th><td className="px-3 py-2">{formatSheetAppliedAt(week.deadline)}</td><td className="px-3 py-2 font-semibold">{week.status === 'ON_TIME' ? '기한 내 완료' : week.status === 'COMPLETED_LATE' ? '기한 후 완료·미준수' : week.status === 'MISSED' ? '기한 경과·미준수' : '완료 대기'}</td><td className="px-3 py-2">{week.updateResult === 'CHANGED' ? '변경사항 반영 완료' : week.updateResult === 'NO_CHANGES' ? '변경사항 없음' : '-'}</td><td className="px-3 py-2">{formatSheetAppliedAt(week.completedAt) || '-'}</td><td className="px-3 py-2 break-all">{week.completedBy || '-'}</td></tr>)}</tbody>
              </table>
            ) : weeklyComplianceHistoryLoading ? <p role="status" className="p-6 text-center text-[12px] text-slate-500">이력을 불러오는 중입니다.</p> : weeklyComplianceHistoryError ? <div role="alert" className="p-6 text-center text-[12px] text-red-700">{weeklyComplianceHistoryError}<Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void loadWeeklyComplianceHistory()}>다시 시도</Button></div> : <p className="p-6 text-center text-[12px] text-slate-500">저장된 주간 정산 이력이 없습니다.</p>}
          </div>
          {weeklyComplianceNextCursor ? <Button type="button" variant="outline" disabled={weeklyComplianceHistoryLoading} onClick={() => void loadMoreWeeklyComplianceHistory()}>{weeklyComplianceHistoryLoading ? '추가 이력 불러오는 중…' : '이전 이력 더 불러오기'}</Button> : null}
          <AlertDialogFooter><AlertDialogCancel>닫기</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={monthCloseReviewOpen}
        onOpenChange={(open) => {
          if (!monthCloseBusy) setMonthCloseReviewOpen(open);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[620px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{yearMonth} 누적 월결산 승인 요청</AlertDialogTitle>
            <AlertDialogDescription>
              결산 기준과 서버가 고정한 누적 범위를 점검한 뒤 지정 조직장에게 승인을 요청합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-700">
            <div className="flex items-center justify-between gap-4">
              <span>결산 대상</span>
              <strong className="text-slate-950">{yearMonth}</strong>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>시트 데이터</span>
              <strong className="text-[#17324D]">{monthCloseCellsState.error ? '확인 필요' : '준비됨'}</strong>
            </div>
            {cumulativeRequestScopeReady ? <><div className="flex items-center justify-between gap-4"><span>누적 대상 월</span><strong className="text-right text-slate-950">{cumulativeRequestScope.fromMonth} ~ {cumulativeRequestScope.throughMonth}</strong></div><div className="flex items-center justify-between gap-4"><span>서버 고정 범위</span><strong className="text-right text-slate-950">{cumulativeRequestScope.lockRange.fromMonth} {cumulativeRequestScope.lockRange.fromWeekNo}주차 ~ {cumulativeRequestScope.lockRange.throughMonth} {cumulativeRequestScope.lockRange.throughWeekNo}주차</strong></div><div className="flex items-center justify-between gap-4"><span>포함 데이터</span><strong className="text-slate-950">{cumulativeRequestScope.monthCount}개월 · {cumulativeRequestScope.weekCount}주 · {cumulativeRequestScope.cellCount}셀</strong></div><div className="flex items-start justify-between gap-4"><span>저장 대상</span><strong className="text-right text-slate-950">{cumulativeRequestScope.source.spreadsheetTitle || '이름 없음'} · {cumulativeRequestScope.source.selectedSheetName || '탭 이름 없음'}</strong></div></> : <div role="alert" className="text-red-700">서버의 누적 결산 고정 범위와 건수를 확인하지 못했습니다. 다시 불러온 뒤 요청해 주세요.</div>}
            {cumulativeRequestScopeReady && cumulativeRequestScope.source.spreadsheetUrl ? <a href={cumulativeRequestScope.source.spreadsheetUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#17324D] underline">저장 대상 시트 열기</a> : <span className="text-slate-500">저장 대상 시트 링크 없음</span>}
          </div>

          <div className={`rounded-md border px-3 py-3 text-[13px] leading-5 ${monthClosePreparation.status === 'READY' ? 'border-[#C7D3DF] bg-[#EAF0F5] text-[#17324D]' : monthClosePreparation.status === 'STATUS_RETRY_REQUIRED' ? 'border-red-200 bg-red-50 text-red-700' : 'border-[#C7D3DF] bg-[#EAF0F5] text-[#17324D]'}`}>
            <div className="font-bold">{monthClosePreparation.title}</div>
            <div className="mt-1">{monthClosePreparation.detail}</div>
          </div>

          <div className="rounded-md border border-[#C7D3DF] bg-[#EAF0F5] px-3 py-3 text-[13px] leading-5 text-[#17324D]">
            승인하면 위 누적 범위의 모든 주차가 수정 불가 상태로 잠깁니다. 요청 후 승인·반려 전에도 동일 범위는 변경할 수 없습니다.
          </div>

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-[13px] leading-5 text-slate-800">
            <input
              type="checkbox"
              checked={monthCloseHumanReviewed}
              disabled={monthCloseBusy || monthCloseRequestLocked}
              onChange={(event) => setMonthCloseHumanReviewed(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-[#17324D]"
            />
            <span>시트의 값과 일치하는지 직접 확인했습니다.</span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={monthCloseBusy}>닫기</AlertDialogCancel>
            {monthClosePreparation.actionLabel ? (
              <Button
                type="button"
                variant="outline"
                disabled={monthCloseBusy || sheetRefreshLoading}
                onClick={() => void handleMonthClosePreparationAction()}
              >
                {sheetRefreshLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {monthClosePreparation.actionLabel}
              </Button>
            ) : null}
            <AlertDialogAction
               disabled={!cumulativeRequestScopeReady || !yearMonth || !savedExecutiveApproverId || !monthCloseHumanReviewed || monthCloseBusy || monthCloseRequestLocked}
              onClick={(event) => {
                event.preventDefault();
                void handleFinalizeMonthClose();
              }}
            >
              {monthCloseBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              월 결산 승인 요청
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CashflowFormulaMismatchDialog
        issues={formulaMismatchPrompt?.issues || []}
        busy={sheetStageApplyLoading}
        onCancel={() => setFormulaMismatchPrompt(null)}
        onConfirm={() => {
          if (!formulaMismatchPrompt) return;
          const pending = formulaMismatchPrompt;
          setFormulaMismatchPrompt(null);
          void handleApplyStagedSheetValues(pending.stage, pending.closedMonthChangeReason, true);
        }}
      />

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
          <label className="grid gap-2 text-[12px] font-semibold text-slate-700">
            사유
            <textarea
              value={reopenReason}
              className="min-h-[120px] rounded-md border border-slate-200 p-3 text-[12px] font-normal outline-none focus:border-[#17324D]"
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
                ? '고정해 둔 시트 값을 MYSCube 시트와 비교합니다. 저장 버튼을 누르기 전까지 MYSCube 시트는 바뀌지 않습니다.'
                : '시트를 연결하지 않아도 캐시플로우는 조회할 수 있습니다. 기존 시트 값을 가져오려면 아래 순서로 연결해 주세요.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-md border border-[#C7D3DF] bg-[#EAF0F5] p-3 text-[12px] text-[#17324D]" aria-label="Google Sheet 편집자 공유 안내">
            <strong>먼저 서비스 계정을 Google Sheet 편집자로 공유해 주세요.</strong>
            {cashflowSystemAccountEmail ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all rounded bg-white px-2 py-1.5">{cashflowSystemAccountEmail}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(cashflowSystemAccountEmail)}>계정 복사</Button>
              </div>
            ) : <p role={cashflowSystemAccountError ? 'alert' : 'status'} className="mt-2">{cashflowSystemAccountError ? '서비스 계정 이메일을 확인하지 못했습니다. 시트 설정에서 다시 불러와 주세요.' : '서비스 계정 이메일을 불러오는 중입니다.'}</p>}
          </div>

          <div className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-950">
                  <ArrowDownToLine className="h-4 w-4 text-[#17324D]" />
                  {cashflowSheetConfig ? '시트에서 가져오기' : '연동 전 확인사항'}
                </div>
                <div className="mt-1 text-[12px] leading-5 text-slate-600">
                  {cashflowSheetConfig
                    ? '마지막으로 고정한 Projection/Actual 값을 MYSCube 시트에 반영합니다. 이 단계에서는 Google Sheet를 다시 읽지 않습니다.'
                  : '설정 후에도 자동으로 값을 가져오지 않습니다. 시트 설정에서 직접 시트값을 가져올 때만 고정합니다.'}
                </div>
              </div>
              <Badge className={`w-fit rounded-md border px-2.5 py-1 text-[12px] ${sheetMirrorStatus === 'FRESH' ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-[#C7D3DF] bg-[#EAF0F5] text-[#17324D]'}`}>
                {cashflowSheetConfig ? sheetMirrorStatus : '선택 설정'}
              </Badge>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-[#C7D3DF] bg-[#EAF0F5] px-3 py-2 text-[12px] leading-5 text-slate-800">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[#17324D]" />
              <div>
                {cashflowSheetConfig
                  ? `현재 선택: ${sheetMirrorCapturedAt || '최근'} 고정본을 MYSCube 시트에 반영합니다.`
                  : 'Google Sheet는 조회 전용으로 연결되며, 시트 값 반영 버튼을 누를 때만 MYSCube 시트가 바뀝니다.'}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(cashflowSheetConfig ? [
                ['1', '고정본 선택', '명시적으로 연동한 시트 고정본을 사용합니다.'],
                ['2', '시트값 반영', '시트에서 사람이 확인한 최신값을 MYSCube 시트에 바로 반영합니다.'],
                ['3', '변경 이력', '결산 후 변경은 시점과 사유, 경고 횟수를 기록합니다.'],
              ] : [
                ['1', '공유 권한 확인', '연동할 Google Sheet에 조회 권한이 있는지 확인합니다.'],
                ['2', '시트 탭 선택', '사용할 시트 탭을 지정하면 탭 전체를 불러옵니다.'],
                ['3', '명시적으로 불러오기', '설정 후 시트 설정에서 직접 값을 가져와 저장할 값을 확인합니다.'],
              ]).map(([step, title, detail]) => (
                <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[12px] font-bold text-white">{step}</span>
                    <span className="text-[12px] font-bold text-slate-900">{title}</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-4 text-slate-500">{detail}</div>
                </div>
              ))}
            </div>
            <div className={`rounded-md border px-3 py-2 text-[12px] leading-5 ${cashflowSheetConfig ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-[#C7D3DF] bg-[#EAF0F5] text-[#17324D]'}`}>
              {cashflowSheetConfig
                ? `${sheetIdentityLabel} · ${sheetRangeLabel}`
                : '먼저 Google Sheet 공유 권한과 시트 탭을 설정해야 합니다.'}
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
                  시트 값 반영
                </Button>
                <AlertDialogAction onClick={() => void handleStartSheetChangeReview(true)} disabled={sheetRefreshLoading || sheetMirrorStatus !== 'FRESH'} className="bg-[#17324D] hover:bg-slate-800">
                  {sheetRefreshLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  {yearMonth} MYSCube 시트 덮어쓰기
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!lateSheetApply}
        onOpenChange={(open) => {
          if (!open && !sheetStageApplyLoading && !sheetApplyResumeRequired) {
            setLateSheetApply(null);
            setSheetApplyResumeRequired(false);
            setLateSheetChangeReason('');
            setLateSheetFormulaAccepted(false);
          }
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[560px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{sheetApplyResumeRequired ? '시트 반영 이어서 완료' : '마감 후 시트값 변경'}</AlertDialogTitle>
            <AlertDialogDescription>
              {sheetApplyResumeRequired
                ? '이전 반영의 응답을 확인하지 못했습니다. 같은 검토본으로 안전하게 이어서 완료해 주세요.'
                : '이미 결산이 완료된 월의 값이 시트에서 변경되었습니다. 사유를 남기면 변경 이력과 경고 횟수에 함께 기록됩니다. 그래도 반영할까요?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {lateSheetApply && (
            <div className="space-y-3">
              {!sheetApplyResumeRequired && (
                <>
                  <div className={`rounded-md border px-3 py-2 text-[12px] ${lateSheetDiffComplete ? 'border-slate-300 bg-slate-50 text-slate-700' : 'border-red-300 bg-red-50 text-red-800'}`} role={lateSheetDiffComplete ? 'status' : 'alert'}>
                    {lateSheetDiffComplete ? `검토본 manifest와 일치하는 전체 ${lateSheetDiffRows.length.toLocaleString()}건입니다.` : '변경 목록의 manifest 또는 건수가 일치하지 않아 반영할 수 없습니다. 다시 비교해 주세요.'}
                    <span className="ml-2 break-all text-[12px]">{lateSheetApply.closedMonthDifferenceManifestHash || 'manifest 없음'}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Input aria-label="변경 이력 검색" placeholder="월·주·항목 검색" value={lateSheetDiffQuery} onChange={(event) => setLateSheetDiffQuery(event.target.value)} />
                    <select aria-label="Projection Actual 필터" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[12px]" value={lateSheetDiffMode} onChange={(event) => setLateSheetDiffMode(event.target.value)}><option value="ALL">전체 mode</option><option value="projection">Projection</option><option value="actual">Actual</option></select>
                    <select aria-label="월 필터" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[12px]" value={lateSheetDiffMonth} onChange={(event) => setLateSheetDiffMonth(event.target.value)}><option value="ALL">전체 월</option>{[...new Set(lateSheetDiffRows.map((row) => row.yearMonth))].map((month) => <option key={month} value={month}>{month}</option>)}</select>
                    <select aria-label="주차 필터" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[12px]" value={lateSheetDiffWeek} onChange={(event) => setLateSheetDiffWeek(event.target.value)}><option value="ALL">전체 주차</option>{[1, 2, 3, 4, 5].map((weekNo) => <option key={weekNo} value={weekNo}>{weekNo}주차</option>)}</select>
                  </div>
                  <div className="max-h-[300px] overflow-auto rounded-md border border-slate-200 bg-slate-50" role="region" aria-label="마감 후 변경 후보 전체 목록" tabIndex={0}>
                    <table className="w-full min-w-[620px] border-collapse text-[12px] leading-4 text-slate-700">
                      <caption className="sr-only">월, 주차, mode, 항목별 이전값과 변경값</caption>
                      <thead className="sticky top-0 bg-slate-100"><tr><th className="px-2 py-2 text-left">월·주차</th><th className="px-2 py-2 text-left">mode</th><th className="px-2 py-2 text-left">항목</th><th className="px-2 py-2 text-right">이전값 → 변경값</th></tr></thead>
                      <tbody>{filteredLateSheetDiffRows.map((change) => <tr key={`${change.yearMonth}:${change.mode}:${change.weekNo}:${change.lineId}`} className="border-t border-slate-200"><th className="px-2 py-1.5 text-left">{change.yearMonth} {change.weekNo}주차</th><td className="px-2 py-1.5">{change.mode === 'projection' ? 'Projection' : 'Actual'}</td><td className="px-2 py-1.5">{CASHFLOW_SHEET_LINE_LABELS[change.lineId as CashflowSheetLineId] || change.lineId}</td><td className="px-2 py-1.5 text-right tabular-nums"><span className={change.beforeHadValue ? 'text-slate-500' : 'text-slate-400'}>{change.beforeHadValue ? `${fmt(Number(change.beforeAmount || 0))}원` : 'EMPTY'}</span><span className="px-1 text-slate-400">→</span><strong>{change.afterHadValue ? `${fmt(Number(change.afterAmount || 0))}원` : 'EMPTY'}</strong></td></tr>)}</tbody>
                    </table>
                    {filteredLateSheetDiffRows.length === 0 ? <p className="p-5 text-center text-[12px] text-slate-500">필터와 일치하는 변경 후보가 없습니다.</p> : null}
                  </div>
                  <label className="block text-[12px] font-semibold text-slate-800" htmlFor="late-sheet-change-reason">
                    변경 사유
                  </label>
                  <textarea
                    id="late-sheet-change-reason"
                    value={lateSheetChangeReason}
                    onChange={(event) => setLateSheetChangeReason(event.target.value.slice(0, 1000))}
                    placeholder="예: 결산 후 확인된 실제 입금액을 시트 기준으로 정정"
                    className="min-h-[96px] w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] leading-5 text-slate-900 outline-none focus:border-[#17324D] focus:ring-2 focus:ring-[#17324D]/10"
                    disabled={sheetStageApplyLoading}
                  />
                  <div className="text-right text-[12px] text-slate-400">{lateSheetChangeReason.length}/1000</div>
                </>
              )}
            </div>
          )}
          <AlertDialogFooter>
            {!sheetApplyResumeRequired && (
              <AlertDialogCancel disabled={sheetStageApplyLoading}>취소</AlertDialogCancel>
            )}
            <Button
              type="button"
              className="bg-[#17324D] hover:bg-slate-800"
              disabled={sheetStageApplyLoading || !lateSheetApply || (!sheetApplyResumeRequired && (!lateSheetChangeReason.trim() || !lateSheetDiffComplete))}
              onClick={() => lateSheetApply && void handleApplyStagedSheetValues(
                lateSheetApply,
                lateSheetChangeReason.trim(),
                lateSheetFormulaAccepted,
              )}
            >
              {sheetStageApplyLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              {sheetApplyResumeRequired ? '같은 작업 이어서 완료' : '사유와 함께 반영'}
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
             <AlertDialogTitle>저장되지 않은 변경사항이 있습니다</AlertDialogTitle>
             <AlertDialogDescription>
               페이지를 이동하면 아직 최종저장하지 않은 현금흐름 입력값이 사라집니다.
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
               저장하지 않고 이동
             </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    {sheetRefreshLoading ? <CashflowSheetSyncOverlay operation="refresh" /> : null}
    </>
  );
}
