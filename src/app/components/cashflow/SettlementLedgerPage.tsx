import { ChevronLeft, ChevronRight, Download, Loader2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BUDGET_CODE_BOOK } from '../../data/budget-data';
import type {
  Basis,
  BudgetCodeEntry,
  BudgetTreeV2,
  Comment,
  ProjectFundInputMode,
  SettlementSheetPolicy,
  Transaction,
  TransactionState,
} from '../../data/types';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { findWeekForDate, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { parseDate, triggerDownload } from '../../platform/csv-utils';
import {
  SETTLEMENT_COLUMNS,
  SETTLEMENT_COLUMN_GROUPS,
  transactionsToImportRows,
  type ImportRow,
} from '../../platform/settlement-csv';
import { parseLocalWorkbookFile } from '../../platform/local-workbook';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { buildSettlementActualSyncPayloadLocally } from '../../platform/settlement-calculation-kernel';
import type { SettlementDerivationContext, SettlementDerivationOptions } from '../../platform/settlement-row-derivation';
import type { SettlementActualSyncWeekPayload } from '../../platform/settlement-sheet-sync';
import { normalizeSettlementWorkbookToImportRows } from '../../platform/settlement-workbook-import';
import {
  resolveWeeklyAccountingSheetRowsHydration,
  resolveWeeklyAccountingProductStatus,
  resolveWeeklyAccountingProductStatusDomHooks,
  serializeWeeklyAccountingImportRowsMaterially,
  type WeeklyAccountingSheetRowsHydrationReason,
} from '../../platform/weekly-accounting-state';
import { resolveWeeklyExpenseAutosavePlan } from '../../platform/weekly-expense-save-policy';
import { normalizeBudgetLabel } from '../../platform/budget-labels';
import { findBudgetTreeSubItem } from '../../platform/budget-tree-v2';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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
import { ImportEditor, type EvidenceUploadSelection } from './ImportEditor';
export type { EvidenceUploadSelection, PendingQuickInsert } from './ImportEditor';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { SettlementWeekSection } from './SettlementWeekSection';
import {
  buildTransactionEditHistoryEntries,
  formatCommentTime,
} from '../../platform/settlement-grid-helpers';
import {
  readImportDraftCache,
  writeImportDraftCache,
  clearImportDraftCache,
} from '../../platform/settlement-draft-cache';
import { countPendingImportRowReviews } from '../../platform/settlement-review';
import { loadExcelJs, warmExcelJs } from '../../platform/lazy-heavy-modules';

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
  onAddTransaction: (tx: Transaction) => void | Promise<void>;
  onUpdateTransaction: (id: string, updates: Partial<Transaction>) => void | Promise<void>;
  evidenceRequiredMap?: Record<string, string>;
  onSaveEvidenceRequiredMap?: (map: Record<string, string>) => void | Promise<void>;
  saving?: boolean;
  sheetRows?: ImportRow[] | null;
  onSaveSheetRows?: (rows: ImportRow[]) => ImportRow[] | void | Promise<ImportRow[] | void>;
  saveMode?: 'auto' | 'manual';
  showSaveStatusButton?: boolean;
  authorOptions?: string[];
  budgetCodeBook?: BudgetCodeEntry[];
  budgetTreeV2?: BudgetTreeV2 | null;
  hideYearControls?: boolean;
  hideCountBadge?: boolean;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void | Promise<void>;
  /** Current user name for audit trail */
  currentUserName?: string;
  currentUserId?: string;
  userRole?: 'pm' | 'admin';
  comments?: Comment[];
  onAddComment?: (comment: Comment) => void | Promise<void>;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onUploadEvidenceDrive?: (tx: Transaction, uploads: EvidenceUploadSelection[]) => void | Promise<unknown>;
  onEnsureTransactionPersisted?: (input: {
    transaction: Transaction;
    sourceTxId?: string;
  }) => Promise<string | null>;
  allowEditSubmitted?: boolean;
  /** 거래처 이름으로 비목/세목 히스토리 제안을 요청하는 콜백. 제공 시에만 제안 칩 표시. */
  onFetchBudgetSuggestion?: (counterparty: string) => Promise<{ budgetCategory: string; budgetSubCategory: string } | null>;
  workflowMode?: ProjectFundInputMode;
  settlementSheetPolicy?: SettlementSheetPolicy;
  basis?: Basis;
  onUpdateWeeklySubmissionStatus?: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    expenseUpdated?: boolean;
    expenseSyncState?: 'pending' | 'review_required' | 'synced' | 'sync_failed';
    expenseReviewPendingCount?: number;
  }) => void | Promise<void>;
  pendingQuickInsert?: import('./ImportEditor').PendingQuickInsert | null;
  onPendingQuickInsertHandled?: () => void;
  onDeriveRows?: (
    rows: ImportRow[],
    context: SettlementDerivationContext,
    options: SettlementDerivationOptions,
  ) => Promise<ImportRow[]>;
  onPreviewActualSyncPayload?: (
    rows: ImportRow[],
    yearWeeks: MonthMondayWeek[],
    persistedRows?: ImportRow[] | null,
  ) => Promise<SettlementActualSyncWeekPayload[]>;
  onDirtyStateChange?: (dirty: boolean) => void;
  onSavingStateChange?: (saving: boolean) => void;
  discardChangesRequestToken?: number;
  autoSaveIdleMs?: number;
  autoSaveSyncCashflow?: boolean;
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
  saveMode = 'manual',
  showSaveStatusButton = true,
  authorOptions,
  budgetCodeBook,
  budgetTreeV2,
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
  allowEditSubmitted = false,
  onFetchBudgetSuggestion,
  workflowMode = 'BANK_UPLOAD',
  settlementSheetPolicy,
  basis,
  onUpdateWeeklySubmissionStatus,
  pendingQuickInsert,
  onPendingQuickInsertHandled,
  onDeriveRows,
  onPreviewActualSyncPayload,
  onDirtyStateChange,
  onSavingStateChange,
  discardChangesRequestToken = 0,
  autoSaveIdleMs = 60_000,
  autoSaveSyncCashflow = true,
}: SettlementLedgerProps) {
  const { upsertWeekAmounts } = useCashflowWeeks();
  const isDirectEntryMode = workflowMode === 'DIRECT_ENTRY';
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importDirty, setImportDirty] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [cashflowSyncing, setCashflowSyncing] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState('');
  const [lastCashflowSyncedAt, setLastCashflowSyncedAt] = useState('');
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [sheetSaveState, setSheetSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'save_failed'>('idle');
  const [cashflowSyncState, setCashflowSyncState] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'sync_failed' | 'review_required'>('idle');
  const [downloadFrom, setDownloadFrom] = useState('');
  const [downloadTo, setDownloadTo] = useState('');
  const [downloadPreparing, setDownloadPreparing] = useState(false);
  const [directEntryUploading, setDirectEntryUploading] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const directEntryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const restoredDraftCacheKeyRef = useRef('');
  const hasAppliedSheetRowsRef = useRef(false);
  const lastDiscardChangesRequestTokenRef = useRef(0);
  const pendingSheetRowsEchoSignatureRef = useRef<string | null>(null);
  const pendingSheetRowsSyncRef = useRef<{ rows: ImportRow[] | null; reason: WeeklyAccountingSheetRowsHydrationReason } | null>(null);
  const cloneImportRows = useCallback((input: ImportRow[]) => (
    input.map((row) => ({
      ...row,
      cells: [...row.cells],
      ...(row.reviewHints ? { reviewHints: [...row.reviewHints] } : {}),
      ...(row.reviewRequiredCellIndexes ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes] } : {}),
      ...(row.userEditedCells ? { userEditedCells: new Set(row.userEditedCells) } : {}),
    }))
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
  const weekIdx = useMemo(() => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '해당 주차'), []);
  const dateIdx = useMemo(() => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시'), []);
  const budgetCodeIdx = useMemo(() => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비목'), []);
  const subCodeIdx = useMemo(() => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '세목'), []);
  const subSubCodeIdx = useMemo(() => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '세세목'), []);

  // Filter transactions for this project + year
  const projectTxs = useMemo(() => {
    const yearStr = String(year);
    return allTransactions.filter(
      (tx) => tx.projectId === projectId && (!tx.dateTime || tx.dateTime.startsWith(yearStr)),
    );
  }, [allTransactions, projectId, year]);

  const sanitizeBudgetSubSubRows = useCallback((input: ImportRow[]) => {
    if (subSubCodeIdx < 0) return input;
    return input.map((row) => {
      const currentSubSub = normalizeBudgetLabel(row.cells[subSubCodeIdx] || '');
      if (!currentSubSub) return row;
      const budgetCode = budgetCodeIdx >= 0 ? normalizeBudgetLabel(row.cells[budgetCodeIdx] || '') : '';
      const subCode = subCodeIdx >= 0 ? normalizeBudgetLabel(row.cells[subCodeIdx] || '') : '';
      if (!budgetTreeV2?.codes || !budgetCode || !subCode) {
        const cells = [...row.cells];
        cells[subSubCodeIdx] = '';
        return { ...row, cells };
      }
      const subItem = findBudgetTreeSubItem(budgetTreeV2.codes, budgetCode, subCode);
      const validSubSubs = new Set(
        (subItem?.leafItems || [])
          .map((leaf) => normalizeBudgetLabel(leaf.subSubCode))
          .filter(Boolean),
      );
      if (validSubSubs.size === 0 || !validSubSubs.has(currentSubSub)) {
        const cells = [...row.cells];
        cells[subSubCodeIdx] = '';
        return { ...row, cells };
      }
      return row;
    });
  }, [budgetCodeIdx, budgetTreeV2?.codes, subCodeIdx, subSubCodeIdx]);

  useEffect(() => {
    if (importDirty) return;
    if (restoredDraftCacheKeyRef.current !== draftCacheKey) {
      const cachedRows = readImportDraftCache(draftCacheKey);
      if (cachedRows && cachedRows.length > 0) {
        restoredDraftCacheKeyRef.current = draftCacheKey;
        setImportRows(cachedRows);
        setImportDirty(true);
        setSheetSaveState('dirty');
        toast.message('브라우저 임시 저장본을 복원했습니다.');
        return;
      }
      restoredDraftCacheKeyRef.current = draftCacheKey;
    }
  }, [draftCacheKey, importDirty]);

  useEffect(() => {
    if (!importDirty || !importRows || importRows.length === 0) return;
    const timer = window.setTimeout(() => {
      writeImportDraftCache(draftCacheKey, importRows);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftCacheKey, importDirty, importRows]);

  const applySheetRowsSync = useCallback((rows: ImportRow[] | null | undefined, reason: WeeklyAccountingSheetRowsHydrationReason) => {
    const hasPersistedRows = Boolean(rows && rows.length > 0);
    const incomingRowsOrigin = reason === 'persistence_echo' || hasPersistedRows
      ? 'persisted'
      : 'fallback';
    const incomingRows = reason === 'persistence_echo'
      ? (rows ?? null)
      : (rows && rows.length > 0 ? rows : transactionsToImportRows(projectTxs, yearWeeks));
    const hydration = resolveWeeklyAccountingSheetRowsHydration({
      reason,
      currentRows: importRows,
      incomingRows,
      incomingRowsOrigin,
      currentSaveState: sheetSaveState,
      currentSyncState: cashflowSyncState,
    });
    if (hydration.shouldReplaceRows) {
      setImportRows(cloneImportRows(incomingRows || []));
    }
    setImportDirty(false);
    setSheetSaveState(hydration.nextSaveState);
    setCashflowSyncState(hydration.nextSyncState);
    if (reason !== 'persistence_echo') {
      clearImportDraftCache(draftCacheKey);
    } else {
      pendingSheetRowsEchoSignatureRef.current = null;
    }
    hasAppliedSheetRowsRef.current = true;
  }, [cashflowSyncState, cloneImportRows, draftCacheKey, importRows, projectTxs, sheetSaveState, yearWeeks]);

  useEffect(() => {
    const nextSignature = serializeWeeklyAccountingImportRowsMaterially(sheetRows);

    // 그리드 셀에 포커스가 있으면 리셋을 defer — 타이핑 중 백스페이스 끊김 방지
    const active = document.activeElement;
    const isCellFocused = active instanceof HTMLInputElement && active.getAttribute('data-cell-row') != null;
    const isPersistenceEcho = pendingSheetRowsEchoSignatureRef.current !== null
      && nextSignature === pendingSheetRowsEchoSignatureRef.current;
    const reason: WeeklyAccountingSheetRowsHydrationReason = !hasAppliedSheetRowsRef.current
      ? 'initial_hydrate'
      : isPersistenceEcho
        ? 'persistence_echo'
        : 'active_sheet_switch_hydrate';
    if (isCellFocused) {
      const syncRows = reason === 'persistence_echo'
        ? (sheetRows ?? null)
        : (sheetRows && sheetRows.length > 0 ? sheetRows : transactionsToImportRows(projectTxs, yearWeeks));
      pendingSheetRowsSyncRef.current = { rows: syncRows, reason };
      return;
    }

    applySheetRowsSync(sheetRows, reason);
  }, [applySheetRowsSync, projectTxs, sheetRows, yearWeeks]);

  // 포커스가 그리드 밖으로 나갈 때 pending sync 적용
  useEffect(() => {
    const handleFocusOut = () => {
      if (!pendingSheetRowsSyncRef.current) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const isCellFocused = active instanceof HTMLInputElement && active.getAttribute('data-cell-row') != null;
        if (isCellFocused) return; // 그리드 내 다른 셀로 이동한 경우 유지
        const pending = pendingSheetRowsSyncRef.current;
        if (!pending) return;
        pendingSheetRowsSyncRef.current = null;
        applySheetRowsSync(pending.rows, pending.reason);
      });
    };
    document.addEventListener('focusout', handleFocusOut);
    return () => document.removeEventListener('focusout', handleFocusOut);
  }, [applySheetRowsSync]);

  const revertToSavedSnapshot = useCallback(() => {
    if (sheetSaving) return;
    pendingSheetRowsEchoSignatureRef.current = null;
    pendingSheetRowsSyncRef.current = null;
    if (sheetRows && sheetRows.length > 0) {
      setImportRows(cloneImportRows(sheetRows));
      setImportDirty(false);
      setSheetSaveState('saved');
      setCashflowSyncState('synced');
      clearImportDraftCache(draftCacheKey);
      toast.message('마지막 저장값으로 되돌렸습니다.');
      hasAppliedSheetRowsRef.current = true;
      return;
    }
    setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
    setImportDirty(false);
    setSheetSaveState('idle');
    setCashflowSyncState('idle');
    clearImportDraftCache(draftCacheKey);
    toast.message('저장된 사업비 입력이 없어 기본값으로 되돌렸습니다.');
    hasAppliedSheetRowsRef.current = true;
  }, [sheetSaving, sheetRows, cloneImportRows, projectTxs, yearWeeks, draftCacheKey]);

  const handleRevertToSaved = useCallback(() => {
    if (sheetSaving) return;
    setRevertConfirmOpen(true);
  }, [sheetSaving]);

  const handleConfirmRevert = useCallback(() => {
    setRevertConfirmOpen(false);
    revertToSavedSnapshot();
  }, [revertToSavedSnapshot]);

  useEffect(() => {
    if (!discardChangesRequestToken) return;
    if (discardChangesRequestToken === lastDiscardChangesRequestTokenRef.current) return;
    lastDiscardChangesRequestTokenRef.current = discardChangesRequestToken;
    setRevertConfirmOpen(false);
    revertToSavedSnapshot();
  }, [discardChangesRequestToken, revertToSavedSnapshot]);

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
    setDownloadPreparing(true);
    try {
      const ExcelJS = await loadExcelJs();
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
    } finally {
      setDownloadPreparing(false);
    }
  }, [buildExportMatrix, projectName, year]);

  const resolveWeekLabelForImportRow = useCallback((row: ImportRow): string => {
    const explicitLabel = weekIdx >= 0 ? String(row.cells[weekIdx] || '').trim() : '';
    if (explicitLabel) return explicitLabel;
    if (dateIdx < 0) return '';
    const parsedDate = parseDate(String(row.cells[dateIdx] || '').trim());
    if (!parsedDate) return '';
    const dateOnly = parsedDate.slice(0, 10);
    const dateYear = Number.parseInt(dateOnly.slice(0, 4), 10);
    if (!Number.isFinite(dateYear)) return '';
    const anchorYear = Number.parseInt(yearWeeks[0]?.yearMonth.slice(0, 4) || '', 10);
    const matchedWeek = findWeekForDate(
      dateOnly,
      dateYear === anchorYear ? yearWeeks : getYearMondayWeeks(dateYear),
    );
    return matchedWeek?.label || '';
  }, [dateIdx, weekIdx, yearWeeks]);

  const buildPendingReviewCountsByWeek = useCallback((rows: ImportRow[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const isPending = (row.reviewHints?.length || 0) > 0 && row.reviewStatus !== 'confirmed';
      if (!isPending) continue;
      const weekLabel = resolveWeekLabelForImportRow(row);
      if (!weekLabel) continue;
      counts.set(weekLabel, (counts.get(weekLabel) || 0) + 1);
    }
    return counts;
  }, [resolveWeekLabelForImportRow]);

  const buildPayloadWeekLabelMap = useCallback(() => {
    const labelMap = new Map<string, string>();
    for (const week of yearWeeks) {
      labelMap.set(`${week.yearMonth}:${week.weekNo}`, week.label);
    }
    return labelMap;
  }, [yearWeeks]);

  const updateWeeklyStatusesForPayload = useCallback(async (
    payload: Array<{ yearMonth: string; weekNo: number }>,
    input: {
      expenseUpdated?: boolean;
      expenseSyncState: 'pending' | 'review_required' | 'synced' | 'sync_failed';
      reviewCountsByWeekLabel?: Map<string, number>;
    },
  ) => {
    if (!onUpdateWeeklySubmissionStatus || payload.length === 0) return;
    const weekLabelMap = buildPayloadWeekLabelMap();
    await Promise.all(payload.map((week) => onUpdateWeeklySubmissionStatus({
      projectId,
      yearMonth: week.yearMonth,
      weekNo: week.weekNo,
      ...(typeof input.expenseUpdated === 'boolean' ? { expenseUpdated: input.expenseUpdated } : {}),
      expenseSyncState: input.expenseSyncState,
      expenseReviewPendingCount: input.reviewCountsByWeekLabel?.get(
        weekLabelMap.get(`${week.yearMonth}:${week.weekNo}`) || '',
      ) || 0,
    })));
  }, [buildPayloadWeekLabelMap, onUpdateWeeklySubmissionStatus, projectId]);

  const persistImportRowsSnapshot = useCallback(async (
    rows: ImportRow[],
    options?: { silent?: boolean },
  ) => {
    if (!onSaveSheetRows) {
      toast.error('저장 기능이 연결되어 있지 않습니다.');
      return false;
    }
    const silent = options?.silent ?? false;
    setSheetSaving(true);
    setSheetSaveState('saving');
    try {
      const sanitizedRows = sanitizeBudgetSubSubRows(rows);
      setImportRows(cloneImportRows(sanitizedRows));
      const persistedRows = await onSaveSheetRows(sanitizedRows);
      const previewSourceRows = Array.isArray(persistedRows) ? persistedRows : sanitizedRows;
      pendingSheetRowsEchoSignatureRef.current = serializeWeeklyAccountingImportRowsMaterially(previewSourceRows);
      const payload = onPreviewActualSyncPayload
        ? await onPreviewActualSyncPayload(previewSourceRows, yearWeeks, sheetRows || null)
        : buildSettlementActualSyncPayloadLocally(previewSourceRows, yearWeeks, sheetRows || null);
      await updateWeeklyStatusesForPayload(payload, {
        expenseUpdated: true,
        expenseSyncState: 'pending',
      });
      setImportDirty(false);
      setSheetSaveState('saved');
      setCashflowSyncState('pending');
      clearImportDraftCache(draftCacheKey);
      setLastAutoSavedAt(new Date().toISOString());
      if (!silent) toast.success('정산대장을 저장했습니다.');
      return previewSourceRows;
    } catch (err) {
      console.error('[SettlementLedger] save sheet failed:', err);
      setSheetSaveState('save_failed');
      if (!silent) toast.error('정산대장 저장에 실패했습니다.');
      return null;
    } finally {
      setSheetSaving(false);
    }
  }, [cloneImportRows, draftCacheKey, onPreviewActualSyncPayload, onSaveSheetRows, sanitizeBudgetSubSubRows, sheetRows, updateWeeklyStatusesForPayload, yearWeeks]);

  const syncImportRowsToCashflow = useCallback(async (
    rows: ImportRow[],
    options?: { silent?: boolean },
  ) => {
    const silent = options?.silent ?? false;
    const pendingReviewCount = countPendingImportRowReviews(rows);
    const reviewCountsByWeekLabel = buildPendingReviewCountsByWeek(rows);
    const payload = onPreviewActualSyncPayload
      ? await onPreviewActualSyncPayload(rows, yearWeeks, sheetRows || null)
      : buildSettlementActualSyncPayloadLocally(rows, yearWeeks, sheetRows || null);
    const weekLabelMap = buildPayloadWeekLabelMap();
    const blockedWeeks = payload.filter((week) => (
      reviewCountsByWeekLabel.get(weekLabelMap.get(`${week.yearMonth}:${week.weekNo}`) || '') || 0
    ) > 0);
    const syncableWeeks = payload.filter((week) => !blockedWeeks.includes(week));
    setCashflowSyncing(true);
    setCashflowSyncState(blockedWeeks.length > 0 ? 'review_required' : 'syncing');
    try {
      let syncFailed = false;
      await Promise.all(
        syncableWeeks.map(async (week) => {
          try {
            await upsertWeekAmounts({
              projectId,
              yearMonth: week.yearMonth,
              weekNo: week.weekNo,
              mode: 'actual',
              amounts: week.amounts as any,
            });
          } catch (err) {
            syncFailed = true;
            console.error('[SettlementLedger] cashflow actual update failed:', err);
          }
        }),
      );
      if (blockedWeeks.length > 0) {
        await updateWeeklyStatusesForPayload(blockedWeeks, {
          expenseUpdated: true,
          expenseSyncState: 'review_required',
          reviewCountsByWeekLabel,
        });
      }
      if (syncFailed) {
        await updateWeeklyStatusesForPayload(syncableWeeks, {
          expenseUpdated: true,
          expenseSyncState: 'sync_failed',
          reviewCountsByWeekLabel,
        });
        setCashflowSyncState('sync_failed');
        if (!silent) toast.message('정산대장은 저장되었지만 캐시플로 업데이트에 실패했습니다.');
        return 'sync_failed' as const;
      }
      if (syncableWeeks.length > 0) {
        await updateWeeklyStatusesForPayload(syncableWeeks, {
          expenseUpdated: true,
          expenseSyncState: 'synced',
          reviewCountsByWeekLabel,
        });
      }
      setCashflowSyncState(blockedWeeks.length > 0 ? 'review_required' : 'synced');
      setLastCashflowSyncedAt(new Date().toISOString());
      if (!silent) {
        if (blockedWeeks.length > 0 && syncableWeeks.length > 0) {
          toast.success(`검토가 끝난 ${syncableWeeks.length}개 주차는 캐시플로에 반영했고, ${blockedWeeks.length}개 주차는 사람 확인 상태로 남겼습니다.`);
        } else if (blockedWeeks.length > 0) {
          toast.message(`정산대장은 저장했고, 사람 확인 ${pendingReviewCount}건이 있는 주차는 검토 후 캐시플로에 반영됩니다.`);
        } else {
          toast.success('캐시플로 실제값까지 동기화했습니다.');
        }
      }
      return blockedWeeks.length > 0 ? ('review_required' as const) : ('synced' as const);
    } finally {
      setCashflowSyncing(false);
    }
  }, [buildPayloadWeekLabelMap, buildPendingReviewCountsByWeek, onPreviewActualSyncPayload, projectId, sheetRows, updateWeeklyStatusesForPayload, upsertWeekAmounts, yearWeeks]);

  const handleImportSave = useCallback(async (options?: { silent?: boolean; syncCashflow?: boolean }) => {
    if (!importRows) return;
    const silent = options?.silent ?? false;
    const syncCashflow = options?.syncCashflow ?? true;
    const persistedRows = await persistImportRowsSnapshot(importRows, { silent });
    if (!persistedRows) return;
    if (syncCashflow) {
      await syncImportRowsToCashflow(persistedRows, { silent });
    }
  }, [importRows, persistImportRowsSnapshot, syncImportRowsToCashflow]);

  const applyDirectEntryWorkbookRows = useCallback(async (rows: ImportRow[], sheetName: string) => {
    const nextRows = cloneImportRows(rows);
    setImportRows(nextRows);
    setImportDirty(true);
    setSheetSaveState('dirty');
    const persistedRows = await persistImportRowsSnapshot(nextRows, { silent: true });
    if (!persistedRows) {
      toast.error(`작성본 업로드는 완료됐지만 저장에 실패했습니다: ${sheetName}`);
      return;
    }
    const syncOutcome = await syncImportRowsToCashflow(persistedRows, { silent: true });
    if (syncOutcome === 'synced') {
      toast.success(`작성본 ${persistedRows.length}건을 저장하고 캐시플로 actual까지 반영했습니다.`);
      return;
    }
    if (syncOutcome === 'review_required') {
      toast.message(`작성본 ${persistedRows.length}건을 저장했고, 사람 확인이 필요한 주차는 검토 후 actual에 반영됩니다.`);
      return;
    }
    toast.error(`작성본 ${persistedRows.length}건은 저장했지만 캐시플로 actual 반영은 다시 확인이 필요합니다.`);
  }, [cloneImportRows, persistImportRowsSnapshot, syncImportRowsToCashflow]);

  const handleDirectEntryWorkbookFile = useCallback(async (file: File) => {
    setDirectEntryUploading(true);
    try {
      const sheets = await parseLocalWorkbookFile(file);
      const normalized = normalizeSettlementWorkbookToImportRows(sheets);
      if (!normalized) {
        toast.error('정산대장 형식을 찾지 못했습니다. 엑셀 템플릿 또는 저장한 CSV/XLSX 파일을 확인해 주세요.');
        return;
      }
      await applyDirectEntryWorkbookRows(normalized.rows, normalized.sheetName);
    } catch (error) {
      console.error('[SettlementLedger] direct-entry workbook upload failed:', error);
      toast.error(resolveApiErrorMessage(error, '작성본 업로드에 실패했습니다.'));
    } finally {
      setDirectEntryUploading(false);
      if (directEntryUploadInputRef.current) {
        directEntryUploadInputRef.current.value = '';
      }
    }
  }, [applyDirectEntryWorkbookRows]);

  const openDirectEntryUploadPicker = useCallback(() => {
    directEntryUploadInputRef.current?.click();
  }, []);

  const autosavePlan = useMemo(() => resolveWeeklyExpenseAutosavePlan({
    saveMode,
    idleMs: autoSaveIdleMs,
    syncCashflowOnAutoSave: autoSaveSyncCashflow,
    importDirty,
    hasImportRows: Boolean(importRows && importRows.length > 0),
    hasSaveHandler: Boolean(onSaveSheetRows),
    sheetSaving,
  }), [autoSaveIdleMs, autoSaveSyncCashflow, importDirty, importRows, onSaveSheetRows, saveMode, sheetSaving]);

  useEffect(() => {
    if (!autosavePlan.shouldSchedule) return;
    const timer = window.setTimeout(() => {
      void handleImportSave({ silent: true, syncCashflow: autosavePlan.syncCashflow });
    }, autosavePlan.idleMs);
    return () => window.clearTimeout(timer);
  }, [autosavePlan, handleImportSave]);

  useEffect(() => {
    if (!importDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [importDirty]);

  useEffect(() => {
    onDirtyStateChange?.(importDirty || sheetSaveState === 'dirty');
  }, [importDirty, onDirtyStateChange, sheetSaveState]);

  useEffect(() => {
    onSavingStateChange?.(sheetSaveState === 'saving');
  }, [onSavingStateChange, sheetSaveState]);

  useEffect(() => () => {
    onDirtyStateChange?.(false);
  }, [onDirtyStateChange]);

  useEffect(() => () => {
    onSavingStateChange?.(false);
  }, [onSavingStateChange]);

  const saveStatusLabel = useMemo(() => {
    if (sheetSaveState === 'saving') return '시트 저장 중...';
    if (sheetSaveState === 'save_failed') return '시트 저장 실패';
    if (importDirty || sheetSaveState === 'dirty') return '저장 전 초안';
    if (cashflowSyncState === 'review_required') return '저장 완료 · 사람 확인 필요';
    if (cashflowSyncState === 'syncing') return '저장 완료 · actual 반영 중';
    if (cashflowSyncState === 'sync_failed') return '저장 완료 · actual 반영 실패';
    if (cashflowSyncState === 'pending') {
      return lastAutoSavedAt
        ? `저장 완료 ${formatCommentTime(lastAutoSavedAt)} · actual 반영 대기`
        : '저장 완료 · actual 반영 대기';
    }
    if (cashflowSyncState === 'synced' && lastCashflowSyncedAt) {
      return `동기화 완료 ${formatCommentTime(lastCashflowSyncedAt)}`;
    }
    if (lastAutoSavedAt) {
      return `${saveMode === 'manual' ? '수동 저장' : '자동 저장'} ${formatCommentTime(lastAutoSavedAt)}`;
    }
    return saveMode === 'manual' ? '수동 저장만 사용' : '자동 저장 대기';
  }, [cashflowSyncState, importDirty, lastAutoSavedAt, lastCashflowSyncedAt, saveMode, sheetSaveState]);

  const pendingReviewCount = useMemo(() => countPendingImportRowReviews(importRows || []), [importRows]);

  const weeklyAccountingStatus = useMemo(() => resolveWeeklyAccountingProductStatus({
    snapshot: {
      projectionEdited: importDirty,
      projectionDone: true,
      expenseEdited: importDirty,
      expenseDone: sheetSaveState === 'saved' || cashflowSyncState === 'pending' || cashflowSyncState === 'syncing' || cashflowSyncState === 'synced' || cashflowSyncState === 'review_required' || cashflowSyncState === 'sync_failed',
      expenseSyncState: cashflowSyncState === 'review_required' || cashflowSyncState === 'sync_failed' || cashflowSyncState === 'synced'
        ? cashflowSyncState
        : 'pending',
      expenseReviewPendingCount: pendingReviewCount,
      pmSubmitted: false,
      adminClosed: false,
    },
    saveState: sheetSaveState,
    syncState: cashflowSyncState,
    reviewCount: pendingReviewCount,
  }), [cashflowSyncState, importDirty, pendingReviewCount, sheetSaveState]);
  const weeklyAccountingStatusHooks = useMemo(
    () => resolveWeeklyAccountingProductStatusDomHooks(weeklyAccountingStatus),
    [weeklyAccountingStatus],
  );
  const saveStatusButton = showSaveStatusButton && onSaveSheetRows ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer shadow-sm hover:bg-muted/40"
          data-testid={weeklyAccountingStatusHooks.testId}
          aria-label={weeklyAccountingStatusHooks.ariaLabel}
        >
          <span className="mr-2 text-[11px]">{weeklyAccountingStatus.label}</span>
          <span className="text-[10px] text-muted-foreground">저장 상태</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] rounded-xl border border-slate-200/80 bg-background p-4 dark:border-slate-800">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Save Status</p>
          <p className="text-[11px] text-muted-foreground">{saveStatusLabel}</p>
          <p
            className={
              weeklyAccountingStatus.tone === 'success'
                ? 'text-[13px] font-semibold text-emerald-700 dark:text-emerald-300'
                : weeklyAccountingStatus.tone === 'danger'
                  ? 'text-[13px] font-semibold text-rose-700 dark:text-rose-300'
                  : weeklyAccountingStatus.tone === 'warning'
                    ? 'text-[13px] font-semibold text-amber-700 dark:text-amber-300'
                    : 'text-[13px] font-semibold text-foreground'
            }
          >
            {weeklyAccountingStatus.label}
          </p>
          <p className="text-[11px] leading-5 text-muted-foreground">{weeklyAccountingStatus.description}</p>
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  // ── Inline edit handler with audit trail ──
  const handleUpdateTx = useCallback(
    (txId: string, updates: Partial<Transaction>) => {
      const existing = allTransactions.find((t) => t.id === txId);
      if (!existing) {
        void Promise.resolve(onUpdateTransaction(txId, updates)).catch((error) => {
          console.error('[SettlementLedger] update transaction failed:', error);
          toast.error(resolveApiErrorMessage(error, '거래 수정에 실패했습니다.'));
        });
        return;
      }

      const normalizedUpdates: Partial<Transaction> = { ...updates };
      if (typeof normalizedUpdates.dateTime === 'string') {
        normalizedUpdates.weekCode = resolveWeekLabelFromDate(normalizedUpdates.dateTime.slice(0, 10));
      }

      // Build edit history entries for changed fields
      const now = new Date().toISOString();
      const newEntries = buildTransactionEditHistoryEntries(existing, normalizedUpdates, currentUserName, now);

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

      void Promise.resolve(onUpdateTransaction(txId, enhancedUpdates)).catch((error) => {
        console.error('[SettlementLedger] update transaction failed:', error);
        toast.error(resolveApiErrorMessage(error, '거래 수정에 실패했습니다.'));
      });
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
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
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
              onMouseEnter={() => warmExcelJs()}
              onFocus={() => warmExcelJs()}
              disabled={downloadPreparing}
            >
              {downloadPreparing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              {downloadPreparing ? '엑셀 준비 중' : (isDirectEntryMode ? '엑셀 템플릿 다운로드' : '엑셀 다운로드')}
            </Button>
            {isDirectEntryMode && (
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer shadow-sm hover:bg-muted/40"
                onClick={openDirectEntryUploadPicker}
                disabled={directEntryUploading || sheetSaving}
              >
                {directEntryUploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                {directEntryUploading ? '작성본 반영 중' : '작성본 업로드'}
              </Button>
            )}
            {isDirectEntryMode && (
              <input
                ref={directEntryUploadInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  void handleDirectEntryWorkbookFile(file);
                }}
              />
            )}
          </div>
          {saveStatusButton}
        </div>

        {importRows && (
          <ImportEditor
            rows={importRows}
            onChange={(rows) => {
              setImportRows(rows);
              setImportDirty(true);
              setSheetSaveState('dirty');
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
            budgetTreeV2={budgetTreeV2}
            weekOptions={weekOptions}
            inline
            fullscreen={editorFullscreen}
            comments={comments}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAddComment={onAddComment}
            onProvisionEvidenceDriveById={handleProvisionEvidenceDriveById}
            onSyncEvidenceDriveById={handleSyncEvidenceDriveById}
            onUploadEvidenceDriveById={handleUploadEvidenceDriveById}
            onEnsureTransactionPersisted={onEnsureTransactionPersisted}
            sourceTransactions={allTransactions}
            workflowMode={workflowMode}
            settlementSheetPolicy={settlementSheetPolicy}
            basis={basis}
            pendingQuickInsert={pendingQuickInsert}
            onPendingQuickInsertHandled={onPendingQuickInsertHandled}
            onToggleFullscreen={() => setEditorFullscreen((prev) => !prev)}
            onDeriveRows={onDeriveRows}
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
            onMouseEnter={() => warmExcelJs()}
            onFocus={() => warmExcelJs()}
            disabled={downloadPreparing}
            >
              {downloadPreparing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              {downloadPreparing ? '엑셀 준비 중' : (isDirectEntryMode ? '엑셀 템플릿 다운로드' : '엑셀 다운로드')}
            </Button>
            {isDirectEntryMode && (
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer shadow-sm hover:bg-muted/40"
                onClick={openDirectEntryUploadPicker}
                disabled={directEntryUploading || sheetSaving}
              >
                {directEntryUploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                {directEntryUploading ? '작성본 반영 중' : '작성본 업로드'}
              </Button>
            )}
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
            {isDirectEntryMode && (
              <input
                ref={directEntryUploadInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  void handleDirectEntryWorkbookFile(file);
                }}
              />
            )}
            {saveStatusButton}
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
                <SettlementWeekSection
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
                  allowEditSubmitted={allowEditSubmitted}
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
            setSheetSaveState('dirty');
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
          budgetTreeV2={budgetTreeV2}
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
          onFetchBudgetSuggestion={onFetchBudgetSuggestion}
          workflowMode={workflowMode}
          settlementSheetPolicy={settlementSheetPolicy}
          basis={basis}
          pendingQuickInsert={pendingQuickInsert}
          onPendingQuickInsertHandled={onPendingQuickInsertHandled}
          onDeriveRows={onDeriveRows}
        />
      )}
      {revertConfirmDialog}
    </div>
  );
}
