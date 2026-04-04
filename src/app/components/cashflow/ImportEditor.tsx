import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Loader2, Maximize2, Minimize2, Plus, RotateCcw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { detectKeyRuleContext, runKeyRules, type KeyRule } from '../../platform/settlement-grid-keymap';
import { grid2tsv, html2grid, isSpreadsheetHtml, parseTsvRows } from '../../platform/settlement-grid-clipboard';
import { BUDGET_CODE_BOOK } from '../../data/budget-data';
import type {
  Basis,
  BudgetCodeEntry,
  Comment,
  Transaction,
  ProjectFundInputMode,
  SettlementSheetPolicy,
} from '../../data/types';
import { normalizeSettlementSheetPolicy } from '../../data/types';
import { parseNumber } from '../../platform/csv-utils';
import {
  computeEvidenceStatus,
  computeEvidenceSummary,
  resolveEvidenceCompletedDesc,
  resolveEvidenceCompletedManualDesc,
} from '../../platform/evidence-helpers';
import { buildDriveTransactionFolderName, deriveEvidenceLabelFromFileName, inferEvidenceCategoryFromFileName, suggestEvidenceUploadFileName } from '../../platform/drive-evidence';
import {
  CASHFLOW_LINE_OPTIONS,
  SETTLEMENT_COLUMNS,
  SETTLEMENT_COLUMN_GROUPS,
  createEmptyImportRow,
  createQuickEntryImportRow,
  importRowToTransaction,
  type ImportRow,
  type SettlementQuickInsertKind,
} from '../../platform/settlement-csv';
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
  countConfirmedImportRowReviews,
  countPendingImportRowReviews,
} from '../../platform/settlement-review';
import {
  findSimilarCounterparty,
  type CounterpartySuggestion,
} from '../../platform/counterparty-normalizer';
import { resolveEvidenceRequiredByRules } from '../../platform/evidence-rules';
import { matchBudgetCode } from '../../platform/budget-auto-match';
import {
  buildSettlementDerivationContext,
  resolveEvidenceRequiredDesc,
  isSettlementRowMeaningful,
} from '../../platform/settlement-sheet-prepare';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { ActiveCommentAnchor } from './SettlementCommentThreadSheet';
import type { EvidenceUploadDraft } from './SettlementEvidenceUploadDialog';
import { MemoizedImportEditorRow } from './ImportEditorRow';
import {
  buildCommentThreadKey,
  fmt,
  METHOD_LABELS,
  METHOD_OPTIONS,
  CASHFLOW_IN_LINE_IDS,
  normalizeBudgetLabel,
  formatBudgetCodeLabel,
  formatSubCodeLabel,
  toFieldSlug,
  buildSheetRowCommentId,
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

// ── Shared type (re-exported for parent) ──

export interface EvidenceUploadSelection {
  file: File;
  category: string;
  parserCategory: string;
  reviewedFileName: string;
}

export interface PendingQuickInsert {
  kind: SettlementQuickInsertKind;
  token: number;
}

const SettlementCommentThreadSheet = lazy(
  () => import('./SettlementCommentThreadSheet').then((module) => ({ default: module.SettlementCommentThreadSheet })),
);
const SettlementEvidenceUploadDialog = lazy(
  () => import('./SettlementEvidenceUploadDialog').then((module) => ({ default: module.SettlementEvidenceUploadDialog })),
);

// ── Import Editor (editable CSV preview) ──

export function ImportEditor({
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
  fullscreen = false,
  comments = [],
  currentUserId = 'pm',
  currentUserName = 'PM',
  onAddComment,
  onProvisionEvidenceDriveById,
  onSyncEvidenceDriveById,
  onUploadEvidenceDriveById,
  onEnsureTransactionPersisted,
  sourceTransactions = [],
  onFetchBudgetSuggestion,
  workflowMode = 'BANK_UPLOAD',
  settlementSheetPolicy,
  pendingQuickInsert,
  onPendingQuickInsertHandled,
  basis,
  onToggleFullscreen,
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
  fullscreen?: boolean;
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
  onFetchBudgetSuggestion?: (counterparty: string) => Promise<{ budgetCategory: string; budgetSubCategory: string } | null>;
  workflowMode?: ProjectFundInputMode;
  settlementSheetPolicy?: SettlementSheetPolicy;
  pendingQuickInsert?: PendingQuickInsert | null;
  onPendingQuickInsertHandled?: () => void;
  basis?: Basis;
  onToggleFullscreen?: () => void;
}) {
  const isInlineLayout = inline && !fullscreen;

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  const resolvedPolicy = useMemo(
    () => normalizeSettlementSheetPolicy(settlementSheetPolicy, workflowMode),
    [settlementSheetPolicy, workflowMode],
  );
  const meaningfulRows = useMemo(
    () => rows.filter((row) => isSettlementRowMeaningful(row)),
    [rows],
  );
  const errorCount = meaningfulRows.filter((r) => r.error).length;
  const validCount = meaningfulRows.length - errorCount;
  const importedRowCount = useMemo(
    () => meaningfulRows.filter((row) => Boolean(row.sourceTxId)).length,
    [meaningfulRows],
  );
  const manuallyEditedRowCount = useMemo(
    () => meaningfulRows.filter((row) => (row.userEditedCells?.size || 0) > 0).length,
    [meaningfulRows],
  );
  const quickEntryRowCount = useMemo(
    () => meaningfulRows.filter((row) => row.entryKind && row.entryKind !== 'STANDARD').length,
    [meaningfulRows],
  );
  const reviewRequiredRowCount = useMemo(
    () => countPendingImportRowReviews(meaningfulRows),
    [meaningfulRows],
  );
  const reviewConfirmedRowCount = useMemo(
    () => countConfirmedImportRowReviews(meaningfulRows),
    [meaningfulRows],
  );
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

  // ── 비목 제안: 거래처 히스토리 → 코드북 fuzzy cascade ──
  const [budgetSuggestionsMap, setBudgetSuggestionsMap] = useState<Record<string, { budgetCategory: string; budgetSubCategory: string; confidence?: 'history' | 'codebook' } | null>>({});
  const pendingBudgetFetches = useRef<Set<string>>(new Set());
  const [counterpartyHintMap, setCounterpartyHintMap] = useState<Record<string, CounterpartySuggestion | null>>({});
  // 비목 제안 수락률 통계 (세션 내 카운트)
  const [acceptStats, setAcceptStats] = useState<{ history: number; codebook: number }>({ history: 0, codebook: 0 });

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

  // 거래처 입력 후 비목이 비어있는 행에 대해 히스토리 → 코드북 cascade 제안
  // 1. BFF 히스토리 hit → 즉시 사용
  // 2. BFF miss + 코드북 있음 → 코드북 fuzzy match (confidence: 'codebook')
  // 3. 둘 다 miss → null (칩 미표시)
  useEffect(() => {
    if (!onFetchBudgetSuggestion || counterpartyIdx < 0 || budgetCodeIdx < 0) return;
    const codebook = budgetCodeBook ?? [];
    for (const row of rows) {
      const counterparty = String(row.cells[counterpartyIdx] || '').trim();
      const budgetCode = String(row.cells[budgetCodeIdx] || '').trim();
      if (!counterparty || budgetCode) continue;
      const key = `${row.tempId}::${counterparty}`;
      if (pendingBudgetFetches.current.has(key) || key in budgetSuggestionsMap) continue;
      pendingBudgetFetches.current.add(key);
      const memo = memoIdx >= 0 ? String(row.cells[memoIdx] || '').trim() : '';
      const cashflowLabel = cashflowIdx >= 0 ? String(row.cells[cashflowIdx] || '').trim() : '';
      onFetchBudgetSuggestion(counterparty).then((suggestion) => {
        pendingBudgetFetches.current.delete(key);
        if (suggestion) {
          setBudgetSuggestionsMap((prev) => ({ ...prev, [key]: suggestion }));
          return;
        }
        // BFF miss → 코드북 fuzzy fallback
        if (codebook.length > 0) {
          const local = matchBudgetCode(counterparty, memo, cashflowLabel, codebook);
          if (local.confidence !== 'none') {
            setBudgetSuggestionsMap((prev) => ({
              ...prev,
              [key]: { budgetCategory: local.budgetCategory, budgetSubCategory: local.budgetSubCategory, confidence: 'codebook' as const },
            }));
            return;
          }
        }
        setBudgetSuggestionsMap((prev) => ({ ...prev, [key]: null }));
      }).catch(() => {
        pendingBudgetFetches.current.delete(key);
      });
    }
  }, [rows, onFetchBudgetSuggestion, counterpartyIdx, budgetCodeIdx, budgetSuggestionsMap, budgetCodeBook, memoIdx, cashflowIdx]);

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
  const selectionSummary = useMemo(() => {
    if (!selectionBounds) return null;
    return {
      rowCount: selectionBounds.r2 - selectionBounds.r1 + 1,
      colCount: selectionBounds.c2 - selectionBounds.c1 + 1,
    };
  }, [selectionBounds]);
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
      { policy: resolvedPolicy },
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
    () => buildSettlementDerivationContext(projectId, defaultLedgerId, resolvedPolicy, basis),
    [projectId, defaultLedgerId, resolvedPolicy, basis],
  );

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = updateImportRowAt(rows, rowIdx, (r) => {
        const cells = [...r.cells];
        cells[colIdx] = value;
        const userEditedCells = new Set(r.userEditedCells);
        userEditedCells.add(colIdx);
        return { ...r, cells, userEditedCells };
      });

      const mode = colIdx === cashflowIdx
        ? 'row'
        : isSettlementCascadeColumn(colIdx, settlementDerivationContext)
          ? 'cascade'
          : 'row';
      onChange(deriveSettlementRows(next, settlementDerivationContext, { mode, rowIdx }));

      // 거래처 셀 변경 시 오타 탐지
      if (colIdx === counterpartyIdx && value.trim()) {
        const targetRow = rows[rowIdx];
        if (targetRow) {
          const existingCounterparties = rows
            .filter((_, idx) => idx !== rowIdx)
            .map((r) => String(r.cells[counterpartyIdx] || '').trim())
            .filter(Boolean);
          const hint = findSimilarCounterparty(value.trim(), existingCounterparties);
          setCounterpartyHintMap((prev) => ({ ...prev, [targetRow.tempId]: hint }));
        }
      }
    },
    [rows, onChange, cashflowIdx, settlementDerivationContext, counterpartyIdx],
  );

  const updateRow = useCallback(
    (rowIdx: number, updater: (row: ImportRow) => ImportRow) => {
      const next = updateImportRowAt(rows, rowIdx, (r) => {
        let updated = updater(r);
        if (budgetCodeIdx >= 0 && subCodeIdx >= 0 && evidenceIdx >= 0) {
          const budgetCode = updated.cells[budgetCodeIdx] || '';
          const subCode = updated.cells[subCodeIdx] || '';
          // 1순위: 프로젝트별 evidenceRequiredMap
          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
          if (mapped) {
            const cells = [...updated.cells];
            cells[evidenceIdx] = mapped;
            updated = { ...updated, cells };
          } else {
            // 2순위: 기본 규칙표 fallback
            const amountStr = (expenseIdx >= 0 ? updated.cells[expenseIdx] : '')
              || (bankAmountIdx >= 0 ? updated.cells[bankAmountIdx] : '')
              || '';
            const ruleResult = resolveEvidenceRequiredByRules(budgetCode, subCode, amountStr);
            if (ruleResult) {
              const cells = [...updated.cells];
              cells[evidenceIdx] = ruleResult;
              updated = { ...updated, cells };
            }
          }
        }
        return updated;
      });
      onChange(deriveSettlementRows(next, settlementDerivationContext, { mode: 'row', rowIdx }));
    },
    [rows, onChange, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap, settlementDerivationContext, expenseIdx, bankAmountIdx],
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

  const insertPreparedRow = useCallback((preparedRow: ImportRow, focusColIdx?: number) => {
    const anchor = getSelectionAnchor();
    const insertIndex = anchor ? Math.min(rows.length, anchor.rowIdx + 1) : rows.length;
    const nextRows = [
      ...rows.slice(0, insertIndex),
      preparedRow,
      ...rows.slice(insertIndex),
    ];
    commitRows(nextRows, { rowIdx: insertIndex, colIdx: focusColIdx ?? getPreferredEditableCol() });
  }, [rows, getSelectionAnchor, commitRows, getPreferredEditableCol]);

  const addQuickInsertRow = useCallback((kind: SettlementQuickInsertKind) => {
    if (kind === 'ADJUSTMENT' && !resolvedPolicy.allowAdjustmentRows) {
      toast.message('현재 사업 정책에서는 잔액 조정 행을 사용할 수 없습니다.');
      return;
    }
    const preparedRow = createQuickEntryImportRow(kind);
    const focusColIdx = kind === 'DEPOSIT'
      ? (depositIdx >= 0 ? depositIdx : bankAmountIdx)
      : kind === 'EXPENSE'
        ? (expenseIdx >= 0 ? expenseIdx : bankAmountIdx)
        : (balanceIdx >= 0 ? balanceIdx : bankAmountIdx);
    insertPreparedRow(preparedRow, focusColIdx >= 0 ? focusColIdx : undefined);
  }, [insertPreparedRow, depositIdx, expenseIdx, balanceIdx, bankAmountIdx, resolvedPolicy.allowAdjustmentRows]);

  const addRows = useCallback((count: number) => {
    if (count <= 0) return;
    const nextRows = [...rows];
    for (let i = 0; i < count; i++) {
      const newRow = createEmptyImportRow();
      nextRows.push(newRow);
    }
    commitRows(nextRows);
  }, [rows, commitRows]);

  useEffect(() => {
    if (!pendingQuickInsert) return;
    addQuickInsertRow(pendingQuickInsert.kind);
    onPendingQuickInsertHandled?.();
  }, [pendingQuickInsert, addQuickInsertRow, onPendingQuickInsertHandled]);

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
    if (!resolvedPolicy.allowRowDelete) {
      toast.message('현재 사업 정책에서는 행 삭제가 잠겨 있습니다.');
      return false;
    }
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
  }, [commitRows, getActiveSelectionBounds, getPreferredEditableCol, pushUndoSnapshot, resolvedPolicy.allowRowDelete, rows]);

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
      // Modal/form inputs handle their own paste — don't intercept
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;

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
      if (!resolvedPolicy.allowRowDelete) {
        toast.message('현재 사업 정책에서는 행 삭제가 잠겨 있습니다.');
        return;
      }
      const nextRows = deleteSelectedRows(rows, { r1: rowIdx, r2: rowIdx, c1: 0, c2: SETTLEMENT_COLUMNS.length - 1 });
      if (nextRows === rows) return;
      pushUndoSnapshot();
      setSelection(null);
      const nextFocusRow = Math.min(Math.max(0, rowIdx - 1), Math.max(0, nextRows.length - 1));
      commitRows(nextRows, nextRows.length > 0 ? { rowIdx: nextFocusRow, colIdx: getPreferredEditableCol() } : null);
    },
    [rows, pushUndoSnapshot, commitRows, getPreferredEditableCol, resolvedPolicy.allowRowDelete],
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
        const result = importRowToTransaction(updated, projectId, defaultLedgerId, i, { policy: resolvedPolicy });
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
        const result = importRowToTransaction(updated, projectId, defaultLedgerId, rowIdx, { policy: resolvedPolicy });
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
      <div
        className={isInlineLayout
          ? 'relative flex flex-col overflow-visible rounded-lg border bg-background'
          : fullscreen
            ? 'fixed inset-3 z-[70] flex flex-col overflow-hidden rounded-[28px] border bg-background/98 shadow-2xl backdrop-blur-xl'
            : 'fixed inset-0 z-50 flex flex-col bg-background/95'}
      >
      {authorListId && (
        <datalist id={authorListId}>
          {(authorOptions || []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {/* Toolbar */}
      <div className={`shrink-0 border-b bg-muted/20 ${isInlineLayout ? 'sticky top-0 z-20' : ''}`}>
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold">정산대장 편집</h3>
              <Badge variant="default" className="text-[10px]">{validCount}건 저장 가능</Badge>
              {errorCount > 0 && (
                <Badge variant="destructive" className="text-[10px]">{errorCount}건 수정 필요</Badge>
              )}
              {missingCount > 0 && (
                <Badge variant="secondary" className="text-[10px] text-red-600">{missingCount}건 미입력</Badge>
              )}
              {reviewRequiredRowCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                  사람 확인 {reviewRequiredRowCount}건
                </Badge>
              )}
              {reviewConfirmedRowCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                  확인 완료 {reviewConfirmedRowCount}건
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-full border bg-background px-2 py-1">업로드 반영 {importedRowCount}건</span>
              <span className="rounded-full border bg-background px-2 py-1">수동 수정 {manuallyEditedRowCount}건</span>
              <span className="rounded-full border bg-background px-2 py-1">빠른 입력 {quickEntryRowCount}건</span>
              {(acceptStats.history + acceptStats.codebook > 0) && (
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-teal-700">
                  비목 제안 수락 {acceptStats.history + acceptStats.codebook}건
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right text-[11px] text-muted-foreground">
            <div>행 왼쪽 배지에서 출처를 확인할 수 있습니다.</div>
            <div>사람 확인이 필요한 후보값은 확인 완료 전까지 캐시플로 반영이 보류됩니다.</div>
            {onToggleFullscreen && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-[11px] shadow-sm"
                onClick={onToggleFullscreen}
              >
                {fullscreen ? <Minimize2 className="mr-1 h-3.5 w-3.5" /> : <Maximize2 className="mr-1 h-3.5 w-3.5" />}
                {fullscreen ? '기본 화면으로' : '전체 화면 편집'}
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t bg-background/80">
          <div className="flex flex-wrap items-center gap-2">
            {selectionSummary ? (
              <>
                <Badge variant="outline" className="text-[10px]">
                  선택 영역 {selectionSummary.rowCount}행 x {selectionSummary.colCount}열
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
                  onClick={() => {
                    void clearSelectedCells();
                  }}
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
                  disabled={selectedRowIdx < 0 || rows.length === 0 || !resolvedPolicy.allowRowDelete}
                >
                  <X className="h-3.5 w-3.5" />
                  선택 행 삭제
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setSelection(null)}
                >
                  선택 해제
                </Button>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                셀이나 행을 선택하면 대량 작업 액션이 여기에 나타납니다.
              </span>
            )}
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
          {workflowMode === 'DIRECT_ENTRY' && (
            <>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm"
                onClick={() => addQuickInsertRow('DEPOSIT')}
              >
                <Plus className="h-3.5 w-3.5" />
                입금 추가
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
                onClick={() => addQuickInsertRow('EXPENSE')}
              >
                <Plus className="h-3.5 w-3.5" />
                지출 추가
              </Button>
              {resolvedPolicy.allowAdjustmentRows && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 cursor-pointer shadow-sm hover:bg-muted/40"
                  onClick={() => addQuickInsertRow('ADJUSTMENT')}
                >
                  <Plus className="h-3.5 w-3.5" />
                  잔액 조정
                </Button>
              )}
            </>
          )}
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

      <div className="space-y-3">
        <div className="rounded-lg border bg-slate-50/70 px-3 py-2 text-[10px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">원본: 통장내역 또는 기존 저장값</span>
            <span className="inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-teal-700">수정: 사용자가 직접 덮어쓴 값</span>
            <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">계산: 정책에 따라 자동 계산되고 잠긴 값</span>
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">검토/확인: 수식 후보값 확인 필요</span>
          </div>
        </div>
        {/* Scrollable table */}
        <div
          className={`min-w-0 flex-1 ${isInlineLayout ? 'overflow-auto max-h-[calc(100vh-260px)]' : 'flex-1 overflow-auto'}`}
          onPaste={handleTablePaste}
          onKeyDownCapture={handleTableKeyDown}
          tabIndex={0}
          ref={tableWrapRef}
        >
          <table className="w-full text-[11px] border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 96 }} />
            {SETTLEMENT_COLUMNS.map((_, i) => (
              <col key={i} style={{ width: colWidths[i] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            {/* Group header */}
            <tr className="bg-slate-100 dark:bg-slate-800">
              <th className="px-1 py-1 border-b border-r text-center text-[9px] w-24">상태</th>
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
              <th className="px-1 py-1 border-b border-r text-[9px] w-24">행 정보</th>
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
              const counterpartyVal = counterpartyIdx >= 0 ? String(row.cells[counterpartyIdx] || '').trim() : '';
              const budgetCodeVal = budgetCodeIdx >= 0 ? String(row.cells[budgetCodeIdx] || '').trim() : '';
              const suggestionKey = `${row.tempId}::${counterpartyVal}`;
              const budgetSuggestion = (onFetchBudgetSuggestion && !budgetCodeVal && counterpartyVal)
                ? (budgetSuggestionsMap[suggestionKey] ?? null)
                : null;
              const counterpartyHint = counterpartyHintMap[row.tempId] ?? null;
              return (
              <MemoizedImportEditorRow
                key={`${row.tempId}-${rowIdx}`}
                row={row}
                rowIdx={rowIdx}
                budgetSuggestion={budgetSuggestion}
                counterpartyHint={counterpartyHint}
                onCellChange={(colIdx, value) => updateCell(rowIdx, colIdx, value)}
                onRowChange={(updater) => updateRow(rowIdx, updater)}
                onRemove={() => removeRow(rowIdx)}
                onInsertBelow={() => insertRowAt(rowIdx + 1)}
                settlementSheetPolicy={resolvedPolicy}
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
                evidenceCompletedIdx={evidenceCompletedIdx}
                evidencePendingIdx={evidencePendingIdx}
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
                onBudgetSuggestionAccepted={(confidence) => {
                  setAcceptStats((prev) => ({ ...prev, [confidence]: prev[confidence] + 1 }));
                }}
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
              const initialCategory = parserCategory === '기타'
                ? deriveEvidenceLabelFromFileName(file.name)
                : parserCategory;
              const suggestedFileName = suggestEvidenceUploadFileName({
                originalFileName: file.name,
                category: initialCategory,
                transaction: sourceTransaction,
              });
              return {
                id: `${batchId}-${index}-${file.name}`,
                file,
                objectUrl: URL.createObjectURL(file),
                category: initialCategory,
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
