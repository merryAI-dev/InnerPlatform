import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, GripVertical, Loader2, Plus, RotateCcw, Save, Upload, X } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { toast } from 'sonner';
import { detectKeyRuleContext, runKeyRules, type KeyRule } from '../../platform/settlement-grid-keymap';
import { grid2tsv, parseTsvRows, isSpreadsheetHtml, html2grid } from '../../platform/settlement-grid-clipboard';
import { BUDGET_CODE_BOOK } from '../../data/budget-data';
import type { BudgetCodeEntry, Comment, Transaction, TransactionState } from '../../data/types';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { findWeekForDate, getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { parseDate, parseNumber, triggerDownload } from '../../platform/csv-utils';
import {
  computeEvidenceStatus,
  computeEvidenceSummary,
  isValidDriveUrl,
  resolveEvidenceCompletedDesc,
  resolveEvidenceCompletedManualDesc,
} from '../../platform/evidence-helpers';
import {
  buildDriveTransactionFolderName,
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
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { buildSettlementActualSyncPayload } from '../../platform/settlement-sheet-sync';
import { computeSettlementGridWindowRange } from '../../platform/settlement-grid-windowing';
import { updateImportRowAt } from '../../platform/settlement-grid-state';
import {
  clearSelectionCells,
  DEFAULT_PROTECTED_SETTLEMENT_HEADERS,
  deleteSelectedRows,
} from '../../platform/settlement-grid-actions';
import {
  deriveSettlementRows,
  isSettlementCascadeColumn,
} from '../../platform/settlement-row-derivation';
import {
  buildSettlementDerivationContext,
  resolveEvidenceRequiredDesc,
  isSettlementRowMeaningful,
} from '../../platform/settlement-sheet-prepare';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
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
import type { ActiveCommentAnchor } from './SettlementCommentThreadSheet';
import type { EvidenceUploadDraft } from './SettlementEvidenceUploadDialog';
import { CellCommentButton } from './CellCommentButton';
import { SettlementWeekSection } from './SettlementWeekSection';
import {
  buildTransactionEditHistoryEntries,
  findLatestFieldEdit,
  fmt,
  METHOD_LABELS,
  METHOD_OPTIONS,
  CASHFLOW_IN_LINE_IDS,
  normalizeBudgetLabel,
  formatBudgetCodeLabel,
  formatSubCodeLabel,
  toFieldSlug,
  buildCommentThreadKey,
  buildSheetRowCommentId,
  formatCommentTime,
  IMPORT_EDITOR_ROW_HEIGHT_ESTIMATE,
  IMPORT_EDITOR_WINDOW_OVERSCAN,
  IMPORT_EDITOR_WINDOW_THRESHOLD,
  normalizeMethodValue,
  parseContentStatusNote,
  composeContentStatusNote,
  type QuickExpenseTemplate,
  QUICK_EXPENSE_TEMPLATES,
  derivePendingEvidence,
  TX_STATE_BADGE,
  isEditable,
  resolveWeekFromLabel,
} from '../../platform/settlement-grid-helpers';
import {
  readImportDraftCache,
  writeImportDraftCache,
  clearImportDraftCache,
  serializeImportRows,
} from '../../platform/settlement-draft-cache';

const SettlementCommentThreadSheet = lazy(
  () => import('./SettlementCommentThreadSheet').then((module) => ({ default: module.SettlementCommentThreadSheet })),
);
const SettlementEvidenceUploadDialog = lazy(
  () => import('./SettlementEvidenceUploadDialog').then((module) => ({ default: module.SettlementEvidenceUploadDialog })),
);

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
  allowEditSubmitted = false,
}: SettlementLedgerProps) {
  const { upsertWeekAmounts } = useCashflowWeeks();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importDirty, setImportDirty] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [cashflowSyncing, setCashflowSyncing] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState('');
  const [lastCashflowSyncedAt, setLastCashflowSyncedAt] = useState('');
  const [sheetSaveState, setSheetSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'save_failed'>('idle');
  const [cashflowSyncState, setCashflowSyncState] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'sync_failed'>('idle');
  const [downloadFrom, setDownloadFrom] = useState('');
  const [downloadTo, setDownloadTo] = useState('');
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const restoredDraftCacheKeyRef = useRef('');
  const lastSyncedSheetRowsSignatureRef = useRef('');
  const pendingSheetRowsSyncRef = useRef<ImportRow[] | null>(null);
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
        setSheetSaveState('dirty');
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

  const applySheetRowsSync = useCallback((rows: ImportRow[] | null | undefined) => {
    if (rows && rows.length > 0) {
      setImportRows(cloneImportRows(rows));
      setImportDirty(false);
      setSheetSaveState('saved');
      setCashflowSyncState('synced');
      clearImportDraftCache(draftCacheKey);
    } else if (serializeImportRows(rows) === '') {
      setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
      setImportDirty(false);
      setSheetSaveState('idle');
      setCashflowSyncState('idle');
      clearImportDraftCache(draftCacheKey);
    }
  }, [cloneImportRows, draftCacheKey, projectTxs, yearWeeks]);

  useEffect(() => {
    const nextSignature = serializeImportRows(sheetRows);
    if (nextSignature === lastSyncedSheetRowsSignatureRef.current) return;
    lastSyncedSheetRowsSignatureRef.current = nextSignature;

    // 그리드 셀에 포커스가 있으면 리셋을 defer — 타이핑 중 백스페이스 끊김 방지
    const active = document.activeElement;
    const isCellFocused = active instanceof HTMLInputElement && active.getAttribute('data-cell-row') != null;
    if (isCellFocused) {
      pendingSheetRowsSyncRef.current = sheetRows ?? null;
      return;
    }

    applySheetRowsSync(sheetRows);
  }, [sheetRows, applySheetRowsSync]);

  // 포커스가 그리드 밖으로 나갈 때 pending sync 적용
  useEffect(() => {
    const handleFocusOut = () => {
      if (!pendingSheetRowsSyncRef.current) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const isCellFocused = active instanceof HTMLInputElement && active.getAttribute('data-cell-row') != null;
        if (isCellFocused) return; // 그리드 내 다른 셀로 이동한 경우 유지
        const pending = pendingSheetRowsSyncRef.current;
        pendingSheetRowsSyncRef.current = null;
        applySheetRowsSync(pending);
      });
    };
    document.addEventListener('focusout', handleFocusOut);
    return () => document.removeEventListener('focusout', handleFocusOut);
  }, [applySheetRowsSync]);

  const revertToSavedSnapshot = useCallback(() => {
    if (sheetSaving) return;
    if (sheetRows && sheetRows.length > 0) {
      setImportRows(cloneImportRows(sheetRows));
      setImportDirty(false);
      setSheetSaveState('saved');
      setCashflowSyncState('synced');
      clearImportDraftCache(draftCacheKey);
      toast.message('마지막 저장값으로 되돌렸습니다.');
      return;
    }
    setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
    setImportDirty(false);
    setSheetSaveState('idle');
    setCashflowSyncState('idle');
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
      await onSaveSheetRows(rows);
      setImportDirty(false);
      setSheetSaveState('saved');
      setCashflowSyncState('pending');
      clearImportDraftCache(draftCacheKey);
      setLastAutoSavedAt(new Date().toISOString());
      if (!silent) toast.success('정산대장을 저장했습니다.');
      return true;
    } catch (err) {
      console.error('[SettlementLedger] save sheet failed:', err);
      setSheetSaveState('save_failed');
      if (!silent) toast.error('정산대장 저장에 실패했습니다.');
      return false;
    } finally {
      setSheetSaving(false);
    }
  }, [draftCacheKey, onSaveSheetRows]);

  const syncImportRowsToCashflow = useCallback(async (
    rows: ImportRow[],
    options?: { silent?: boolean },
  ) => {
    const silent = options?.silent ?? false;
    setCashflowSyncing(true);
    setCashflowSyncState('syncing');
    try {
      const payload = buildSettlementActualSyncPayload(rows, yearWeeks, sheetRows || null);
      let syncFailed = false;
      await Promise.all(
        payload.map(async (week) => {
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
      if (syncFailed) {
        setCashflowSyncState('sync_failed');
        if (!silent) toast.message('정산대장은 저장되었지만 캐시플로 업데이트에 실패했습니다.');
        return false;
      }
      setCashflowSyncState('synced');
      setLastCashflowSyncedAt(new Date().toISOString());
      if (!silent) toast.success('캐시플로 실제값까지 동기화했습니다.');
      return true;
    } finally {
      setCashflowSyncing(false);
    }
  }, [projectId, sheetRows, upsertWeekAmounts, yearWeeks]);

  const handleImportSave = useCallback(async (options?: { silent?: boolean; syncCashflow?: boolean }) => {
    if (!importRows) return;
    const silent = options?.silent ?? false;
    const syncCashflow = options?.syncCashflow ?? true;
    const persisted = await persistImportRowsSnapshot(importRows, { silent });
    if (!persisted) return;
    if (syncCashflow) {
      await syncImportRowsToCashflow(importRows, { silent });
    }
  }, [importRows, persistImportRowsSnapshot, syncImportRowsToCashflow]);

  useEffect(() => {
    if (!autoSaveSheet || !importDirty || !importRows || !onSaveSheetRows || sheetSaving) return;
    const timer = window.setTimeout(() => {
      void handleImportSave({ silent: true, syncCashflow: false });
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [autoSaveSheet, importDirty, importRows, onSaveSheetRows, sheetSaving, handleImportSave]);

  useEffect(() => {
    if (!autoSaveSheet || importDirty || !importRows || sheetSaving || cashflowSyncing || cashflowSyncState !== 'pending') return;
    const timer = window.setTimeout(() => {
      void syncImportRowsToCashflow(importRows, { silent: true });
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [autoSaveSheet, cashflowSyncState, cashflowSyncing, importDirty, importRows, sheetSaving, syncImportRowsToCashflow]);

  useEffect(() => {
    if (!importDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [importDirty]);

  const autoSaveStatusLabel = useMemo(() => {
    if (!autoSaveSheet) return '';
    if (sheetSaveState === 'saving') return '시트 저장 중...';
    if (sheetSaveState === 'save_failed') return '시트 저장 실패';
    if (importDirty || sheetSaveState === 'dirty') return '저장되지 않은 변경 있음';
    if (cashflowSyncState === 'syncing') return '시트 저장됨 · 캐시플로 동기화 중...';
    if (cashflowSyncState === 'sync_failed') return '시트 저장됨 · 캐시플로 동기화 실패';
    if (cashflowSyncState === 'pending') {
      return lastAutoSavedAt
        ? `시트 저장 ${formatCommentTime(lastAutoSavedAt)} · 캐시플로 동기화 대기`
        : '시트 저장됨 · 캐시플로 동기화 대기';
    }
    if (cashflowSyncState === 'synced' && lastCashflowSyncedAt) {
      return `시트 저장 ${formatCommentTime(lastAutoSavedAt || lastCashflowSyncedAt)} · 캐시플로 동기화 ${formatCommentTime(lastCashflowSyncedAt)}`;
    }
    return lastAutoSavedAt ? `자동 저장 ${formatCommentTime(lastAutoSavedAt)}` : '자동 저장 대기';
  }, [autoSaveSheet, cashflowSyncState, importDirty, lastAutoSavedAt, lastCashflowSyncedAt, sheetSaveState]);

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
                {autoSaveStatusLabel}
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
                {autoSaveStatusLabel}
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

// ── Import Editor (editable CSV preview) ──

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
  onProvisionEvidenceDriveById?: (txId: string) => void | Promise<unknown>;
  onSyncEvidenceDriveById?: (txId: string) => void | Promise<unknown>;
  onUploadEvidenceDriveById?: (txId: string, uploads: EvidenceUploadSelection[]) => void | Promise<unknown>;
  onEnsureTransactionPersisted?: (input: {
    transaction: Transaction;
    sourceTxId?: string;
  }) => Promise<string | null>;
  sourceTransactions?: Transaction[];
}) {
  const meaningfulRows = useMemo(
    () => rows.filter((row) => isSettlementRowMeaningful(row)),
    [rows],
  );
  const errorCount = meaningfulRows.filter((r) => r.error).length;
  const validCount = meaningfulRows.length - errorCount;
  const noIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.'),
    [],
  );
  const missingCount = useMemo(() => {
    return meaningfulRows.filter((row) => {
      const cells = row.cells || [];
      const hasAnyValue = cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() !== '');
      if (!hasAnyValue) return false;
      return cells.some((cell, idx) => idx !== noIdx && String(cell || '').trim() === '');
    }).length;
  }, [meaningfulRows, noIdx]);
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
  const selectionRef = useRef<{ start: { r: number; c: number }; end: { r: number; c: number } } | null>(null);
  const pendingSelectionEndRef = useRef<{ r: number; c: number } | null>(null);
  const dragSelectionFrameRef = useRef<number | null>(null);
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
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0);
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetTxId, setUploadTargetTxId] = useState<string | null>(null);
  const [uploadDrafts, setUploadDrafts] = useState<EvidenceUploadDraft[]>([]);
  const [activeUploadDraftId, setActiveUploadDraftId] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    return {
      r1: Math.min(selection.start.r, selection.end.r),
      r2: Math.max(selection.start.r, selection.end.r),
      c1: Math.min(selection.start.c, selection.end.c),
      c2: Math.max(selection.start.c, selection.end.c),
    };
  }, [selection]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const sourceTransactionMap = useMemo(
    () => new Map(sourceTransactions.map((transaction) => [transaction.id, transaction])),
    [sourceTransactions],
  );
  const protectedClearColumnIndexes = useMemo(
    () => SETTLEMENT_COLUMNS.reduce<number[]>((indexes, column, index) => {
      if (DEFAULT_PROTECTED_SETTLEMENT_HEADERS.includes(column.csvHeader as (typeof DEFAULT_PROTECTED_SETTLEMENT_HEADERS)[number])) {
        indexes.push(index);
      }
      return indexes;
    }, []),
    [],
  );
  const shouldVirtualizeRows = inline && rows.length >= IMPORT_EDITOR_WINDOW_THRESHOLD;
  const visibleRowWindow = useMemo(() => {
    if (!shouldVirtualizeRows) {
      return {
        startIndex: 0,
        endIndex: rows.length,
        paddingTop: 0,
        paddingBottom: 0,
      };
    }
    return computeSettlementGridWindowRange({
      rowCount: rows.length,
      scrollTop: virtualScrollTop,
      viewportHeight: virtualViewportHeight,
      rowHeightEstimate: IMPORT_EDITOR_ROW_HEIGHT_ESTIMATE,
      overscan: IMPORT_EDITOR_WINDOW_OVERSCAN,
    });
  }, [rows.length, shouldVirtualizeRows, virtualScrollTop, virtualViewportHeight]);
  const visibleRows = useMemo(
    () => rows.slice(visibleRowWindow.startIndex, visibleRowWindow.endIndex),
    [rows, visibleRowWindow.endIndex, visibleRowWindow.startIndex],
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
      onChange(updateImportRowAt(rows, rowIdx, (candidate) => ({ ...candidate, sourceTxId: persistedTxId })));
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

  const confirmEvidenceUpload = useCallback(async () => {
    if (!uploadTargetTxId || !onUploadEvidenceDriveById || uploadDrafts.length === 0) return;
    setUploadingEvidence(true);
    try {
      const uploadedNames = uploadDrafts.map((draft) => draft.reviewedFileName.trim() || draft.suggestedFileName);
      await onUploadEvidenceDriveById(
        uploadTargetTxId,
        uploadDrafts.map((draft) => ({
          file: draft.file,
          category: draft.category,
          parserCategory: draft.parserCategory,
          reviewedFileName: draft.reviewedFileName.trim() || draft.suggestedFileName,
        })),
      );
      const firstFileName = uploadedNames[0] || '증빙 파일';
      toast.success(
        uploadDrafts.length === 1
          ? `업로드 완료 · Drive 폴더에 저장됨: ${firstFileName} · 목록 반영은 동기화 버튼에서 진행`
          : `업로드 완료 · Drive 폴더에 저장됨: ${firstFileName} 외 ${uploadDrafts.length - 1}건 · 목록 반영은 동기화 버튼에서 진행`,
      );
      setUploadDialogOpen(false);
      clearUploadDrafts();
    } catch (error) {
      console.error('[ImportEditor] evidence upload failed:', error);
      toast.error('증빙 업로드에 실패했습니다.');
    } finally {
      setUploadingEvidence(false);
    }
  }, [clearUploadDrafts, onUploadEvidenceDriveById, uploadDrafts, uploadTargetTxId]);

  const settlementDerivationContext = useMemo(
    () => buildSettlementDerivationContext(projectId, defaultLedgerId),
    [projectId, defaultLedgerId],
  );

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = updateImportRowAt(rows, rowIdx, (r) => {
        const cells = [...r.cells];
        cells[colIdx] = value;
        return { ...r, cells };
      });

      const mode = colIdx === cashflowIdx
        ? 'row'
        : isSettlementCascadeColumn(colIdx, settlementDerivationContext)
          ? 'cascade'
          : 'row';
      onChange(deriveSettlementRows(next, settlementDerivationContext, { mode, rowIdx }));
    },
    [rows, onChange, cashflowIdx, settlementDerivationContext],
  );

  const updateRow = useCallback(
    (rowIdx: number, updater: (row: ImportRow) => ImportRow) => {
      const next = updateImportRowAt(rows, rowIdx, (r) => {
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
      onChange(deriveSettlementRows(next, settlementDerivationContext, { mode: 'row', rowIdx }));
    },
    [rows, onChange, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap, settlementDerivationContext],
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
  const getActiveSelectionBounds = useCallback(() => {
    if (selectionBounds) return selectionBounds;
    const anchor = getSelectionAnchor();
    if (!anchor) return null;
    return {
      r1: anchor.rowIdx,
      r2: anchor.rowIdx,
      c1: anchor.colIdx,
      c2: anchor.colIdx,
    };
  }, [getSelectionAnchor, selectionBounds]);

  const commitRows = useCallback((nextRows: ImportRow[], focusTarget?: { rowIdx: number; colIdx: number } | null) => {
    if (focusTarget) pendingFocusCell.current = focusTarget;
    onChange(deriveSettlementRows(normalizeRowNumbers(nextRows), settlementDerivationContext, { mode: 'full' }));
  }, [onChange, normalizeRowNumbers, settlementDerivationContext]);

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

  const pushUndoSnapshot = useCallback(() => {
    undoStack.current.push(cloneRows(rows));
  }, [cloneRows, rows]);

  const clearSelectedCells = useCallback((options?: { silent?: boolean }) => {
    const bounds = getActiveSelectionBounds();
    if (!bounds) return false;
    const nextRows = clearSelectionCells(rows, bounds, {
      protectedColumnIndexes: protectedClearColumnIndexes,
    });
    if (nextRows === rows) {
      if (!options?.silent) {
        toast.message('비울 수 있는 셀이 선택되지 않았습니다.');
      }
      return false;
    }
    pushUndoSnapshot();
    commitRows(nextRows, {
      rowIdx: bounds.r1,
      colIdx: bounds.c1 === noIdx ? getPreferredEditableCol() : bounds.c1,
    });
    return true;
  }, [
    commitRows,
    getActiveSelectionBounds,
    getPreferredEditableCol,
    noIdx,
    protectedClearColumnIndexes,
    pushUndoSnapshot,
    rows,
  ]);

  const removeSelectedRows = useCallback(() => {
    const bounds = getActiveSelectionBounds();
    if (!bounds) return false;
    const nextRows = deleteSelectedRows(rows, bounds);
    if (nextRows === rows) return false;
    pushUndoSnapshot();
    setSelection(null);
    const nextFocusRow = Math.min(bounds.r1, Math.max(0, nextRows.length - 1));
    commitRows(
      nextRows,
      nextRows.length > 0
        ? { rowIdx: nextFocusRow, colIdx: getPreferredEditableCol() }
        : null,
    );
    return true;
  }, [commitRows, getActiveSelectionBounds, getPreferredEditableCol, pushUndoSnapshot, rows]);

  const clearAllRows = useCallback(() => {
    if (rows.length === 0) {
      toast.message('초기화할 행이 없습니다.');
      return false;
    }
    pushUndoSnapshot();
    setSelection(null);
    commitRows([], null);
    toast.success('현재 탭을 초기화했습니다.');
    return true;
  }, [commitRows, pushUndoSnapshot, rows]);

  const applyPaste = useCallback(
    (startRow: number, startCol: number, text: string, html?: string) => {
      const grid = (html && isSpreadsheetHtml(html))
        ? html2grid(html)
        : parseTsvRows(text);
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

  const handleTablePaste = useCallback((e: ReactClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain') || e.clipboardData.getData('text');
    const html = e.clipboardData.getData('text/html') || undefined;
    if (!text && !html) return;
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
    applyPaste(anchor.r, anchor.c, text || '', html);
  }, [applyPaste, selection]);

  const handleUndo = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
    if (!isUndo) return;
    if (undoStack.current.length === 0) return;
    e.preventDefault();
    const prev = undoStack.current.pop();
    if (prev) onChange(prev);
  }, [onChange]);

  const handleCopy = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
    if (!isCopy) return;
    if (!selection) return;
    const r1 = Math.min(selection.start.r, selection.end.r);
    const r2 = Math.max(selection.start.r, selection.end.r);
    const c1 = Math.min(selection.start.c, selection.end.c);
    const c2 = Math.max(selection.start.c, selection.end.c);
    if (r1 < 0 || c1 < 0) return;
    const grid: string[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row = rows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = c1; c <= c2; c++) {
        if (c === noIdx) continue;
        cells.push(String(row.cells[c] ?? ''));
      }
      grid.push(cells);
    }
    const text = grid2tsv(grid);
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
    const tryFocus = () => {
      const target = tableWrapRef.current?.querySelector<HTMLElement>(selector);
      if (!target) return false;
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      handleCellFocus(boundedRow, boundedCol);
      return true;
    };
    if (tryFocus()) return;
    if (shouldVirtualizeRows && tableWrapRef.current) {
      const nextScrollTop = Math.max(
        0,
        boundedRow * IMPORT_EDITOR_ROW_HEIGHT_ESTIMATE - IMPORT_EDITOR_ROW_HEIGHT_ESTIMATE * 2,
      );
      tableWrapRef.current.scrollTop = nextScrollTop;
      window.requestAnimationFrame(() => {
        void tryFocus();
      });
    }
  }, [rows.length, noIdx, handleCellFocus, shouldVirtualizeRows]);

  useEffect(() => {
    if (!pendingFocusCell.current) return;
    const target = pendingFocusCell.current;
    pendingFocusCell.current = null;
    const timer = window.setTimeout(() => {
      focusCellAt(target.rowIdx, target.colIdx);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rows, focusCellAt]);

  const handleTableKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    handleUndo(e);
    handleCopy(e);
    if (e.defaultPrevented) return;

    const ctx = detectKeyRuleContext(e as unknown as globalThis.KeyboardEvent);
    ctx.hasMultiCellSelection = Boolean(
      selectionBounds
      && (selectionBounds.r1 !== selectionBounds.r2 || selectionBounds.c1 !== selectionBounds.c2),
    );

    const anchor = selection
      ? {
        r: Math.min(selection.start.r, selection.end.r),
        c: Math.min(selection.start.c, selection.end.c),
      }
      : lastFocusedCell.current
        ? { r: lastFocusedCell.current.rowIdx, c: lastFocusedCell.current.colIdx }
        : null;

    const keyRules: KeyRule[] = [
      {
        combo: { key: 'a', mod: true },
        run: (_ev, ruleCtx) => {
          if (ruleCtx.isTextEditingTarget) return false;
          if (rows.length === 0) return false;
          _ev.preventDefault();
          const firstEditableCol = noIdx === 0 ? 1 : 0;
          setSelection({
            start: { r: 0, c: firstEditableCol },
            end: { r: rows.length - 1, c: Math.max(firstEditableCol, SETTLEMENT_COLUMNS.length - 1) },
          });
          tableWrapRef.current?.focus();
          return true;
        },
      },
      {
        combo: { key: 'x', mod: true },
        run: (_ev) => {
          if (!selection) return false;
          // Copy first
          handleCopy(_ev as unknown as ReactKeyboardEvent<HTMLDivElement>);
          // Then clear
          void clearSelectedCells();
          return true;
        },
      },
      {
        combo: { key: 'Escape' },
        run: (_ev) => {
          if (!selectionRef.current) return false;
          _ev.preventDefault();
          setSelection(null);
          return true;
        },
      },
      {
        combo: [{ key: 'Delete' }, { key: 'Backspace' }],
        run: (_ev, ruleCtx) => {
          if (ruleCtx.isTextEditingTarget && !ruleCtx.hasMultiCellSelection && ruleCtx.inputHasPartialSelection) return false;
          if (!getActiveSelectionBounds()) return false;
          _ev.preventDefault();
          void clearSelectedCells();
          return true;
        },
      },
      {
        combo: { key: 'Tab' },
        run: (_ev) => {
          if (!anchor) return false;
          _ev.preventDefault();
          const nextCol = anchor.c + 1 >= SETTLEMENT_COLUMNS.length ? 0 : anchor.c + 1;
          const nextRow = nextCol === 0 ? Math.min(anchor.r + 1, rows.length - 1) : anchor.r;
          focusCellAt(nextRow, nextCol === noIdx ? nextCol + 1 : nextCol);
          return true;
        },
      },
      {
        combo: { key: 'Tab', shift: true },
        run: (_ev) => {
          if (!anchor) return false;
          _ev.preventDefault();
          const prevCol = anchor.c - 1 < 0 ? SETTLEMENT_COLUMNS.length - 1 : anchor.c - 1;
          const prevRow = prevCol === SETTLEMENT_COLUMNS.length - 1 ? Math.max(anchor.r - 1, 0) : anchor.r;
          focusCellAt(prevRow, prevCol === noIdx ? Math.max(prevCol - 1, 0) : prevCol);
          return true;
        },
      },
      {
        combo: [{ key: 'Enter' }, { key: 'Enter', shift: true }],
        run: (_ev) => {
          if (!anchor) return false;
          _ev.preventDefault();
          focusCellAt(anchor.r + (_ev.shiftKey ? -1 : 1), anchor.c);
          return true;
        },
      },
      {
        combo: { key: 'ArrowUp' },
        run: (_ev) => { if (!anchor) return false; _ev.preventDefault(); focusCellAt(anchor.r - 1, anchor.c); return true; },
      },
      {
        combo: { key: 'ArrowDown' },
        run: (_ev) => { if (!anchor) return false; _ev.preventDefault(); focusCellAt(anchor.r + 1, anchor.c); return true; },
      },
      {
        combo: { key: 'ArrowLeft' },
        run: (_ev) => { if (!anchor) return false; _ev.preventDefault(); focusCellAt(anchor.r, anchor.c - 1); return true; },
      },
      {
        combo: { key: 'ArrowRight' },
        run: (_ev) => { if (!anchor) return false; _ev.preventDefault(); focusCellAt(anchor.r, anchor.c + 1); return true; },
      },
    ];

    runKeyRules(e as unknown as globalThis.KeyboardEvent, keyRules, ctx);
  }, [
    clearSelectedCells,
    focusCellAt,
    getActiveSelectionBounds,
    handleCopy,
    handleUndo,
    noIdx,
    rows.length,
    selection,
    selectionBounds,
  ]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
      const html = e.clipboardData?.getData('text/html') || undefined;
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
      applyPaste(anchor.r, anchor.c, text, html);
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
    pendingSelectionEndRef.current = null;
    if (dragSelectionFrameRef.current != null) {
      window.cancelAnimationFrame(dragSelectionFrameRef.current);
      dragSelectionFrameRef.current = null;
    }
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

  const flushPendingSelection = useCallback(() => {
    dragSelectionFrameRef.current = null;
    const pending = pendingSelectionEndRef.current;
    pendingSelectionEndRef.current = null;
    if (!pending) return;
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.end.r === pending.r && prev.end.c === pending.c) return prev;
      return { ...prev, end: pending };
    });
  }, []);

  const handleCellMouseEnter = useCallback((rowIdx: number, colIdx: number) => {
    if (!draggingSelection.current) return;
    if (colIdx === noIdx) return;
    const current = selectionRef.current;
    if (current?.end.r === rowIdx && current.end.c === colIdx) return;
    const pending = pendingSelectionEndRef.current;
    if (pending?.r === rowIdx && pending.c === colIdx) return;
    pendingSelectionEndRef.current = { r: rowIdx, c: colIdx };
    if (dragSelectionFrameRef.current != null) return;
    dragSelectionFrameRef.current = window.requestAnimationFrame(flushPendingSelection);
  }, [flushPendingSelection, noIdx]);

  useEffect(() => {
    const onUp = () => {
      if (dragSelectionFrameRef.current != null) {
        window.cancelAnimationFrame(dragSelectionFrameRef.current);
      }
      flushPendingSelection();
      draggingSelection.current = false;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      if (dragSelectionFrameRef.current != null) {
        window.cancelAnimationFrame(dragSelectionFrameRef.current);
        dragSelectionFrameRef.current = null;
      }
      pendingSelectionEndRef.current = null;
    };
  }, [flushPendingSelection]);

  useEffect(() => {
    if (!tableWrapRef.current) return;
    const element = tableWrapRef.current;
    const syncViewport = () => {
      setVirtualScrollTop(element.scrollTop);
      setVirtualViewportHeight(element.clientHeight);
    };
    syncViewport();
    const handleScroll = () => {
      setVirtualScrollTop(element.scrollTop);
    };
    element.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(() => syncViewport());
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [inline, rows.length]);

  useEffect(() => {
    if (!inline) return;
    if (rows.length >= 20) return;
    addRows(20 - rows.length);
  }, [rows.length, inline, addRows]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      const nextRows = deleteSelectedRows(rows, { r1: rowIdx, r2: rowIdx, c1: 0, c2: SETTLEMENT_COLUMNS.length - 1 });
      if (nextRows === rows) return;
      pushUndoSnapshot();
      setSelection(null);
      const nextFocusRow = Math.min(Math.max(0, rowIdx - 1), Math.max(0, nextRows.length - 1));
      commitRows(nextRows, nextRows.length > 0 ? { rowIdx: nextFocusRow, colIdx: getPreferredEditableCol() } : null);
    },
    [rows, pushUndoSnapshot, commitRows, getPreferredEditableCol],
  );

  const applyEvidenceMapping = useCallback((rowIdx?: number) => {
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || evidenceIdx < 0) return;
    if (!evidenceRequiredMap || Object.keys(evidenceRequiredMap).length === 0) return;
    const next = rowIdx == null
      ? rows.map((r, i) => {
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
      })
      : updateImportRowAt(rows, rowIdx, (r) => {
        const budgetCode = r.cells[budgetCodeIdx] || '';
        const subCode = r.cells[subCodeIdx] || '';
        const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
        if (!mapped) return r;
        const cells = [...r.cells];
        cells[evidenceIdx] = mapped;
        const updated: ImportRow = { ...r, cells };
        const result = importRowToTransaction(updated, projectId, defaultLedgerId, rowIdx);
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
              void clearSelectedCells();
            }}
            disabled={!getActiveSelectionBounds()}
          >
            <X className="h-3.5 w-3.5" />
            선택 셀 비우기
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
            onClick={() => {
              void removeSelectedRows();
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
            onClick={() => setClearAllConfirmOpen(true)}
            disabled={rows.length === 0}
          >
            현재 탭 전체 비우기
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
      <AlertDialog open={clearAllConfirmOpen} onOpenChange={setClearAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>현재 탭을 완전히 초기화할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              현재 탭의 모든 행을 제거하고 빈 상태로 저장합니다. 되돌리기를 누르기 전까지는 기존 데이터가 복구되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void clearAllRows();
                setClearAllConfirmOpen(false);
              }}
            >
              탭 초기화
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            {shouldVirtualizeRows && visibleRowWindow.paddingTop > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={SETTLEMENT_COLUMNS.length + 1}
                  style={{ height: visibleRowWindow.paddingTop }}
                  className="border-b-0 p-0"
                />
              </tr>
            )}
            {visibleRows.map((row, visibleIndex) => {
              const rowIdx = visibleRowWindow.startIndex + visibleIndex;
              return (
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
                persistedTransaction={row.sourceTxId ? sourceTransactionMap.get(row.sourceTxId) : undefined}
                onEnsurePersistedTransaction={() => ensurePersistedTransactionByRow(rowIdx)}
                noIdx={noIdx}
                colWidths={colWidths}
              />
              );
            })}
            {shouldVirtualizeRows && visibleRowWindow.paddingBottom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={SETTLEMENT_COLUMNS.length + 1}
                  style={{ height: visibleRowWindow.paddingBottom }}
                  className="border-b-0 p-0"
                />
              </tr>
            )}
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
      {uploadDialogOpen && (
        <Suspense fallback={null}>
          <SettlementEvidenceUploadDialog
            open={uploadDialogOpen}
            uploadDrafts={uploadDrafts}
            activeUploadDraftId={activeUploadDraftId}
            uploadingEvidence={uploadingEvidence}
            onOpenChange={(open) => {
              setUploadDialogOpen(open);
              if (!open && !uploadingEvidence) {
                clearUploadDrafts();
              }
            }}
            onPickFiles={triggerEvidenceFilePicker}
            onCancel={() => {
              setUploadDialogOpen(false);
              clearUploadDrafts();
            }}
            onConfirm={() => void confirmEvidenceUpload()}
            onSelectDraft={setActiveUploadDraftId}
            onUpdateDraftCategory={(draftId, nextCategory) => {
              setUploadDrafts((current) => current.map((item) => (
                item.id === draftId
                  ? { ...item, category: nextCategory }
                  : item
              )));
            }}
            onUpdateDraftFileName={(draftId, nextFileName) => {
              setUploadDrafts((current) => current.map((item) => (
                item.id === draftId
                  ? { ...item, reviewedFileName: nextFileName }
                  : item
              )));
            }}
            onResetDraftFileName={(draftId) => {
              setUploadDrafts((current) => current.map((item) => (
                item.id === draftId
                  ? { ...item, reviewedFileName: item.suggestedFileName }
                  : item
              )));
            }}
          />
        </Suspense>
      )}
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
      {activeCommentAnchor && (
        <Suspense fallback={null}>
          <SettlementCommentThreadSheet
            anchor={activeCommentAnchor}
            comments={activeCellComments}
            open={!!activeCommentAnchor}
            projectId={projectId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onClose={() => setActiveCommentAnchor(null)}
            onAddComment={onAddComment}
          />
        </Suspense>
      )}
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
  persistedTransaction,
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
  onProvisionEvidenceDriveById?: (txId: string) => void | Promise<unknown>;
  onSyncEvidenceDriveById?: (txId: string) => void | Promise<unknown>;
  onOpenEvidenceUpload?: (txId: string) => void;
  persistedTransactionId?: string;
  persistedTransaction?: Transaction;
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
  const expenseAudit = useMemo(
    () => findLatestFieldEdit(persistedTransaction, 'amounts.expenseAmount'),
    [persistedTransaction],
  );
  const persistedDriveStatusLabel = persistedTransaction?.evidenceDriveSyncStatus === 'UPLOADED'
    ? '업로드됨'
    : persistedTransaction?.evidenceDriveSyncStatus === 'SYNCED'
      ? '동기화됨'
      : '';
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
    e: ReactClipboardEvent<HTMLTableCellElement | HTMLInputElement | HTMLSelectElement>,
  ) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    onPasteRange(rowIdx, colIdx, text);
  }, [onPasteRange, rowIdx]);

  const runDriveAction = useCallback(async (
    action: 'provision' | 'sync',
    handler?: (txId: string) => void | Promise<unknown>,
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

    const openPicker = (e: ReactMouseEvent<HTMLButtonElement>) => {
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
        const isExpenseAmount = col.csvHeader === '사업비 사용액';
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
                      title={hasSourceTransaction ? 'Drive 폴더 파일을 다시 읽어 완료 목록에 반영' : '필요한 값을 확인한 뒤 실제 거래로 저장하고 계속합니다'}
                      onClick={() => {
                        void runDriveAction('sync', onSyncEvidenceDriveById);
                      }}
                    >
                      {driveAction === 'sync' ? '동기화중' : '동기화'}
                    </Button>
                    {persistedDriveStatusLabel && (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                          persistedTransaction?.evidenceDriveSyncStatus === 'UPLOADED'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-sky-200 bg-sky-50 text-sky-700'
                        }`}
                        title={persistedTransaction?.evidenceDriveSyncStatus === 'UPLOADED'
                          ? '업로드는 완료됐고 목록 반영은 동기화 버튼에서 진행됩니다.'
                          : 'Drive 폴더 파일 기준 완료 목록이 반영된 상태입니다.'}
                      >
                        {persistedDriveStatusLabel}
                      </span>
                    )}
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
                    placeholder={hasSourceTransaction ? '' : '행 저장 후 Drive 사용 가능'}
                  />
                </div>
              ) : isExpenseAmount ? (
                <div className="space-y-0.5 pr-6">
                  <input
                    type="text"
                    value={row.cells[colIdx] || ''}
                    className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5"
                    data-cell-row={rowIdx}
                    data-cell-col={colIdx}
                    onFocus={() => onCellFocus(rowIdx, colIdx)}
                    onPaste={(e) => handlePaste(colIdx, e)}
                    onChange={(e) => onCellChange(colIdx, formatNumberInput(e.target.value))}
                  />
                  {expenseAudit && (
                    <div className="px-1 text-[9px] leading-tight text-muted-foreground">
                      최종 수정 {expenseAudit.editedBy} · {formatCommentTime(expenseAudit.editedAt)}
                    </div>
                  )}
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
