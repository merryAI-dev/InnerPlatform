import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, GripVertical, Loader2, MessageSquare, Plus, RotateCcw, Save, Send, Upload, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipboardEvent, KeyboardEvent, MouseEvent } from 'react';
import { toast } from 'sonner';
import { BUDGET_CODE_BOOK } from '../../data/budget-data';
import type { BudgetCodeEntry, Comment, Transaction, TransactionState } from '../../data/types';
import { findWeekForDate, getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { parseDate, parseNumber, triggerDownload } from '../../platform/csv-utils';
import { computeEvidenceStatus, computeEvidenceSummary, isValidDriveUrl } from '../../platform/evidence-helpers';
import {
  buildDriveTransactionFolderName,
  EVIDENCE_DOCUMENT_CATEGORIES,
  inferEvidenceCategoryFromFileName,
  suggestEvidenceUploadFileName,
} from '../../platform/drive-evidence';
import {
  CASHFLOW_LINE_OPTIONS,
  SETTLEMENT_COLUMNS, SETTLEMENT_COLUMN_GROUPS,
  createEmptyImportRow,
  parseCashflowLineLabel,
  importRowToTransaction,
  transactionsToImportRows,
  type ImportRow,
} from '../../platform/settlement-csv';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Textarea } from '../ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

// ── Helpers ──

const fmt = (n: number | undefined) =>
  n != null && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';

const METHOD_LABELS: Record<string, string> = {
  TRANSFER: '계좌이체',
  CORP_CARD_1: '사업비카드',
  CORP_CARD_2: '개인법인카드',
  OTHER: '기타',
};

const METHOD_OPTIONS = Object.entries(METHOD_LABELS).map(([v, l]) => ({ value: v, label: l }));
const CASHFLOW_IN_LINE_IDS = new Set([
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
]);

function normalizeBudgetLabel(value: string): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
}

function formatBudgetCodeLabel(index: number, name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return `${index + 1}`;
  return `${index + 1} ${trimmed}`;
}

function formatSubCodeLabel(codeIndex: number, subIndex: number, name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return `${codeIndex + 1}-${subIndex + 1}`;
  return `${codeIndex + 1}-${subIndex + 1} ${trimmed}`;
}

function toFieldSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCommentThreadKey(transactionId: string, fieldKey: string): string {
  return `${transactionId}::${fieldKey}`;
}

function buildSheetRowCommentId(tempId: string): string {
  return `sheet-row:${tempId}`;
}

function formatCommentTime(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '';
}

function readImportDraftCache(cacheKey: string): ImportRow[] | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: ImportRow[] } | null;
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}

function writeImportDraftCache(cacheKey: string, rows: ImportRow[]): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ rows }));
  } catch {
    // Ignore browser storage quota errors during local draft caching.
  }
}

function clearImportDraftCache(cacheKey: string): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function serializeImportRows(rows: ImportRow[] | null | undefined): string {
  if (!rows || rows.length === 0) return '';
  try {
    return JSON.stringify(rows);
  } catch {
    return String(rows.length);
  }
}

function normalizeMethodValue(value: string | undefined): string {
  if (!value) return '';
  if (value === 'BANK_TRANSFER') return 'TRANSFER';
  if (value === 'CARD') return 'CORP_CARD_1';
  if (value === 'CASH' || value === 'CHECK') return 'OTHER';
  return value;
}

function parseContentStatusNote(value: string): { status: '' | '미완료' | '완료'; text: string } {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^\[(미완료|완료)\]\s*(.*)$/);
  if (!match) return { status: '', text: trimmed };
  return { status: match[1] as '미완료' | '완료', text: match[2] || '' };
}

function composeContentStatusNote(status: '' | '미완료' | '완료', text: string): string {
  const body = String(text || '').trim();
  if (!status) return body;
  return body ? `[${status}] ${body}` : `[${status}]`;
}

interface QuickExpenseTemplate {
  id: string;
  label: string;
  methodLabel: string;
  cashflowLabel: string;
  counterparty: string;
  memo: string;
}

const QUICK_EXPENSE_TEMPLATES: QuickExpenseTemplate[] = [
  { id: 'communication', label: '통신비', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '통신비', memo: '정기지출: 통신비' },
  { id: 'rent', label: '임차료', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '임차료', memo: '정기지출: 임차료' },
  { id: 'utility', label: '공과금', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '공과금', memo: '정기지출: 공과금' },
  { id: 'insurance', label: '보험료', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '보험료', memo: '정기지출: 보험료' },
];

function derivePendingEvidence(requiredDesc: string, completedDesc: string): string {
  const required = String(requiredDesc || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (required.length === 0) return '';
  const completed = String(completedDesc || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return required
    .filter((item) => !completed.some((done) => done.includes(item.toLowerCase())))
    .join(', ');
}
const TX_STATE_BADGE: Record<TransactionState, { label: string; cls: string }> = {
  DRAFT: { label: '작성중', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  SUBMITTED: { label: '제출', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  APPROVED: { label: '승인', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  REJECTED: { label: '반려', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

function isEditable(state: TransactionState | undefined): boolean {
  return !state || state === 'DRAFT' || state === 'REJECTED';
}

function resolveEvidenceRequiredDesc(
  map: Record<string, string> | undefined,
  budgetCode: string,
  subCode: string,
): string {
  if (!map) return '';
  const direct = map[`${budgetCode}|${subCode}`] || map[subCode] || map[budgetCode] || '';
  if (direct) return direct;
  const normBudget = normalizeBudgetLabel(budgetCode);
  const normSub = normalizeBudgetLabel(subCode);
  return map[`${normBudget}|${normSub}`] || map[normSub] || map[normBudget] || '';
}

function resolveWeekFromLabel(label: string, yearWeeks: MonthMondayWeek[]): MonthMondayWeek | undefined {
  const fromYear = yearWeeks.find((w) => w.label === label);
  if (fromYear) return fromYear;
  const m = label.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  const year = 2000 + Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const weekNo = Number.parseInt(m[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return undefined;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return getMonthMondayWeeks(yearMonth).find((w) => w.weekNo === weekNo);
}

interface ActiveCommentAnchor {
  transactionId: string;
  fieldKey: string;
  fieldLabel: string;
  rowLabel: string;
}

function CellCommentButton({
  count,
  disabled,
  onClick,
}: {
  count: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={disabled ? '저장 후 메모를 남길 수 있습니다' : '셀 메모 열기'}
      aria-label="셀 메모 열기"
      disabled={disabled}
      className={`absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-md border text-[10px] transition ${
        count > 0
          ? 'border-amber-300 bg-amber-50 text-amber-700 opacity-100'
          : 'border-transparent bg-background/90 text-muted-foreground opacity-0 group-hover:opacity-100'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-border hover:text-foreground'}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function CommentThreadSheet({
  anchor,
  comments,
  open,
  projectId,
  currentUserId,
  currentUserName,
  onClose,
  onAddComment,
}: {
  anchor: ActiveCommentAnchor | null;
  comments: Comment[];
  open: boolean;
  projectId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onAddComment?: (comment: Comment) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setDraft('');
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!anchor || !onAddComment) return;
    const content = draft.trim();
    if (!content) return;

    setSaving(true);
    try {
      const isSheetRowComment = anchor.transactionId.startsWith('sheet-row:');
      await onAddComment({
        id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        transactionId: anchor.transactionId,
        projectId,
        targetType: isSheetRowComment ? 'expense_sheet_row' : 'transaction',
        ...(isSheetRowComment ? { sheetRowId: anchor.transactionId } : {}),
        authorId: currentUserId || currentUserName,
        authorName: currentUserName,
        fieldKey: anchor.fieldKey,
        fieldLabel: anchor.fieldLabel,
        content,
        createdAt: new Date().toISOString(),
      });
      setDraft('');
      toast.success('메모를 남겼습니다.');
    } catch (error) {
      console.error('[SettlementLedger] add comment failed:', error);
      toast.error('메모 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [anchor, currentUserId, currentUserName, draft, onAddComment, projectId]);

  return (
    <Sheet modal={false} open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent side="right" showOverlay={false} className="w-[420px] sm:max-w-[420px] gap-0">
        <SheetHeader className="border-b">
          <SheetTitle className="text-[14px]">셀 메모</SheetTitle>
          <SheetDescription className="text-[11px]">
            {anchor ? `${anchor.rowLabel} · ${anchor.fieldLabel}` : '메모를 남길 셀을 선택하세요.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {comments.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-[12px] text-muted-foreground">
              아직 메모가 없습니다. 아래 입력창에 첫 메모를 남겨보세요.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border bg-background px-3 py-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{comment.authorName}</span>
                    <span className="text-[10px] text-muted-foreground">{formatCommentTime(comment.createdAt)}</span>
                  </div>
                  {comment.fieldLabel && (
                    <Badge variant="secondary" className="mt-2 text-[9px]">{comment.fieldLabel}</Badge>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5">{comment.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t px-4 py-4 space-y-2">
          <Textarea
            value={draft}
            placeholder="이 셀에 남길 메모를 적어주세요"
            className="min-h-24 text-[12px]"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">Cmd/Ctrl + Enter로 저장</span>
            <Button size="sm" className="h-8 text-[11px]" disabled={!draft.trim() || saving || !anchor || !onAddComment} onClick={() => void handleSubmit()}>
              {saving ? '저장중...' : '메모 남기기'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Types ──

interface WeekBucket {
  week: MonthMondayWeek;
  transactions: Transaction[];
  collapsed: boolean;
}

export interface SettlementLedgerProps {
  projectId: string;
  projectName: string;
  transactions: Transaction[];
  defaultLedgerId: string;
  onAddTransaction: (tx: Transaction) => void;
  onUpdateTransaction: (id: string, updates: Partial<Transaction>) => void;
  evidenceRequiredMap?: Record<string, string>;
  onSaveEvidenceRequiredMap?: (map: Record<string, string>) => void | Promise<void>;
  saving?: boolean;
  sheetRows?: ImportRow[] | null;
  onSaveSheetRows?: (rows: ImportRow[]) => void | Promise<void>;
  autoSaveSheet?: boolean;
  authorOptions?: string[];
  budgetCodeBook?: BudgetCodeEntry[];
  hideYearControls?: boolean;
  hideCountBadge?: boolean;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void;
  /** Current user name for audit trail */
  currentUserName?: string;
  currentUserId?: string;
  userRole?: 'pm' | 'admin';
  comments?: Comment[];
  onAddComment?: (comment: Comment) => void | Promise<void>;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onUploadEvidenceDrive?: (tx: Transaction, uploads: EvidenceUploadSelection[]) => void | Promise<void>;
  onEnsureTransactionPersisted?: (input: {
    transaction: Transaction;
    sourceTxId?: string;
  }) => Promise<string | null>;
}

export interface EvidenceUploadSelection {
  file: File;
  category: string;
  parserCategory: string;
  reviewedFileName: string;
}

// ── Main Component ──

export function SettlementLedgerPage({
  projectId,
  projectName,
  transactions: allTransactions,
  defaultLedgerId,
  onAddTransaction,
  onUpdateTransaction,
  evidenceRequiredMap,
  onSaveEvidenceRequiredMap,
  sheetRows,
  onSaveSheetRows,
  autoSaveSheet = false,
  authorOptions,
  budgetCodeBook,
  hideYearControls = false,
  hideCountBadge = false,
  onSubmitWeek,
  onChangeTransactionState,
  currentUserName = 'PM',
  currentUserId = 'pm',
  userRole = 'pm',
  comments = [],
  onAddComment,
  onProvisionEvidenceDrive,
  onSyncEvidenceDrive,
  onUploadEvidenceDrive,
  onEnsureTransactionPersisted,
}: SettlementLedgerProps) {
  const { upsertWeekAmounts } = useCashflowWeeks();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importDirty, setImportDirty] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState('');
  const [downloadFrom, setDownloadFrom] = useState('');
  const [downloadTo, setDownloadTo] = useState('');
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const restoredDraftCacheKeyRef = useRef('');
  const lastSyncedSheetRowsSignatureRef = useRef('');
  const cloneImportRows = useCallback((input: ImportRow[]) => (
    input.map((row) => ({ ...row, cells: [...row.cells] }))
  ), []);
  const resolvedBudgetBook = useMemo(
    () => (budgetCodeBook && budgetCodeBook.length ? budgetCodeBook : BUDGET_CODE_BOOK),
    [budgetCodeBook],
  );

  // All weeks for the year
  const yearWeeks = useMemo(() => getYearMondayWeeks(year), [year]);
  const draftCacheKey = useMemo(
    () => `settlement-import-draft:${projectId}:${defaultLedgerId}:${year}`,
    [projectId, defaultLedgerId, year],
  );

  // Filter transactions for this project + year
  const projectTxs = useMemo(() => {
    const yearStr = String(year);
    return allTransactions.filter(
      (tx) => tx.projectId === projectId && (!tx.dateTime || tx.dateTime.startsWith(yearStr)),
    );
  }, [allTransactions, projectId, year]);

  useEffect(() => {
    if (importDirty) return;
    if (restoredDraftCacheKeyRef.current !== draftCacheKey) {
      const cachedRows = readImportDraftCache(draftCacheKey);
      if (cachedRows && cachedRows.length > 0) {
        restoredDraftCacheKeyRef.current = draftCacheKey;
        setImportRows(cachedRows);
        setImportDirty(true);
        toast.message('브라우저 임시 저장본을 복원했습니다.');
        return;
      }
    }
    if (sheetRows && sheetRows.length > 0) {
      setImportRows(cloneImportRows(sheetRows));
      return;
    }
    setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
  }, [projectTxs, yearWeeks, importDirty, sheetRows, cloneImportRows, draftCacheKey]);

  useEffect(() => {
    if (!importDirty || !importRows || importRows.length === 0) return;
    const timer = window.setTimeout(() => {
      writeImportDraftCache(draftCacheKey, importRows);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftCacheKey, importDirty, importRows]);

  useEffect(() => {
    const nextSignature = serializeImportRows(sheetRows);
    if (nextSignature === lastSyncedSheetRowsSignatureRef.current) return;
    lastSyncedSheetRowsSignatureRef.current = nextSignature;

    if (sheetRows && sheetRows.length > 0) {
      setImportRows(cloneImportRows(sheetRows));
      setImportDirty(false);
      clearImportDraftCache(draftCacheKey);
      return;
    }

    if (nextSignature === '') {
      setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
      setImportDirty(false);
      clearImportDraftCache(draftCacheKey);
    }
  }, [sheetRows, cloneImportRows, draftCacheKey, projectTxs, yearWeeks]);

  const revertToSavedSnapshot = useCallback(() => {
    if (sheetSaving) return;
    if (sheetRows && sheetRows.length > 0) {
      setImportRows(cloneImportRows(sheetRows));
      setImportDirty(false);
      clearImportDraftCache(draftCacheKey);
      toast.message('마지막 저장값으로 되돌렸습니다.');
      return;
    }
    setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
    setImportDirty(false);
    clearImportDraftCache(draftCacheKey);
    toast.message('저장된 사업비 입력이 없어 기본값으로 되돌렸습니다.');
  }, [sheetSaving, sheetRows, cloneImportRows, projectTxs, yearWeeks, draftCacheKey]);

  const handleRevertToSaved = useCallback(() => {
    if (sheetSaving) return;
    setRevertConfirmOpen(true);
  }, [sheetSaving]);

  const handleConfirmRevert = useCallback(() => {
    setRevertConfirmOpen(false);
    revertToSavedSnapshot();
  }, [revertToSavedSnapshot]);

  const revertConfirmDialog = (
    <AlertDialog open={revertConfirmOpen} onOpenChange={setRevertConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>저장된 값으로 되돌리기</AlertDialogTitle>
          <AlertDialogDescription>
            현재 편집 중인 내용은 버리고, 마지막으로 저장된 사업비 입력(주간) 값으로 복원합니다.
            <span className="mt-1 block font-medium text-rose-600 dark:text-rose-400">
              저장하지 않은 기존 입력 내용은 되돌리기 시 날아갑니다.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmRevert}>되돌리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Group transactions by week
  const weekBuckets: WeekBucket[] = useMemo(() => {
    const txByWeek = new Map<string, Transaction[]>();
    for (const w of yearWeeks) txByWeek.set(w.label, []);
    const unmatchedWeek: MonthMondayWeek = {
      yearMonth: '',
      weekNo: 0,
      weekStart: '',
      weekEnd: '',
      label: '미지정',
    };
    txByWeek.set(unmatchedWeek.label, []);

    for (const tx of projectTxs) {
      const d = tx.dateTime.slice(0, 10);
      const w = findWeekForDate(d, yearWeeks);
      const key = w?.label || unmatchedWeek.label;
      txByWeek.get(key)!.push(tx);
    }

    const buckets = yearWeeks.map((week) => ({
      week,
      transactions: (txByWeek.get(week.label) || []).sort((a, b) =>
        a.dateTime.localeCompare(b.dateTime),
      ),
      collapsed: collapsedWeeks.has(week.label),
    }));
    const unmatchedTxs = txByWeek.get(unmatchedWeek.label) || [];
    if (unmatchedTxs.length > 0) {
      buckets.push({
        week: unmatchedWeek,
        transactions: unmatchedTxs.sort((a, b) => a.dateTime.localeCompare(b.dateTime)),
        collapsed: collapsedWeeks.has(unmatchedWeek.label),
      });
    }
    return buckets;
  }, [yearWeeks, projectTxs, collapsedWeeks]);

  const resolveWeekLabelFromDate = useCallback((dateStr: string): string => {
    if (!dateStr) return '';
    const y = Number.parseInt(dateStr.slice(0, 4), 10);
    if (!Number.isFinite(y)) return '';
    const weeksForYear = getYearMondayWeeks(y);
    return findWeekForDate(dateStr, weeksForYear)?.label || '';
  }, []);

  const weekOptions = useMemo(() => {
    const dateIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
    const years = new Set<number>();
    if (importRows && dateIdx >= 0) {
      for (const row of importRows) {
        const raw = String(row.cells[dateIdx] || '').trim();
        if (!raw) continue;
        const datePart = raw.split(/\s+/)[0];
        const iso = parseDate(datePart) || '';
        const year = Number.parseInt(iso.slice(0, 4), 10);
        if (Number.isFinite(year)) years.add(year);
      }
    }
    if (years.size === 0) years.add(year);
    const options: { value: string; label: string }[] = [];
    Array.from(years).sort().forEach((y) => {
      const weeks = getYearMondayWeeks(y);
      weeks.forEach((w) => {
        options.push({ value: w.label, label: w.label });
      });
    });
    return options;
  }, [importRows, year]);

  // Auto-collapse empty weeks on year change
  useEffect(() => {
    const empty = new Set<string>();
    for (const b of weekBuckets) {
      if (b.transactions.length === 0) empty.add(b.week.label);
    }
    setCollapsedWeeks(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, projectTxs.length]);

  const toggleWeek = useCallback((label: string) => {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedWeeks(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsedWeeks(new Set(yearWeeks.map((w) => w.label)));
  }, [yearWeeks]);

  const buildExportMatrix = useCallback(() => {
    const headerRow = SETTLEMENT_COLUMN_GROUPS.map((g) => g.name).flatMap((name, i) => {
      const colSpan = SETTLEMENT_COLUMN_GROUPS[i].colSpan;
      return [name, ...Array(colSpan - 1).fill('')];
    });
    const columnRow = SETTLEMENT_COLUMNS.map((c) => c.csvHeader);
    const sourceRows = importRows || transactionsToImportRows(projectTxs, yearWeeks);
    const dateIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
    const dataRows = sourceRows
      .filter((row) => {
        if (dateIdx < 0 || (!downloadFrom && !downloadTo)) return true;
        const raw = String(row.cells[dateIdx] || '').trim();
        const iso = raw ? (parseDate(raw.split(/\s+/)[0]) || '') : '';
        if (!iso) return true;
        if (downloadFrom && iso < downloadFrom) return false;
        if (downloadTo && iso > downloadTo) return false;
        return true;
      })
      .map((row) => row.cells.map((c) => c ?? ''));
    return [headerRow, columnRow, ...dataRows];
  }, [downloadFrom, downloadTo, importRows, projectTxs, yearWeeks]);

  // ── Excel Download ──
  const handleDownload = useCallback(async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('정산대장');
    const matrix = buildExportMatrix();
    matrix.forEach((row) => ws.addRow(row));
    ws.getRow(1).font = { bold: true };
    ws.getRow(2).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob(
      [buffer],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    triggerDownload(blob, `정산대장_${projectName}_${year}.xlsx`);
  }, [buildExportMatrix, projectName, year]);

  

  const handleImportSave = useCallback(async (options?: { silent?: boolean }) => {
    if (!importRows) return;
    if (!onSaveSheetRows) {
      toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    const silent = options?.silent ?? false;
    setSheetSaving(true);
    try {
      await onSaveSheetRows(importRows);
      const weekIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '해당 주차');
      const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'cashflow항목');
      const depositIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '입금액(사업비,공급가액,은행이자)');
      const refundIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '매입부가세 반환');
      const expenseIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '사업비 사용액');
      const vatInIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '매입부가세');
      const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');

      const byWeek = new Map<string, Record<string, number>>();
      const weekLabels = new Set<string>();
      const targetYears = new Set<number>([year]);
      const dateIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
      const collectWeekLabels = (rows: ImportRow[] | null | undefined) => {
        if (!rows) return;
        for (const row of rows) {
          const label = weekIdx >= 0 ? (row.cells[weekIdx] || '').trim() : '';
          if (label) weekLabels.add(label);
        }
      };
      const collectYearsFromRows = (rows: ImportRow[] | null | undefined) => {
        if (!rows || dateIdx < 0) return;
        for (const row of rows) {
          const raw = String(row.cells[dateIdx] || '').trim();
          if (!raw) continue;
          const datePart = raw.split(/\s+/)[0];
          const iso = parseDate(datePart);
          if (!iso) continue;
          const y = Number.parseInt(iso.slice(0, 4), 10);
          if (Number.isFinite(y)) targetYears.add(y);
        }
      };

      // Snapshot sync rule:
      // - Current edited rows define latest truth.
      // - Previously saved rows are also included as clear targets so removed weeks are zeroed out.
      collectWeekLabels(importRows);
      collectWeekLabels(sheetRows || null);
      collectYearsFromRows(importRows);
      collectYearsFromRows(sheetRows || null);

      for (const weekLabel of weekLabels) {
        const week = resolveWeekFromLabel(weekLabel, yearWeeks);
        if (!week?.yearMonth) continue;
        const y = Number.parseInt(week.yearMonth.slice(0, 4), 10);
        if (Number.isFinite(y)) targetYears.add(y);
      }

      for (const row of importRows) {
        const weekLabel = weekIdx >= 0 ? row.cells[weekIdx] || '' : '';
        const cashflowLabel = cashflowIdx >= 0 ? row.cells[cashflowIdx] || '' : '';
        if (!weekLabel || !cashflowLabel) continue;
        const lineId = parseCashflowLineLabel(cashflowLabel);
        if (!lineId) continue;
        if (lineId === 'INPUT_VAT_OUT') continue;
        const target = byWeek.get(weekLabel) || {};
        const bankAmount = bankAmountIdx >= 0 ? (parseNumber(row.cells[bankAmountIdx]) ?? 0) : 0;
        const amount = bankAmount;
        if (amount !== 0) {
          target[lineId] = (target[lineId] || 0) + amount;
          byWeek.set(weekLabel, target);
        }
      }


      let cashflowFailed = false;
      const cleared: Partial<Record<string, number>> = {};
      for (const lineId of CASHFLOW_ALL_LINES) {
        cleared[lineId] = 0;
      }

      const targetWeeks: MonthMondayWeek[] = [];
      const seenWeekIds = new Set<string>();
      for (const targetYear of Array.from(targetYears)) {
        const weeks = getYearMondayWeeks(targetYear);
        for (const w of weeks) {
          const key = `${w.yearMonth}-${w.weekNo}`;
          if (seenWeekIds.has(key)) continue;
          seenWeekIds.add(key);
          targetWeeks.push(w);
        }
      }

      await Promise.all(
        targetWeeks.map(async (week) => {
          const amounts = byWeek.get(week.label) || {};
          const merged = { ...cleared, ...amounts };
          try {
            await upsertWeekAmounts({
              projectId,
              yearMonth: week.yearMonth,
              weekNo: week.weekNo,
              mode: 'actual',
              amounts: merged as any,
            });
          } catch (err) {
            cashflowFailed = true;
            console.error('[SettlementLedger] cashflow actual update failed:', err);
          }
        }),
      );

      setImportDirty(false);
      clearImportDraftCache(draftCacheKey);
      setLastAutoSavedAt(new Date().toISOString());
      if (cashflowFailed) {
        if (!silent) {
          toast.message('정산대장은 저장되었지만 캐시플로 업데이트에 실패했습니다.');
        }
      } else {
        if (!silent) {
          toast.success('정산대장을 저장했습니다.');
        }
      }
    } catch (err) {
      console.error('[SettlementLedger] save sheet failed:', err);
      if (!silent) {
        toast.error('정산대장 저장에 실패했습니다.');
      }
    } finally {
      setSheetSaving(false);
    }
  }, [draftCacheKey, importRows, onSaveSheetRows, upsertWeekAmounts, projectId, yearWeeks, sheetRows]);

  useEffect(() => {
    if (!autoSaveSheet || !importDirty || !importRows || !onSaveSheetRows || sheetSaving) return;
    const timer = window.setTimeout(() => {
      void handleImportSave({ silent: true });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [autoSaveSheet, importDirty, importRows, onSaveSheetRows, sheetSaving, handleImportSave]);

  // ── Inline edit handler with audit trail ──
  const handleUpdateTx = useCallback(
    (txId: string, updates: Partial<Transaction>) => {
      const existing = allTransactions.find((t) => t.id === txId);
      if (!existing) {
        onUpdateTransaction(txId, updates);
        return;
      }

      const normalizedUpdates: Partial<Transaction> = { ...updates };
      if (typeof normalizedUpdates.dateTime === 'string') {
        normalizedUpdates.weekCode = resolveWeekLabelFromDate(normalizedUpdates.dateTime.slice(0, 10));
      }

      // Build edit history entries for changed fields
      const now = new Date().toISOString();
      const newEntries: NonNullable<Transaction['editHistory']> = [];
      for (const [key, newValue] of Object.entries(normalizedUpdates)) {
        const oldValue = (existing as Record<string, unknown>)[key];
        if (oldValue !== newValue) {
          newEntries.push({
            field: key,
            before: oldValue,
            after: newValue,
            editedBy: currentUserName,
            editedAt: now,
          });
        }
      }

      const enhancedUpdates: Partial<Transaction> = {
        ...normalizedUpdates,
        updatedAt: now,
        updatedBy: currentUserName,
      };

      if (newEntries.length > 0) {
        enhancedUpdates.editHistory = [
          ...(existing.editHistory || []),
          ...newEntries,
        ];
      }

      onUpdateTransaction(txId, enhancedUpdates);
    },
    [allTransactions, onUpdateTransaction, currentUserName, resolveWeekLabelFromDate],
  );

  const handleProvisionEvidenceDriveById = useCallback(async (txId: string) => {
    if (!onProvisionEvidenceDrive) return;
    const tx = allTransactions.find((item) => item.id === txId);
    if (!tx) {
      toast.error('먼저 저장된 거래에서 사용하세요.');
      return;
    }
    await onProvisionEvidenceDrive(tx);
  }, [allTransactions, onProvisionEvidenceDrive]);

  const handleSyncEvidenceDriveById = useCallback(async (txId: string) => {
    if (!onSyncEvidenceDrive) return;
    const tx = allTransactions.find((item) => item.id === txId);
    if (!tx) {
      toast.error('먼저 저장된 거래에서 사용하세요.');
      return;
    }
    await onSyncEvidenceDrive(tx);
  }, [allTransactions, onSyncEvidenceDrive]);

  const handleUploadEvidenceDriveById = useCallback(async (txId: string, uploads: EvidenceUploadSelection[]) => {
    if (!onUploadEvidenceDrive) return;
    const tx = allTransactions.find((item) => item.id === txId);
    if (!tx) {
      toast.error('먼저 저장된 거래에서 사용하세요.');
      return;
    }
    await onUploadEvidenceDrive(tx, uploads);
  }, [allTransactions, onUploadEvidenceDrive]);

  // Row numbering
  let globalRowNum = 0;

  const totalCount = projectTxs.length;

  const viewMode: 'sheet' | 'weekly' = 'sheet';

  if (viewMode === 'sheet') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {!hideYearControls && (
              <>
                <Button variant="outline" size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={() => setYear((y) => y - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold min-w-[60px] text-center">{year}년</span>
                <Button variant="outline" size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={() => setYear((y) => y + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            {!hideCountBadge && (
              <Badge variant="secondary" className="ml-2 text-[11px]">
                {totalCount}건
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={downloadFrom}
              onChange={(e) => setDownloadFrom(e.target.value)}
              className="h-8 rounded-md border px-2 text-[11px] bg-background"
              title="다운로드 시작일"
            />
            <input
              type="date"
              value={downloadTo}
              onChange={(e) => setDownloadTo(e.target.value)}
              className="h-8 rounded-md border px-2 text-[11px] bg-background"
              title="다운로드 종료일"
            />
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer shadow-sm hover:bg-muted/40"
              onClick={handleDownload}
            >
              <Download className="h-4 w-4 mr-1" />
              엑셀 다운로드
            </Button>
            {autoSaveSheet && (
              <span className="text-[10px] text-muted-foreground">
                {sheetSaving ? '자동 저장 중...' : lastAutoSavedAt ? `자동 저장 ${formatCommentTime(lastAutoSavedAt)}` : '자동 저장 대기'}
              </span>
            )}
          </div>
        </div>

        {importRows && (
          <ImportEditor
            rows={importRows}
            onChange={(rows) => {
              setImportRows(rows);
              setImportDirty(true);
            }}
            onSave={handleImportSave}
            saving={sheetSaving}
            onCancel={handleRevertToSaved}
            projectId={projectId}
            defaultLedgerId={defaultLedgerId}
            evidenceRequiredMap={evidenceRequiredMap}
            onSaveEvidenceRequiredMap={onSaveEvidenceRequiredMap}
            authorOptions={authorOptions}
            budgetCodeBook={resolvedBudgetBook}
            weekOptions={weekOptions}
            inline
            comments={comments}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAddComment={onAddComment}
            onProvisionEvidenceDriveById={handleProvisionEvidenceDriveById}
            onSyncEvidenceDriveById={handleSyncEvidenceDriveById}
            onUploadEvidenceDriveById={handleUploadEvidenceDriveById}
            onEnsureTransactionPersisted={onEnsureTransactionPersisted}
            sourceTransactions={allTransactions}
          />
        )}
        {revertConfirmDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {!hideYearControls && (
            <>
              <Button variant="outline" size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={() => setYear((y) => y - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold min-w-[60px] text-center">{year}년</span>
              <Button variant="outline" size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={() => setYear((y) => y + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
          {!hideCountBadge && (
            <Badge variant="secondary" className="ml-2 text-[11px]">
              {totalCount}건
            </Badge>
          )}
        </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
            className="cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={expandAll}
          >
            전체 펼치기
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={collapseAll}
          >
            전체 접기
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={handleDownload}
            >
              <Download className="h-4 w-4 mr-1" />
              엑셀 다운로드
            </Button>
            <input
              type="date"
              value={downloadFrom}
              onChange={(e) => setDownloadFrom(e.target.value)}
              className="h-8 rounded-md border px-2 text-[11px] bg-background"
              title="다운로드 시작일"
            />
            <input
              type="date"
              value={downloadTo}
              onChange={(e) => setDownloadTo(e.target.value)}
              className="h-8 rounded-md border px-2 text-[11px] bg-background"
              title="다운로드 종료일"
            />
            {autoSaveSheet && (
              <span className="text-[10px] text-muted-foreground">
                {sheetSaving ? '자동 저장 중...' : lastAutoSavedAt ? `자동 저장 ${formatCommentTime(lastAutoSavedAt)}` : '자동 저장 대기'}
              </span>
            )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="relative w-full overflow-x-auto border rounded-lg">
        <table className="w-full text-[11px] border-collapse table-fixed">
          {/* Group header row */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 dark:bg-slate-800">
              {SETTLEMENT_COLUMN_GROUPS.map((g) => (
                <th
                  key={g.name}
                  colSpan={g.colSpan}
                  className="px-2 py-1.5 text-center font-bold border-b border-r text-[10px] text-slate-600 dark:text-slate-300 uppercase tracking-wide"
                >
                  {g.name}
                </th>
              ))}
            </tr>
            {/* Column header row */}
            <tr className="bg-slate-50 dark:bg-slate-900">
              {SETTLEMENT_COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className={`px-2 py-1.5 font-medium border-b border-r whitespace-nowrap text-[10px] ${col.format === 'number' ? 'text-right' : 'text-left'
                    }`}
                >
                  {col.csvHeader}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekBuckets.map((bucket) => {
              const { week, transactions: txs, collapsed } = bucket;
              const weekTxCount = txs.length;

              // Accumulate row numbers even when collapsed
              const rows = txs.map((tx) => {
                globalRowNum++;
                return { tx, rowNum: globalRowNum };
              });

              return (
                <WeekSection
                  key={week.label}
                  week={week}
                  txRows={rows}
                  collapsed={collapsed}
                  txCount={weekTxCount}
                  onToggle={() => toggleWeek(week.label)}
                  onUpdateTx={handleUpdateTx}
                  onProvisionEvidenceDrive={onProvisionEvidenceDrive}
                  onSyncEvidenceDrive={onSyncEvidenceDrive}
                  onSubmitWeek={onSubmitWeek}
                  onChangeTransactionState={onChangeTransactionState}
                  userRole={userRole}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Import Editor (editable preview) ── */}
      {importRows !== null && (
        <ImportEditor
          rows={importRows}
          onChange={(rows) => {
            setImportRows(rows);
            setImportDirty(true);
          }}
          onSave={handleImportSave}
          saving={sheetSaving}
          onCancel={handleRevertToSaved}
          projectId={projectId}
          defaultLedgerId={defaultLedgerId}
          evidenceRequiredMap={evidenceRequiredMap}
          onSaveEvidenceRequiredMap={onSaveEvidenceRequiredMap}
          authorOptions={authorOptions}
          budgetCodeBook={resolvedBudgetBook}
          weekOptions={weekOptions}
          comments={comments}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onAddComment={onAddComment}
          onProvisionEvidenceDriveById={handleProvisionEvidenceDriveById}
          onSyncEvidenceDriveById={handleSyncEvidenceDriveById}
          onUploadEvidenceDriveById={handleUploadEvidenceDriveById}
          onEnsureTransactionPersisted={onEnsureTransactionPersisted}
          sourceTransactions={allTransactions}
        />
      )}
      {revertConfirmDialog}
    </div>
  );
}

// ── Week Section ──

interface WeekSectionProps {
  week: MonthMondayWeek;
  txRows: { tx: Transaction; rowNum: number }[];
  collapsed: boolean;
  txCount: number;
  onToggle: () => void;
  onUpdateTx: (txId: string, updates: Partial<Transaction>) => void;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void;
  userRole?: 'pm' | 'admin';
}

function WeekSection({
  week,
  txRows,
  collapsed,
  txCount,
  onToggle,
  onUpdateTx,
  onProvisionEvidenceDrive,
  onSyncEvidenceDrive,
  onSubmitWeek,
  onChangeTransactionState,
  userRole,
}: WeekSectionProps) {
  const [submitting, setSubmitting] = useState(false);
  const colCount = SETTLEMENT_COLUMNS.length;
  const draftTxIds = txRows.filter(({ tx }) => tx.state === 'DRAFT').map(({ tx }) => tx.id);
  const hasDrafts = draftTxIds.length > 0 && userRole === 'pm' && week.weekNo > 0;
  const evSummary = txRows.length > 0 ? computeEvidenceSummary(txRows.map(({ tx }) => tx)) : null;

  return (
    <>
      {/* Week header row */}
      <tr
        className="bg-blue-50 dark:bg-blue-950 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
        onClick={onToggle}
      >
        <td colSpan={colCount} className="px-3 py-1.5 border-b">
          <div className="flex items-center gap-2">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-blue-600" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
            )}
            <span className="font-bold text-[11px] text-blue-700 dark:text-blue-300">
              {week.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {week.weekStart ? `${week.weekStart} ~ ${week.weekEnd}` : '날짜 없음'}
            </span>
            <Badge
              variant={txCount > 0 ? 'default' : 'secondary'}
              className="text-[9px] h-4 px-1.5"
            >
              {txCount}건
            </Badge>
            {evSummary && txCount > 0 && (
              <span className="text-[9px] text-muted-foreground">
                증빙:
                {evSummary.complete > 0 && <span className="text-emerald-600 ml-1">완료 {evSummary.complete}</span>}
                {evSummary.partial > 0 && <span className="text-amber-600 ml-1">일부 {evSummary.partial}</span>}
                {evSummary.missing > 0 && <span className="text-rose-600 ml-1">미제출 {evSummary.missing}</span>}
              </span>
            )}
            {hasDrafts && onSubmitWeek && (
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[9px] gap-1 px-2 ml-auto border-amber-400 text-amber-700 hover:bg-amber-50"
                disabled={submitting}
                onClick={(e) => {
                  e.stopPropagation();
                  setSubmitting(true);
                  Promise.resolve(
                    onSubmitWeek({
                      weekLabel: week.label,
                      yearMonth: week.yearMonth,
                      weekNo: week.weekNo,
                      txIds: draftTxIds,
                    }),
                  )
                    .catch((err) => {
                      console.error('[SettlementLedger] submit week failed:', err);
                    })
                    .finally(() => setSubmitting(false));
                }}
              >
                <Send className="h-2.5 w-2.5" />
                {submitting ? '제출중...' : `제출 (${draftTxIds.length}건)`}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {/* Transaction rows */}
      {!collapsed &&
        txRows.map(({ tx, rowNum }) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            rowNum={rowNum}
            weekLabel={week.label}
            onUpdate={(updates) => onUpdateTx(tx.id, updates)}
            onProvisionEvidenceDrive={onProvisionEvidenceDrive}
            onSyncEvidenceDrive={onSyncEvidenceDrive}
            onChangeState={onChangeTransactionState}
            userRole={userRole}
          />
        ))}
      {!collapsed && txCount === 0 && (
        <tr className="text-muted-foreground">
          <td colSpan={colCount} className="px-3 py-2 text-center text-[10px] border-b italic">
            이 주차에 등록된 거래가 없습니다
          </td>
        </tr>
      )}
    </>
  );
}

// ── Transaction Row ──

interface TransactionRowProps {
  tx: Transaction;
  rowNum: number;
  weekLabel: string;
  onUpdate: (updates: Partial<Transaction>) => void;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<void>;
  onChangeState?: (txId: string, newState: TransactionState, reason?: string) => void;
  userRole?: 'pm' | 'admin';
}

function TransactionRow({
  tx,
  rowNum,
  weekLabel,
  onUpdate,
  onProvisionEvidenceDrive,
  onSyncEvidenceDrive,
  onChangeState,
  userRole,
}: TransactionRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const locked = !isEditable(tx.state);
  const [driveAction, setDriveAction] = useState<'' | 'provision' | 'sync'>('');

  const debouncedUpdate = useCallback(
    (updates: Partial<Transaction>) => {
      if (locked) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUpdate(updates), 1200);
    },
    [onUpdate, locked],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const effectiveCompletedDesc = tx.evidenceCompletedDesc || tx.evidenceAutoListedDesc || '';
  const suggestedFolderName = tx.evidenceDriveFolderName || buildDriveTransactionFolderName(tx);

  const runDriveAction = useCallback(async (
    action: 'provision' | 'sync',
    handler?: (targetTx: Transaction) => void | Promise<void>,
  ) => {
    if (!handler || driveAction) return;
    setDriveAction(action);
    try {
      await handler(tx);
    } catch (error) {
      console.error(`[SettlementLedger] evidence drive ${action} failed:`, error);
    } finally {
      setDriveAction('');
    }
  }, [driveAction, tx]);

  const textCell = (
    value: string | undefined,
    field: keyof Transaction,
    className?: string,
  ) => (
    <td className={`px-1 py-0.5 border-b border-r ${className || ''}`}>
      <input
        type="text"
        defaultValue={value || ''}
        disabled={locked}
        className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
        onBlur={(e) => {
          if (!locked && e.target.value !== (value || '')) {
            debouncedUpdate({ [field]: e.target.value } as Partial<Transaction>);
          }
        }}
      />
    </td>
  );

  const numberCell = (value: number | undefined) => (
    <td className="px-1 py-0.5 border-b border-r text-right tabular-nums">
      <span className="text-[11px]">{fmt(value)}</span>
    </td>
  );

  const boolCell = (value: boolean | undefined, field: keyof Transaction) => (
    <td className="px-1 py-0.5 border-b border-r text-center">
      <Checkbox
        checked={!!value}
        disabled={locked}
        onCheckedChange={(checked) => {
          if (!locked) onUpdate({ [field]: !!checked } as Partial<Transaction>);
        }}
        className="h-3.5 w-3.5"
      />
    </td>
  );

  const stateBadge = TX_STATE_BADGE[tx.state] || TX_STATE_BADGE.DRAFT;

  return (
    <tr className={`hover:bg-muted/30 transition-colors ${locked ? 'opacity-80' : ''}`}>
      {/* 작성자 + 상태배지 */}
      <td className={`px-1 py-0.5 border-b border-r`}>
        <div className="flex items-center gap-1">
          <input
            type="text"
            defaultValue={tx.author || ''}
            disabled={locked}
            className={`flex-1 bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[40px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== (tx.author || '')) {
                debouncedUpdate({ author: e.target.value });
              }
            }}
          />
          <span className={`shrink-0 inline-flex items-center h-4 px-1.5 rounded-full text-[8px] font-bold ${stateBadge.cls}`}>
            {stateBadge.label}
          </span>
          {tx.state === 'REJECTED' && tx.rejectedReason && (
            <span className="shrink-0 text-[8px] text-red-500 truncate max-w-[80px]" title={tx.rejectedReason}>
              ({tx.rejectedReason})
            </span>
          )}
          {tx.state === 'REJECTED' && userRole === 'pm' && onChangeState && (
            <button
              className="shrink-0 text-[8px] text-blue-600 hover:underline"
              onClick={() => onChangeState(tx.id, 'DRAFT')}
            >
              수정
            </button>
          )}
        </div>
      </td>
      {/* No. */}
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {rowNum}
      </td>
      {/* 거래일시 */}
      <td className="px-1 py-0.5 border-b border-r">
        <input
          type="date"
          defaultValue={tx.dateTime?.slice(0, 10) || ''}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] px-0.5 ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (!locked && e.target.value && e.target.value !== tx.dateTime?.slice(0, 10)) {
              debouncedUpdate({ dateTime: e.target.value });
            }
          }}
        />
      </td>
      {/* 해당 주차 */}
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {weekLabel}
      </td>
      {/* 지출구분 */}
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={normalizeMethodValue(tx.method)}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => { if (!locked) onUpdate({ method: e.target.value as Transaction['method'] }); }}
        >
          {METHOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      {/* 비목 */}
      {textCell(tx.budgetCategory, 'budgetCategory')}
      {/* 세목 */}
      {textCell(tx.budgetSubCategory, 'budgetSubCategory')}
      {/* 세세목 */}
      {textCell(tx.budgetSubSubCategory, 'budgetSubSubCategory')}
      {/* cashflow항목 */}
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={tx.cashflowLabel || ''}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer min-w-[100px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => { if (!locked) onUpdate({ cashflowLabel: e.target.value }); }}
        >
          <option value="">-</option>
          {CASHFLOW_LINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.label}>{o.label}</option>
          ))}
        </select>
      </td>
      {/* 통장잔액 */}
      {numberCell(tx.amounts?.balanceAfter)}
      {/* 통장에 찍힌 입/출금액 */}
      {numberCell(tx.amounts?.bankAmount)}
      {/* 입금합계: 입금액 */}
      {numberCell(tx.amounts?.depositAmount)}
      {/* 입금합계: 매입부가세 반환 */}
      {numberCell(tx.amounts?.vatRefund)}
      {/* 출금합계: 사업비 사용액 */}
      {numberCell(tx.amounts?.expenseAmount)}
      {/* 출금합계: 매입부가세 */}
      {numberCell(tx.amounts?.vatIn)}
      {/* 사업팀: 지급처 */}
      {textCell(tx.counterparty, 'counterparty')}
      {/* 사업팀: 상세 적요 */}
      {textCell(tx.memo, 'memo', 'min-w-[150px]')}
      {/* 사업팀: 필수증빙자료 리스트 */}
      {textCell(tx.evidenceRequiredDesc, 'evidenceRequiredDesc')}
      {/* 사업팀: 실제 구비 완료된 증빙자료 리스트 */}
      <td className="px-1 py-0.5 border-b border-r">
        <input
          key={`evidence-completed-${tx.id}-${effectiveCompletedDesc}`}
          type="text"
          defaultValue={effectiveCompletedDesc}
          disabled={locked}
          placeholder={tx.evidenceAutoListedDesc ? `자동집계: ${tx.evidenceAutoListedDesc}` : ''}
          title={tx.evidenceAutoListedDesc ? `자동 집계: ${tx.evidenceAutoListedDesc}` : undefined}
          className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (!locked && e.target.value !== effectiveCompletedDesc) {
              const updatedTx = { ...tx, evidenceCompletedDesc: e.target.value };
              const newStatus = computeEvidenceStatus(updatedTx);
              debouncedUpdate({ evidenceCompletedDesc: e.target.value, evidenceStatus: newStatus });
            }
          }}
        />
      </td>
      {/* 사업팀: 준비필요자료 */}
      {textCell(tx.evidencePendingDesc, 'evidencePendingDesc')}
      {/* 정산지원: 증빙자료 드라이브 */}
      <td className="px-1 py-0.5 border-b border-r">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px] shrink-0"
            disabled={driveAction !== '' || !onProvisionEvidenceDrive}
            onClick={(e) => {
              e.stopPropagation();
              void runDriveAction('provision', onProvisionEvidenceDrive);
            }}
            title={`증빙 폴더 생성 · ${suggestedFolderName}`}
          >
            {driveAction === 'provision' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            생성
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px] shrink-0"
            disabled={driveAction !== '' || !onSyncEvidenceDrive}
            onClick={(e) => {
              e.stopPropagation();
              void runDriveAction('sync', onSyncEvidenceDrive);
            }}
            title="Drive 폴더 파일 동기화"
          >
            {driveAction === 'sync' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            동기화
          </Button>
          <input
            key={`evidence-drive-link-${tx.id}-${tx.evidenceDriveLink || ''}-${tx.evidenceDriveFolderId || ''}`}
            type="text"
            defaultValue={tx.evidenceDriveLink || ''}
            disabled={locked}
            placeholder={`Drive URL · ${suggestedFolderName}`}
            title={`권장 폴더명: ${suggestedFolderName}`}
            className={`flex-1 bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== (tx.evidenceDriveLink || '')) {
                const updatedTx = { ...tx, evidenceDriveLink: e.target.value };
                const newStatus = computeEvidenceStatus(updatedTx);
                debouncedUpdate({ evidenceDriveLink: e.target.value, evidenceStatus: newStatus });
              }
            }}
          />
          {isValidDriveUrl(tx.evidenceDriveLink || '') && (
            <a
              href={tx.evidenceDriveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-blue-500 hover:text-blue-700"
              onClick={(e) => e.stopPropagation()}
              title="Google Drive에서 열기"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </td>
      {/* 정산지원: 준비 필요자료 */}
      {textCell(tx.supportPendingDocs, 'supportPendingDocs')}
      {/* 도담: e나라 등록 */}
      {textCell(tx.eNaraRegistered, 'eNaraRegistered')}
      {/* 도담: e나라 집행 */}
      {textCell(tx.eNaraExecuted, 'eNaraExecuted')}
      {/* 도담: 부가세 지결 완료여부 */}
      {boolCell(tx.vatSettlementDone, 'vatSettlementDone')}
      {/* 도담: 최종완료 */}
      {boolCell(tx.settlementComplete, 'settlementComplete')}
      {/* 비고 */}
      {textCell(tx.settlementNote, 'settlementNote')}
    </tr>
  );
}

// ── Import Editor (editable CSV preview) ──

interface EvidenceUploadDraft {
  id: string;
  file: File;
  objectUrl: string;
  category: string;
  parserCategory: string;
  suggestedFileName: string;
  reviewedFileName: string;
  previewType: 'pdf' | 'image' | 'other';
}

function ImportEditor({
  rows,
  onChange,
  onSave,
  saving = false,
  onCancel,
  projectId,
  defaultLedgerId,
  evidenceRequiredMap,
  onSaveEvidenceRequiredMap,
  authorOptions,
  budgetCodeBook,
  weekOptions,
  inline = false,
  comments = [],
  currentUserId = 'pm',
  currentUserName = 'PM',
  onAddComment,
  onProvisionEvidenceDriveById,
  onSyncEvidenceDriveById,
  onUploadEvidenceDriveById,
  onEnsureTransactionPersisted,
  sourceTransactions = [],
}: {
  rows: ImportRow[];
  onChange: (rows: ImportRow[]) => void;
  onSave: () => void;
  saving?: boolean;
  onCancel: () => void;
  projectId: string;
  defaultLedgerId: string;
  evidenceRequiredMap?: Record<string, string>;
  onSaveEvidenceRequiredMap?: (map: Record<string, string>) => void | Promise<void>;
  authorOptions?: string[];
  budgetCodeBook?: BudgetCodeEntry[];
  weekOptions: { value: string; label: string }[];
  inline?: boolean;
  comments?: Comment[];
  currentUserId?: string;
  currentUserName?: string;
  onAddComment?: (comment: Comment) => void | Promise<void>;
  onProvisionEvidenceDriveById?: (txId: string) => void | Promise<void>;
  onSyncEvidenceDriveById?: (txId: string) => void | Promise<void>;
  onUploadEvidenceDriveById?: (txId: string, uploads: EvidenceUploadSelection[]) => void | Promise<void>;
  onEnsureTransactionPersisted?: (input: {
    transaction: Transaction;
    sourceTxId?: string;
  }) => Promise<string | null>;
  sourceTransactions?: Transaction[];
}) {
  const errorCount = rows.filter((r) => r.error).length;
  const validCount = rows.length - errorCount;
  const noIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.'),
    [],
  );
  const missingCount = useMemo(() => {
    return rows.filter((row) => {
      const cells = row.cells || [];
      const hasAnyValue = cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() !== '');
      if (!hasAnyValue) return false;
      return cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() === '');
    }).length;
  }, [rows, noIdx]);
  const budgetCodeIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비목'),
    [],
  );
  const subCodeIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '세목'),
    [],
  );
  const weekIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '해당 주차'),
    [],
  );
  const authorIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '작성자'),
    [],
  );
  const dateIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시'),
    [],
  );
  const cashflowIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'cashflow항목'),
    [],
  );
  const methodIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지출구분'),
    [],
  );
  const evidenceIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '필수증빙자료 리스트'),
    [],
  );
  const evidenceCompletedIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '실제 구비 완료된 증빙자료 리스트'),
    [],
  );
  const evidencePendingIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '준비필요자료'),
    [],
  );
  const counterpartyIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지급처'),
    [],
  );
  const memoIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '상세 적요'),
    [],
  );
  const cashflowOptions = useMemo(
    () => CASHFLOW_LINE_OPTIONS.filter((o) => o.value !== 'INPUT_VAT_OUT'),
    [],
  );
  const depositIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '입금액(사업비,공급가액,은행이자)'),
    [],
  );
  const refundIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '매입부가세 반환'),
    [],
  );
  const expenseIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '사업비 사용액'),
    [],
  );
  const vatInIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '매입부가세'),
    [],
  );
  const bankAmountIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액'),
    [],
  );
  const balanceIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액'),
    [],
  );
  const resolvedBudgetBook = useMemo(
    () => (budgetCodeBook && budgetCodeBook.length ? budgetCodeBook : BUDGET_CODE_BOOK),
    [budgetCodeBook],
  );
  const mappingRows = useMemo(
    () => resolvedBudgetBook.flatMap((c, codeIdx) => {
      if (!c.subCodes.length) return [];
      return c.subCodes.map((subCode, subIdx) => ({
        budgetCode: c.code,
        subCode,
        key: `${c.code}|${subCode}`,
        codeLabel: formatBudgetCodeLabel(codeIdx, c.code),
        subLabel: formatSubCodeLabel(codeIdx, subIdx, subCode),
        showCode: subIdx === 0,
        rowSpan: c.subCodes.length,
      }));
    }),
    [resolvedBudgetBook],
  );
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);
  const lastFocusedCell = useRef<{ rowIdx: number; colIdx: number } | null>(null);
  const pendingFocusCell = useRef<{ rowIdx: number; colIdx: number } | null>(null);
  const draggingSelection = useRef(false);
  const [selection, setSelection] = useState<{ start: { r: number; c: number }; end: { r: number; c: number } } | null>(null);
  const undoStack = useRef<ImportRow[][]>([]);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [openSelect, setOpenSelect] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const authorListId = useMemo(
    () => (authorOptions && authorOptions.length ? `author-options-${projectId}` : ''),
    [authorOptions, projectId],
  );
  const [colWidths, setColWidths] = useState<number[]>(
    () => SETTLEMENT_COLUMNS.map((col) => {
      const headerLen = col.csvHeader.length;
      const base = 60 + headerLen * 10;
      const min = col.format === 'number' ? 110 : 90;
      const max = 240;
      return Math.max(min, Math.min(max, base));
    }),
  );
  const [activeCommentAnchor, setActiveCommentAnchor] = useState<ActiveCommentAnchor | null>(null);
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetTxId, setUploadTargetTxId] = useState<string | null>(null);
  const [uploadDrafts, setUploadDrafts] = useState<EvidenceUploadDraft[]>([]);
  const [activeUploadDraftId, setActiveUploadDraftId] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    return {
      r1: Math.min(selection.start.r, selection.end.r),
      r2: Math.max(selection.start.r, selection.end.r),
      c1: Math.min(selection.start.c, selection.end.c),
      c2: Math.max(selection.start.c, selection.end.c),
    };
  }, [selection]);
  const sourceTransactionMap = useMemo(
    () => new Map(sourceTransactions.map((transaction) => [transaction.id, transaction])),
    [sourceTransactions],
  );

  const ensurePersistedTransactionByRow = useCallback(async (rowIdx: number): Promise<string | null> => {
    const row = rows[rowIdx];
    if (!row) return null;
    if (row.sourceTxId && sourceTransactionMap.has(row.sourceTxId)) {
      return row.sourceTxId;
    }
    if (!onEnsureTransactionPersisted) {
      toast.error('먼저 실제 거래로 저장한 후 사용하세요.');
      return null;
    }
    const parsed = importRowToTransaction(
      { ...row, sourceTxId: undefined },
      projectId,
      defaultLedgerId,
      rowIdx,
    );
    if (parsed.error || !parsed.transaction) {
      toast.error(parsed.error || '거래 정보를 먼저 입력하세요.');
      return null;
    }
    if (!parsed.transaction.dateTime || !parsed.transaction.counterparty.trim()) {
      toast.error('거래일시와 지급처를 입력한 후 다시 시도하세요.');
      return null;
    }
    const persistedTxId = await onEnsureTransactionPersisted({
      transaction: {
        ...parsed.transaction,
        weekCode: weekIdx >= 0 ? String(row.cells[weekIdx] || '').trim() : parsed.transaction.weekCode,
      },
      sourceTxId: row.sourceTxId,
    });
    if (!persistedTxId) return null;
    if (row.sourceTxId !== persistedTxId) {
      onChange(rows.map((candidate, index) => (
        index === rowIdx ? { ...candidate, sourceTxId: persistedTxId } : candidate
      )));
    }
    return persistedTxId;
  }, [
    defaultLedgerId,
    onChange,
    onEnsureTransactionPersisted,
    projectId,
    rows,
    sourceTransactionMap,
    weekIdx,
  ]);

  const commentCountByCell = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const comment of comments) {
      if (!comment.transactionId || !comment.fieldKey) continue;
      const key = buildCommentThreadKey(comment.transactionId, comment.fieldKey);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return buckets;
  }, [comments]);

  const activeCellComments = useMemo(() => {
    if (!activeCommentAnchor) return [];
    return comments
      .filter((comment) => (
        comment.transactionId === activeCommentAnchor.transactionId
        && comment.fieldKey === activeCommentAnchor.fieldKey
      ))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }, [activeCommentAnchor, comments]);

  const openCellComments = useCallback((anchor: ActiveCommentAnchor) => {
    setActiveCommentAnchor(anchor);
  }, []);

  const clearUploadDrafts = useCallback(() => {
    setUploadDrafts((current) => {
      current.forEach((draft) => {
        try {
          URL.revokeObjectURL(draft.objectUrl);
        } catch {
          // ignore cleanup failures for browser object URLs
        }
      });
      return [];
    });
    setActiveUploadDraftId('');
    setUploadTargetTxId(null);
  }, []);

  useEffect(() => {
    return () => {
      uploadDrafts.forEach((draft) => {
        try {
          URL.revokeObjectURL(draft.objectUrl);
        } catch {
          // ignore cleanup failures for browser object URLs
        }
      });
    };
  }, [uploadDrafts]);

  const openEvidenceUploadPicker = useCallback((txId: string) => {
    setUploadTargetTxId(txId);
    setUploadDialogOpen(true);
  }, []);

  const triggerEvidenceFilePicker = useCallback(() => {
    if (evidenceFileInputRef.current) {
      evidenceFileInputRef.current.value = '';
      evidenceFileInputRef.current.click();
    }
  }, []);

  const activeUploadDraft = useMemo(
    () => uploadDrafts.find((draft) => draft.id === activeUploadDraftId) || uploadDrafts[0] || null,
    [uploadDrafts, activeUploadDraftId],
  );

  const confirmEvidenceUpload = useCallback(async () => {
    if (!uploadTargetTxId || !onUploadEvidenceDriveById || uploadDrafts.length === 0) return;
    setUploadingEvidence(true);
    try {
      await onUploadEvidenceDriveById(
        uploadTargetTxId,
        uploadDrafts.map((draft) => ({
          file: draft.file,
          category: draft.category,
          parserCategory: draft.parserCategory,
          reviewedFileName: draft.reviewedFileName.trim() || draft.suggestedFileName,
        })),
      );
      toast.success(`${uploadDrafts.length}건 업로드 완료`);
      setUploadDialogOpen(false);
      clearUploadDrafts();
    } catch (error) {
      console.error('[ImportEditor] evidence upload failed:', error);
      toast.error('증빙 업로드에 실패했습니다.');
    } finally {
      setUploadingEvidence(false);
    }
  }, [clearUploadDrafts, onUploadEvidenceDriveById, uploadDrafts, uploadTargetTxId]);

  const recomputeBalances = useCallback(
    (input: ImportRow[]) => {
      if (depositIdx < 0 || refundIdx < 0 || expenseIdx < 0 || vatInIdx < 0 || bankAmountIdx < 0 || balanceIdx < 0) return input;
      let running = 0;
      return input.map((row) => {
        const existingBankRaw = String(row.cells[bankAmountIdx] || '').trim();
        const existingBalanceRaw = String(row.cells[balanceIdx] || '').trim();
        const hasExistingBank = existingBankRaw !== '';
        const hasExistingBalance = existingBalanceRaw !== '';
        const existingBalanceNum = hasExistingBalance ? (parseNumber(existingBalanceRaw) ?? null) : null;

        const depositSum = (parseNumber(row.cells[depositIdx]) ?? 0) + (parseNumber(row.cells[refundIdx]) ?? 0);
        const expenseSum = (parseNumber(row.cells[expenseIdx]) ?? 0) + (parseNumber(row.cells[vatInIdx]) ?? 0);
        const derivedBankAmount = depositSum > 0 ? depositSum : expenseSum;
        const bankAmount = hasExistingBank ? (parseNumber(existingBankRaw) ?? 0) : derivedBankAmount;

        if (existingBalanceNum != null) {
          running = existingBalanceNum;
        } else if (depositSum !== 0 || expenseSum !== 0) {
          running += depositSum - expenseSum;
        }
        const cells = [...row.cells];
        if (!hasExistingBank) {
          cells[bankAmountIdx] = Number.isFinite(bankAmount) && bankAmount !== 0 ? bankAmount.toLocaleString('ko-KR') : '';
        }
        if (!hasExistingBalance && (depositSum !== 0 || expenseSum !== 0)) {
          cells[balanceIdx] = Number.isFinite(running) ? running.toLocaleString('ko-KR') : '';
        }
        return { ...row, cells };
      });
    },
    [depositIdx, refundIdx, expenseIdx, vatInIdx, bankAmountIdx, balanceIdx],
  );

  const applyDerivedRows = useCallback(
    (input: ImportRow[]) => {
      const recalced = recomputeBalances(input);
      return recalced.map((row, i) => {
        let next = row;
        const weekCell = weekIdx >= 0 ? String(row.cells[weekIdx] || '').trim() : '';
      if (weekIdx >= 0 && dateIdx >= 0 && (!weekCell || weekCell === '-') && row.cells[dateIdx]) {
          const rawDate = String(row.cells[dateIdx]).trim();
          const datePart = rawDate.split(/\s+/)[0];
          let dateIso = parseDate(datePart);
          if (!dateIso) {
            const m = datePart.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
            if (m) {
              dateIso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
            }
          }
          if (dateIso) {
            const weeks = getYearMondayWeeks(Number.parseInt(dateIso.slice(0, 4), 10));
            const label = findWeekForDate(dateIso, weeks)?.label || '';
            if (label) {
              const cells = [...row.cells];
              cells[weekIdx] = label;
              next = { ...row, cells };
            }
          }
        }
        if (bankAmountIdx >= 0 && expenseIdx >= 0 && vatInIdx >= 0) {
          const existingExpense = String(next.cells[expenseIdx] || '').trim();
          const bankAmount = parseNumber(next.cells[bankAmountIdx]) ?? 0;
          const vatAmount = parseNumber(next.cells[vatInIdx]) ?? 0;
          if (bankAmount > 0 && (!existingExpense || existingExpense === '0')) {
            const derivedExpense = Math.max(bankAmount - Math.max(vatAmount, 0), 0);
            const cells = [...next.cells];
            cells[expenseIdx] = derivedExpense > 0 ? derivedExpense.toLocaleString('ko-KR') : '';
            next = { ...next, cells };
          }
        }
        if (evidenceIdx >= 0 && evidenceCompletedIdx >= 0 && evidencePendingIdx >= 0) {
          const requiredDesc = String(next.cells[evidenceIdx] || '');
          const completedDesc = String(next.cells[evidenceCompletedIdx] || '');
          const pendingDesc = derivePendingEvidence(requiredDesc, completedDesc);
          const cells = [...next.cells];
          cells[evidencePendingIdx] = pendingDesc;
          next = { ...next, cells };
        }
        const result = importRowToTransaction(next, projectId, defaultLedgerId, i);
        return { ...next, error: result.error };
      });
    },
    [recomputeBalances, projectId, defaultLedgerId, weekIdx, dateIdx, bankAmountIdx, expenseIdx, vatInIdx, evidenceIdx, evidenceCompletedIdx, evidencePendingIdx],
  );

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[colIdx] = value;
        return { ...r, cells };
      });

      if (colIdx === cashflowIdx) {
        const updated = next.map((row, i) => {
          if (i !== rowIdx) return row;
          const result = importRowToTransaction(row, projectId, defaultLedgerId, i);
          return { ...row, error: result.error };
        });
        onChange(updated);
        return;
      }

      onChange(applyDerivedRows(next));
    },
    [rows, onChange, applyDerivedRows, cashflowIdx, projectId, defaultLedgerId],
  );

  const updateRow = useCallback(
    (rowIdx: number, updater: (row: ImportRow) => ImportRow) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        let updated = updater(r);
        if (budgetCodeIdx >= 0 && subCodeIdx >= 0 && evidenceIdx >= 0 && evidenceRequiredMap) {
          const budgetCode = updated.cells[budgetCodeIdx] || '';
          const subCode = updated.cells[subCodeIdx] || '';
          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
          if (mapped) {
            const cells = [...updated.cells];
            cells[evidenceIdx] = mapped;
            updated = { ...updated, cells };
          }
        }
        return updated;
      });
      onChange(applyDerivedRows(next));
    },
    [rows, onChange, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap, applyDerivedRows],
  );

  const normalizeRowNumbers = useCallback((input: ImportRow[]) => {
    if (noIdx < 0) return input;
    return input.map((row, index) => {
      const nextNo = String(index + 1);
      if (row.cells[noIdx] === nextNo) return row;
      const cells = [...row.cells];
      cells[noIdx] = nextNo;
      return { ...row, cells };
    });
  }, [noIdx]);

  const getSelectionAnchor = useCallback(() => {
    if (selection) {
      return {
        rowIdx: Math.min(selection.start.r, selection.end.r),
        colIdx: Math.min(selection.start.c, selection.end.c),
      };
    }
    return lastFocusedCell.current;
  }, [selection]);

  const getPreferredEditableCol = useCallback(() => {
    const anchor = getSelectionAnchor();
    const fallback = noIdx === 0 ? 1 : 0;
    if (!anchor) return fallback;
    if (anchor.colIdx === noIdx) return fallback;
    return anchor.colIdx;
  }, [getSelectionAnchor, noIdx]);
  const selectedRowIdx = getSelectionAnchor()?.rowIdx ?? -1;

  const commitRows = useCallback((nextRows: ImportRow[], focusTarget?: { rowIdx: number; colIdx: number } | null) => {
    if (focusTarget) pendingFocusCell.current = focusTarget;
    onChange(applyDerivedRows(normalizeRowNumbers(nextRows)));
  }, [onChange, applyDerivedRows, normalizeRowNumbers]);

  const addRow = useCallback(() => {
    const anchor = getSelectionAnchor();
    const insertIndex = anchor ? Math.min(rows.length, anchor.rowIdx + 1) : rows.length;
    const newRow = createEmptyImportRow();
    newRow.error = undefined;
    const nextRows = [
      ...rows.slice(0, insertIndex),
      newRow,
      ...rows.slice(insertIndex),
    ];
    commitRows(nextRows, { rowIdx: insertIndex, colIdx: getPreferredEditableCol() });
  }, [rows, getSelectionAnchor, commitRows, getPreferredEditableCol]);

  const addRows = useCallback((count: number) => {
    if (count <= 0) return;
    const nextRows = [...rows];
    for (let i = 0; i < count; i++) {
      const newRow = createEmptyImportRow();
      nextRows.push(newRow);
    }
    commitRows(nextRows);
  }, [rows, commitRows]);

  const addTemplateRow = useCallback((template: QuickExpenseTemplate) => {
    const anchor = getSelectionAnchor();
    const insertIndex = anchor ? Math.min(rows.length, anchor.rowIdx + 1) : rows.length;
    const newRow = createEmptyImportRow();
    if (methodIdx >= 0) newRow.cells[methodIdx] = template.methodLabel;
    if (cashflowIdx >= 0) newRow.cells[cashflowIdx] = template.cashflowLabel;
    if (counterpartyIdx >= 0) newRow.cells[counterpartyIdx] = template.counterparty;
    if (memoIdx >= 0) newRow.cells[memoIdx] = template.memo;
    const nextRows = [
      ...rows.slice(0, insertIndex),
      newRow,
      ...rows.slice(insertIndex),
    ];
    commitRows(nextRows, { rowIdx: insertIndex, colIdx: getPreferredEditableCol() });
  }, [rows, methodIdx, cashflowIdx, counterpartyIdx, memoIdx, getSelectionAnchor, commitRows, getPreferredEditableCol]);

  const insertRowAt = useCallback((index: number) => {
    const boundedIndex = Math.max(0, Math.min(rows.length, index));
    const newRow = createEmptyImportRow();
    const nextRows = [
      ...rows.slice(0, boundedIndex),
      newRow,
      ...rows.slice(boundedIndex),
    ];
    commitRows(nextRows, { rowIdx: boundedIndex, colIdx: getPreferredEditableCol() });
  }, [rows, commitRows, getPreferredEditableCol]);

  const formatNumberCell = useCallback((value: string) => {
    if (!value) return '';
    const num = parseNumber(value);
    if (num == null) return value;
    return Number.isFinite(num) ? num.toLocaleString('ko-KR') : value;
  }, []);

  const cloneRows = useCallback((input: ImportRow[]) => {
    return input.map((row) => ({ ...row, cells: [...row.cells] }));
  }, []);

  const applyPaste = useCallback(
    (startRow: number, startCol: number, text: string) => {
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let lines = normalized.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
      const grid = lines.map((line) => line.split('\t'));
      const gridRows = grid.length;
      const gridCols = Math.max(0, ...grid.map((r) => r.length));

      const bounds = selection
        ? {
          r1: Math.min(selection.start.r, selection.end.r),
          r2: Math.max(selection.start.r, selection.end.r),
          c1: Math.min(selection.start.c, selection.end.c),
          c2: Math.max(selection.start.c, selection.end.c),
        }
        : {
          r1: startRow,
          r2: startRow + Math.max(0, gridRows - 1),
          c1: startCol,
          c2: startCol + Math.max(0, gridCols - 1),
        };

      // Snapshot for undo
      undoStack.current.push(cloneRows(rows));

      const neededRows = bounds.r2 + 1;
      const nextRows = [...rows];
      while (nextRows.length < neededRows) {
        nextRows.push(createEmptyImportRow());
      }

      const fillAll = gridRows === 1 && gridCols === 1;

      const normalizeSelectValue = (colIdx: number, raw: string, currentCells: string[]) => {
        const trimmed = raw.trim();
        if (!trimmed) return '';
        if (colIdx === weekIdx) {
          const match = weekOptions.find((o) => o.value === trimmed || o.label === trimmed);
          return match ? match.value : trimmed;
        }
        if (colIdx === cashflowIdx) {
          const match = cashflowOptions.find((o) => o.label === trimmed || o.value === trimmed);
          return match ? match.label : trimmed;
        }
        if (colIdx === methodIdx) {
          const match = METHOD_OPTIONS.find((o) => o.label === trimmed || o.value === trimmed);
          return match ? match.label : trimmed;
        }
        if (colIdx === budgetCodeIdx) {
          return normalizeBudgetLabel(trimmed);
        }
        if (colIdx === subCodeIdx) {
          return normalizeBudgetLabel(trimmed);
        }
        return trimmed;
      };

      for (let r = bounds.r1; r <= bounds.r2; r++) {
        const rowIdx = r;
        const row = nextRows[rowIdx];
        const cells = [...row.cells];
        for (let c = bounds.c1; c <= bounds.c2; c++) {
          const colIdx = c;
          if (colIdx < 0 || colIdx >= SETTLEMENT_COLUMNS.length) continue;
          if (colIdx === noIdx) continue;
          const sr = r - bounds.r1;
          const sc = c - bounds.c1;
          if (!fillAll && (sr >= gridRows || sc >= gridCols)) continue;
          const raw = (fillAll ? (grid[0]?.[0] ?? '') : (grid[sr]?.[sc] ?? '')).trim();
          const colDef = SETTLEMENT_COLUMNS[colIdx];
          if ([weekIdx, cashflowIdx, methodIdx, budgetCodeIdx, subCodeIdx].includes(colIdx)) {
            cells[colIdx] = normalizeSelectValue(colIdx, raw, cells);
          } else {
            cells[colIdx] = colDef?.format === 'number' ? formatNumberCell(raw) : raw;
          }
        }
        let updated = { ...row, cells };
        if (budgetCodeIdx >= 0 && subCodeIdx >= 0 && evidenceIdx >= 0 && evidenceRequiredMap) {
          const budgetCode = updated.cells[budgetCodeIdx] || '';
          const subCode = updated.cells[subCodeIdx] || '';
          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
          if (mapped) {
            const mappedCells = [...updated.cells];
            mappedCells[evidenceIdx] = mapped;
            updated = { ...updated, cells: mappedCells };
          }
        }
        nextRows[rowIdx] = updated;
      }

      commitRows(nextRows);
    },
    [
      rows,
      commitRows,
      formatNumberCell,
      noIdx,
      selection,
      cloneRows,
      budgetCodeIdx,
      subCodeIdx,
      evidenceIdx,
      evidenceRequiredMap,
    ],
  );

  const handleCellFocus = useCallback((rowIdx: number, colIdx: number) => {
    lastFocusedCell.current = { rowIdx, colIdx };
    setSelection((prev) => (
      prev
      && prev.start.r === rowIdx
      && prev.start.c === colIdx
      && prev.end.r === rowIdx
      && prev.end.c === colIdx
        ? prev
        : { start: { r: rowIdx, c: colIdx }, end: { r: rowIdx, c: colIdx } }
    ));
  }, []);

  const handleTablePaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const anchor = selection
      ? {
        r: Math.min(selection.start.r, selection.end.r),
        c: Math.min(selection.start.c, selection.end.c),
      }
      : lastFocusedCell.current
        ? { r: lastFocusedCell.current.rowIdx, c: lastFocusedCell.current.colIdx }
        : null;
    if (!anchor) return;
    e.preventDefault();
    applyPaste(anchor.r, anchor.c, text);
  }, [applyPaste, selection]);

  const handleUndo = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
    if (!isUndo) return;
    if (undoStack.current.length === 0) return;
    e.preventDefault();
    const prev = undoStack.current.pop();
    if (prev) onChange(prev);
  }, [onChange]);

  const handleCopy = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
    if (!isCopy) return;
    if (!selection) return;
    const r1 = Math.min(selection.start.r, selection.end.r);
    const r2 = Math.max(selection.start.r, selection.end.r);
    const c1 = Math.min(selection.start.c, selection.end.c);
    const c2 = Math.max(selection.start.c, selection.end.c);
    if (r1 < 0 || c1 < 0) return;
    const lines: string[] = [];
    for (let r = r1; r <= r2; r++) {
      const row = rows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = c1; c <= c2; c++) {
        if (c === noIdx) continue;
        cells.push(String(row.cells[c] ?? ''));
      }
      lines.push(cells.join('\t'));
    }
    const text = lines.join('\n');
    if (!text) return;
    e.preventDefault();
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }, [selection, rows, noIdx]);

  const focusCellAt = useCallback((rowIdx: number, colIdx: number) => {
    if (!tableWrapRef.current) return;
    const boundedRow = Math.max(0, Math.min(rows.length - 1, rowIdx));
    let boundedCol = Math.max(0, Math.min(SETTLEMENT_COLUMNS.length - 1, colIdx));
    if (boundedCol === noIdx) boundedCol = Math.min(SETTLEMENT_COLUMNS.length - 1, boundedCol + 1);
    const selector = `[data-cell-row="${boundedRow}"][data-cell-col="${boundedCol}"]`;
    const target = tableWrapRef.current.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.focus();
    handleCellFocus(boundedRow, boundedCol);
  }, [rows.length, noIdx, handleCellFocus]);

  useEffect(() => {
    if (!pendingFocusCell.current) return;
    const target = pendingFocusCell.current;
    pendingFocusCell.current = null;
    const timer = window.setTimeout(() => {
      focusCellAt(target.rowIdx, target.colIdx);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rows, focusCellAt]);

  const handleTableKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    handleUndo(e);
    handleCopy(e);
    if (e.defaultPrevented) return;

    const anchor = selection
      ? {
        r: Math.min(selection.start.r, selection.end.r),
        c: Math.min(selection.start.c, selection.end.c),
      }
      : lastFocusedCell.current
        ? { r: lastFocusedCell.current.rowIdx, c: lastFocusedCell.current.colIdx }
        : null;
    if (!anchor) return;

    const navigationKeys = new Set(['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    if (!navigationKeys.has(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;

    e.preventDefault();
    if (e.key === 'Enter') {
      focusCellAt(anchor.r + (e.shiftKey ? -1 : 1), anchor.c);
      return;
    }
    if (e.key === 'ArrowUp') {
      focusCellAt(anchor.r - 1, anchor.c);
      return;
    }
    if (e.key === 'ArrowDown') {
      focusCellAt(anchor.r + 1, anchor.c);
      return;
    }
    if (e.key === 'ArrowLeft') {
      focusCellAt(anchor.r, anchor.c - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      focusCellAt(anchor.r, anchor.c + 1);
    }
  }, [handleUndo, handleCopy, selection, focusCellAt]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') || '';
      if (!text) return;
      const anchor = selection
        ? {
          r: Math.min(selection.start.r, selection.end.r),
          c: Math.min(selection.start.c, selection.end.c),
        }
        : lastFocusedCell.current
          ? { r: lastFocusedCell.current.rowIdx, c: lastFocusedCell.current.colIdx }
          : null;
      if (!anchor) return;
      e.preventDefault();
      applyPaste(anchor.r, anchor.c, text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [selection, applyPaste]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-select-popup]') || target.closest('[data-select-toggle]')) return;
      setOpenSelect(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  const handleCellMouseDown = useCallback((rowIdx: number, colIdx: number) => {
    if (colIdx === noIdx) return;
    draggingSelection.current = true;
    document.body.style.userSelect = 'none';
    tableWrapRef.current?.focus();
    setOpenSelect(null);
    setSelection((prev) => (
      prev
      && prev.start.r === rowIdx
      && prev.start.c === colIdx
      && prev.end.r === rowIdx
      && prev.end.c === colIdx
        ? prev
        : { start: { r: rowIdx, c: colIdx }, end: { r: rowIdx, c: colIdx } }
    ));
  }, [noIdx]);

  const handleCellMouseEnter = useCallback((rowIdx: number, colIdx: number) => {
    if (!draggingSelection.current) return;
    if (colIdx === noIdx) return;
    setSelection((prev) => {
      if (!prev) return prev;
      return { ...prev, end: { r: rowIdx, c: colIdx } };
    });
  }, [noIdx]);

  useEffect(() => {
    const onUp = () => {
      draggingSelection.current = false;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    if (!inline) return;
    if (rows.length >= 20) return;
    addRows(20 - rows.length);
  }, [rows.length, inline, addRows]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      const nextRows = rows.filter((_, i) => i !== rowIdx);
      const nextFocusRow = Math.min(Math.max(0, rowIdx - 1), Math.max(0, nextRows.length - 1));
      commitRows(nextRows, nextRows.length > 0 ? { rowIdx: nextFocusRow, colIdx: getPreferredEditableCol() } : null);
    },
    [rows, commitRows, getPreferredEditableCol],
  );

  const applyEvidenceMapping = useCallback((rowIdx?: number) => {
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || evidenceIdx < 0) return;
    if (!evidenceRequiredMap || Object.keys(evidenceRequiredMap).length === 0) return;
    const next = rows.map((r, i) => {
      if (rowIdx != null && i !== rowIdx) return r;
      const budgetCode = r.cells[budgetCodeIdx] || '';
      const subCode = r.cells[subCodeIdx] || '';
      const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
      if (!mapped) return r;
      const cells = [...r.cells];
      cells[evidenceIdx] = mapped;
      const updated: ImportRow = { ...r, cells };
      const result = importRowToTransaction(updated, projectId, defaultLedgerId, i);
      updated.error = result.error;
      return updated;
    });
    onChange(next);
  }, [rows, onChange, projectId, defaultLedgerId, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap]);

  const openMappingEditor = useCallback(() => {
    setMappingDraft({ ...(evidenceRequiredMap || {}) });
    setMappingOpen(true);
  }, [evidenceRequiredMap]);

  const saveMappingEditor = useCallback(async () => {
    if (!onSaveEvidenceRequiredMap) {
      toast.message('증빙 매핑 저장 기능이 없습니다.');
      return;
    }
    const nextMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(mappingDraft)) {
      const trimmed = value.trim();
      if (trimmed) nextMap[key] = trimmed;
    }
    setMappingSaving(true);
    try {
      await onSaveEvidenceRequiredMap(nextMap);
      setMappingOpen(false);
      applyEvidenceMapping();
      toast.success('증빙 매핑이 저장되었습니다');
    } catch (err) {
      console.error('[SettlementLedger] save evidence map failed:', err);
      toast.error('증빙 매핑 저장에 실패했습니다');
    } finally {
      setMappingSaving(false);
    }
  }, [mappingDraft, onSaveEvidenceRequiredMap]);

  return (
      <div className={inline ? 'relative border rounded-lg bg-background flex flex-col overflow-visible' : 'fixed inset-0 z-50 bg-background/95 flex flex-col'}>
      {authorListId && (
        <datalist id={authorListId}>
          {(authorOptions || []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 shrink-0 ${inline ? 'sticky top-0 z-20' : ''}`}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold">정산대장 편집</h3>
          <Badge variant="default" className="text-[10px]">{validCount}건 유효</Badge>
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">{errorCount}건 오류</Badge>
          )}
          {missingCount > 0 && (
            <Badge variant="secondary" className="text-[10px] text-red-600">{missingCount}건 미입력</Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            셀을 직접 수정하거나 행을 추가할 수 있습니다
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={openMappingEditor}
          >
            증빙 매핑 설정
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
              >
                <Plus className="h-3.5 w-3.5" />
                정기지출 템플릿
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-[11px]">
              {QUICK_EXPENSE_TEMPLATES.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onClick={() => addTemplateRow(template)}
                >
                  {template.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={addRow}
          >
            <Plus className="h-3.5 w-3.5" />
            행 추가
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={() => {
              if (selectedRowIdx < 0) return;
              removeRow(selectedRowIdx);
            }}
            disabled={selectedRowIdx < 0 || rows.length === 0}
          >
            <X className="h-3.5 w-3.5" />
            선택 행 삭제
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={onCancel}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            되돌리기
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm"
            onClick={onSave}
            disabled={validCount === 0 || saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? '저장 중...' : `${validCount}건 저장`}
          </Button>
        </div>
      </div>

      {/* Scrollable table */}
      <div
        className={inline ? 'overflow-auto max-h-[calc(100vh-260px)]' : 'flex-1 overflow-auto'}
        onPaste={handleTablePaste}
        onKeyDownCapture={handleTableKeyDown}
        tabIndex={0}
        ref={tableWrapRef}
      >
        <table className="w-full text-[11px] border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 44 }} />
            {SETTLEMENT_COLUMNS.map((_, i) => (
              <col key={i} style={{ width: colWidths[i] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            {/* Group header */}
            <tr className="bg-slate-100 dark:bg-slate-800">
              <th className="px-1 py-1 border-b border-r text-center text-[9px] w-11" />
              {SETTLEMENT_COLUMN_GROUPS.map((g) => (
                <th
                  key={g.name}
                  colSpan={g.colSpan}
                  className="px-2 py-1 text-center font-bold border-b border-r text-[10px] text-slate-600 dark:text-slate-300"
                >
                  {g.name}
                </th>
              ))}
            </tr>
            {/* Column header */}
            <tr className="bg-slate-50 dark:bg-slate-900">
              <th className="px-1 py-1 border-b border-r text-[9px] w-11" />
              {SETTLEMENT_COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className="px-1.5 py-1 font-medium border-b border-r whitespace-nowrap text-[10px] text-left relative select-none pr-3"
                  style={{ width: colWidths[i], minWidth: 80 }}
                >
                  {col.csvHeader}
                  <div
                    role="separator"
                    className="absolute -right-1 top-0 h-full w-3 cursor-col-resize z-20 hover:bg-teal-500/10"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startX = e.clientX;
                      const startW = colWidths[i] || 120;
                      const target = e.currentTarget;
                      target.setPointerCapture(e.pointerId);

                      const onMove = (ev: PointerEvent) => {
                        const next = Math.max(60, startW + ev.clientX - startX);
                        setColWidths((prev) => {
                          const copy = [...prev];
                          copy[i] = next;
                          return copy;
                        });
                      };
                      const onUp = (ev: PointerEvent) => {
                        target.releasePointerCapture(ev.pointerId);
                        target.removeEventListener('pointermove', onMove);
                        target.removeEventListener('pointerup', onUp);
                        target.removeEventListener('pointercancel', onUp);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                      };
                      document.body.style.cursor = 'col-resize';
                      document.body.style.userSelect = 'none';
                      target.addEventListener('pointermove', onMove);
                      target.addEventListener('pointerup', onUp);
                      target.addEventListener('pointercancel', onUp);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <MemoizedImportEditorRow
                key={`${row.tempId}-${rowIdx}`}
                row={row}
                rowIdx={rowIdx}
                onCellChange={(colIdx, value) => updateCell(rowIdx, colIdx, value)}
                onRowChange={(updater) => updateRow(rowIdx, updater)}
                onRemove={() => removeRow(rowIdx)}
                onInsertBelow={() => insertRowAt(rowIdx + 1)}
                onPasteRange={applyPaste}
                onCellFocus={handleCellFocus}
                onCellMouseDown={handleCellMouseDown}
                onCellMouseEnter={handleCellMouseEnter}
                selectionBounds={selectionBounds}
                openSelect={openSelect}
                onOpenSelect={(rowIdx, colIdx) => setOpenSelect({ rowIdx, colIdx })}
                onCloseSelect={() => setOpenSelect(null)}
                authorIdx={authorIdx}
                authorListId={authorListId}
                authorOptions={authorOptions}
                budgetCodeBook={resolvedBudgetBook}
                budgetCodeIdx={budgetCodeIdx}
                subCodeIdx={subCodeIdx}
                evidenceIdx={evidenceIdx}
                weekIdx={weekIdx}
                cashflowIdx={cashflowIdx}
                weekOptions={weekOptions}
                cashflowOptions={cashflowOptions}
                evidenceRequiredMap={evidenceRequiredMap}
                commentCountByCell={commentCountByCell}
                onOpenCellComments={openCellComments}
                onProvisionEvidenceDriveById={onProvisionEvidenceDriveById}
                onSyncEvidenceDriveById={onSyncEvidenceDriveById}
                onOpenEvidenceUpload={openEvidenceUploadPicker}
                persistedTransactionId={row.sourceTxId && sourceTransactionMap.has(row.sourceTxId) ? row.sourceTxId : ''}
                onEnsurePersistedTransaction={() => ensurePersistedTransactionByRow(rowIdx)}
                noIdx={noIdx}
                colWidths={colWidths}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={SETTLEMENT_COLUMNS.length + 1}
                  className="px-4 py-8 text-center text-[12px] text-muted-foreground"
                >
                  데이터가 없습니다. 행을 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <input
        ref={evidenceFileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx,.txt,.eml,.msg"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (!files.length || !uploadTargetTxId) return;
          const batchId = Date.now();
          const sourceTransaction = sourceTransactionMap.get(uploadTargetTxId);
          setUploadDrafts((current) => {
            current.forEach((draft) => {
              try {
                URL.revokeObjectURL(draft.objectUrl);
              } catch {
                // ignore cleanup failures for browser object URLs
              }
            });
            return files.map((file, index) => {
              const parserCategory = inferEvidenceCategoryFromFileName(file.name);
              const suggestedFileName = suggestEvidenceUploadFileName({
                originalFileName: file.name,
                category: parserCategory,
                transaction: sourceTransaction,
              });
              return {
                id: `${batchId}-${index}-${file.name}`,
                file,
                objectUrl: URL.createObjectURL(file),
                category: parserCategory,
                parserCategory,
                suggestedFileName,
                reviewedFileName: suggestedFileName,
                previewType: file.type === 'application/pdf'
                  ? 'pdf'
                  : (file.type.startsWith('image/') ? 'image' : 'other'),
              };
            });
          });
          setActiveUploadDraftId(`${batchId}-0-${files[0].name}`);
          setUploadDialogOpen(true);
        }}
      />
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open && !uploadingEvidence) {
            clearUploadDrafts();
          }
        }}
      >
        <DialogContent className="h-[92vh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
          <DialogHeader className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle>증빙 업로드 검토</DialogTitle>
                <DialogDescription>
                  좌측에서 파일을 확인하고, 우측에서 자동 분류 결과를 수정한 뒤 업로드하세요.
                </DialogDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={triggerEvidenceFilePicker} disabled={uploadingEvidence}>
                파일 선택
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-6 py-4">
            <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1.4fr)_380px]">
            <div className="min-h-0 rounded-xl border bg-slate-50/60 p-3">
              {activeUploadDraft ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold">{activeUploadDraft.file.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {(activeUploadDraft.file.size / 1024).toFixed(1)} KB · {activeUploadDraft.file.type || 'application/octet-stream'}
                      </p>
                    </div>
                    <span className="rounded-full border bg-background px-2 py-1 text-[10px] text-muted-foreground">
                      파일명 자동분류
                    </span>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2 text-[11px]">
                    <p className="text-[10px] font-semibold text-muted-foreground">원본 파일명</p>
                    <p className="mt-1 break-all">{activeUploadDraft.file.name}</p>
                  </div>
                  <div className="flex-1 overflow-hidden rounded-lg border bg-background">
                    {activeUploadDraft.previewType === 'pdf' ? (
                      <iframe
                        title={activeUploadDraft.file.name}
                        src={activeUploadDraft.objectUrl}
                        className="h-full min-h-[420px] w-full"
                      />
                    ) : activeUploadDraft.previewType === 'image' ? (
                      <img
                        src={activeUploadDraft.objectUrl}
                        alt={activeUploadDraft.file.name}
                        className="h-full min-h-[420px] w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
                        브라우저 미리보기를 지원하지 않는 형식입니다. 업로드 후 Drive 링크에서 원본을 확인하세요.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-[12px] text-muted-foreground">
                  <p>업로드할 파일을 선택하세요.</p>
                  <Button type="button" variant="outline" size="sm" onClick={triggerEvidenceFilePicker} disabled={uploadingEvidence}>
                    파일 선택
                  </Button>
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-3">
              <div className="rounded-xl border bg-background p-3">
                <p className="text-[12px] font-semibold">파싱 결과</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  파일명과 운영 규칙으로 자동 분류했습니다. 사람이 최종 확인해 주세요.
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {uploadDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    role="button"
                    tabIndex={0}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      activeUploadDraft?.id === draft.id
                        ? 'border-teal-400 bg-teal-50/70'
                        : 'border-border bg-background hover:bg-muted/40'
                    }`}
                    onClick={() => setActiveUploadDraftId(draft.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveUploadDraftId(draft.id);
                      }
                    }}
                  >
                    <p className="truncate text-[12px] font-medium">{draft.file.name}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      자동분류: {draft.parserCategory}
                    </p>
                    <div className="mt-2 space-y-1.5">
                      <div>
                        <label className="mb-1 block text-[10px] text-muted-foreground">권장 파일명</label>
                        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-[10px] break-all">
                          {draft.suggestedFileName}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-muted-foreground">최종 업로드 파일명</label>
                        <input
                          type="text"
                          value={draft.reviewedFileName}
                          className="h-8 w-full rounded-md border bg-background px-2 text-[11px]"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const nextFileName = event.target.value;
                            setUploadDrafts((current) => current.map((item) => (
                              item.id === draft.id
                                ? { ...item, reviewedFileName: nextFileName }
                                : item
                            )));
                          }}
                        />
                        <div className="mt-1 flex justify-end">
                          <button
                            type="button"
                            className="text-[10px] text-teal-700 underline underline-offset-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              setUploadDrafts((current) => current.map((item) => (
                                item.id === draft.id
                                  ? { ...item, reviewedFileName: item.suggestedFileName }
                                  : item
                              )));
                            }}
                          >
                            권장안 다시 적용
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-[10px] text-muted-foreground">문서 종류</label>
                      <select
                        value={draft.category}
                        className="h-8 w-full rounded-md border bg-background px-2 text-[11px]"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const nextCategory = event.target.value;
                          setUploadDrafts((current) => current.map((item) => (
                            item.id === draft.id
                              ? { ...item, category: nextCategory }
                              : item
                          )));
                        }}
                      >
                        {EVIDENCE_DOCUMENT_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false);
                clearUploadDrafts();
              }}
              disabled={uploadingEvidence}
            >
              취소
            </Button>
            <Button onClick={() => void confirmEvidenceUpload()} disabled={uploadingEvidence || uploadDrafts.length === 0}>
              {uploadingEvidence ? '업로드 중...' : `선택한 ${uploadDrafts.length}건 업로드`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {mappingOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-3xl bg-background rounded-lg border shadow-lg flex flex-col max-h-[80vh] pointer-events-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-sm font-bold">증빙 매핑 설정</h4>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={() => setMappingOpen(false)}>닫기</Button>
                <Button size="sm" className="hover:bg-muted/40 cursor-pointer" onClick={saveMappingEditor} disabled={mappingSaving}>
                  {mappingSaving ? '저장중...' : '저장'}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 border-b text-left">비목</th>
                    <th className="px-2 py-2 border-b text-left">세목</th>
                    <th className="px-2 py-2 border-b text-left">필수증빙자료 리스트</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingRows.map((row, idx) => (
                    <tr key={row.key} className={idx === mappingRows.length - 1 ? '' : 'border-b'}>
                      {row.showCode && (
                        <td className="px-2 py-1.5 align-top" rowSpan={row.rowSpan}>
                          {row.codeLabel}
                        </td>
                      )}
                      <td className="px-2 py-1.5">{row.subLabel}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={mappingDraft[row.key] || ''}
                          className="w-full bg-transparent outline-none text-[11px] px-2 py-1 border rounded"
                          placeholder="예: 세금계산서, 이체확인증"
                          onChange={(e) => {
                            const next = { ...mappingDraft, [row.key]: e.target.value };
                            setMappingDraft(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <CommentThreadSheet
        anchor={activeCommentAnchor}
        comments={activeCellComments}
        open={!!activeCommentAnchor}
        projectId={projectId}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onClose={() => setActiveCommentAnchor(null)}
        onAddComment={onAddComment}
      />
    </div>
  );
}

function ImportEditorRow({
  row,
  rowIdx,
  onCellChange,
  onRowChange,
  onRemove,
  onInsertBelow,
  onPasteRange,
  onCellFocus,
  onCellMouseDown,
  onCellMouseEnter,
  selectionBounds,
  openSelect,
  onOpenSelect,
  onCloseSelect,
  authorIdx,
  authorListId,
  authorOptions,
  budgetCodeBook,
  budgetCodeIdx,
  subCodeIdx,
  evidenceIdx,
  weekIdx,
  cashflowIdx,
  weekOptions,
  cashflowOptions,
  evidenceRequiredMap,
  commentCountByCell,
  onOpenCellComments,
  onProvisionEvidenceDriveById,
  onSyncEvidenceDriveById,
  onOpenEvidenceUpload,
  persistedTransactionId,
  onEnsurePersistedTransaction,
  noIdx,
  colWidths,
}: {
  row: ImportRow;
  rowIdx: number;
  onCellChange: (colIdx: number, value: string) => void;
  onRowChange: (updater: (row: ImportRow) => ImportRow) => void;
  onRemove: () => void;
  onInsertBelow: () => void;
  onPasteRange: (rowIdx: number, colIdx: number, text: string) => void;
  onCellFocus: (rowIdx: number, colIdx: number) => void;
  onCellMouseDown: (rowIdx: number, colIdx: number) => void;
  onCellMouseEnter: (rowIdx: number, colIdx: number) => void;
  selectionBounds: { r1: number; r2: number; c1: number; c2: number } | null;
  openSelect: { rowIdx: number; colIdx: number } | null;
  onOpenSelect: (rowIdx: number, colIdx: number) => void;
  onCloseSelect: () => void;
  authorIdx: number;
  authorListId: string;
  authorOptions?: string[];
  budgetCodeBook: BudgetCodeEntry[];
  budgetCodeIdx: number;
  subCodeIdx: number;
  evidenceIdx: number;
  weekIdx: number;
  cashflowIdx: number;
  weekOptions: { value: string; label: string }[];
  cashflowOptions: { value: string; label: string }[];
  evidenceRequiredMap?: Record<string, string>;
  commentCountByCell: Map<string, number>;
  onOpenCellComments: (anchor: ActiveCommentAnchor) => void;
  onProvisionEvidenceDriveById?: (txId: string) => void | Promise<void>;
  onSyncEvidenceDriveById?: (txId: string) => void | Promise<void>;
  onOpenEvidenceUpload?: (txId: string) => void;
  persistedTransactionId?: string;
  onEnsurePersistedTransaction?: () => Promise<string | null>;
  noIdx: number;
  colWidths: number[];
}) {
  const hasError = Boolean(row.error);
  const hasMissingCell = useMemo(() => {
    const cells = row.cells || [];
    const hasAnyValue = cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() !== '');
    if (!hasAnyValue) return false;
    return cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() === '');
  }, [row.cells, noIdx]);
  const methodIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지출구분'),
    [],
  );
  const dateIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시'),
    [],
  );
  const budgetCodeRaw = budgetCodeIdx >= 0 ? row.cells[budgetCodeIdx] : '';
  const budgetCode = normalizeBudgetLabel(String(budgetCodeRaw || ''));
  const subCodes = useMemo(() => {
    const entry = budgetCodeBook.find((c) => c.code === budgetCode);
    return entry ? entry.subCodes : [];
  }, [budgetCode, budgetCodeBook]);
  const rowLabel = `${rowIdx + 1}행`;
  const commentTransactionId = row.sourceTxId || buildSheetRowCommentId(row.tempId);
  const [driveAction, setDriveAction] = useState<'' | 'provision' | 'sync'>('');
  const hasSourceTransaction = Boolean(persistedTransactionId);
  const canUseDrive = hasSourceTransaction || !!onEnsurePersistedTransaction;
  const isCellSelected = useCallback((colIdx: number) => {
    if (!selectionBounds || colIdx === noIdx) return false;
    return rowIdx >= selectionBounds.r1
      && rowIdx <= selectionBounds.r2
      && colIdx >= selectionBounds.c1
      && colIdx <= selectionBounds.c2;
  }, [selectionBounds, rowIdx, noIdx]);
  const formatNumberInput = useCallback((value: string) => {
    if (!value) return '';
    const num = parseNumber(value);
    if (num == null) return value;
    return Number.isFinite(num) ? num.toLocaleString('ko-KR') : value;
  }, []);
  const renderCommentButton = useCallback((fieldLabel: string) => {
    const fieldKey = toFieldSlug(fieldLabel);
    const count = commentCountByCell.get(buildCommentThreadKey(commentTransactionId, fieldKey)) || 0;
    return (
      <CellCommentButton
        count={count}
        onClick={() => {
          onOpenCellComments({
            transactionId: commentTransactionId,
            fieldKey,
            fieldLabel,
            rowLabel,
          });
        }}
      />
    );
  }, [commentCountByCell, commentTransactionId, onOpenCellComments, rowLabel]);

  const handlePaste = useCallback((
    colIdx: number,
    e: ClipboardEvent<HTMLTableCellElement | HTMLInputElement | HTMLSelectElement>,
  ) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    onPasteRange(rowIdx, colIdx, text);
  }, [onPasteRange, rowIdx]);

  const runDriveAction = useCallback(async (
    action: 'provision' | 'sync',
    handler?: (txId: string) => void | Promise<void>,
  ) => {
    if (!handler) return;
    const txId = persistedTransactionId || await onEnsurePersistedTransaction?.();
    if (!txId) return;
    setDriveAction(action);
    try {
      await handler(txId);
    } finally {
      setDriveAction('');
    }
  }, [onEnsurePersistedTransaction, persistedTransactionId]);

  const SelectCell = ({
    value,
    options,
    onChange,
    onFocus,
    cellColIdx,
    disabled = false,
    isOpen,
    onOpen,
    onClose,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (next: string) => void;
    onFocus: () => void;
    cellColIdx: number;
    disabled?: boolean;
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
  }) => {
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const [popupRect, setPopupRect] = useState<{ left: number; top: number } | null>(null);

    useLayoutEffect(() => {
      if (!isOpen) return;
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopupRect({ left: rect.left, top: rect.bottom + 4 });
    }, [isOpen]);

    useEffect(() => {
      if (!isOpen) return;
      const update = () => {
        const rect = btnRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPopupRect({ left: rect.left, top: rect.bottom + 4 });
      };
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
      };
    }, [isOpen]);

    const openPicker = (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      onFocus();
      onOpen();
    };
    const label = options.find((o) => o.value === value)?.label || value || '-';
    return (
      <div className="relative w-full">
        <div className={`flex items-center justify-between gap-1 px-1 py-0.5 text-[11px] ${disabled ? 'text-muted-foreground' : ''}`}>
          <span className="truncate">{label}</span>
          <button
            type="button"
            className={`shrink-0 h-4 w-4 rounded border border-slate-200/80 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30 text-[9px] leading-none text-slate-500 dark:text-slate-400 ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'}`}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseDownCapture={openPicker}
            data-select-toggle
            data-cell-row={rowIdx}
            data-cell-col={cellColIdx}
            title="옵션 열기"
            ref={btnRef}
          >
            ▼
          </button>
        </div>
        {isOpen && !disabled && popupRect && createPortal(
          <div
            className="fixed z-[120] w-40 max-h-56 overflow-auto rounded-md border bg-background shadow-lg"
            style={{ left: popupRect.left, top: popupRect.top }}
            onMouseDown={(e) => e.stopPropagation()}
            data-select-popup
          >
            <button
              type="button"
              className="w-full text-left px-2 py-1 text-[11px] hover:bg-muted"
              onClick={() => {
                onChange('');
                onClose();
              }}
            >
              -
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="w-full text-left px-2 py-1 text-[11px] hover:bg-muted"
                onClick={() => {
                  onChange(o.value);
                  onClose();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    );
  };

  return (
    <tr className={`${hasError
      ? 'bg-red-50/60 dark:bg-red-950/20'
      : hasMissingCell
        ? 'bg-red-50/40 dark:bg-red-950/10'
        : 'hover:bg-muted/30'
    } transition-colors`}>
      {/* Row controls */}
      <td className="relative px-0.5 py-0.5 border-b border-r align-middle w-11">
        <div className="flex items-center justify-start gap-1.5 pl-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-3 w-3 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                title="행 작업"
              >
                <GripVertical className="h-2.5 w-2.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-[11px]">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertBelow();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                아래에 행 추가
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <X className="h-3.5 w-3.5" />
                행 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="inline-flex text-[9px] text-muted-foreground">{rowIdx + 1}</span>
        </div>
        {(hasError || hasMissingCell) && (
          <span
            className="absolute right-1 top-1 h-1 w-1 rounded-full bg-rose-500"
            title={hasError ? (row.error || '행 오류') : '미입력 셀 있음'}
          />
        )}
      </td>
      {/* Data cells */}
      {SETTLEMENT_COLUMNS.map((col, colIdx) => {
        const isReadOnly = col.csvHeader === 'No.';
        const isBudgetCode = colIdx === budgetCodeIdx;
        const isSubCode = colIdx === subCodeIdx;
        const isWeek = colIdx === weekIdx;
        const isCashflow = colIdx === cashflowIdx;
        const isAuthor = colIdx === authorIdx;
        const isDriveLink = col.csvHeader === '증빙자료 드라이브';
        const isSettlementNote = col.csvHeader === '비고';
        const hasAuthorOptions = (authorOptions || []).length > 0;
        return (
          <td
            key={colIdx}
            className={`px-0.5 py-0.5 border-b border-r focus-within:bg-teal-50/20 focus-within:shadow-[inset_0_0_0_2px_rgba(20,184,166,0.8)] ${isCellSelected(colIdx)
              ? 'bg-teal-50/40 dark:bg-teal-900/20 shadow-[inset_0_0_0_2px_rgba(20,184,166,0.7)]'
              : ''
            }`}
            style={{ width: colWidths[colIdx], minWidth: 60 }}
            onPaste={(e) => {
              if (isReadOnly) return;
              handlePaste(colIdx, e);
            }}
            onMouseDown={() => onCellMouseDown(rowIdx, colIdx)}
            onMouseEnter={() => onCellMouseEnter(rowIdx, colIdx)}
          >
            <div className="group relative">
              {isReadOnly ? (
                <span className="block pr-6 text-[10px] text-muted-foreground px-1">
                  {row.cells[colIdx]}
                </span>
              ) : isWeek ? (
                <div className="pr-6">
                  <SelectCell
                    value={row.cells[colIdx] || ''}
                    options={weekOptions}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(next) => onCellChange(colIdx, next)}
                  />
                </div>
              ) : colIdx === methodIdx ? (
                <div className="pr-6">
                  <SelectCell
                    value={row.cells[colIdx] || ''}
                    options={METHOD_OPTIONS.map((o) => ({ value: o.label, label: o.label }))}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(next) => {
                      if (next !== row.cells[colIdx]) onCellChange(colIdx, next);
                    }}
                  />
                </div>
              ) : isCashflow ? (
                <div className="pr-6">
                  <SelectCell
                    value={row.cells[colIdx] || ''}
                    options={cashflowOptions.map((o) => ({ value: o.label, label: o.label }))}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(next) => onCellChange(colIdx, next)}
                  />
                </div>
              ) : isBudgetCode ? (
                <div className="pr-6">
                  <SelectCell
                    value={normalizeBudgetLabel(String(row.cells[colIdx] || ''))}
                    options={budgetCodeBook.map((c, idx) => ({ value: c.code, label: formatBudgetCodeLabel(idx, c.code) }))}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(nextCode) => {
                      onRowChange((prev) => {
                        if (budgetCodeIdx < 0) return prev;
                        const cells = [...prev.cells];
                        cells[budgetCodeIdx] = nextCode;
                        if (subCodeIdx >= 0) {
                          const allowed = budgetCodeBook.find((c) => c.code === nextCode)?.subCodes || [];
                          const currentSub = normalizeBudgetLabel(String(cells[subCodeIdx] || ''));
                          if (!allowed.includes(currentSub)) {
                            cells[subCodeIdx] = '';
                          } else {
                            cells[subCodeIdx] = currentSub;
                          }
                        }
                        if (evidenceIdx >= 0) {
                          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, nextCode, cells[subCodeIdx] || '');
                          if (mapped) cells[evidenceIdx] = mapped;
                        }
                        return { ...prev, cells };
                      });
                    }}
                  />
                </div>
              ) : isSubCode ? (
                <div className="pr-6">
                  <SelectCell
                    value={normalizeBudgetLabel(String(row.cells[colIdx] || ''))}
                    options={subCodes.map((sc, sidx) => {
                      const codeIdx = Math.max(0, budgetCodeBook.findIndex((c) => c.code === budgetCode));
                      return { value: sc, label: formatSubCodeLabel(codeIdx, sidx, sc) };
                    })}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    disabled={!budgetCode}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(nextSub) => {
                      onRowChange((prev) => {
                        if (subCodeIdx < 0) return prev;
                        const cells = [...prev.cells];
                        cells[subCodeIdx] = nextSub;
                        if (evidenceIdx >= 0) {
                          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, nextSub);
                          if (mapped) cells[evidenceIdx] = mapped;
                        }
                        return { ...prev, cells };
                      });
                    }}
                  />
                </div>
              ) : isAuthor && hasAuthorOptions ? (
                <div className="pr-6">
                  <SelectCell
                    value={row.cells[colIdx] || ''}
                    options={(authorOptions || []).map((name) => ({ value: name, label: name }))}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    cellColIdx={colIdx}
                    isOpen={openSelect?.rowIdx === rowIdx && openSelect?.colIdx === colIdx}
                    onOpen={() => onOpenSelect(rowIdx, colIdx)}
                    onClose={onCloseSelect}
                    onChange={(next) => onCellChange(colIdx, next)}
                  />
                </div>
              ) : isSettlementNote ? (
                <div className="flex items-center gap-1 pr-6">
                  <select
                    value={parseContentStatusNote(String(row.cells[colIdx] || '')).status}
                    data-cell-row={rowIdx}
                    data-cell-col={colIdx}
                    className="h-6 rounded border bg-background px-1 text-[10px]"
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    onChange={(e) => {
                      const parsed = parseContentStatusNote(String(row.cells[colIdx] || ''));
                      onCellChange(colIdx, composeContentStatusNote(
                        (e.target.value as '' | '미완료' | '완료'),
                        parsed.text,
                      ));
                    }}
                  >
                    <option value="">상태</option>
                    <option value="미완료">미완료</option>
                    <option value="완료">완료</option>
                  </select>
                  <input
                    type="text"
                    value={parseContentStatusNote(String(row.cells[colIdx] || '')).text}
                    className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5"
                    data-cell-row={rowIdx}
                    data-cell-col={colIdx}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    onPaste={(e) => handlePaste(colIdx, e)}
                    onChange={(e) => {
                      const parsed = parseContentStatusNote(String(row.cells[colIdx] || ''));
                      onCellChange(colIdx, composeContentStatusNote(parsed.status, e.target.value));
                    }}
                  />
                </div>
              ) : isDriveLink ? (
                <div className="space-y-1.5 pr-10">
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-5 px-1.5 text-[9px]"
                      disabled={driveAction !== '' || !canUseDrive || !onProvisionEvidenceDriveById}
                      title={hasSourceTransaction ? '거래별 증빙 폴더 생성' : '필요한 값을 확인한 뒤 실제 거래로 저장하고 계속합니다'}
                      onClick={() => {
                        void runDriveAction('provision', onProvisionEvidenceDriveById);
                      }}
                    >
                      {driveAction === 'provision' ? '생성중' : '생성'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-5 px-1.5 text-[9px]"
                      disabled={!canUseDrive || !onOpenEvidenceUpload}
                      title={hasSourceTransaction ? '파일 업로드 및 분류 검토' : '필요한 값을 확인한 뒤 실제 거래로 저장하고 계속합니다'}
                      onClick={() => {
                        if (!onOpenEvidenceUpload) return;
                        void (async () => {
                          const txId = persistedTransactionId || await onEnsurePersistedTransaction?.();
                          if (!txId) return;
                          onOpenEvidenceUpload(txId);
                        })();
                      }}
                    >
                      <Upload className="mr-1 h-2.5 w-2.5" />
                      업로드
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-5 px-1.5 text-[9px]"
                      disabled={driveAction !== '' || !canUseDrive || !onSyncEvidenceDriveById}
                      title={hasSourceTransaction ? 'Drive 파일목록 동기화' : '필요한 값을 확인한 뒤 실제 거래로 저장하고 계속합니다'}
                      onClick={() => {
                        void runDriveAction('sync', onSyncEvidenceDriveById);
                      }}
                    >
                      {driveAction === 'sync' ? '동기화중' : '동기화'}
                    </Button>
                  </div>
                  <input
                    type="text"
                    value={row.cells[colIdx] || ''}
                    className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5"
                    data-cell-row={rowIdx}
                    data-cell-col={colIdx}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    onPaste={(e) => handlePaste(colIdx, e)}
                    onChange={(e) => onCellChange(colIdx, e.target.value)}
                    placeholder={hasSourceTransaction ? '생성 후 Drive 폴더 링크가 표시됩니다.' : '행 저장 후 Drive 사용 가능'}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={row.cells[colIdx] || ''}
                  className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 pr-6 ${hasError && colIdx === dateIdx && !row.cells[colIdx]
                    ? 'ring-1 ring-red-300 rounded'
                    : ''
                    }`}
                  data-cell-row={rowIdx}
                  data-cell-col={colIdx}
                  list={isAuthor && authorListId ? authorListId : undefined}
                  onFocus={() => onCellFocus(rowIdx, colIdx)}
                  onPaste={(e) => handlePaste(colIdx, e)}
                  onChange={(e) => {
                    const next = col.format === 'number'
                      ? formatNumberInput(e.target.value)
                      : e.target.value;
                    onCellChange(colIdx, next);
                  }}
                />
              )}
              {isDriveLink && isValidDriveUrl(String(row.cells[colIdx] || '')) && (
                <a
                  href={String(row.cells[colIdx] || '')}
                  target="_blank"
                  rel="noreferrer"
                  className="absolute top-1 right-7 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-background text-[10px] hover:bg-muted"
                  title="증빙 드라이브 열기"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {renderCommentButton(col.csvHeader)}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

function selectionKeyForRow(
  rowIdx: number,
  selectionBounds: { r1: number; r2: number; c1: number; c2: number } | null,
): string {
  if (!selectionBounds || rowIdx < selectionBounds.r1 || rowIdx > selectionBounds.r2) {
    return '';
  }
  return `${selectionBounds.c1}:${selectionBounds.c2}`;
}

function openSelectKeyForRow(
  rowIdx: number,
  openSelect: { rowIdx: number; colIdx: number } | null,
): string {
  return openSelect?.rowIdx === rowIdx ? String(openSelect.colIdx) : '';
}

const MemoizedImportEditorRow = memo(ImportEditorRow, (prev, next) => {
  return prev.row === next.row
    && prev.rowIdx === next.rowIdx
    && prev.authorListId === next.authorListId
    && prev.authorOptions === next.authorOptions
    && prev.budgetCodeBook === next.budgetCodeBook
    && prev.budgetCodeIdx === next.budgetCodeIdx
    && prev.subCodeIdx === next.subCodeIdx
    && prev.evidenceIdx === next.evidenceIdx
    && prev.weekIdx === next.weekIdx
    && prev.cashflowIdx === next.cashflowIdx
    && prev.weekOptions === next.weekOptions
    && prev.cashflowOptions === next.cashflowOptions
    && prev.evidenceRequiredMap === next.evidenceRequiredMap
    && prev.commentCountByCell === next.commentCountByCell
    && prev.persistedTransactionId === next.persistedTransactionId
    && prev.noIdx === next.noIdx
    && prev.colWidths === next.colWidths
    && selectionKeyForRow(prev.rowIdx, prev.selectionBounds) === selectionKeyForRow(next.rowIdx, next.selectionBounds)
    && openSelectKeyForRow(prev.rowIdx, prev.openSelect) === openSelectKeyForRow(next.rowIdx, next.openSelect);
});
